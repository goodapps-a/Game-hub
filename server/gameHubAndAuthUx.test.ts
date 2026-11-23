import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
  HOKM_MATCH_VARIANTS,
  computePasswordStrength,
  filterShopItemsForGame,
  getHokmVariantById,
  rankLeaderboardEntries,
} from '../src/platform/utils/gameHubHelpers';
import { ShopItem } from '../src/platform/types/platform';
import { EyvanDatabase } from './database';
import { HokmRoomManager } from './roomManager';
import { createEyvanExpressApp } from './createExpressApp';
import worker from '../cloudflare/src/index';

const TEST_SHOP_FIXTURES: ShopItem[] = [
  {
    id: 'cb-1',
    name: 'پشت کارت شمسه',
    subtitle: 'طرح سنتی',
    description: 'توضیح',
    section: 'card_backs',
    price: 0,
    currency: 'coins',
    rarity: 'common',
    isDefaultOwned: true,
    palette: ['#0B1528', '#D4AE58', '#1C2E4A'],
    motif: 'shamsa',
  },
  {
    id: 'cb-2',
    name: 'پشت کارت فیروزه',
    subtitle: 'طرح فیروزه‌ای',
    description: 'توضیح',
    section: 'card_backs',
    price: 600,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#0D8A8A', '#F3D179', '#0B1528'],
    motif: 'kashi',
  },
  {
    id: 'tb-1',
    name: 'میز زمردی ایوان',
    subtitle: 'میز اصلی حکم',
    description: 'توضیح',
    section: 'table_themes',
    price: 0,
    currency: 'coins',
    rarity: 'common',
    isDefaultOwned: true,
    palette: ['#0C352E', '#D4AE58', '#081F1B'],
    motif: 'carpet',
  },
  {
    id: 'tb-2',
    name: 'میز لاجوردی',
    subtitle: 'میز ویژه',
    description: 'توضیح',
    section: 'table_themes',
    price: 900,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#102446', '#D4AE58', '#091529'],
    motif: 'arch',
  },
  {
    id: 'fx-1',
    name: 'افکت کُت طلایی',
    subtitle: 'جلوه پیروزی',
    description: 'توضیح',
    section: 'visual_effects',
    price: 45,
    currency: 'gems',
    rarity: 'legendary',
    palette: ['#D4AE58', '#F3D179', '#3D2E10'],
    motif: 'star',
  },
  {
    id: 'dd-ruby-shamsa',
    name: 'پشت کارت یاقوتی',
    subtitle: 'پیشنهاد روز',
    description: 'توضیح',
    section: 'daily_deals',
    price: 450,
    currency: 'coins',
    rarity: 'epic',
    palette: ['#7F1D1D', '#D4AE58', '#2B0909'],
    motif: 'shamsa',
  },
  {
    id: 'dd-kot-aura',
    name: 'هاله حاکم‌کُت',
    subtitle: 'پیشنهاد روز',
    description: 'توضیح',
    section: 'daily_deals',
    price: 30,
    currency: 'gems',
    rarity: 'epic',
    palette: ['#0D8A8A', '#F3D179', '#0B1528'],
    motif: 'star',
  },
  {
    id: 'ch-1',
    name: 'صندوقچه ایوان',
    subtitle: 'صندوقچه',
    description: 'توضیح',
    section: 'chests',
    price: 100,
    currency: 'gems',
    rarity: 'common',
    palette: ['#D4AE58', '#111827', '#0B1528'],
    motif: 'chest',
  },
  {
    id: 'fr-1',
    name: 'قاب پروفایل',
    subtitle: 'قاب',
    description: 'توضیح',
    section: 'avatars_frames',
    price: 250,
    currency: 'coins',
    rarity: 'rare',
    palette: ['#0D8A8A', '#111827', '#0B1528'],
    motif: 'cypress',
  },
];

