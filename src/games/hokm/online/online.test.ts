import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Seat, Suit } from '../engine/types';
import { COUNTER_CLOCKWISE_ORDER } from '../engine/turns';
import { getLegalCards } from '../engine/rules';
import {
  rotateSeatForViewer,
  unrotateSeatFromViewer,
  rotateTeamForViewer,
} from './perspective';
import { HokmRoomController } from './roomController';
import { parseClientMessage, PROTOCOL_VERSION } from './protocol';
import {
  buildOnlineHttpUrl,
  buildOnlineWsUrl,
  resolveOnlineApiBase,
} from './client';
import { EyvanDatabase } from '../../../../server/database';
import { HokmRoomManager } from '../../../../server/roomManager';
import {
  buildClearSessionCookieHeader,
  buildSetSessionCookieHeader,
} from '../../../../cloudflare/src/lib/sessionCookie';


function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function setupReadyFourPlayerRoom(seed = 42, nowFn?: () => number) {
  const controller = new HokmRoomController({
    roomId: 'room_test_1',
    roomCode: 'K7M4P2',
    targetMatchScore: 3,
    disconnectGraceMs: 60_000,
    rng: makeSeededRng(seed),
    now: nowFn,
  });

  const names = ['amir_rad', 'sohrab_k', 'parvin_sh', 'farhad_n'];
  const members = names.map((username) => {
    const res = controller.joinPlayer({ username, avatarCode: 'portrait' });
    assert.equal(res.ok, true);
    if (!res.ok) throw new Error('join failed');
    const auth = controller.authenticateConnection(
      res.member.playerId,
      res.member.sessionToken
    );
    assert.equal(auth.ok, true);
    return res.member;
  });

  members.forEach((m, i) => {
    const r = controller.setReady(m.playerId, true, `ready_act_${i}_12345678`);
    assert.equal(r.ok, true);
  });

  return { controller, members };
}

describe('Online Hokm Perspective Rotation', () => {
  it('rotates every seat bijectively and preserves counter-clockwise order', () => {
    for (const viewer of COUNTER_CLOCKWISE_ORDER) {
      assert.equal(rotateSeatForViewer(viewer, viewer), 'south');

      const seen = new Set<Seat>();
      for (const canonical of COUNTER_CLOCKWISE_ORDER) {
        const visual = rotateSeatForViewer(canonical, viewer);
        seen.add(visual);
        assert.equal(unrotateSeatFromViewer(visual, viewer), canonical);
      }
      assert.equal(seen.size, 4);

      // Next counter-clockwise canonical seat must map to visual 'east'
      const vIdx = COUNTER_CLOCKWISE_ORDER.indexOf(viewer);
      const nextCanonical = COUNTER_CLOCKWISE_ORDER[(vIdx + 1) % 4];
      const partnerCanonical = COUNTER_CLOCKWISE_ORDER[(vIdx + 2) % 4];
      const prevCanonical = COUNTER_CLOCKWISE_ORDER[(vIdx + 3) % 4];
      assert.equal(rotateSeatForViewer(nextCanonical, viewer), 'east');
      assert.equal(rotateSeatForViewer(partnerCanonical, viewer), 'north');
      assert.equal(rotateSeatForViewer(prevCanonical, viewer), 'west');
    }

    assert.equal(rotateTeamForViewer('myTeam', 'south'), 'myTeam');
    assert.equal(rotateTeamForViewer('myTeam', 'north'), 'myTeam');
    assert.equal(rotateTeamForViewer('opponentTeam', 'east'), 'myTeam');
    assert.equal(rotateTeamForViewer('myTeam', 'east'), 'opponentTeam');
  });
});

