import {
  BASE_UNIVERSAL_ITEMS,
  DEFAULT_EQUIPPED_SLOTS,
  SLOT_FALLBACK_ITEMS,
  buildPublicAppearanceFromSlots,
  resolveCatalogItemDefinition,
} from '../../../../src/platform/items/catalogData';
import type {
  EquippedSlotsMap,
  InventoryRecord,
  ItemSlot,
  PublicAppearanceSnapshot,
  ServerInventoryState,
  UniversalItemDefinition,
} from '../../../../src/platform/items/itemTypes';
import {
  getEffectiveItemPrice,
  resolveShopTestModeEnabled,
} from '../../../../src/platform/items/shopTestMode';
import type { D1DatabaseLike } from '../types';
import { ensureUserAccountCode, isValidAccountCode } from '../auth/accountCode';

export type ItemsServiceErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_INPUT'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_NOT_CLAIMABLE'
  | 'NOT_EQUIPPABLE'
  | 'ITEM_NOT_OWNED'
  | 'ITEM_ALREADY_OWNED'
  | 'ITEM_NOT_GIFTABLE'
  | 'SELF_ACTION_FORBIDDEN'
  | 'USER_BLOCKED'
  | 'INSUFFICIENT_FUNDS'
  | 'USER_NOT_FOUND'
  | 'DATABASE_ERROR';

export type ItemsServiceResult<T> =
  | ({ readonly ok: true; readonly status: number } & T)
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: ItemsServiceErrorCode;
      readonly message: string;
    };

export interface PublicUserProfilePayload {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly accountCode: string | null;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly level: number;
  readonly stats: {
    readonly matchesPlayed: number;
    readonly wins: number;
    readonly losses: number;
  };
  readonly appearance: PublicAppearanceSnapshot;
}

export interface GiftRecipientPreview {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly accountCode: string | null;
  readonly avatarCode: string;
  readonly avatarUrl: string | null;
  readonly level: number;
  readonly appearance: PublicAppearanceSnapshot;
}

const VALID_SLOTS = new Set<ItemSlot>([
  'banner',
  'avatar',
  'avatar_frame',
  'profile_badge',
  'nameplate',
  'card_deck',
  'card_back',
  'game_effect',
  'table_skin',
  'table_background',
]);

const DEFAULT_OWNED_ITEMS = BASE_UNIVERSAL_ITEMS.filter((i) => i.isDefaultOwned);

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function isValidSlotName(value: unknown): value is ItemSlot {
  return typeof value === 'string' && VALID_SLOTS.has(value as ItemSlot);
}

export function isValidItemIdInput(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= 2 &&
    value.trim().length <= 80 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,79}$/.test(value.trim())
  );
}

export function isValidRequestIdInput(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length >= 4 &&
    value.trim().length <= 120 &&
    /^[a-zA-Z0-9_.:-]+$/.test(value.trim())
  );
}

/**
 * Ensures wallet, default-owned items, and default equipped slots exist for a user
 * idempotently using INSERT OR IGNORE in a single D1 batch.
 */