async function startTempServer() {
  const db = new EyvanDatabase(':memory:');
  const roomManager = new HokmRoomManager({ db });
  const { app } = createEyvanExpressApp({
    db,
    roomManager,
    config: { isProduction: false },
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind ephemeral port');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    db,
    roomManager,
    baseUrl,
    close: async () => {
      roomManager.dispose();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}

test('gameHubHelpers: Hokm match variants map to valid scores (1, 3, 7)', () => {
  assert.equal(HOKM_MATCH_VARIANTS.length, 3);
  assert.equal(getHokmVariantById('single_1').targetScore, 1);
  assert.equal(getHokmVariantById('quick_3').targetScore, 3);
  assert.equal(getHokmVariantById('classic_7').targetScore, 7);
});

test('gameHubHelpers: filterShopItemsForGame returns only Hokm-relevant items and respects sub-filters', () => {
  const allHokm = filterShopItemsForGame(TEST_SHOP_FIXTURES, 'hokm', 'all');
  assert.equal(allHokm.length, 7);
  // Must exclude chests/avatars_frames unrelated to Hokm board/cards
  assert.equal(
    allHokm.some((item) => item.section === 'chests' || item.section === 'avatars_frames'),
    false
  );

  const cardBacks = filterShopItemsForGame(TEST_SHOP_FIXTURES, 'hokm', 'card_backs');
  assert.equal(cardBacks.length, 3);
  assert.ok(
    cardBacks.every(
      (item) => item.section === 'card_backs' || item.id === 'dd-ruby-shamsa'
    )
  );

  const tables = filterShopItemsForGame(TEST_SHOP_FIXTURES, 'hokm', 'table_themes');
  assert.equal(tables.length, 2);
  assert.ok(tables.every((item) => item.section === 'table_themes'));

  // Non-hokm future game returns empty cleanly
  assert.deepEqual(filterShopItemsForGame(TEST_SHOP_FIXTURES, 'chess', 'all'), []);
});

test('gameHubHelpers: computePasswordStrength aligns strictly with backend rules', () => {
  const empty = computePasswordStrength('');
  assert.equal(empty.score, 0);
  assert.equal(empty.isValid, false);

  const tooShort = computePasswordStrength('Ab123');
  assert.equal(tooShort.score, 1);
  assert.equal(tooShort.isValid, false);
  assert.equal(tooShort.hasMinLength, false);

  const missingDigit = computePasswordStrength('PasswordOnly');
  assert.equal(missingDigit.score, 1);
  assert.equal(missingDigit.isValid, false);
  assert.equal(missingDigit.hasNumber, false);

  const validMedium = computePasswordStrength('Eyvan1234');
  assert.equal(validMedium.score, 2);
  assert.equal(validMedium.isValid, true);

  const validStrong = computePasswordStrength('Eyvan#2026!Secure');
  assert.equal(validStrong.score, 3);
  assert.equal(validStrong.isValid, true);
});

test('gameHubHelpers: rankLeaderboardEntries sorts deterministically and filters zero-match rows', () => {
  const ranked = rankLeaderboardEntries([
    {
      userId: 'u0',
      username: 'NoGames',
      avatarCode: 'portrait',
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      kotWins: 0,
      hakemKotWins: 0,
      lastPlayedAt: null,
    },
    {
      userId: 'u1',
      username: 'PlayerOne',
      avatarCode: 'shamsa',
      matchesPlayed: 10,
      wins: 6,
      losses: 4,
      kotWins: 0,
      hakemKotWins: 0,
      lastPlayedAt: 1000,
    },
    {
      userId: 'u2',
      username: 'KotMaster',
      avatarCode: 'jade',
      matchesPlayed: 8,
      wins: 6,
      losses: 2,
      kotWins: 2,
      hakemKotWins: 1,
      lastPlayedAt: 2000,
    },
    {
      userId: 'u3',
      username: 'Champion',
      avatarCode: 'turquoise',
      matchesPlayed: 12,
      wins: 9,
      losses: 3,
      kotWins: 1,
      hakemKotWins: 0,
      lastPlayedAt: 3000,
    },
  ]);

  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].username, 'Champion');
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].winRatePct, 75);
  assert.equal(ranked[1].username, 'KotMaster');
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[2].username, 'PlayerOne');
  assert.equal(ranked[2].rank, 3);
});

