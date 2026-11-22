import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import worker from '../cloudflare/src/index';
import { HokmRoomDO } from '../cloudflare/src/HokmRoomDO';
import {
  CfWorkerEnv,
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResult,
  DurableObjectStateLike,
  DurableObjectStorageLike,
  HibernatableWebSocket,
} from '../cloudflare/src/lib/types';
import { AUTH_COOKIE_NAME } from '../cloudflare/src/lib/auth/authCookie';
import {
  loginWithCredentials,
  registerManualAccount,
  verifyAuthSession,
} from '../cloudflare/src/lib/auth/authService';
import {
  requestPasswordReset,
  resendVerificationEmail,
  resetPasswordWithToken,
  verifyEmailWithToken,
} from '../cloudflare/src/lib/auth/c2Service';
import { sha256Hex } from '../cloudflare/src/lib/auth/crypto';
import {
  EmailSender,
  createEmailSender,
  resolvePublicAppBaseUrl,
} from '../cloudflare/src/lib/auth/emailService';
import {
  LOGIN_ID_RATE_LIMIT,
  consumeRateLimitSlot,
  pruneExpiredRateLimits,
} from '../cloudflare/src/lib/auth/rateLimit';
import {
  parseTrustedProxyIps,
  resolveClientIp,
  validateProductionAuthConfig,
} from '../cloudflare/src/lib/auth/securityPolicy';
import { createEyvanExpressApp } from './createExpressApp';
import { EyvanDatabase } from './database';
import { HokmRoomManager } from './roomManager';

interface BoundQueryStmt extends D1PreparedStatementLike {
  readonly __query: string;
  readonly __params: unknown[];
}

/**
 * Fault-injecting wrapper over real `better-sqlite3` so batch failures happen INSIDE a real
 * SQLite transaction (exact semantic match with Cloudflare D1 atomic `db.batch()` rollback).
 */
class FaultInjectingSqliteD1 implements D1DatabaseLike {
  public failBatchQueryPattern: RegExp | null = null;
  public faultTriggers = 0;

  constructor(private readonly sqlite: Database.Database) {}

  prepare(query: string): D1PreparedStatementLike {
    return this.createBoundStmt(query, []);
  }

  private createBoundStmt(query: string, params: unknown[]): BoundQueryStmt {
    const sqlite = this.sqlite;
    return {
      __query: query,
      __params: params,
      bind: (...values: unknown[]) => this.createBoundStmt(query, values),
      async run(): Promise<D1RunResult> {
        const info = sqlite.prepare(query).run(...params);
        return {
          success: true,
          meta: {
            changes: info.changes,
            last_row_id: Number(info.lastInsertRowid ?? 0),
          },
        };
      },
      async all<T = unknown>(): Promise<{ results: T[]; success?: boolean }> {
        return { results: sqlite.prepare(query).all(...params) as T[], success: true };
      },
      async first<T = unknown>(): Promise<T | null> {
        return (sqlite.prepare(query).get(...params) as T | undefined) ?? null;
      },
    };
  }

  async batch(statements: D1PreparedStatementLike[]): Promise<D1RunResult[]> {
    const bound = statements as BoundQueryStmt[];
    const tx = this.sqlite.transaction((items: BoundQueryStmt[]) => {
      const results: D1RunResult[] = [];
      for (const item of items) {
        if (this.failBatchQueryPattern && this.failBatchQueryPattern.test(item.__query)) {
          this.faultTriggers += 1;
          throw new Error('INJECTED_TX_FAULT');
        }
        const info = this.sqlite.prepare(item.__query).run(...item.__params);
        results.push({
          success: true,
          meta: {
            changes: info.changes,
            last_row_id: Number(info.lastInsertRowid ?? 0),
          },
        });
      }
      return results;
    });
    return tx(bound);
  }
}