describe('Online Hokm Room Rules & Security Boundaries', () => {
  it('blocks 5th player, duplicate usernames, unready/non-host starts, and migrates host on leave', () => {
    const { controller, members } = setupReadyFourPlayerRoom(7);

    // 5th player strictly blocked
    const fifth = controller.joinPlayer({ username: 'extra_player' });
    assert.equal(fifth.ok, false);
    if (!fifth.ok) assert.equal(fifth.code, 'ROOM_FULL');

    // Non-host cannot start
    const nonHostStart = controller.startMatch(
      members[1].playerId,
      'start_nonhost_123456'
    );
    assert.equal(nonHostStart.ok, false);
    assert.equal(nonHostStart.errorCode, 'NOT_HOST');

    // Unready blocks host start
    controller.setReady(members[2].playerId, false, 'unready_act_123456');
    const unreadyStart = controller.startMatch(
      members[0].playerId,
      'start_unready_123456'
    );
    assert.equal(unreadyStart.ok, false);
    assert.equal(unreadyStart.errorCode, 'NOT_ALL_READY');

    // Host leaves -> host migrates to next oldest member (members[1])
    const leaveRes = controller.leaveRoom(members[0].playerId, 'leave_host_123456');
    assert.equal(leaveRes.ok, true);
    const snap = controller.getSnapshotForPlayer(members[1].playerId);
    assert.ok(snap);
    assert.equal(snap.hostPlayerId, members[1].playerId);

    // Duplicate username rejected when trying to fill freed seat
    const dupJoin = controller.joinPlayer({ username: 'sohrab_k' });
    assert.equal(dupJoin.ok, false);
    if (!dupJoin.ok) assert.equal(dupJoin.code, 'DUPLICATE_PLAYER');

    // Empty room auto-closes
    controller.leaveRoom(members[1].playerId, 'leave_m1_12345678');
    controller.leaveRoom(members[2].playerId, 'leave_m2_12345678');
    controller.leaveRoom(members[3].playerId, 'leave_m3_12345678');
    assert.equal(controller.getStatus(), 'CLOSED');
  });

  it('strictly enforces card secrecy across all 4 players (ZERO opponent/deck leaks)', () => {
    const { controller, members } = setupReadyFourPlayerRoom(99);
    const start = controller.startMatch(members[0].playerId, 'start_match_123456');
    assert.equal(start.ok, true);

    const assertZeroLeaks = () => {
      const authState = controller.getAuthoritativeGameState();
      assert.ok(authState);

      for (const viewer of members) {
        const snap = controller.getSnapshotForPlayer(viewer.playerId);
        assert.ok(snap);
        const serialized = JSON.stringify(snap);

        // Must never leak session tokens
        for (const m of members) {
          assert.equal(
            serialized.includes(m.sessionToken),
            false,
            'Session token leaked in snapshot!'
          );
        }

        // Must never contain any card from another player's hand or undealt deck
        for (const other of members) {
          if (other.playerId === viewer.playerId) continue;
          for (const card of authState.hands[other.canonicalSeat]) {
            assert.equal(
              serialized.includes(`"${card.id}"`),
              false,
              `Opponent card ${card.id} leaked to ${viewer.username}!`
            );
          }
        }
        for (const deckCard of authState.deck) {
          assert.equal(
            serialized.includes(`"${deckCard.id}"`),
            false,
            `Undealt deck card ${deckCard.id} leaked to ${viewer.username}!`
          );
        }

        // Viewer MUST have their exact own hand count
        assert.equal(
          snap.game?.myHand.length,
          authState.hands[viewer.canonicalSeat].length
        );
      }
    };

    // Audit during CHOOSING_TRUMP (5 cards dealt, 32 in deck)
    assertZeroLeaks();

    // Hakem chooses trump -> remaining 8 dealt -> audit during PLAYING_TRICK
    const authState = controller.getAuthoritativeGameState()!;
    const hakemMember = members.find((m) => m.canonicalSeat === authState.hakem)!;
    const trumpRes = controller.chooseTrump(
      hakemMember.playerId,
      'spades',
      'trump_act_12345678'
    );
    assert.equal(trumpRes.ok, true);
    assertZeroLeaks();
  });

  it('validates illegal moves, action idempotency, disconnect/reconnect, and plays full match to 3', () => {
    let clock = 1_700_000_000_000;
    const { controller, members } = setupReadyFourPlayerRoom(1234, () => clock);

    assert.equal(
      controller.startMatch(members[0].playerId, 'start_full_123456').ok,
      true
    );

    // Non-Hakem trump choice rejected
    const initialHakem = controller.getAuthoritativeGameState()!.hakem;
    const nonHakem = members.find((m) => m.canonicalSeat !== initialHakem)!;
    const badTrump = controller.chooseTrump(
      nonHakem.playerId,
      'hearts',
      'bad_trump_123456'
    );
    assert.equal(badTrump.ok, false);
    assert.equal(badTrump.errorCode, 'NOT_HAKEM');

    // Wrong token rejected on reconnect
    const badAuth = controller.authenticateConnection(
      members[1].playerId,
      '00000000000000000000000000000000'
    );
    assert.equal(badAuth.ok, false);

    // Simulate mid-match disconnect & reconnect recovery for members[1]
    const disc = controller.markPlayerDisconnected(members[1].playerId);
    assert.equal(disc.ok, true);
    clock += 15_000; // within 60s grace window
    assert.equal(controller.sweepExpiredDisconnects().shouldBroadcast, false);
    assert.equal(controller.getStatus(), 'PLAYING');

    const reconn = controller.authenticateConnection(
      members[1].playerId,
      members[1].sessionToken
    );
    assert.equal(reconn.ok, true);
    if (reconn.ok) assert.equal(reconn.wasReconnect, true);

    // Play a full match to 3 points using server-authoritative validation
    let actionSeq = 0;
    let completedRecord = null;
    let guard = 0;
    let testedIdempotency = false;
    let testedFollowSuit = false;
    let testedOutOfTurn = false;

    while (controller.getStatus() === 'PLAYING' && guard < 400) {
      guard += 1;
      const st = controller.getAuthoritativeGameState()!;

      if (st.phase === 'CHOOSING_TRUMP') {
        const hakem = members.find((m) => m.canonicalSeat === st.hakem)!;
        const suit: Suit = (['spades', 'hearts', 'diamonds', 'clubs'] as Suit[])[
          st.handNumber % 4
        ];
        const res = controller.chooseTrump(
          hakem.playerId,
          suit,
          `trump_${++actionSeq}_123456`
        );
        assert.equal(res.ok, true);
        continue;
      }

      if (st.phase === 'PLAYING_TRICK') {
        const actor = members.find((m) => m.canonicalSeat === st.currentTurn)!;
        const other = members.find((m) => m.canonicalSeat !== st.currentTurn)!;

        // Test out-of-turn rejection once
        if (!testedOutOfTurn) {
          const otherHand = st.hands[other.canonicalSeat];
          const rej = controller.playCardMove(
            other.playerId,
            otherHand[0].id,
            `out_of_turn_${++actionSeq}_1234`
          );
          assert.equal(rej.ok, false);
          assert.equal(rej.errorCode, 'NOT_YOUR_TURN');
          testedOutOfTurn = true;
        }

        const hand = st.hands[actor.canonicalSeat];
        const legal = getLegalCards(hand, st.currentTrick);

        // Test follow-suit enforcement when player holds both legal and illegal cards
        if (!testedFollowSuit && legal.length < hand.length) {
          const legalSet = new Set(legal.map((c) => c.id));
          const illegalCard = hand.find((c) => !legalSet.has(c.id))!;
          const rej = controller.playCardMove(
            actor.playerId,
            illegalCard.id,
            `illegal_suit_${++actionSeq}_123`
          );
          assert.equal(rej.ok, false);
          assert.equal(rej.errorCode, 'MUST_FOLLOW_SUIT');
          testedFollowSuit = true;
        }

        const playActionId = `play_${++actionSeq}_12345678`;
        const playRes = controller.playCardMove(
          actor.playerId,
          legal[0].id,
          playActionId
        );
        assert.equal(playRes.ok, true);

        // Test duplicate actionId idempotency once
        if (!testedIdempotency) {
          const dupRes = controller.playCardMove(
            actor.playerId,
            legal[0].id,
            playActionId
          );
          assert.equal(dupRes.ok, true);
          assert.equal(dupRes.duplicate, true);
          assert.equal(dupRes.shouldBroadcast, false);
          testedIdempotency = true;
        }
        continue;
      }

      if (st.phase === 'TRICK_COMPLETE') {
        const res = controller.resolveCompletedTrick();
        assert.equal(res.ok, true);
        if (res.completedMatch) {
          completedRecord = res.completedMatch;
        }
        continue;
      }

      if (st.phase === 'HAND_COMPLETE') {
        const res = controller.advanceToNextHand();
        assert.equal(res.ok, true);
        continue;
      }
    }

    assert.equal(controller.getStatus(), 'FINISHED');
    assert.ok(completedRecord, 'Expected completedMatch record at match end');
    assert.equal(testedOutOfTurn, true);
    assert.equal(testedIdempotency, true);
    assert.equal(testedFollowSuit, true);
    assert.ok(
      completedRecord.teamAScore >= 3 || completedRecord.teamBScore >= 3
    );

    // Persist completed match into in-memory D1-schema SQLite DB & verify idempotent writes
    const db = new EyvanDatabase(':memory:');
    db.recordCompletedMatch(completedRecord);
    db.recordCompletedMatch(completedRecord); // duplicate call must not double-count stats!

    const recent = db.getRecentMatches(5);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].matchId, completedRecord.matchId);
    assert.equal(recent[0].players.length, 4);

    for (const p of completedRecord.players) {
      const stats = db.getPlayerStats(p.username);
      assert.equal(stats.matchesPlayed, 1);
      assert.equal(stats.wins, p.won ? 1 : 0);
      assert.equal(stats.losses, p.won ? 0 : 1);
    }
    db.close();
  });

  it('closes room cleanly if disconnected player exceeds grace period', () => {
    let clock = 1_700_000_000_000;
    const { controller, members } = setupReadyFourPlayerRoom(55, () => clock);
    controller.startMatch(members[0].playerId, 'start_grace_123456');

    controller.markPlayerDisconnected(members[2].playerId);
    clock += 61_000; // past 60s grace period
    const sweep = controller.sweepExpiredDisconnects();
    assert.equal(sweep.shouldBroadcast, true);
    assert.equal(sweep.event?.type, 'ROOM_CLOSED');
    assert.equal(controller.getStatus(), 'CLOSED');
  });

  it('validates WebSocket client protocol messages strictly', () => {
    const valid = parseClientMessage(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: 'play_card',
        actionId: 'act_1234567890',
        cardId: 'spades-A',
      })
    );
    assert.equal(valid.ok, true);

    const badCard = parseClientMessage(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: 'play_card',
        actionId: 'act_1234567890',
        cardId: 'spades-99',
      })
    );
    assert.equal(badCard.ok, false);

    const badVersion = parseClientMessage(
      JSON.stringify({
        protocolVersion: 999,
        type: 'ping',
        clientTime: Date.now(),
      })
    );
    assert.equal(badVersion.ok, false);
    if (!badVersion.ok) assert.equal(badVersion.code, 'UNSUPPORTED_PROTOCOL');
  });

  it('roundtrips persisted room state faithfully across restarts and preserves actionId idempotency', () => {
    let clock = 1_700_000_000_000;
    const { controller, members } = setupReadyFourPlayerRoom(88, () => clock);

    assert.equal(
      controller.startMatch(members[0].playerId, 'start_persist_1234').ok,
      true
    );
    const hakemSeat = controller.getAuthoritativeGameState()!.hakem;
    const hakem = members.find((m) => m.canonicalSeat === hakemSeat)!;
    assert.equal(
      controller.chooseTrump(hakem.playerId, 'hearts', 'trump_persist_1234').ok,
      true
    );

    const exported = controller.exportPersistedState();
    const cloned = structuredClone(exported);
    const restored = HokmRoomController.fromPersistedState(cloned, {
      now: () => clock,
      rng: makeSeededRng(88),
    });

    assert.equal(restored.roomCode, controller.roomCode);
    assert.equal(restored.getStatus(), 'PLAYING');
    assert.equal(restored.getStateVersion(), controller.getStateVersion());
    assert.deepEqual(
      restored.getSnapshotForPlayer(members[0].playerId),
      controller.getSnapshotForPlayer(members[0].playerId)
    );

    // Action idempotency cache survived serialization
    const replay = restored.chooseTrump(
      hakem.playerId,
      'hearts',
      'trump_persist_1234'
    );
    assert.equal(replay.ok, true);
    assert.equal(replay.duplicate, true);
  });

  it('prevents stale connectionId disconnect from affecting a newer active connection and expires abandoned HTTP joins', () => {
    let clock = 1_700_000_000_000;
    const ctrl = new HokmRoomController({
      roomId: 'room_conn_race',
      roomCode: 'R9T4W2',
      disconnectGraceMs: 30_000,
      now: () => clock,
    });

    const p1 = ctrl.joinPlayer({ username: 'amir_race' });
    const p2 = ctrl.joinPlayer({ username: 'abandoned_http' });
    assert.equal(p1.ok && p2.ok, true);
    if (!p1.ok || !p2.ok) return;

    // p1 connects on conn_1, then reconnects concurrently on conn_2
    const auth1 = ctrl.authenticateConnection(
      p1.member.playerId,
      p1.member.sessionToken,
      'conn_1'
    );
    assert.equal(auth1.ok, true);

    const auth2 = ctrl.authenticateConnection(
      p1.member.playerId,
      p1.member.sessionToken,
      'conn_2'
    );
    assert.equal(auth2.ok, true);
    if (auth2.ok) assert.equal(auth2.previousConnectionId, 'conn_1');

    // Stale conn_1 closing MUST be ignored
    const staleDisc = ctrl.markPlayerDisconnected(p1.member.playerId, 'conn_1');
    assert.equal(staleDisc.shouldBroadcast, false);
    assert.equal(ctrl.isActiveConnection(p1.member.playerId, 'conn_2'), true);
    assert.equal(ctrl.isActiveConnection(p1.member.playerId, 'conn_1'), false);

    // p2 joined via HTTP only and never connected -> expires after grace window!
    clock += 31_000;
    const sweep = ctrl.sweepExpiredDisconnects();
    assert.equal(sweep.shouldBroadcast, true);
    assert.equal(ctrl.getPublicSummary().playerCount, 1);
  });

  it('consolidates mixed-case usernames (Amir vs amir) in EyvanDatabase without duplicate stats', () => {
    const db = new EyvanDatabase(':memory:');
    db.upsertUser('Amir_Dev', 'portrait', 1000);
    db.upsertUser('amir_dev', 'shamsa', 2000);

    db.recordCompletedMatch({
      matchId: 'local_case_1',
      roomCode: 'LOC111',
      startedAt: 1000,
      finishedAt: 2000,
      winningTeam: 'myTeam',
      teamAScore: 3,
      teamBScore: 0,
      targetScore: 3,
      lastWinType: 'normal',
      handsPlayed: 3,
      players: [
        { playerId: 'a1', username: 'Amir_Dev', canonicalSeat: 'south', team: 'myTeam', won: true },
        { playerId: 'a2', username: 'P2_User', canonicalSeat: 'east', team: 'opponentTeam', won: false },
        { playerId: 'a3', username: 'P3_User', canonicalSeat: 'north', team: 'myTeam', won: true },
        { playerId: 'a4', username: 'P4_User', canonicalSeat: 'west', team: 'opponentTeam', won: false },
      ],
    });
    db.recordCompletedMatch({
      matchId: 'local_case_2',
      roomCode: 'LOC222',
      startedAt: 3000,
      finishedAt: 4000,
      winningTeam: 'opponentTeam',
      teamAScore: 1,
      teamBScore: 3,
      targetScore: 3,
      lastWinType: 'normal',
      handsPlayed: 4,
      players: [
        { playerId: 'b1', username: 'amir_dev', canonicalSeat: 'south', team: 'myTeam', won: false },
        { playerId: 'b2', username: 'p2_user', canonicalSeat: 'east', team: 'opponentTeam', won: true },
        { playerId: 'b3', username: 'p3_user', canonicalSeat: 'north', team: 'myTeam', won: false },
        { playerId: 'b4', username: 'p4_user', canonicalSeat: 'west', team: 'opponentTeam', won: true },
      ],
    });

    const stats = db.getPlayerStats('AMIR_DEV');
    assert.equal(stats.matchesPlayed, 2);
    assert.equal(stats.wins, 1);
    assert.equal(stats.losses, 1);
    db.close();
  });

  it('rejects legacy WebSocket auth payloads containing sessionToken', () => {
    const legacyAuth = parseClientMessage(
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        type: 'auth',
        roomCode: 'ABC123',
        playerId: 'p1',
        sessionToken: 'deadbeefdeadbeefdeadbeefdeadbeef',
      })
    );
    assert.equal(legacyAuth.ok, false);
    if (!legacyAuth.ok) assert.equal(legacyAuth.code, 'INVALID_MESSAGE');
  });

  it('standardizes VITE_ONLINE_API_BASE across HTTP, WS, Dev fallback, and URL validation', () => {
    // 1) Dev / unset fallback -> same-origin relative HTTP and window.location WS
    assert.equal(resolveOnlineApiBase({}), '');
    assert.equal(resolveOnlineApiBase({ VITE_ONLINE_API_BASE: '   ' }), '');
    assert.equal(buildOnlineHttpUrl('/api/rooms', {}), '/api/rooms');
    assert.equal(
      buildOnlineWsUrl(
        '/ws/rooms/ABC123',
        {},
        { protocol: 'http:', host: 'localhost:3000' }
      ),
      'ws://localhost:3000/ws/rooms/ABC123'
    );

    // 2) Production HTTPS Worker URL with trailing slash -> cleanly normalized HTTP & WSS
    const prodEnv = {
      VITE_ONLINE_API_BASE: ' https://api.eyvan-hokm.ir/ ',
    };
    assert.equal(resolveOnlineApiBase(prodEnv), 'https://api.eyvan-hokm.ir');
    assert.equal(
      buildOnlineHttpUrl('/api/rooms', prodEnv),
      'https://api.eyvan-hokm.ir/api/rooms'
    );
    assert.equal(
      buildOnlineWsUrl('/ws/rooms/ABC123', prodEnv),
      'wss://api.eyvan-hokm.ir/ws/rooms/ABC123'
    );

    // 3) Subpath prefix support without double slashes
    const subpathEnv = {
      VITE_ONLINE_API_BASE: 'https://eyvan-hokm.ir/worker/',
    };
    assert.equal(
      buildOnlineHttpUrl('api/session/resume', subpathEnv),
      'https://eyvan-hokm.ir/worker/api/session/resume'
    );
    assert.equal(
      buildOnlineWsUrl('/ws/rooms/K7M4P2', subpathEnv),
      'wss://eyvan-hokm.ir/worker/ws/rooms/K7M4P2'
    );

    // 4) Invalid protocol/URL throws clear diagnostic error
    assert.throws(() =>
      resolveOnlineApiBase({ VITE_ONLINE_API_BASE: 'ftp://bad.example' })
    );
    assert.throws(() =>
      resolveOnlineApiBase({ VITE_ONLINE_API_BASE: 'not-a-valid-url' })
    );
  });

  it('keeps sessionToken strictly out of HokmRoomManager public responses and matches Set/Clear cookie Domain & Path attributes', () => {
    const db = new EyvanDatabase(':memory:');
    const manager = new HokmRoomManager({ db, disconnectGraceMs: 60_000 });

    const created = manager.createRoom({
      username: 'amir_local',
      avatarCode: 'portrait',
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    // HTTP DTO response MUST NOT contain sessionToken
    assert.equal(JSON.stringify(created.response).includes('sessionToken'), false);
    assert.equal(typeof created.sessionToken, 'string');
    assert.equal(created.sessionToken.length >= 24, true);

    const joined = manager.joinRoom(created.response.roomCode, {
      username: 'sara_local',
      avatarCode: 'shamsa',
    });
    assert.equal(joined.ok, true);
    if (!joined.ok) return;
    assert.equal(JSON.stringify(joined.response).includes('sessionToken'), false);

    const resumed = manager.resumeSession(
      created.response.roomCode,
      created.response.playerId,
      created.sessionToken
    );
    assert.equal(resumed.ok, true);
    if (resumed.ok) {
      assert.equal(JSON.stringify(resumed.response).includes('sessionToken'), false);
      assert.equal(resumed.response.playerId, created.response.playerId);
    }

    // Wrong token rejected on resume
    const badResume = manager.resumeSession(
      created.response.roomCode,
      created.response.playerId,
      '00000000000000000000000000000000'
    );
    assert.equal(badResume.ok, false);

    // Set-Cookie and Clear-Cookie emit matching Path=/ and optional Domain
    const setHdr = buildSetSessionCookieHeader(
      {
        roomCode: created.response.roomCode,
        playerId: created.response.playerId,
        sessionToken: created.sessionToken,
      },
      true,
      { domain: '.eyvan-hokm.ir' }
    );
    const clearHdr = buildClearSessionCookieHeader(true, {
      domain: '.eyvan-hokm.ir',
    });
    assert.ok(setHdr.includes('HttpOnly'));
    assert.ok(setHdr.includes('Secure'));
    assert.ok(setHdr.includes('Path=/'));
    assert.ok(setHdr.includes('Domain=.eyvan-hokm.ir'));
    assert.ok(clearHdr.includes('Max-Age=0'));
    assert.ok(clearHdr.includes('HttpOnly'));
    assert.ok(clearHdr.includes('Secure'));
    assert.ok(clearHdr.includes('Path=/'));
    assert.ok(clearHdr.includes('Domain=.eyvan-hokm.ir'));

    manager.dispose();
    db.close();
  });
});



