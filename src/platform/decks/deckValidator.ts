import { isSafeRelativeDeckPath } from './deckHosting';
import {
  ALL_CARD_ASSET_KEYS,
  CardAssetKey,
  DECK_SCHEMA_VERSION,
  DeckAssetEntry,
  DeckAssetFormat,
  DeckAssetMimeType,
  DeckCatalogEntry,
  DeckManifest,
  DeckPricingInfo,
  DeckRenderMode,
  DeckStyleTokens,
  DeckSystemError,
} from './types';

const DECK_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const SAFE_COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|var\(--[a-zA-Z0-9_-]+\))$/;
const VALID_CARD_KEYS = new Set<string>(ALL_CARD_ASSET_KEYS);

const ALLOWED_MIME_TYPES = new Set<DeckAssetMimeType>([
  'image/svg+xml',
  'image/webp',
  'image/png',
  'image/jpeg',
  'image/avif',
]);

const ALLOWED_RENDER_MODES = new Set<DeckRenderMode>([
  'builtin_classic',
  'full_card',
  'partial_override',
]);

const ALLOWED_FORMATS = new Set<DeckAssetFormat>([
  'svg',
  'webp',
  'png',
  'mixed',
]);

function asNonEmptyString(val: unknown, maxLen = 400): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed || trimmed.length > maxLen) return null;
  return trimmed;
}

function validateSafeUrl(val: unknown): string {
  if (typeof val !== 'string' || !val.trim()) return '';
  const trimmed = val.trim();
  if (trimmed.startsWith('/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // Reject invalid URLs
  }
  return '';
}

function validateStyleTokens(raw: unknown): DeckStyleTokens {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const pickColor = (candidate: unknown, fallback: string) =>
    typeof candidate === 'string' && SAFE_COLOR_RE.test(candidate.trim())
      ? candidate.trim()
      : fallback;

  return {
    cardBackground: pickColor(obj.cardBackground, '#FFFFFF'),
    cardBorderColor: pickColor(obj.cardBorderColor, '#CFCBC2'),
    cardInnerFrame:
      typeof obj.cardInnerFrame === 'boolean' ? obj.cardInnerFrame : true,
    imageFit: obj.imageFit === 'contain' ? 'contain' : 'cover',
    imagePaddingPx:
      typeof obj.imagePaddingPx === 'number' &&
      Number.isFinite(obj.imagePaddingPx) &&
      obj.imagePaddingPx >= 0 &&
      obj.imagePaddingPx <= 16
        ? Math.round(obj.imagePaddingPx)
        : 0,
    backBackground: pickColor(obj.backBackground, '#FFFFFF'),
    backBorderColor: pickColor(obj.backBorderColor, '#D4CFC5'),
    backPaddingPx:
      typeof obj.backPaddingPx === 'number' &&
      Number.isFinite(obj.backPaddingPx) &&
      obj.backPaddingPx >= 0 &&
      obj.backPaddingPx <= 8
        ? Math.round(obj.backPaddingPx)
        : 2,
    unplayableFilter:
      typeof obj.unplayableFilter === 'string' &&
      obj.unplayableFilter.length <= 120 &&
      !/[;{}]/.test(obj.unplayableFilter)
        ? obj.unplayableFilter
        : undefined,
  };
}

function validateAssetEntry(raw: unknown, label: string): DeckAssetEntry {
  if (!raw || typeof raw !== 'object') {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      `اطلاعات فایل «${label}» نامعتبر است.`
    );
  }
  const obj = raw as Record<string, unknown>;
  const path = asNonEmptyString(obj.path, 260);
  if (!path || !isSafeRelativeDeckPath(path)) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      `مسیر فایل «${label}» امن یا معتبر نیست.`
    );
  }
  const hash =
    typeof obj.hash === 'string' ? obj.hash.trim().toLowerCase() : '';
  if (!SHA256_HEX_RE.test(hash)) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      `هش SHA-256 برای فایل «${label}» نامعتبر است.`
    );
  }
  const bytes = obj.bytes;
  if (
    typeof bytes !== 'number' ||
    !Number.isFinite(bytes) ||
    bytes <= 0 ||
    bytes > 10 * 1024 * 1024
  ) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      `اندازه فایل «${label}» نامعتبر است.`
    );
  }
  const mimeType = obj.mimeType as DeckAssetMimeType;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      `فرمت فایل «${label}» پشتیبانی نمی‌شود.`
    );
  }
  return {
    path,
    hash,
    bytes: Math.floor(bytes),
    mimeType,
  };
}

