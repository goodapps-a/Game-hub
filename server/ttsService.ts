import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { VOICE_CALLOUT_BY_ID } from '../src/games/hokm/audio/voiceCallouts';

const TTS_MODEL = 'gemini-3.8-flash-lite-tts';
const TTS_VOICE_NAME = 'Fenrir'; // Deep, bold, charismatic masculine voice
const CACHE_DIR = path.resolve(process.cwd(), 'data', 'tts-cache');

const memoryCache = new Map<string, Buffer>();
const inflightRequests = new Map<string, Promise<Buffer | null>>();

let cachedAiClient: GoogleGenAI | null = null;
let cachedApiKey: string | undefined;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  if (!cachedAiClient || cachedApiKey !== apiKey) {
    cachedApiKey = apiKey;
    cachedAiClient = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1beta',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedAiClient;
}

function getCacheFilePath(calloutId: string): string {
  return path.join(CACHE_DIR, `${calloutId}_${TTS_VOICE_NAME.toLowerCase()}.wav`);
}

function readDiskCache(calloutId: string): Buffer | null {
  try {
    const filePath = getCacheFilePath(calloutId);
    if (fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      if (buf.length > 64) {
        return buf;
      }
    }
  } catch {
    // Non-fatal disk cache miss
  }
  return null;
}

function writeDiskCache(calloutId: string, wavBuffer: Buffer): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(getCacheFilePath(calloutId), wavBuffer);
  } catch {
    // Non-fatal disk cache write failure
  }
}

/**
 * Generates (and permanently caches) a high-quality deep masculine Persian WAV
 * clip for a whitelisted Hokm in-game voice callout using Gemini 3.8 TTS.
 */
export async function getOrGenerateVoiceCalloutWav(
  calloutId: string
): Promise<{ ok: true; wav: Buffer } | { ok: false; status: number; message: string }> {
  const spec = VOICE_CALLOUT_BY_ID.get(calloutId);
  if (!spec) {
    return {
      ok: false,
      status: 400,
      message: 'شناسه صوت نامعتبر است.',
    };
  }

  const memHit = memoryCache.get(calloutId);
  if (memHit) {
    return { ok: true, wav: memHit };
  }

  const diskHit = readDiskCache(calloutId);
  if (diskHit) {
    memoryCache.set(calloutId, diskHit);
    return { ok: true, wav: diskHit };
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      ok: false,
      status: 503,
      message: 'سرویس تولید صوت در حال حاضر پیکربندی نشده است.',
    };
  }

  let lastErrorDetail = '';
  let promise = inflightRequests.get(calloutId);
  if (!promise) {
    promise = (async () => {
      const attemptGenerate = async (includeStyleMetadata: boolean): Promise<Buffer | null> => {
        const part = includeStyleMetadata
          ? {
              text: spec.spokenText,
              speechMetadata: {
                style: `${spec.styleCue}. Natural Iranian Persian accent, rich low-pitched baritone male voice, short punchy delivery.`,
              },
            }
          : {
              text: spec.spokenText,
            };

        const response = await ai.models.generateContent({
          model: TTS_MODEL,
          contents: [
            {
              role: 'user',
              parts: [part],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: TTS_VOICE_NAME,
                },
              },
            },
          },
        });

        const base64Audio =
          response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
          return null;
        }
        const wavBuffer = Buffer.from(base64Audio, 'base64');
        return wavBuffer.length >= 64 ? wavBuffer : null;
      };

      let wavBuffer: Buffer | null = null;
      try {
        wavBuffer = await attemptGenerate(true);
      } catch (firstErr: unknown) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        lastErrorDetail = msg.slice(0, 220);
        console.warn('[Eyvan TTS] First attempt failed for', calloutId, lastErrorDetail);
        // Retry cleanly without speechMetadata in case style metadata caused an upstream rejection
        wavBuffer = await attemptGenerate(false);
      }

      if (!wavBuffer) {
        return null;
      }
      memoryCache.set(calloutId, wavBuffer);
      writeDiskCache(calloutId, wavBuffer);
      return wavBuffer;
    })()
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        lastErrorDetail = msg.slice(0, 220);
        console.warn('[Eyvan TTS] Generation failed for', calloutId, lastErrorDetail);
        return null;
      })
      .finally(() => {
        inflightRequests.delete(calloutId);
      });

    inflightRequests.set(calloutId, promise);
  }

  const wav = await promise;
  if (!wav) {
    return {
      ok: false,
      status: 502,
      message: lastErrorDetail
        ? `تولید صوت با خطا مواجه شد (${lastErrorDetail})`
        : 'تولید صوت با خطا مواجه شد.',
    };
  }

  return { ok: true, wav };
}