test('Express API: POST /api/rooms/quick-match joins matching public rooms and isolates private/other-score rooms', async () => {
  const srv = await startTempServer();
  try {
    // 1. Private friend room (targetScore 3) must NOT be joined by quick-match
    const friendRes = await fetch(`${srv.baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'FriendHost',
        avatarCode: 'portrait',
        targetMatchScore: 3,
      }),
    });
    assert.equal(friendRes.status, 201);
    const friendRoom = (await friendRes.json()) as { roomCode: string };

    // 2. First quick-match player (targetScore 7) creates a new public room
    const q1Res = await fetch(`${srv.baseUrl}/api/rooms/quick-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'RandomAlpha',
        avatarCode: 'shamsa',
        targetMatchScore: 7,
      }),
    });
    assert.equal(q1Res.status, 201);
    const q1 = (await q1Res.json()) as {
      roomCode: string;
      matchedExisting: boolean;
    };
    assert.equal(q1.matchedExisting, false);
    assert.notEqual(q1.roomCode, friendRoom.roomCode);

    // 3. Second quick-match player with targetScore 3 does NOT join the targetScore 7 room
    const q2Res = await fetch(`${srv.baseUrl}/api/rooms/quick-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'RandomThree',
        avatarCode: 'jade',
        targetMatchScore: 3,
      }),
    });
    assert.equal(q2Res.status, 201);
    const q2 = (await q2Res.json()) as {
      roomCode: string;
      matchedExisting: boolean;
    };
    assert.equal(q2.matchedExisting, false);
    assert.notEqual(q2.roomCode, q1.roomCode);
    assert.notEqual(q2.roomCode, friendRoom.roomCode);

    // 4. Third quick-match player with targetScore 7 automatically joins RandomAlpha's public room!
    const q3Res = await fetch(`${srv.baseUrl}/api/rooms/quick-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'RandomBeta',
        avatarCode: 'lapis',
        targetMatchScore: 7,
      }),
    });
    assert.equal(q3Res.status, 200);
    const q3 = (await q3Res.json()) as {
      roomCode: string;
      matchedExisting: boolean;
    };
    assert.equal(q3.matchedExisting, true);
    assert.equal(q3.roomCode, q1.roomCode);
  } finally {
    await srv.close();
  }
});

test('Express & Worker API: GET /api/leaderboard/hokm returns ranked real database rows', async () => {
  const srv = await startTempServer();
  try {
    // Empty database returns clean empty array
    const emptyRes = await fetch(`${srv.baseUrl}/api/leaderboard/hokm`);
    assert.equal(emptyRes.status, 200);
    const emptyJson = (await emptyRes.json()) as {
      ok: boolean;
      gameId: string;
      entries: unknown[];
    };
    assert.equal(emptyJson.ok, true);
    assert.equal(emptyJson.gameId, 'hokm');
    assert.deepEqual(emptyJson.entries, []);

    // Record a real completed match with 4 players
    const u1Id = srv.db.upsertUser('LeadWin1', 'portrait');
    const u2Id = srv.db.upsertUser('LeadWin2', 'shamsa');
    const u3Id = srv.db.upsertUser('LeadLose1', 'jade');
    const u4Id = srv.db.upsertUser('LeadLose2', 'lapis');
    srv.db.recordCompletedMatch({
      matchId: 'match_lb_1',
      roomCode: 'LB1234',
      winningTeam: 'myTeam',
      teamAScore: 3,
      teamBScore: 0,
      targetScore: 3,
      lastWinType: 'kot',
      handsPlayed: 2,
      startedAt: Date.now() - 60_000,
      finishedAt: Date.now(),
      players: [
        { playerId: 'p1', canonicalSeat: 'north', userId: u1Id, username: 'LeadWin1', team: 'myTeam', won: true },
        { playerId: 'p2', canonicalSeat: 'south', userId: u2Id, username: 'LeadWin2', team: 'myTeam', won: true },
        { playerId: 'p3', canonicalSeat: 'east', userId: u3Id, username: 'LeadLose1', team: 'opponentTeam', won: false },
        { playerId: 'p4', canonicalSeat: 'west', userId: u4Id, username: 'LeadLose2', team: 'opponentTeam', won: false },
      ],
    });

    // Express endpoint returns winners ahead of losers
    const expressRes = await fetch(`${srv.baseUrl}/api/leaderboard/hokm?limit=10`);
    assert.equal(expressRes.status, 200);
    const expressJson = (await expressRes.json()) as {
      ok: boolean;
      entries: Array<{ username: string; wins: number; kotWins: number }>;
    };
    assert.equal(expressJson.ok, true);
    assert.equal(expressJson.entries.length, 4);
    assert.equal(expressJson.entries[0].wins, 1);
    assert.equal(expressJson.entries[0].kotWins, 1);

    // Worker endpoint using D1 adapter matches Express parity
    const workerRes = await worker.fetch(
      new Request('http://localhost/api/leaderboard/hokm?limit=10', {
        method: 'GET',
      }),
      {
        EYVAN_DB: srv.db.getD1Adapter(),
        HOKM_ROOM: {} as never,
        EYVAN_ASSETS: {} as never,
      }
    );
    assert.equal(workerRes.status, 200);
    const workerJson = (await workerRes.json()) as {
      ok: boolean;
      gameId: string;
      entries: Array<{ username: string; wins: number }>;
    };
    assert.equal(workerJson.ok, true);
    assert.equal(workerJson.gameId, 'hokm');
    assert.equal(workerJson.entries.length, 4);
    assert.equal(workerJson.entries[0].wins, 1);
  } finally {
    await srv.close();
  }
});