export async function ensureUserInventoryInitialized(
  db: D1DatabaseLike,
  userId: string,
  now: number = Date.now()
): Promise<void> {
  const existingWallet = await db
    .prepare(`SELECT user_id FROM user_wallets WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<{ user_id: string }>();

  const stmts = [
    db
      .prepare(
        `INSERT OR IGNORE INTO user_wallets (user_id, coins, gems, updated_at)
         VALUES (?, 0, 0, ?)`
      )
      .bind(userId, now),
    ...DEFAULT_OWNED_ITEMS.map((item) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO user_inventory (user_id, item_id, source, acquired_at)
           VALUES (?, ?, 'default', ?)`
        )
        .bind(userId, item.id, now)
    ),
  ];

  // Only populate default equipped slots on first-time initialization so intentional unequips stay unequipped.
  if (!existingWallet) {
    for (const [slot, itemId] of Object.entries(DEFAULT_EQUIPPED_SLOTS)) {
      if (!itemId) continue;
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO user_equipped_items (user_id, slot, item_id, updated_at)
             VALUES (?, ?, ?, ?)`
          )
          .bind(userId, slot, itemId, now)
      );
    }
  }

  await db.batch(stmts);
}

export async function readUserInventoryState(
  db: D1DatabaseLike,
  userId: string,
  options?: { shopTestMode?: boolean; now?: number }
): Promise<ServerInventoryState> {
  const now = options?.now ?? Date.now();
  const shopTestMode = resolveShopTestModeEnabled(options?.shopTestMode);

  await ensureUserInventoryInitialized(db, userId, now);

  const walletRow = await db
    .prepare(`SELECT coins, gems FROM user_wallets WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<{ coins: number; gems: number }>();

  const invRows = await db
    .prepare(
      `SELECT item_id, source, acquired_at
       FROM user_inventory
       WHERE user_id = ?
       ORDER BY acquired_at ASC, item_id ASC`
    )
    .bind(userId)
    .all<{
      item_id: string;
      source: InventoryRecord['source'];
      acquired_at: number;
    }>();

  const equippedRows = await db
    .prepare(
      `SELECT slot, item_id
       FROM user_equipped_items
       WHERE user_id = ?`
    )
    .bind(userId)
    .all<{ slot: ItemSlot; item_id: string }>();

  const inventory: InventoryRecord[] = (invRows.results ?? []).map((r) => ({
    itemId: r.item_id,
    source: r.source,
    acquiredAt: Number(r.acquired_at),
  }));

  const ownedSet = new Set(inventory.map((r) => r.itemId));
  const equippedSlots: EquippedSlotsMap = {};

  for (const row of equippedRows.results ?? []) {
    if (isValidSlotName(row.slot) && ownedSet.has(row.item_id)) {
      equippedSlots[row.slot] = row.item_id;
    }
  }

  // Ensure mandatory defaults remain populated if absent from rows
  if (!equippedSlots.card_deck) equippedSlots.card_deck = DEFAULT_EQUIPPED_SLOTS.card_deck;
  if (!equippedSlots.card_back) equippedSlots.card_back = DEFAULT_EQUIPPED_SLOTS.card_back;
  if (!equippedSlots.table_skin) equippedSlots.table_skin = DEFAULT_EQUIPPED_SLOTS.table_skin;
  if (!equippedSlots.banner && !equippedRows.results?.some((r) => r.slot === 'banner')) {
    equippedSlots.banner = DEFAULT_EQUIPPED_SLOTS.banner;
  }

  const publicAppearance = buildPublicAppearanceFromSlots(equippedSlots);

  return {
    userId,
    coins: Math.max(0, Number(walletRow?.coins ?? 0)),
    gems: Math.max(0, Number(walletRow?.gems ?? 0)),
    ownedItemIds: Array.from(ownedSet),
    inventory,
    equippedSlots,
    publicAppearance,
    shopTestMode,
  };
}

export async function claimShopItemForUser(
  db: D1DatabaseLike,
  userId: string,
  input: {
    readonly itemId: unknown;
    readonly requestId?: unknown;
    readonly shopTestMode?: boolean;
    readonly now?: number;
  }
): Promise<
  ItemsServiceResult<{
    readonly item: UniversalItemDefinition;
    readonly effectivePrice: number;
    readonly deduplicated: boolean;
    readonly alreadyOwned: boolean;
    readonly grantedCoins: number;
    readonly grantedGems: number;
    readonly state: ServerInventoryState;
  }>
> {
  const now = input.now ?? Date.now();
  const shopTestMode = resolveShopTestModeEnabled(input.shopTestMode);

  if (!isValidItemIdInput(input.itemId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه آیتم فروشگاه معتبر نیست.',
    };
  }
  const itemId = input.itemId.trim();

  if (input.requestId !== undefined && input.requestId !== null && !isValidRequestIdInput(input.requestId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه پیگیری تراکنش معتبر نیست.',
    };
  }
  const requestId = isValidRequestIdInput(input.requestId)
    ? input.requestId.trim()
    : generateId('req');

  const def = resolveCatalogItemDefinition(itemId);
  if (!def) {
    return {
      ok: false,
      status: 404,
      code: 'ITEM_NOT_FOUND',
      message: 'آیتم درخواستی در کاتالوگ فروشگاه یافت نشد.',
    };
  }
  if (!def.isClaimable) {
    return {
      ok: false,
      status: 400,
      code: 'ITEM_NOT_CLAIMABLE',
      message: 'این آیتم در حال حاضر قابل دریافت نیست.',
    };
  }

  await ensureUserInventoryInitialized(db, userId, now);

  // 1) Idempotency check by (user_id, request_id)
  const existingClaim = await db
    .prepare(
      `SELECT effective_price, reward_coins, reward_gems
       FROM user_wallet_claims
       WHERE user_id = ? AND request_id = ?
       LIMIT 1`
    )
    .bind(userId, requestId)
    .first<{
      effective_price: number;
      reward_coins: number;
      reward_gems: number;
    }>();

  if (existingClaim) {
    const state = await readUserInventoryState(db, userId, { shopTestMode, now });
    return {
      ok: true,
      status: 200,
      item: def,
      effectivePrice: Number(existingClaim.effective_price),
      deduplicated: true,
      alreadyOwned: def.kind !== 'chest' && def.kind !== 'bundle',
      grantedCoins: Number(existingClaim.reward_coins),
      grantedGems: Number(existingClaim.reward_gems),
      state,
    };
  }

  const isConsumableReward = def.kind === 'chest' || def.kind === 'bundle';

  // 2) Duplicate protection for permanent (non-consumable) items
  if (!isConsumableReward) {
    const ownedRow = await db
      .prepare(
        `SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ? LIMIT 1`
      )
      .bind(userId, def.id)
      .first();

    if (ownedRow) {
      const state = await readUserInventoryState(db, userId, { shopTestMode, now });
      return {
        ok: true,
        status: 200,
        item: def,
        effectivePrice: 0,
        deduplicated: true,
        alreadyOwned: true,
        grantedCoins: 0,
        grantedGems: 0,
        state,
      };
    }
  }

  // 3) Compute effective price strictly server-side
  const effectivePrice = getEffectiveItemPrice(def.price, shopTestMode);
  const rewardCoins = Math.max(0, Math.floor(def.rewardPayload?.coins ?? 0));
  const rewardGems = Math.max(0, Math.floor(def.rewardPayload?.gems ?? 0));

  // 4) Deduct cost atomically when effectivePrice > 0
  if (effectivePrice > 0) {
    const deductSql =
      def.currency === 'gems'
        ? `UPDATE user_wallets
           SET gems = gems - ?, updated_at = ?
           WHERE user_id = ? AND gems >= ?`
        : `UPDATE user_wallets
           SET coins = coins - ?, updated_at = ?
           WHERE user_id = ? AND coins >= ?`;
    const deductRes = await db
      .prepare(deductSql)
      .bind(effectivePrice, now, userId, effectivePrice)
      .run();

    if ((deductRes.meta?.changes ?? 0) !== 1) {
      return {
        ok: false,
        status: 402,
        code: 'INSUFFICIENT_FUNDS',
        message:
          def.currency === 'gems'
            ? 'موجودی الماس شما برای دریافت این آیتم کافی نیست.'
            : 'موجودی سکه شما برای دریافت این آیتم کافی نیست.',
      };
    }
  }

  // 5) Insert idempotent claim record FIRST so concurrent duplicate requestIds fail the UNIQUE key
  const claimId = generateId('clm');
  try {
    await db
      .prepare(
        `INSERT INTO user_wallet_claims (
           claim_id, user_id, request_id, item_id, currency,
           effective_price, reward_coins, reward_gems, test_mode, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        claimId,
        userId,
        requestId,
        def.id,
        def.currency,
        effectivePrice,
        rewardCoins,
        rewardGems,
        shopTestMode ? 1 : 0,
        now
      )
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE') || msg.includes('constraint')) {
      // Refund any optimistic deduction from the racing duplicate request
      if (effectivePrice > 0) {
        const refundSql =
          def.currency === 'gems'
            ? `UPDATE user_wallets SET gems = gems + ?, updated_at = ? WHERE user_id = ?`
            : `UPDATE user_wallets SET coins = coins + ?, updated_at = ? WHERE user_id = ?`;
        await db.prepare(refundSql).bind(effectivePrice, now, userId).run();
      }
      const state = await readUserInventoryState(db, userId, { shopTestMode, now });
      return {
        ok: true,
        status: 200,
        item: def,
        effectivePrice,
        deduplicated: true,
        alreadyOwned: !isConsumableReward,
        grantedCoins: rewardCoins,
        grantedGems: rewardGems,
        state,
      };
    }
    throw err;
  }

  // 6) Apply wallet rewards & grant permanent ownership atomically
  const postStatements = [];
  if (rewardCoins > 0 || rewardGems > 0) {
    postStatements.push(
      db
        .prepare(
          `UPDATE user_wallets
           SET coins = coins + ?, gems = gems + ?, updated_at = ?
           WHERE user_id = ?`
        )
        .bind(rewardCoins, rewardGems, now, userId)
    );
  }
  if (!isConsumableReward) {
    postStatements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO user_inventory (user_id, item_id, source, acquired_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(userId, def.id, shopTestMode ? 'test_mode' : 'shop_claim', now)
    );
  }
  if (postStatements.length > 0) {
    await db.batch(postStatements);
  }

  const state = await readUserInventoryState(db, userId, { shopTestMode, now });
  return {
    ok: true,
    status: 200,
    item: def,
    effectivePrice,
    deduplicated: false,
    alreadyOwned: false,
    grantedCoins: rewardCoins,
    grantedGems: rewardGems,
    state,
  };
}

export async function equipItemForUser(
  db: D1DatabaseLike,
  userId: string,
  input: {
    readonly itemId: unknown;
    readonly slot?: unknown;
    readonly shopTestMode?: boolean;
    readonly now?: number;
  }
): Promise<ItemsServiceResult<{ readonly state: ServerInventoryState }>> {
  const now = input.now ?? Date.now();
  const shopTestMode = resolveShopTestModeEnabled(input.shopTestMode);

  if (!isValidItemIdInput(input.itemId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه آیتم برای انتخاب نامعتبر است.',
    };
  }
  const itemId = input.itemId.trim();

  const def = resolveCatalogItemDefinition(itemId);
  if (!def) {
    return {
      ok: false,
      status: 404,
      code: 'ITEM_NOT_FOUND',
      message: 'آیتم انتخاب‌شده در کاتالوگ وجود ندارد.',
    };
  }

  if (!def.isEquippable || !def.slot) {
    return {
      ok: false,
      status: 400,
      code: 'NOT_EQUIPPABLE',
      message: 'این نوع آیتم قابل انتخاب روی اسلات کاربری نیست.',
    };
  }

  if (input.slot !== undefined && input.slot !== null && input.slot !== def.slot) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'اسلات انتخاب‌شده با نوع آیتم همخوانی ندارد.',
    };
  }

  await ensureUserInventoryInitialized(db, userId, now);

  const owned = await db
    .prepare(
      `SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ? LIMIT 1`
    )
    .bind(userId, def.id)
    .first();

  if (!owned) {
    return {
      ok: false,
      status: 403,
      code: 'ITEM_NOT_OWNED',
      message: 'شما مالک این آیتم نیستید و ابتدا باید آن را دریافت کنید.',
    };
  }

  await db
    .prepare(
      `INSERT INTO user_equipped_items (user_id, slot, item_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, slot) DO UPDATE SET
         item_id = excluded.item_id,
         updated_at = excluded.updated_at`
    )
    .bind(userId, def.slot, def.id, now)
    .run();

  const state = await readUserInventoryState(db, userId, { shopTestMode, now });
  return {
    ok: true,
    status: 200,
    state,
  };
}

export async function unequipSlotForUser(
  db: D1DatabaseLike,
  userId: string,
  input: {
    readonly slot: unknown;
    readonly shopTestMode?: boolean;
    readonly now?: number;
  }
): Promise<ItemsServiceResult<{ readonly state: ServerInventoryState }>> {
  const now = input.now ?? Date.now();
  const shopTestMode = resolveShopTestModeEnabled(input.shopTestMode);

  if (!isValidSlotName(input.slot)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'نام اسلات برای برداشتن انتخاب نامعتبر است.',
    };
  }

  await ensureUserInventoryInitialized(db, userId, now);

  const fallbackItemId = SLOT_FALLBACK_ITEMS[input.slot];
  if (fallbackItemId) {
    await db
      .prepare(
        `INSERT INTO user_equipped_items (user_id, slot, item_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, slot) DO UPDATE SET
           item_id = excluded.item_id,
           updated_at = excluded.updated_at`
      )
      .bind(userId, input.slot, fallbackItemId, now)
      .run();
  } else {
    await db
      .prepare(
        `DELETE FROM user_equipped_items WHERE user_id = ? AND slot = ?`
      )
      .bind(userId, input.slot)
      .run();
  }

  const state = await readUserInventoryState(db, userId, { shopTestMode, now });
  return {
    ok: true,
    status: 200,
    state,
  };
}

/**
 * Loads ONLY public profile & public gameplay appearance for a target userId.
 * NEVER returns `email`, `coins`, `gems`, `ownedItemIds`, `inventory`, or `owner_only` slots (`table_skin`, `table_background`).
 */
export async function getPublicAppearanceForUser(
  db: D1DatabaseLike,
  userId: string
): Promise<PublicAppearanceSnapshot> {
  const rows = await db
    .prepare(
      `SELECT e.slot, e.item_id
       FROM user_equipped_items e
       INNER JOIN user_inventory inv
         ON inv.user_id = e.user_id AND inv.item_id = e.item_id
       WHERE e.user_id = ?`
    )
    .bind(userId)
    .all<{ slot: ItemSlot; item_id: string }>();

  const equipped: EquippedSlotsMap = {};
  for (const row of rows.results ?? []) {
    if (isValidSlotName(row.slot)) {
      equipped[row.slot] = row.item_id;
    }
  }
  return buildPublicAppearanceFromSlots(equipped);
}

/**
 * Loads public appearance map for multiple users in one batched query (for friends lists, rooms, etc.).
 */
export async function getPublicAppearancesForUsers(
  db: D1DatabaseLike,
  userIds: readonly string[]
): Promise<Map<string, PublicAppearanceSnapshot>> {
  const cleanIds = Array.from(
    new Set(userIds.filter((id) => typeof id === 'string' && id.trim().length > 0))
  ).slice(0, 100);
  const out = new Map<string, PublicAppearanceSnapshot>();
  if (cleanIds.length === 0) return out;

  const placeholders = cleanIds.map(() => '?').join(', ');
  const rows = await db
    .prepare(
      `SELECT e.user_id, e.slot, e.item_id
       FROM user_equipped_items e
       INNER JOIN user_inventory inv
         ON inv.user_id = e.user_id AND inv.item_id = e.item_id
       WHERE e.user_id IN (${placeholders})`
    )
    .bind(...cleanIds)
    .all<{ user_id: string; slot: ItemSlot; item_id: string }>();

  const slotsByUser = new Map<string, EquippedSlotsMap>();
  for (const id of cleanIds) {
    slotsByUser.set(id, {});
  }
  for (const row of rows.results ?? []) {
    const map = slotsByUser.get(row.user_id);
    if (map && isValidSlotName(row.slot)) {
      map[row.slot] = row.item_id;
    }
  }
  for (const id of cleanIds) {
    out.set(id, buildPublicAppearanceFromSlots(slotsByUser.get(id) ?? {}));
  }
  return out;
}

export async function getPublicUserProfileById(
  db: D1DatabaseLike,
  rawTargetUserId: unknown
): Promise<ItemsServiceResult<{ readonly profile: PublicUserProfilePayload }>> {
  if (
    typeof rawTargetUserId !== 'string' ||
    !/^[a-zA-Z0-9_.-]{3,64}$/.test(rawTargetUserId.trim())
  ) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه کاربر نامعتبر است.',
    };
  }
  const targetUserId = rawTargetUserId.trim();

  const row = await db
    .prepare(
      `SELECT
         u.user_id,
         u.username,
         u.display_name,
         u.account_code,
         u.avatar_code,
         u.avatar_url,
         COALESCE(ugs.matches_played, 0) AS matches_played,
         COALESCE(ugs.wins, 0) AS wins,
         COALESCE(ugs.losses, 0) AS losses
       FROM users u
       LEFT JOIN user_game_stats ugs ON ugs.user_id = u.user_id
       WHERE u.user_id = ?
         AND u.account_status = 'active'
         AND u.email_verified = 1
       LIMIT 1`
    )
    .bind(targetUserId)
    .first<{
      user_id: string;
      username: string;
      display_name: string;
      account_code: string | null;
      avatar_code: string;
      avatar_url: string | null;
      matches_played: number;
      wins: number;
      losses: number;
    }>();

  if (!row) {
    return {
      ok: false,
      status: 404,
      code: 'USER_NOT_FOUND',
      message: 'کاربر مورد نظر یافت نشد.',
    };
  }

  const [appearance, ensuredCode] = await Promise.all([
    getPublicAppearanceForUser(db, row.user_id),
    row.account_code
      ? Promise.resolve(row.account_code)
      : ensureUserAccountCode(db, row.user_id),
  ]);
  const wins = Math.max(0, Number(row.wins ?? 0));
  const matchesPlayed = Math.max(0, Number(row.matches_played ?? 0));
  const losses = Math.max(0, Number(row.losses ?? 0));

  return {
    ok: true,
    status: 200,
    profile: {
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      accountCode: ensuredCode,
      avatarCode: row.avatar_code,
      avatarUrl: row.avatar_url,
      level: Math.max(1, Math.floor(wins / 3) + 1),
      stats: {
        matchesPlayed,
        wins,
        losses,
      },
      appearance,
    },
  };
}

/**
 * Looks up a safe public user preview for gifting by exact case-insensitive username
 * OR unique 6-digit `accountCode`. Strictly omits all PII and owner-only items.
 */
export async function lookupPublicUserForGift(
  db: D1DatabaseLike,
  rawQuery: unknown,
  actorUserId: string
): Promise<ItemsServiceResult<{ readonly user: GiftRecipientPreview }>> {
  if (typeof rawQuery !== 'string') {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'نام کاربری یا شناسه ۶ رقمی دوست را وارد کنید.',
    };
  }
  const clean = rawQuery.trim();
  if (clean.length < 2 || clean.length > 32) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'عبارت جستجو باید بین ۲ تا ۳۲ کاراکتر باشد.',
    };
  }

  const isCode = isValidAccountCode(clean);
  const queryKey = clean.toLowerCase();

  const row = await db
    .prepare(
      isCode
        ? `SELECT
             u.user_id,
             u.username,
             u.display_name,
             u.account_code,
             u.avatar_code,
             u.avatar_url,
             COALESCE(ugs.wins, 0) AS wins
           FROM users u
           LEFT JOIN user_game_stats ugs ON ugs.user_id = u.user_id
           WHERE (u.account_code = ? OR u.username_key = ?)
             AND u.account_status = 'active'
             AND u.email_verified = 1
           LIMIT 1`
        : `SELECT
             u.user_id,
             u.username,
             u.display_name,
             u.account_code,
             u.avatar_code,
             u.avatar_url,
             COALESCE(ugs.wins, 0) AS wins
           FROM users u
           LEFT JOIN user_game_stats ugs ON ugs.user_id = u.user_id
           WHERE u.username_key = ?
             AND u.account_status = 'active'
             AND u.email_verified = 1
           LIMIT 1`
    )
    .bind(...(isCode ? [clean, queryKey] : [queryKey]))
    .first<{
      user_id: string;
      username: string;
      display_name: string;
      account_code: string | null;
      avatar_code: string;
      avatar_url: string | null;
      wins: number;
    }>();

  if (!row) {
    return {
      ok: false,
      status: 404,
      code: 'USER_NOT_FOUND',
      message: 'بازیکنی با این نام کاربری یا شناسه ۶ رقمی یافت نشد.',
    };
  }

  if (row.user_id === actorUserId) {
    return {
      ok: false,
      status: 400,
      code: 'SELF_ACTION_FORBIDDEN',
      message: 'امکان ارسال هدیه به حساب خودتان وجود ندارد.',
    };
  }

  const blocked = await db
    .prepare(
      `SELECT 1 AS hit
       FROM user_blocks
       WHERE (blocker_id = ? AND blocked_id = ?)
          OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`
    )
    .bind(actorUserId, row.user_id, row.user_id, actorUserId)
    .first<{ hit: number }>();

  if (blocked) {
    return {
      ok: false,
      status: 404,
      code: 'USER_NOT_FOUND',
      message: 'بازیکنی با این نام کاربری یا شناسه ۶ رقمی یافت نشد.',
    };
  }

  const [appearance, ensuredCode] = await Promise.all([
    getPublicAppearanceForUser(db, row.user_id),
    row.account_code
      ? Promise.resolve(row.account_code)
      : ensureUserAccountCode(db, row.user_id),
  ]);
  const wins = Math.max(0, Number(row.wins ?? 0));

  return {
    ok: true,
    status: 200,
    user: {
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      accountCode: ensuredCode,
      avatarCode: row.avatar_code,
      avatarUrl: row.avatar_url,
      level: Math.max(1, Math.floor(wins / 3) + 1),
      appearance,
    },
  };
}

/**
 * Purchases a permanent, non-default shop item or card deck as a gift for another active verified user.
 * Enforces self-gift block, already-owned check (409), atomic wallet debit (402), idempotency via requestId,
 * and permanent grant to recipient's `user_inventory` (`source = 'reward'`).
 */
export async function giftShopItemForUser(
  db: D1DatabaseLike,
  senderUserId: string,
  input: {
    readonly itemId: unknown;
    readonly recipientUserId?: unknown;
    readonly requestId?: unknown;
    readonly shopTestMode?: boolean;
    readonly now?: number;
  }
): Promise<
  ItemsServiceResult<{
    readonly giftId: string;
    readonly item: UniversalItemDefinition;
    readonly effectivePrice: number;
    readonly deduplicated: boolean;
    readonly recipient: GiftRecipientPreview;
    readonly state: ServerInventoryState;
  }>
> {
  const now = input.now ?? Date.now();
  const shopTestMode = resolveShopTestModeEnabled(input.shopTestMode);

  if (!isValidItemIdInput(input.itemId)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه آیتم برای هدیه معتبر نیست.',
    };
  }
  const itemId = input.itemId.trim();

  if (
    typeof input.recipientUserId !== 'string' ||
    !/^[a-zA-Z0-9_.-]{3,64}$/.test(input.recipientUserId.trim())
  ) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه کاربر دریافت‌کننده هدیه نامعتبر است.',
    };
  }
  const recipientUserId = input.recipientUserId.trim();

  if (recipientUserId === senderUserId) {
    return {
      ok: false,
      status: 400,
      code: 'SELF_ACTION_FORBIDDEN',
      message: 'امکان ارسال هدیه به خودتان وجود ندارد.',
    };
  }

  if (
    input.requestId !== undefined &&
    input.requestId !== null &&
    !isValidRequestIdInput(input.requestId)
  ) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_INPUT',
      message: 'شناسه پیگیری هدیه معتبر نیست.',
    };
  }
  const requestId = isValidRequestIdInput(input.requestId)
    ? input.requestId.trim()
    : generateId('giftreq');

  const def = resolveCatalogItemDefinition(itemId);
  if (!def) {
    return {
      ok: false,
      status: 404,
      code: 'ITEM_NOT_FOUND',
      message: 'آیتم درخواستی در فروشگاه یافت نشد.',
    };
  }

  if (
    !def.isClaimable ||
    def.isDefaultOwned ||
    def.kind === 'chest' ||
    def.kind === 'bundle'
  ) {
    return {
      ok: false,
      status: 400,
      code: 'ITEM_NOT_GIFTABLE',
      message: 'این آیتم قابل هدیه‌دادن نیست (فقط آیتم‌های دائمی غیرافتتاحی قابل هدیه هستند).',
    };
  }

  const recipientRow = await db
    .prepare(
      `SELECT
         u.user_id,
         u.username,
         u.display_name,
         u.account_code,
         u.avatar_code,
         u.avatar_url,
         COALESCE(ugs.wins, 0) AS wins
       FROM users u
       LEFT JOIN user_game_stats ugs ON ugs.user_id = u.user_id
       WHERE u.user_id = ?
         AND u.account_status = 'active'
         AND u.email_verified = 1
       LIMIT 1`
    )
    .bind(recipientUserId)
    .first<{
      user_id: string;
      username: string;
      display_name: string;
      account_code: string | null;
      avatar_code: string;
      avatar_url: string | null;
      wins: number;
    }>();

  if (!recipientRow) {
    return {
      ok: false,
      status: 404,
      code: 'USER_NOT_FOUND',
      message: 'کاربر دریافت‌کننده هدیه یافت نشد.',
    };
  }

  const blocked = await db
    .prepare(
      `SELECT 1 AS hit
       FROM user_blocks
       WHERE (blocker_id = ? AND blocked_id = ?)
          OR (blocker_id = ? AND blocked_id = ?)
       LIMIT 1`
    )
    .bind(senderUserId, recipientUserId, recipientUserId, senderUserId)
    .first<{ hit: number }>();

  if (blocked) {
    return {
      ok: false,
      status: 403,
      code: 'USER_BLOCKED',
      message: 'امکان ارسال هدیه به این کاربر وجود ندارد.',
    };
  }

  await Promise.all([
    ensureUserInventoryInitialized(db, senderUserId, now),
    ensureUserInventoryInitialized(db, recipientUserId, now),
  ]);

  const [recipientAppearance, recipientAccountCode] = await Promise.all([
    getPublicAppearanceForUser(db, recipientUserId),
    recipientRow.account_code
      ? Promise.resolve(recipientRow.account_code)
      : ensureUserAccountCode(db, recipientUserId, now),
  ]);

  const recipientPreview: GiftRecipientPreview = {
    userId: recipientRow.user_id,
    username: recipientRow.username,
    displayName: recipientRow.display_name,
    accountCode: recipientAccountCode,
    avatarCode: recipientRow.avatar_code,
    avatarUrl: recipientRow.avatar_url,
    level: Math.max(1, Math.floor(Number(recipientRow.wins ?? 0) / 3) + 1),
    appearance: recipientAppearance,
  };

  // Idempotency fast-path
  const existingGift = await db
    .prepare(
      `SELECT gift_id, price_paid
       FROM gift_transactions
       WHERE sender_user_id = ? AND request_id = ?
       LIMIT 1`
    )
    .bind(senderUserId, requestId)
    .first<{ gift_id: string; price_paid: number }>();

  if (existingGift) {
    const state = await readUserInventoryState(db, senderUserId, { shopTestMode, now });
    return {
      ok: true,
      status: 200,
      giftId: existingGift.gift_id,
      item: def,
      effectivePrice: Number(existingGift.price_paid),
      deduplicated: true,
      recipient: recipientPreview,
      state,
    };
  }

  // Recipient already owns this item? Reject cleanly before charging sender!
  const alreadyOwned = await db
    .prepare(
      `SELECT 1 FROM user_inventory WHERE user_id = ? AND item_id = ? LIMIT 1`
    )
    .bind(recipientUserId, def.id)
    .first();

  if (alreadyOwned) {
    return {
      ok: false,
      status: 409,
      code: 'ITEM_ALREADY_OWNED',
      message: 'این بازیکن از قبل مالک این آیتم است و نیازی به خرید مجدد ندارد.',
    };
  }

  const effectivePrice = getEffectiveItemPrice(def.price, shopTestMode);

  if (effectivePrice > 0) {
    const deductSql =
      def.currency === 'gems'
        ? `UPDATE user_wallets
           SET gems = gems - ?, updated_at = ?
           WHERE user_id = ? AND gems >= ?`
        : `UPDATE user_wallets
           SET coins = coins - ?, updated_at = ?
           WHERE user_id = ? AND coins >= ?`;
    const deductRes = await db
      .prepare(deductSql)
      .bind(effectivePrice, now, senderUserId, effectivePrice)
      .run();

    if ((deductRes.meta?.changes ?? 0) !== 1) {
      return {
        ok: false,
        status: 402,
        code: 'INSUFFICIENT_FUNDS',
        message:
          def.currency === 'gems'
            ? 'موجودی الماس شما برای ارسال این هدیه کافی نیست.'
            : 'موجودی سکه شما برای ارسال این هدیه کافی نیست.',
      };
    }
  }

  const giftId = generateId('gft');
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO gift_transactions (
             gift_id, sender_user_id, recipient_user_id, item_id,
             currency, price_paid, request_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          giftId,
          senderUserId,
          recipientUserId,
          def.id,
          def.currency,
          effectivePrice,
          requestId,
          now
        ),
      db
        .prepare(
          `INSERT OR IGNORE INTO user_inventory (user_id, item_id, source, acquired_at)
           VALUES (?, ?, 'reward', ?)`
        )
        .bind(recipientUserId, def.id, now),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE') || msg.includes('constraint')) {
      if (effectivePrice > 0) {
        const refundSql =
          def.currency === 'gems'
            ? `UPDATE user_wallets SET gems = gems + ?, updated_at = ? WHERE user_id = ?`
            : `UPDATE user_wallets SET coins = coins + ?, updated_at = ? WHERE user_id = ?`;
        await db.prepare(refundSql).bind(effectivePrice, now, senderUserId).run();
      }
      const dup = await db
        .prepare(
          `SELECT gift_id, price_paid
           FROM gift_transactions
           WHERE sender_user_id = ? AND request_id = ?
           LIMIT 1`
        )
        .bind(senderUserId, requestId)
        .first<{ gift_id: string; price_paid: number }>();
      if (dup) {
        const state = await readUserInventoryState(db, senderUserId, { shopTestMode, now });
        return {
          ok: true,
          status: 200,
          giftId: dup.gift_id,
          item: def,
          effectivePrice: Number(dup.price_paid),
          deduplicated: true,
          recipient: recipientPreview,
          state,
        };
      }
    }
    throw err;
  }

  const state = await readUserInventoryState(db, senderUserId, { shopTestMode, now });
  return {
    ok: true,
    status: 200,
    giftId,
    item: def,
    effectivePrice,
    deduplicated: false,
    recipient: recipientPreview,
    state,
  };
}