export function validateDeckManifest(raw: unknown): DeckManifest {
  if (!raw || typeof raw !== 'object') {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      'ساختار Manifest مجموعه نامعتبر است.'
    );
  }
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  if (!DECK_ID_RE.test(id)) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      'شناسه مجموعه (Deck ID) نامعتبر است.'
    );
  }
  if (obj.schemaVersion !== DECK_SCHEMA_VERSION) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      `نسخه قالب Manifest پشتیبانی نمی‌شود: ${String(obj.schemaVersion)}`
    );
  }
  const version = asNonEmptyString(obj.version, 40);
  const name = asNonEmptyString(obj.name, 100);
  const description = asNonEmptyString(obj.description, 500) ?? '';
  const author = asNonEmptyString(obj.author, 100) ?? 'ناشناس';
  const license = asNonEmptyString(obj.license, 100) ?? 'Unspecified';
  if (!version || !name) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      'نام یا نسخه مجموعه در Manifest وارد نشده است.'
    );
  }

  const renderMode = obj.renderMode as DeckRenderMode;
  if (!ALLOWED_RENDER_MODES.has(renderMode)) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      `حالت رندر نامعتبر است: ${String(obj.renderMode)}`
    );
  }

  const format = obj.format as DeckAssetFormat;
  if (!ALLOWED_FORMATS.has(format)) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      `فرمت مجموعه نامعتبر است: ${String(obj.format)}`
    );
  }

  const aspectRatio = obj.aspectRatio;
  if (
    typeof aspectRatio !== 'number' ||
    !Number.isFinite(aspectRatio) ||
    aspectRatio < 0.45 ||
    aspectRatio > 1.2
  ) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      'نسبت ابعاد کارت در Manifest نامعتبر است.'
    );
  }

  const preview = obj.preview
    ? validateAssetEntry(obj.preview, 'preview')
    : undefined;
  const back = obj.back ? validateAssetEntry(obj.back, 'back') : undefined;

  if (renderMode === 'full_card' && !back) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      'مجموعه کامل باید فایل پشت کارت داشته باشد.'
    );
  }

  const cardsOut: Partial<Record<CardAssetKey, DeckAssetEntry>> = {};
  if (obj.cards && typeof obj.cards === 'object') {
    const rawCards = obj.cards as Record<string, unknown>;
    for (const [k, v] of Object.entries(rawCards)) {
      if (!VALID_CARD_KEYS.has(k)) {
        throw new DeckSystemError(
          'INVALID_MANIFEST',
          `شناسه کارت نامعتبر در Manifest: ${k}`
        );
      }
      cardsOut[k as CardAssetKey] = validateAssetEntry(v, k);
    }
  }

  if (renderMode === 'full_card') {
    const missingCards = ALL_CARD_ASSET_KEYS.filter((k) => !cardsOut[k]);
    if (missingCards.length > 0) {
      throw new DeckSystemError(
        'INVALID_MANIFEST',
        `مجموعه کامل باید هر ۵۲ برگ استاندارد را شامل شود (${missingCards.length} برگ ناقص است).`
      );
    }
  } else if (renderMode === 'partial_override') {
    if (Object.keys(cardsOut).length === 0 && !back) {
      throw new DeckSystemError(
        'INVALID_MANIFEST',
        'مجموعه جایگزین جزئی باید حداقل یک برگ کارت یا طرح پشت کارت داشته باشد.'
      );
    }
  }

  let jokersOut: DeckManifest['jokers'] | undefined;
  if (obj.jokers && typeof obj.jokers === 'object') {
    const rawJokers = obj.jokers as Record<string, unknown>;
    const red = rawJokers.red
      ? validateAssetEntry(rawJokers.red, 'joker-red')
      : undefined;
    const black = rawJokers.black
      ? validateAssetEntry(rawJokers.black, 'joker-black')
      : undefined;
    if (red || black) {
      jokersOut = { red, black };
    }
  }

  // Reject duplicate asset paths within the same manifest to prevent silent asset collisions
  const seenPaths = new Set<string>();
  const allEntries: DeckAssetEntry[] = [
    ...(preview ? [preview] : []),
    ...(back ? [back] : []),
    ...Object.values(cardsOut).filter((e): e is DeckAssetEntry => Boolean(e)),
    ...(jokersOut?.red ? [jokersOut.red] : []),
    ...(jokersOut?.black ? [jokersOut.black] : []),
  ];
  for (const assetEntry of allEntries) {
    if (seenPaths.has(assetEntry.path)) {
      throw new DeckSystemError(
        'INVALID_MANIFEST',
        `مسیر تکراری فایل در Manifest مجاز نیست: ${assetEntry.path}`
      );
    }
    seenPaths.add(assetEntry.path);
  }

  const MAX_DECK_TOTAL_BYTES = 50 * 1024 * 1024;
  const computedBytes = allEntries.reduce((s, e) => s + e.bytes, 0);
  if (computedBytes > MAX_DECK_TOTAL_BYTES) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      'حجم کل فایل‌های مجموعه از حد مجاز (۵۰ مگابایت) بیشتر است.'
    );
  }

  if (
    obj.totalBytes !== undefined &&
    (typeof obj.totalBytes !== 'number' ||
      !Number.isFinite(obj.totalBytes) ||
      obj.totalBytes < 0 ||
      obj.totalBytes > MAX_DECK_TOTAL_BYTES)
  ) {
    throw new DeckSystemError(
      'INVALID_MANIFEST',
      'مقدار totalBytes در Manifest نامعتبر است.'
    );
  }

  const declaredTotal =
    typeof obj.totalBytes === 'number' &&
    Number.isFinite(obj.totalBytes) &&
    obj.totalBytes > 0
      ? Math.floor(obj.totalBytes)
      : computedBytes;

  return {
    id,
    version,
    schemaVersion: DECK_SCHEMA_VERSION,
    name,
    description,
    author,
    sourceUrl: validateSafeUrl(obj.sourceUrl),
    license,
    preview,
    aspectRatio,
    renderMode,
    format,
    styleTokens: validateStyleTokens(obj.styleTokens),
    back,
    cards: cardsOut,
    jokers: jokersOut,
    totalBytes: declaredTotal || computedBytes,
  };
}

