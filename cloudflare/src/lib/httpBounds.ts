/**
 * Game-agnostic HTTP & WebSocket UTF-8 byte-size guards for Cloudflare Workers.
 *
 * Guarantees:
 * - Rejects oversized HTTP requests via `Content-Length` pre-check BEFORE reading.
 * - Streams `request.body` chunk-by-chunk and cancels immediately once cumulative
 *   bytes exceed `maxBytes` (never buffers huge bodies into Worker memory).
 * - Measures WebSocket payloads in true UTF-8 bytes (not UTF-16 `string.length`),
 *   so multi-byte Persian/Unicode text is accounted for accurately without false positives.
 */

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });

export function getPayloadUtf8Bytes(payload: string | ArrayBuffer): number {
  if (typeof payload === 'string') {
    return UTF8_ENCODER.encode(payload).byteLength;
  }
  return payload.byteLength;
}

export async function readBoundedUtf8Body(
  request: Request,
  maxBytes: number
): Promise<
  | { ok: true; text: string; byteLength: number }
  | { ok: false; status: 413 | 400; reason: 'TOO_LARGE' | 'READ_ERROR' }
> {
  // 1) Pre-flight Content-Length check before touching the body stream
  const contentLengthHeader = request.headers.get('Content-Length');
  if (contentLengthHeader !== null) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      try {
        await request.body?.cancel();
      } catch {
        // Ignore cancel errors
      }
      return { ok: false, status: 413, reason: 'TOO_LARGE' };
    }
  }

  // 2) Streaming chunked byte read (cancels immediately upon exceeding maxBytes)
  if (!request.body) {
    return { ok: true, text: '', byteLength: 0 };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel('payload_too_large');
        } catch {
          // Ignore cancel errors
        }
        return { ok: false, status: 413, reason: 'TOO_LARGE' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, reason: 'READ_ERROR' };
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    ok: true,
    text: UTF8_DECODER.decode(combined),
    byteLength: totalBytes,
  };
}