test('Express & Worker API: POST /api/auth/check-email validates input, enforces CSRF, and detects existing vs new emails', async () => {
  const srv = await startTempServer();
  try {
    const authHeaders = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'eyvan-client',
    };

    // 1. Missing CSRF header rejected
    const noCsrf = await fetch(`${srv.baseUrl}/api/auth/check-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'newplayer@example.com' }),
    });
    assert.equal(noCsrf.status, 403);

    // 2. Invalid email format -> 400 INVALID_INPUT
    const invalidRes = await fetch(`${srv.baseUrl}/api/auth/check-email`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    assert.equal(invalidRes.status, 400);

    // 3. Unknown email -> { ok: true, exists: false } on Express
    const unknownRes = await fetch(`${srv.baseUrl}/api/auth/check-email`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email: 'NewPlayer@Example.com' }),
    });
    assert.equal(unknownRes.status, 200);
    const unknownJson = (await unknownRes.json()) as {
      ok: boolean;
      exists: boolean;
    };
    assert.equal(unknownJson.ok, true);
    assert.equal(unknownJson.exists, false);

    // 4. Register user and verify check-email detects it (case-insensitive) on BOTH Express & Worker
    const regRes = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        email: 'UnifiedUser@Example.com',
        username: 'UnifiedHero',
        password: 'Password1234',
        confirmPassword: 'Password1234',
      }),
    });
    assert.equal(regRes.status, 201);

    const existingExpressRes = await fetch(`${srv.baseUrl}/api/auth/check-email`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ email: 'unifieduser@example.com' }),
    });
    assert.equal(existingExpressRes.status, 200);
    const existingExpressJson = (await existingExpressRes.json()) as {
      ok: boolean;
      exists: boolean;
    };
    assert.equal(existingExpressJson.ok, true);
    assert.equal(existingExpressJson.exists, true);

    const existingWorkerRes = await worker.fetch(
      new Request('https://api.eyvan.test/api/auth/check-email', {
        method: 'POST',
        headers: {
          Origin: 'https://eyvan.test',
          'Content-Type': 'application/json',
          'X-Requested-With': 'eyvan-client',
          'CF-Connecting-IP': '198.51.100.42',
        },
        body: JSON.stringify({ email: 'UNIFIEDUSER@EXAMPLE.COM' }),
      }),
      {
        EYVAN_DB: srv.db.getD1Adapter(),
        HOKM_ROOM: {} as never,
        EYVAN_ASSETS: {} as never,
        ALLOWED_ORIGINS: 'https://eyvan.test',
      }
    );
    assert.equal(existingWorkerRes.status, 200);
    const existingWorkerJson = (await existingWorkerRes.json()) as {
      ok: boolean;
      exists: boolean;
    };
    assert.equal(existingWorkerJson.ok, true);
    assert.equal(existingWorkerJson.exists, true);
  } finally {
    await srv.close();
  }
});

