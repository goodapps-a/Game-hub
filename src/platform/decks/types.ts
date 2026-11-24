import type { Rank, Suit } from '../../games/hokm/engine/types';
import type { ShopRarity } from '../types/platform';

export const EYVAN_CLASSIC_DECK_ID = 'eyvan-classic' as const;
export const DECK_SCHEMA_VERSION = 1 as const;

export type CardAssetKey = `${Suit}-${Rank}`;

export const DECK_SUITS: readonly Suit[] = [
  'hearts',
  'diamonds',
  'clubs',
  'spades',
];

export const DECK_RANKS: readonly Rank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
];

export const ALL_CARD_ASSET_KEYS: readonly CardAssetKey[] = DECK_SUITS.flatMap(
  (suit) => DECK_RANKS.map((rank) => `${suit}-${rank}` as CardAssetKey)
);

export type DeckRenderMode =
  | 'builtin_classic'
  | 'full_card'
  | 'partial_override';

export type DeckAssetFormat = 'svg' | 'webp' | 'png' | 'mixed';

export type DeckAssetMimeType =
  | 'image/svg+xml'
  | 'image/webp'
  | 'image/png'
  | 'image/jpeg'
  | 'image/avif';

export interface DeckAssetEntry {
  readonly path: string;
  readonly hash: string;
  readonly bytes: number;
  readonly mimeType: DeckAssetMimeType;
}

export interface DeckStyleTokens {
  readonly cardBackground: string;
  readonly cardBorderColor: string;
  readonly cardInnerFrame?: boolean;
  readonly imageFit: 'cover' | 'contain';
  readonly imagePaddingPx?: number;
  readonly backBackground?: string;
  readonly backBorderColor?: string;
  readonly backPaddingPx?: number;
  readonly unplayableFilter?: string;
}

export interface DeckPricingInfo {
  readonly access: 'builtin' | 'free' | 'paid';
  readonly price: number;
  readonly currency: 'coins' | 'gems';
  readonly rarity: ShopRarity;
  readonly shopItemId?: string;
  readonly badge?: string;
}

export interface DeckManifest {
  readonly id: string;
  readonly version: string;
  readonly schemaVersion: number;
  readonly name: string;
  readonly description: string;
  readonly author: string;
  readonly sourceUrl: string;
  readonly license: string;
  readonly preview?: DeckAssetEntry;
  readonly aspectRatio: number;
  readonly renderMode: DeckRenderMode;
  readonly format: DeckAssetFormat;
  readonly styleTokens: DeckStyleTokens;
  readonly back?: DeckAssetEntry;
  readonly cards: Partial<Record<CardAssetKey, DeckAssetEntry>>;
  readonly jokers?: {
    readonly red?: DeckAssetEntry;
    readonly black?: DeckAssetEntry;
  };
  readonly totalBytes: number;
}

export interface DeckCatalogEntry {
  readonly id: string;
  readonly version: string;
  readonly schemaVersion: number;
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
  readonly author: string;
  readonly sourceUrl: string;
  readonly license: string;
  readonly manifestPath: string;
  readonly previewPath: string;
  readonly previewMimeType: DeckAssetMimeType;
  readonly aspectRatio: number;
  readonly renderMode: DeckRenderMode;
  readonly format: DeckAssetFormat;
  readonly totalBytes: number;
  readonly cardCount: number;
  readonly pricing: DeckPricingInfo;
  readonly isExperimental?: boolean;
}

export type DeckLifecycleStatus =
  | 'free_available'
  | 'paid_locked'
  | 'downloading'
  | 'downloaded'
  | 'equipped'
  | 'update_available';

export interface DeckInstallRecord {
  readonly deckId: string;
  readonly installedVersion: string;
  readonly manifest: DeckManifest;
  readonly assetHashes: Readonly<Record<string, string>>;
  readonly complete: boolean;
  readonly installedAt: number;
  readonly updatedAt: number;
}

export interface DeckDownloadProgress {
  readonly deckId: string;
  readonly phase: 'manifest' | 'assets' | 'verifying';
  readonly loadedBytes: number;
  readonly totalBytes: number;
  readonly completedFiles: number;
  readonly totalFiles: number;
}

export type DeckErrorCode =
  | 'NETWORK_ERROR'
  | 'OFFLINE'
  | 'INVALID_CATALOG'
  | 'INVALID_MANIFEST'
  | 'HASH_MISMATCH'
  | 'INVALID_ASSET'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'STORAGE_UNAVAILABLE'
  | 'CANNOT_DELETE_ACTIVE'
  | 'CANNOT_DELETE_BUILTIN'
  | 'ABORTED';

export class DeckSystemError extends Error {
  readonly code: DeckErrorCode;

  constructor(code: DeckErrorCode, message: string) {
    super(message);
    this.name = 'DeckSystemError';
    this.code = code;
  }
}