function validatePricing(raw: unknown): DeckPricingInfo {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const access =
    obj.access === 'builtin' || obj.access === 'paid' ? obj.access : 'free';
  const currency = obj.currency === 'gems' ? 'gems' : 'coins';
  const price =
    typeof obj.price === 'number' && Number.isFinite(obj.price) && obj.price >= 0
      ? Math.floor(obj.price)
      : 0;
  const rarity =
    obj.rarity === 'rare' ||
    obj.rarity === 'epic' ||
    obj.rarity === 'legendary'
      ? obj.rarity
      : 'common';
  return {
    access,
    price,
    currency,
    rarity,
    shopItemId:
      typeof obj.shopItemId === 'string' && obj.shopItemId.length <= 64
        ? obj.shopItemId
        : undefined,
    badge:
      typeof obj.badge === 'string' && obj.badge.length <= 32
        ? obj.badge
        : undefined,
  };
}

export function validateDeckCatalog(raw: unknown): DeckCatalogEntry[] {
  const rawList = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { decks?: unknown }).decks)
      ? (raw as { decks: unknown[] }).decks
      : null;

  if (!rawList) {
    throw new DeckSystemError(
      'INVALID_CATALOG',
      'ساختار فایل catalog.json معتبر نیست.'
    );
  }

  const out: DeckCatalogEntry[] = [];
  const seenIds = new Set<string>();

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    if (!DECK_ID_RE.test(id) || seenIds.has(id)) continue;

    const version = asNonEmptyString(obj.version, 40);
    const name = asNonEmptyString(obj.name, 100);
    const manifestPath = asNonEmptyString(obj.manifestPath, 260);
    const previewPath = asNonEmptyString(obj.previewPath, 260);
    if (
      !version ||
      !name ||
      !manifestPath ||
      !previewPath ||
      !isSafeRelativeDeckPath(manifestPath) ||
      !isSafeRelativeDeckPath(previewPath)
    ) {
      continue;
    }

    const previewMimeType = ALLOWED_MIME_TYPES.has(
      obj.previewMimeType as DeckAssetMimeType
    )
      ? (obj.previewMimeType as DeckAssetMimeType)
      : 'image/webp';

    const renderMode = ALLOWED_RENDER_MODES.has(
      obj.renderMode as DeckRenderMode
    )
      ? (obj.renderMode as DeckRenderMode)
      : 'full_card';

    const format = ALLOWED_FORMATS.has(obj.format as DeckAssetFormat)
      ? (obj.format as DeckAssetFormat)
      : 'mixed';

    const aspectRatio =
      typeof obj.aspectRatio === 'number' &&
      Number.isFinite(obj.aspectRatio) &&
      obj.aspectRatio >= 0.45 &&
      obj.aspectRatio <= 1.2
        ? obj.aspectRatio
        : 5 / 7;

    seenIds.add(id);
    out.push({
      id,
      version,
      schemaVersion:
        typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1,
      name,
      subtitle: asNonEmptyString(obj.subtitle, 140) ?? '',
      description: asNonEmptyString(obj.description, 500) ?? '',
      author: asNonEmptyString(obj.author, 100) ?? 'ناشناس',
      sourceUrl: validateSafeUrl(obj.sourceUrl),
      license: asNonEmptyString(obj.license, 100) ?? 'Unspecified',
      manifestPath,
      previewPath,
      previewMimeType,
      aspectRatio,
      renderMode,
      format,
      totalBytes:
        typeof obj.totalBytes === 'number' &&
        Number.isFinite(obj.totalBytes) &&
        obj.totalBytes >= 0
          ? Math.floor(obj.totalBytes)
          : 0,
      cardCount:
        typeof obj.cardCount === 'number' &&
        Number.isFinite(obj.cardCount) &&
        obj.cardCount >= 0
          ? Math.floor(obj.cardCount)
          : 52,
      pricing: validatePricing(obj.pricing),
      isExperimental: obj.isExperimental === true,
    });
  }

  return out;
}

