/**
 * Card skins — rollout switches.
 *
 * CARD_SKIN_PREVIEW_MODE
 *   true  → every skin counts as owned, so it can be equipped for testing.
 *           (Economy / payments are NOT wired yet — see docs/CARD_SKINS.md.)
 *   false → only default skins + skins passed to `grantSkin(id)` can be equipped.
 *
 * Flip to `false` when the shop starts calling `grantSkin(id)` after a real purchase.
 */
export const CARD_SKIN_PREVIEW_MODE = true;

export const CARD_SKIN_STORAGE_KEYS = {
  equipped: 'eyvan_card_skin_equipped',
  owned: 'eyvan_card_skin_owned',
} as const;