function createTempDbHarness() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyvan-c2-harden-'));
  const dbPath = path.join(tmpDir, 'harden.sqlite');
  const eyvanDb = new EyvanDatabase(dbPath);
  const rawDb = new Database(dbPath);
  const faultDb = new FaultInjectingSqliteD1(rawDb);
  const capturedTokens: { kind: 'verify' | 'reset'; token: string; url: string; to: string }[] = [];

  const mockSender: EmailSender = {
    async sendVerificationEmail(payload) {
      const token = new URLSearchParams(new URL(payload.verifyUrl).hash.replace(/^#/, '')).get(
        'verify-email'
      )!;
      capturedTokens.push({ kind: 'verify', token, url: payload.verifyUrl, to: payload.to });
      return { configured: true, sent: true, provider: 'mock' };
    },
    async sendPasswordResetEmail(payload) {
      const token = new URLSearchParams(new URL(payload.resetUrl).hash.replace(/^#/, '')).get(
        'reset-password'
      )!;
      capturedTokens.push({ kind: 'reset', token, url: payload.resetUrl, to: payload.to });
      return { configured: true, sent: true, provider: 'mock' };
    },
  };

  return {
    eyvanDb,
    rawDb,
    faultDb,
    mockSender,
    capturedTokens,
    cleanup() {
      rawDb.close();
      eyvanDb.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

class MemStorage implements DurableObjectStorageLike {
  private readonly map = new Map<string, unknown>();
  async get<T = unknown>(k: string): Promise<T | undefined> {
    return this.map.has(k) ? (structuredClone(this.map.get(k)) as T) : undefined;
  }
  async put<T = unknown>(k: string, v: T): Promise<void> {
    this.map.set(k, structuredClone(v));
  }
  async delete(k: string | string[]): Promise<boolean | number> {
    if (Array.isArray(k)) return k.filter((x) => this.map.delete(x)).length;
    return this.map.delete(k);
  }
  async deleteAll(): Promise<void> {
    this.map.clear();
  }
  async setAlarm(): Promise<void> {}
  async getAlarm(): Promise<number | null> {
    return null;
  }
  async deleteAlarm(): Promise<void> {}
}

class MemDoState implements DurableObjectStateLike {
  public readonly storage = new MemStorage();
  acceptWebSocket(): void {}
  getWebSockets(): HibernatableWebSocket[] {
    return [];
  }
  async blockConcurrencyWhile<T>(cb: () => Promise<T>): Promise<T> {
    return cb();
  }
}

describe('Stage C1 & C2 Final Hardening — Atomicity, Email Delivery, Rate Limits & Production Config', () => {
  it('1. Atomic rollback in verifyEmailWithToken: DB failure at user update or finalize keeps token usable & user pending', async () => {
    const h = createTempDbHarness();
    try {
      const now = 1_750_000_000_000;
      const reg = await registerManualAccount(
        h.faultDb,
        {
          email: 'atomic_verify@example.com',
          username: 'AtomicVerify1',
          password: 'ValidPassword123',
          confirmPassword: 'ValidPassword123',
        },
        { clientIp: '198.51.100.1', userAgent: 'Test', now, publicAppBaseUrl: 'https://eyvan.test', isProduction: true },
        h.mockSender
      );
      assert.equal(reg.ok, true);
      if (!reg.ok) return;
      const token = h.capturedTokens[0].token;
      const tokenHash = await sha256Hex(token);

      // Fault A: throw on `UPDATE users` inside atomic batch
      h.faultDb.failBatchQueryPattern = /UPDATE users/i;
      await assert.rejects(
        () =>
          verifyEmailWithToken(
            h.faultDb,
            { token },
            { clientIp: '198.51.100.2', userAgent: 'Test', now: now + 1000 }
          ),
        /INJECTED_TX_FAULT/
      );

      // Token MUST still be unconsumed (NULL, never -1!) and user MUST still be pending_verification
      const tokAfterFaultA = h.rawDb
        .prepare(`SELECT consumed_at FROM email_verification_tokens WHERE token_hash = ?`)
        .get(tokenHash) as { consumed_at: number | null };
      const usrAfterFaultA = h.rawDb
        .prepare(`SELECT email_verified, account_status FROM users WHERE user_id = ?`)
        .get(reg.user.userId) as { email_verified: number; account_status: string };
      assert.equal(tokAfterFaultA.consumed_at, null);
      assert.equal(usrAfterFaultA.email_verified, 0);
      assert.equal(usrAfterFaultA.account_status, 'pending_verification');

      // Fault B: throw on final `SET consumed_at = ? WHERE token_hash = ? AND user_id = ? AND consumed_at = ?`
      h.faultDb.failBatchQueryPattern = /AND consumed_at = \?/i;
      await assert.rejects(
        () =>
          verifyEmailWithToken(
            h.faultDb,
            { token },
            { clientIp: '198.51.100.3', userAgent: 'Test', now: now + 2000 }
          ),
        /INJECTED_TX_FAULT/
      );

      const tokAfterFaultB = h.rawDb
        .prepare(`SELECT consumed_at FROM email_verification_tokens WHERE token_hash = ?`)
        .get(tokenHash) as { consumed_at: number | null };
      const usrAfterFaultB = h.rawDb
        .prepare(`SELECT email_verified, account_status FROM users WHERE user_id = ?`)
        .get(reg.user.userId) as { email_verified: number; account_status: string };
      assert.equal(tokAfterFaultB.consumed_at, null, 'Rollback must never leave -1 sentinel committed');
      assert.equal(usrAfterFaultB.email_verified, 0);
      assert.equal(usrAfterFaultB.account_status, 'pending_verification');

      // Clear fault -> SAME token MUST succeed on retry!
      h.faultDb.failBatchQueryPattern = null;
      const retry = await verifyEmailWithToken(
        h.faultDb,
        { token },
        { clientIp: '198.51.100.4', userAgent: 'Test', now: now + 3000 }
      );
      assert.equal(retry.ok, true);
      const tokAfterOk = h.rawDb
        .prepare(`SELECT consumed_at FROM email_verification_tokens WHERE token_hash = ?`)
        .get(tokenHash) as { consumed_at: number | null };
      assert.equal(tokAfterOk.consumed_at, now + 3000);
    } finally {
      h.cleanup();
    }
  });

  it('2. Atomic rollback in resetPasswordWithToken: faults in password update, session revoke, or finalize roll back EVERYTHING', async () => {
    const h = createTempDbHarness();
    try {
      const now = 1_750_000_100_000;
      const reg = await registerManualAccount(
        h.faultDb,
        {
          email: 'atomic_reset@example.com',
          username: 'AtomicReset1',
          password: 'OldPassword123',
          confirmPassword: 'OldPassword123',
        },
        { clientIp: '198.51.100.10', userAgent: 'Test', now, publicAppBaseUrl: 'https://eyvan.test', isProduction: true },
        h.mockSender
      );
      assert.equal(reg.ok, true);
      if (!reg.ok) return;

      await verifyEmailWithToken(
        h.faultDb,
        { token: h.capturedTokens[0].token },
        { clientIp: '198.51.100.11', userAgent: 'Test', now: now + 100 }
      );

      // Log in two active sessions
      const sessA = await loginWithCredentials(
        h.faultDb,
        { identifier: 'atomic_reset@example.com', password: 'OldPassword123' },
        { clientIp: '198.51.100.12', userAgent: 'DevA', now: now + 200 }
      );
      const sessB = await loginWithCredentials(
        h.faultDb,
        { identifier: 'atomicreset1', password: 'OldPassword123' },
        { clientIp: '198.51.100.13', userAgent: 'DevB', now: now + 200 }
      );
      assert.equal(sessA.ok, true);
      assert.equal(sessB.ok, true);
      if (!sessA.ok || !sessB.ok) return;

      await requestPasswordReset(
        h.faultDb,
        { email: 'atomic_reset@example.com' },
        { clientIp: '198.51.100.14', userAgent: 'Test', now: now + 300, publicAppBaseUrl: 'https://eyvan.test', isProduction: true },
        h.mockSender
      );
      const resetToken = h.capturedTokens[1].token;
      const resetTokenHash = await sha256Hex(resetToken);

      // Test fault injection on EACH sensitive step inside the atomic batch:
      const faultPatterns = [
        /UPDATE auth_identities/i,
        /UPDATE auth_sessions/i,
        /UPDATE users/i,
        /AND consumed_at = \?/i,
      ];

      for (let idx = 0; idx < faultPatterns.length; idx += 1) {
        h.faultDb.failBatchQueryPattern = faultPatterns[idx];
        await assert.rejects(
          () =>
            resetPasswordWithToken(
              h.faultDb,
              {
                token: resetToken,
                password: 'NewPassword456',
                confirmPassword: 'NewPassword456',
              },
              { clientIp: `198.51.100.${20 + idx}`, userAgent: 'Test', now: now + 500 + idx }
            ),
          /INJECTED_TX_FAULT/
        );

        // Verify full rollback: token unconsumed, BOTH sessions still valid, old password still works!
        const tokRow = h.rawDb
          .prepare(`SELECT consumed_at FROM password_reset_tokens WHERE token_hash = ?`)
          .get(resetTokenHash) as { consumed_at: number | null };
        assert.equal(tokRow.consumed_at, null, `Token must remain unconsumed after fault #${idx}`);

        const checkA = await verifyAuthSession(h.faultDb, sessA.rawSessionToken, now + 600);
        const checkB = await verifyAuthSession(h.faultDb, sessB.rawSessionToken, now + 600);
        assert.equal(checkA.authenticated, true, `Session A must NOT be revoked after fault #${idx}`);
        assert.equal(checkB.authenticated, true, `Session B must NOT be revoked after fault #${idx}`);
      }

      // Clear fault -> retry with SAME token succeeds atomically and revokes BOTH sessions!
      h.faultDb.failBatchQueryPattern = null;
      const okReset = await resetPasswordWithToken(
        h.faultDb,
        {
          token: resetToken,
          password: 'NewPassword456',
          confirmPassword: 'NewPassword456',
        },
        { clientIp: '198.51.100.30', userAgent: 'Test', now: now + 1000 }
      );
      assert.equal(okReset.ok, true);

      const tokFinal = h.rawDb
        .prepare(`SELECT consumed_at FROM password_reset_tokens WHERE token_hash = ?`)
        .get(resetTokenHash) as { consumed_at: number | null };
      assert.equal(tokFinal.consumed_at, now + 1000);

      const revokedA = await verifyAuthSession(h.faultDb, sessA.rawSessionToken, now + 1100);
      const revokedB = await verifyAuthSession(h.faultDb, sessB.rawSessionToken, now + 1100);
      assert.equal(revokedA.authenticated, false);
      assert.equal(revokedB.authenticated, false);

      const oldLogin = await loginWithCredentials(
        h.faultDb,
        { identifier: 'atomic_reset@example.com', password: 'OldPassword123' },
        { clientIp: '198.51.100.31', userAgent: 'Test', now: now + 1200 }
      );
      assert.equal(oldLogin.ok, false);

      const newLogin = await loginWithCredentials(
        h.faultDb,
        { identifier: 'atomic_reset@example.com', password: 'NewPassword456' },
        { clientIp: '198.51.100.32', userAgent: 'Test', now: now + 1300 }
      );
      assert.equal(newLogin.ok, true);
    } finally {
      h.cleanup();
    }
  });

  it('3. Same-millisecond 5x concurrent reset race with 5 DIFFERENT passwords: strictly 1 wins and its password persists', async () => {
    const h = createTempDbHarness();
    try {
      const now = 1_750_000_200_000;
      await registerManualAccount(
        h.faultDb,
        {
          email: 'samems@example.com',
          username: 'SameMsRace1',
          password: 'StartPassword1',
          confirmPassword: 'StartPassword1',
        },
        { clientIp: '198.51.100.40', userAgent: 'Test', now, publicAppBaseUrl: 'https://eyvan.test', isProduction: true },
        h.mockSender
      );

      // 5x same-ms verify-email race
      const verifyResults = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          verifyEmailWithToken(
            h.faultDb,
            { token: h.capturedTokens[0].token },
            { clientIp: `198.51.100.${50 + i}`, userAgent: 'Test', now: now + 500 }
          )
        )
      );
      assert.equal(verifyResults.filter((r) => r.ok).length, 1);
      assert.equal(verifyResults.filter((r) => !r.ok).length, 4);

      await requestPasswordReset(
        h.faultDb,
        { email: 'samems@example.com' },
        { clientIp: '198.51.100.60', userAgent: 'Test', now: now + 1000, publicAppBaseUrl: 'https://eyvan.test', isProduction: true },
        h.mockSender
      );

      const resetToken = h.capturedTokens[1].token;
      const candidatePasswords = [
        'WinnerPass_Alpha1',
        'WinnerPass_Bravo2',
        'WinnerPass_Charl3',
        'WinnerPass_Delta4',
        'WinnerPass_Echo55',
      ];
      const exactSameMs = now + 2000;

      const race = await Promise.all(
        candidatePasswords.map((pwd, i) =>
          resetPasswordWithToken(
            h.faultDb,
            { token: resetToken, password: pwd, confirmPassword: pwd },
            { clientIp: `198.51.100.${70 + i}`, userAgent: 'Test', now: exactSameMs }
          ).then((res) => ({ pwd, res }))
        )
      );

      const winners = race.filter((x) => x.res.ok);
      const losers = race.filter((x) => !x.res.ok);
      assert.equal(winners.length, 1, 'Strictly 1 concurrent password reset must succeed');
      assert.equal(losers.length, 4);

      // Verify committed password matches the exact winner and NONE of the losers overwrote it!
      const winnerLogin = await loginWithCredentials(
        h.faultDb,
        { identifier: 'samems@example.com', password: winners[0].pwd },
        { clientIp: '198.51.100.90', userAgent: 'Test', now: exactSameMs + 50 }
      );
      assert.equal(winnerLogin.ok, true);

      for (let i = 0; i < losers.length; i += 1) {
        const loserLogin = await loginWithCredentials(
          h.faultDb,
          { identifier: 'samems@example.com', password: losers[i].pwd },
          { clientIp: `198.51.100.${91 + i}`, userAgent: 'Test', now: exactSameMs + 60 + i }
        );
        assert.equal(loserLogin.ok, false, 'Concurrent loser password MUST NEVER overwrite winner');
      }
    } finally {
      h.cleanup();
    }
  });

  it('4. Resend error matrix (400/401/429/500/network/unconfigured/placeholder) + zero PII/secret leaks in logs', async () => {
    const secretApiKey = 're_live_SUPER_SECRET_KEY_99887766';
    const sensitiveEmail = 'private.player.pii@domain.test';
    const sensitiveToken = 'RAW_OPAQUE_TOKEN_9876543210ABCDEF9876543210';
    const verifyUrl = `https://eyvan.test/#verify-email=${sensitiveToken}`;

    const capturedLogs: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      capturedLogs.push(args.map((a) => String(a)).join(' '));
    };

    try {
      // HTTP error statuses
      const cases: Array<{ status: number; expectedCode: string }> = [
        { status: 400, expectedCode: 'RESEND_BAD_REQUEST' },
        { status: 401, expectedCode: 'RESEND_AUTH_ERROR' },
        { status: 403, expectedCode: 'RESEND_AUTH_ERROR' },
        { status: 429, expectedCode: 'RESEND_RATE_LIMITED' },
        { status: 500, expectedCode: 'RESEND_SERVER_ERROR' },
      ];

      for (const tc of cases) {
        const sender = createEmailSender({
          provider: 'resend',
          resendApiKey: secretApiKey,
          emailFrom: 'Eyvan <no-reply@eyvan.test>',
          isProduction: true,
          fetchImpl: async () => new Response('{"message":"err"}', { status: tc.status }),
        });
        const res = await sender.sendVerificationEmail({
          to: sensitiveEmail,
          username: 'SecretUser',
          verifyUrl,
          expiresInHours: 24,
        });
        assert.equal(res.configured, true);
        assert.equal(res.sent, false);
        assert.equal(res.errorCode, tc.expectedCode);
      }

      // Network failure
      const netSender = createEmailSender({
        provider: 'resend',
        resendApiKey: secretApiKey,
        emailFrom: 'Eyvan <no-reply@eyvan.test>',
        isProduction: true,
        fetchImpl: async () => {
          throw new Error(`network fail to ${sensitiveEmail}`);
        },
      });
      const netRes = await netSender.sendPasswordResetEmail({
        to: sensitiveEmail,
        username: 'SecretUser',
        resetUrl: `https://eyvan.test/#reset-password=${sensitiveToken}`,
        expiresInMinutes: 60,
      });
      assert.equal(netRes.configured, true);
      assert.equal(netRes.sent, false);
      assert.equal(netRes.errorCode, 'PROVIDER_NETWORK_ERROR');

      // Missing API key / missing EMAIL_FROM / placeholder EMAIL_FROM in Production / disabled provider
      const missingKey = await createEmailSender({
        provider: 'resend',
        resendApiKey: '',
        emailFrom: 'Eyvan <no-reply@eyvan.test>',
        isProduction: true,
      }).sendVerificationEmail({ to: sensitiveEmail, username: 'U', verifyUrl, expiresInHours: 24 });
      assert.equal(missingKey.configured, false);
      assert.equal(missingKey.sent, false);
      assert.equal(missingKey.errorCode, 'EMAIL_API_KEY_MISSING');

      const missingFrom = await createEmailSender({
        provider: 'resend',
        resendApiKey: secretApiKey,
        emailFrom: '',
        isProduction: true,
      }).sendVerificationEmail({ to: sensitiveEmail, username: 'U', verifyUrl, expiresInHours: 24 });
      assert.equal(missingFrom.configured, false);
      assert.equal(missingFrom.errorCode, 'EMAIL_FROM_MISSING');

      const placeholderFrom = await createEmailSender({
        provider: 'resend',
        resendApiKey: secretApiKey,
        emailFrom: 'Eyvan <no-reply@example.com>',
        isProduction: true,
      }).sendVerificationEmail({ to: sensitiveEmail, username: 'U', verifyUrl, expiresInHours: 24 });
      assert.equal(placeholderFrom.configured, false);
      assert.equal(placeholderFrom.errorCode, 'EMAIL_FROM_PLACEHOLDER');

      const disabledSender = await createEmailSender({
        provider: 'disabled',
        resendApiKey: secretApiKey,
        emailFrom: 'Eyvan <no-reply@eyvan.test>',
        isProduction: true,
      }).sendVerificationEmail({ to: sensitiveEmail, username: 'U', verifyUrl, expiresInHours: 24 });
      assert.equal(disabledSender.configured, false);
      assert.equal(disabledSender.errorCode, 'EMAIL_PROVIDER_DISABLED');

      // Assert ZERO sensitive data appeared in ANY console.error log!
      const joinedLogs = capturedLogs.join('\n');
      assert.equal(joinedLogs.includes(secretApiKey), false, 'API key MUST NEVER be logged');
      assert.equal(joinedLogs.includes(sensitiveEmail), false, 'Recipient email MUST NEVER be logged');
      assert.equal(joinedLogs.includes(sensitiveToken), false, 'Raw token MUST NEVER be logged');
      assert.equal(joinedLogs.includes('#verify-email='), false, 'Verification URL MUST NEVER be logged');
      assert.equal(joinedLogs.includes('#reset-password='), false, 'Reset URL MUST NEVER be logged');
    } finally {
      console.error = origError;
    }
  });

  it('5. Production refuses localhost/workers.dev/placeholder public URLs; non-enumerating endpoints hide internalDelivery from HTTP JSON', async () => {
    // resolvePublicAppBaseUrl in Production vs Dev
    assert.equal(
      resolvePublicAppBaseUrl(
        ['MY_APP_URL', 'http://eyvan.ir', 'https://eyvan.example.com', 'https://eyvan.workers.dev', 'https://localhost:3000'],
        'https://eyvan-hokm-online.workers.dev/api/auth/register',
        { isProduction: true }
      ),
      null,
      'Production must NEVER fall back to localhost, http, example.com, or workers.dev'
    );
    assert.equal(
      resolvePublicAppBaseUrl(
        ['https://play.eyvan-real.ir'],
        'https://api.eyvan-real.ir/api/auth/register',
        { isProduction: true }
      ),
      'https://play.eyvan-real.ir'
    );
    assert.equal(
      resolvePublicAppBaseUrl(['MY_APP_URL'], 'http://127.0.0.1:3000/api/auth/register', { isProduction: false }),
      'http://127.0.0.1:3000'
    );

    const h = createTempDbHarness();
    const origError = console.error;
    console.error = () => {};
    try {
      const now = 1_750_000_300_000;
      const failingSender = createEmailSender({
        provider: 'resend',
        resendApiKey: 're_test_key',
        emailFrom: 'Eyvan <no-reply@eyvan.test>',
        isProduction: true,
        fetchImpl: async () => new Response('rate limit', { status: 429 }),
      });

      // Production with missing publicAppBaseUrl -> refuses localhost fallback & reports honest unconfigured state
      const regNoUrl = await registerManualAccount(
        h.faultDb,
        {
          email: 'noprodurl@example.com',
          username: 'NoProdUrl1',
          password: 'ValidPassword123',
          confirmPassword: 'ValidPassword123',
        },
        { clientIp: '198.51.100.101', userAgent: 'Test', now, isProduction: true, publicAppBaseUrl: undefined },
        h.mockSender
      );
      assert.equal(regNoUrl.ok, true);
      if (!regNoUrl.ok) return;
      assert.equal(regNoUrl.emailDelivery.configured, false);
      assert.equal(regNoUrl.emailDelivery.sent, false);
      assert.equal(regNoUrl.internalDelivery?.errorCode, 'PUBLIC_APP_URL_UNCONFIGURED');
      assert.equal(h.capturedTokens.length, 0, 'Email sender must NOT be called with fabricated localhost link in Production');

      // Resend verification & forgot-password with failing Resend 429 -> internalDelivery records RESEND_RATE_LIMITED,
      // while public message stays 100% uniform (identical to non-existent email)!
      const resendFail = await resendVerificationEmail(
        h.faultDb,
        { email: 'noprodurl@example.com' },
        { clientIp: '198.51.100.102', userAgent: 'Test', now: now + 100, isProduction: true, publicAppBaseUrl: 'https://eyvan.test' },
        failingSender
      );
      const resendGhost = await resendVerificationEmail(
        h.faultDb,
        { email: 'ghost_user@example.com' },
        { clientIp: '198.51.100.103', userAgent: 'Test', now: now + 100, isProduction: true, publicAppBaseUrl: 'https://eyvan.test' },
        failingSender
      );
      assert.equal(resendFail.ok, true);
      assert.equal(resendGhost.ok, true);
      if (!resendFail.ok || !resendGhost.ok) return;
      assert.equal(resendFail.message, resendGhost.message);
      assert.equal(resendFail.internalDelivery?.sent, false);
      assert.equal(resendFail.internalDelivery?.errorCode, 'RESEND_RATE_LIMITED');

      // Verify HTTP handler NEVER leaks `internalDelivery` in /api/auth/forgot-password or /api/auth/resend-verification
      const env: CfWorkerEnv = {
        EYVAN_DB: h.eyvanDb.getD1Adapter(),
        EYVAN_ASSETS: { get: async () => null },
        ALLOWED_ORIGINS: 'https://eyvan.test',
        PUBLIC_APP_URL: 'https://eyvan.test',
        ENVIRONMENT: 'production',
        EMAIL_SENDER: failingSender,
        HOKM_ROOM: {
          idFromName: (n) => n,
          get: () => ({ fetch: (r) => new HokmRoomDO(new MemDoState(), env).fetch(r) }),
        },
      };
      const httpForgot = await worker.fetch(
        new Request('https://api.eyvan.test/api/auth/forgot-password', {
          method: 'POST',
          headers: {
            Origin: 'https://eyvan.test',
            'X-Requested-With': 'eyvan-client',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '198.51.100.104',
          },
          body: JSON.stringify({ email: 'noprodurl@example.com' }),
        }),
        env
      );
      assert.equal(httpForgot.status, 200);
      const httpJson = (await httpForgot.json()) as Record<string, unknown>;
      assert.deepEqual(Object.keys(httpJson).sort(), ['message', 'ok']);
      assert.equal('internalDelivery' in httpJson, false);
      assert.equal('emailDelivery' in httpJson, false);
    } finally {
      console.error = origError;
      h.cleanup();
    }
  });

  it('6. Rate limits: case-insensitive email buckets, hashed keys (no raw email/IP), and safe pruneExpiredRateLimits', async () => {
    const h = createTempDbHarness();
    try {
      const now = 1_750_000_400_000;

      // Case-insensitive forgot-password rate limit: 3 variants of same email from distinct IPs -> 4th gets 429
      const variants = ['CaseUser@Example.com', 'caseuser@example.com', 'CASEUSER@EXAMPLE.COM'];
      for (let i = 0; i < variants.length; i += 1) {
        const r = await requestPasswordReset(
          h.faultDb,
          { email: variants[i] },
          { clientIp: `198.51.100.${110 + i}`, userAgent: 'Test', now: now + i * 10, publicAppBaseUrl: 'https://eyvan.test' },
          h.mockSender
        );
        assert.equal(r.ok, true);
      }
      const fourth = await requestPasswordReset(
        h.faultDb,
        { email: 'cAsEuSeR@eXaMpLe.CoM' },
        { clientIp: '198.51.100.119', userAgent: 'Test', now: now + 50, publicAppBaseUrl: 'https://eyvan.test' },
        h.mockSender
      );
      assert.equal(fourth.ok, false);
      if (!fourth.ok) {
        assert.equal(fourth.status, 429);
        assert.ok((fourth.retryAfterSec ?? 0) >= 1);
      }

      // Verify NO raw email or raw IP is persisted in auth_rate_limits.rate_key
      const allRateKeys = h.rawDb
        .prepare(`SELECT rate_key FROM auth_rate_limits`)
        .all() as Array<{ rate_key: string }>;
      assert.ok(allRateKeys.length >= 4);
      for (const row of allRateKeys) {
        assert.equal(row.rate_key.toLowerCase().includes('caseuser'), false);
        assert.equal(row.rate_key.includes('198.51.100'), false);
      }

      // Safe pruning test:
      // 1) Old expired unblocked bucket (30 hours old) -> MUST be pruned
      // 2) Active window bucket (2 minutes old) -> MUST NOT be pruned (even if caller passes retentionMs=1000!)
      // 3) Old row whose blocked_until is still in the future -> MUST NOT be pruned!
      const thirtyHoursAgo = now - 30 * 60 * 60 * 1000;
      const twoMinutesAgo = now - 2 * 60 * 1000;

      h.rawDb
        .prepare(
          `INSERT INTO auth_rate_limits (rate_key, action, attempts, window_started_at, blocked_until, updated_at)
           VALUES (?, 'login_ip', 3, ?, NULL, ?)`
        )
        .run('old:expired:bucket', thirtyHoursAgo, thirtyHoursAgo);

      h.rawDb
        .prepare(
          `INSERT INTO auth_rate_limits (rate_key, action, attempts, window_started_at, blocked_until, updated_at)
           VALUES (?, 'login_ip', 6, ?, ?, ?)`
        )
        .run('still:blocked:bucket', thirtyHoursAgo, now + 60_000, thirtyHoursAgo);

      await consumeRateLimitSlot(h.faultDb, 'active:recent:bucket', LOGIN_ID_RATE_LIMIT, twoMinutesAgo);

      // Even with aggressive 1000ms retention argument, 15m safety floor protects active buckets
      const deleted = await pruneExpiredRateLimits(h.faultDb, now, 1000);
      assert.equal(deleted, 1, 'Only the truly expired unblocked row should be pruned');

      const remainingKeys = new Set(
        (h.rawDb.prepare(`SELECT rate_key FROM auth_rate_limits`).all() as Array<{ rate_key: string }>).map(
          (r) => r.rate_key
        )
      );
      assert.equal(remainingKeys.has('old:expired:bucket'), false);
      assert.equal(remainingKeys.has('still:blocked:bucket'), true, 'Active block must never be pruned');
      assert.equal(remainingKeys.has('active:recent:bucket'), true, 'Active sliding window must never be pruned');
    } finally {
      h.cleanup();
    }
  });

  it('7. Production config validator, multi-hop trusted proxy IP chain, and CSRF Origin bypass prevention on logout/logout-all', async () => {
    // 7a) Production config validator catches placeholders & misconfigurations
    const badReport = validateProductionAuthConfig({
      allowedOrigins: 'https://eyvan.example.com,https://*.run.app',
      publicAppUrl: 'MY_APP_URL',
      emailProvider: 'resend',
      resendApiKey: '',
      emailFrom: 'Eyvan <no-reply@example.com>',
      trustedProxyIps: '*',
      d1DatabaseId: 'REPLACE_WITH_YOUR_D1_DATABASE_ID',
    });
    assert.equal(badReport.ok, false);
    const badCodes = new Set(badReport.errors.map((e) => e.code));
    assert.ok(badCodes.has('ALLOWED_ORIGINS_INVALID_HOST'));
    assert.ok(badCodes.has('ALLOWED_ORIGINS_WILDCARD'));
    assert.ok(badCodes.has('PUBLIC_APP_URL_INVALID_OR_MISSING'));
    assert.ok(badCodes.has('RESEND_API_KEY_MISSING_OR_PLACEHOLDER'));
    assert.ok(badCodes.has('EMAIL_FROM_PLACEHOLDER'));
    assert.ok(badCodes.has('TRUSTED_PROXY_IPS_WILDCARD'));
    assert.ok(badCodes.has('D1_DATABASE_ID_PLACEHOLDER'));

    // Valid Production config passes cleanly
    const goodReport = validateProductionAuthConfig({
      allowedOrigins: 'https://play.eyvan-real.ir,https://www.eyvan-real.ir',
      publicAppUrl: 'https://play.eyvan-real.ir',
      emailProvider: 'resend',
      resendApiKey: 're_live_valid_secret_value',
      emailFrom: 'Eyvan <no-reply@eyvan-real.ir>',
      trustedProxyIps: '10.0.0.1,10.0.0.2',
      d1DatabaseId: '11111111-2222-3333-4444-555555555555',
    });
    assert.equal(goodReport.ok, true);
    assert.equal(goodReport.errors.length, 0);

    // 7b) Multi-hop trusted proxy XFF parsing (right-to-left)
    const proxies = parseTrustedProxyIps('10.0.0.1, 10.0.0.2, *');
    assert.equal(proxies.has('*'), false);
    assert.equal(
      resolveClientIp({
        remoteAddress: '::ffff:10.0.0.1',
        xForwardedFor: '1.2.3.4, 203.0.113.77, 10.0.0.2',
        trustedProxies: proxies,
      }),
      '203.0.113.77',
      'Must ignore attacker-forged leftmost IP and skip trusted proxies from the right'
    );
    assert.equal(
      resolveClientIp({
        remoteAddress: '198.51.100.88',
        xForwardedFor: '1.2.3.4, 203.0.113.77',
        trustedProxies: proxies,
      }),
      '198.51.100.88',
      'Untrusted peer MUST ignore X-Forwarded-For completely'
    );

    // 7c) X-Requested-With alone NEVER bypasses Origin: null or unauthorized Origin on logout/logout-all in Express & Worker
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyvan-c2-csrf-'));
    const dbPath = path.join(tmpDir, 'csrf.sqlite');
    const db = new EyvanDatabase(dbPath);
    const roomManager = new HokmRoomManager({ db });
    const { app } = createEyvanExpressApp({
      db,
      roomManager,
      config: {
        isProduction: true,
        allowedOrigins: 'https://eyvan.test',
        publicAppUrl: 'https://eyvan.test',
      },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      for (const route of ['/api/auth/logout', '/api/auth/logout-all', '/api/auth/verify-email', '/api/auth/reset-password']) {
        // Origin: null with valid X-Requested-With -> MUST be 403!
        const nullOrigin = await fetch(`${baseUrl}${route}`, {
          method: 'POST',
          headers: {
            Origin: 'null',
            'X-Requested-With': 'eyvan-client',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        assert.equal(nullOrigin.status, 403, `Origin: null must be blocked on ${route}`);

        // Unauthorized Origin with valid X-Requested-With -> MUST be 403!
        const evilOrigin = await fetch(`${baseUrl}${route}`, {
          method: 'POST',
          headers: {
            Origin: 'https://attacker.run.app',
            'X-Requested-With': 'eyvan-client',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        assert.equal(evilOrigin.status, 403, `Unauthorized Origin must be blocked on ${route}`);

        // Cross-site Referer without Origin -> MUST be 403!
        const evilRef = await fetch(`${baseUrl}${route}`, {
          method: 'POST',
          headers: {
            Referer: 'https://attacker.evil/csrf.html',
            'X-Requested-With': 'eyvan-client',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        assert.equal(evilRef.status, 403, `Unauthorized Referer must be blocked on ${route}`);
      }

      // Same check on Cloudflare Worker directly
      const workerEnv: CfWorkerEnv = {
        EYVAN_DB: db.getD1Adapter(),
        EYVAN_ASSETS: { get: async () => null },
        ALLOWED_ORIGINS: 'https://eyvan.test',
        PUBLIC_APP_URL: 'https://eyvan.test',
        ENVIRONMENT: 'production',
        HOKM_ROOM: {
          idFromName: (n) => n,
          get: () => ({ fetch: (r) => new HokmRoomDO(new MemDoState(), workerEnv).fetch(r) }),
        },
      };
      for (const route of ['/api/auth/logout', '/api/auth/logout-all']) {
        const wNull = await worker.fetch(
          new Request(`https://api.eyvan.test${route}`, {
            method: 'POST',
            headers: { Origin: 'null', 'X-Requested-With': 'eyvan-client' },
          }),
          workerEnv
        );
        assert.equal(wNull.status, 403);

        const wSecFetch = await worker.fetch(
          new Request(`https://api.eyvan.test${route}`, {
            method: 'POST',
            headers: {
              'Sec-Fetch-Site': 'cross-site',
              'X-Requested-With': 'eyvan-client',
              Cookie: `${AUTH_COOKIE_NAME}=dummy`,
            },
          }),
          workerEnv
        );
        assert.equal(wSecFetch.status, 403);
      }
    } finally {
      roomManager.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