/**
 * Pure SHA-256 implementation fallback for environments lacking `crypto.subtle`
 * (e.g., plain HTTP LAN testing), plus native `crypto.subtle` fast path.
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256HexFallback(bytes: Uint8Array): string {
  const len = bytes.length;
  const bitLen = len * 8;
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return Array.from(H)
    .map((w) => w.toString(16).padStart(8, '0'))
    .join('');
}

export async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    globalThis.crypto.subtle &&
    typeof globalThis.crypto.subtle.digest === 'function'
  ) {
    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
      const bytes = new Uint8Array(digest);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fall through to pure-JS implementation
    }
  }
  return sha256HexFallback(new Uint8Array(buffer));
}

/**
 * Verifies binary integrity and blocks unsafe SVGs or HTML fallback error pages.
 */
export function validateAssetBuffer(
  buffer: ArrayBuffer,
  mimeType: DeckAssetMimeType,
  label: string
): void {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength === 0) {
    throw new DeckSystemError(
      'INVALID_ASSET',
      `فایل «${label}» خالی است.`
    );
  }

  if (mimeType === 'image/png') {
    if (
      bytes.byteLength < 8 ||
      bytes[0] !== 0x89 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x47
    ) {
      throw new DeckSystemError(
        'INVALID_ASSET',
        `ساختار فایل PNG «${label}» خراب است.`
      );
    }
    return;
  }

  if (mimeType === 'image/webp') {
    const riff = String.fromCharCode(
      bytes[0] ?? 0,
      bytes[1] ?? 0,
      bytes[2] ?? 0,
      bytes[3] ?? 0
    );
    const webp = String.fromCharCode(
      bytes[8] ?? 0,
      bytes[9] ?? 0,
      bytes[10] ?? 0,
      bytes[11] ?? 0
    );
    if (bytes.byteLength < 12 || riff !== 'RIFF' || webp !== 'WEBP') {
      throw new DeckSystemError(
        'INVALID_ASSET',
        `ساختار فایل WebP «${label}» خراب است.`
      );
    }
    return;
  }

  if (mimeType === 'image/jpeg') {
    if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new DeckSystemError(
        'INVALID_ASSET',
        `ساختار فایل JPEG «${label}» خراب است.`
      );
    }
    return;
  }

  if (mimeType === 'image/svg+xml') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const lowered = text.toLowerCase();
    if (!lowered.includes('<svg') || lowered.includes('<!doctype html')) {
      throw new DeckSystemError(
        'INVALID_ASSET',
        `فایل SVG «${label}» نامعتبر یا خراب است.`
      );
    }
    if (
      /<script[\s>]/i.test(text) ||
      /<foreignobject[\s>]/i.test(text) ||
      /\son[a-z]+\s*=/i.test(text) ||
      /javascript:/i.test(text)
    ) {
      throw new DeckSystemError(
        'INVALID_ASSET',
        `فایل SVG «${label}» شامل محتوای ناایمن است.`
      );
    }
  }
}
