/**
 * Studio-mastered real acoustic playing-card foley & AAA interface audio engine.
 * - Uses genuine studio-recorded CC0 playing-card foley (Kenney Casino Audio)
 *   and refined interface chimes (Kenney Interface & Music Jingles), mastered
 *   with tight zero-latency silence trim & balanced loudness into /sfx/*.mp3.
 * - Multi-variation round-robin playback for dealing (4 real card slides) and
 *   card placement (3 real card snaps) eliminates mechanical repetition.
 * - Eagerly fetches raw MP3 ArrayBuffers in the background and decodes into
 *   Web Audio API AudioBuffers on first user gesture (zero autoplay warnings).
 */

type SfxKey =
  | 'shuffle'
  | 'deal1'
  | 'deal2'
  | 'deal3'
  | 'deal4'
  | 'select'
  | 'play1'
  | 'play2'
  | 'play3'
  | 'gather'
  | 'trump'
  | 'trickWin'
  | 'trickLoss'
  | 'handWin'
  | 'uiTap'
  | 'uiOpen'
  | 'uiWarning';

const SFX_URLS: Record<SfxKey, string> = {
  shuffle: '/sfx/card-shuffle.mp3',
  deal1: '/sfx/card-deal-1.mp3',
  deal2: '/sfx/card-deal-2.mp3',
  deal3: '/sfx/card-deal-3.mp3',
  deal4: '/sfx/card-deal-4.mp3',
  select: '/sfx/card-select.mp3',
  play1: '/sfx/card-play-1.mp3',
  play2: '/sfx/card-play-2.mp3',
  play3: '/sfx/card-play-3.mp3',
  gather: '/sfx/trick-gather.mp3',
  trump: '/sfx/trump-chosen.mp3',
  trickWin: '/sfx/trick-win.mp3',
  trickLoss: '/sfx/trick-loss.mp3',
  handWin: '/sfx/hand-win.mp3',
  uiTap: '/sfx/ui-tap.mp3',
  uiOpen: '/sfx/ui-open.mp3',
  uiWarning: '/sfx/ui-warning.mp3',
};

const DEAL_KEYS: readonly SfxKey[] = ['deal1', 'deal2', 'deal3', 'deal4'];
const PLAY_KEYS: readonly SfxKey[] = ['play1', 'play2', 'play3'];
const MASTER_SFX_GAIN = 0.22; // Balanced, non-fatiguing loudness aligned with soft ambient BGM

class HokmSoundEngine {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private hasUserGesture = false;
  private rawCache = new Map<SfxKey, ArrayBuffer>();
  private rawLoading = new Map<SfxKey, Promise<ArrayBuffer | null>>();
  private buffers = new Map<SfxKey, AudioBuffer>();
  private decoding = new Map<SfxKey, Promise<AudioBuffer | null>>();
  private dealCursor = 0;
  private playCursor = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.hasUserGesture = true;
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('touchstart', unlock);
        const ctx = this.ensureContext();
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      };
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
      window.addEventListener('touchstart', unlock, { passive: true });
    }
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Lightly prefetch only UI tap/open sounds on the home screen (3 tiny files).
   */
  public prefetchUiOnly(): void {
    if (typeof window === 'undefined') return;
    (['uiTap', 'uiOpen', 'uiWarning'] as SfxKey[]).forEach((key) => {
      void this.fetchRaw(key);
    });
  }

  /**
   * Prefetch game SFX bytes when entering the Hokm table.
   */
  public prefetchRaw(): void {
    if (typeof window === 'undefined') return;
    (Object.keys(SFX_URLS) as SfxKey[]).forEach((key) => {
      void this.fetchRaw(key);
    });
  }

  private async fetchRaw(key: SfxKey): Promise<ArrayBuffer | null> {
    const existing = this.rawCache.get(key);
    if (existing) return existing;

    const inflight = this.rawLoading.get(key);
    if (inflight) return inflight;

    const promise = fetch(SFX_URLS[key])
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((arr) => {
        if (arr) this.rawCache.set(key, arr);
        this.rawLoading.delete(key);
        return arr;
      })
      .catch(() => {
        this.rawLoading.delete(key);
        return null;
      });

    this.rawLoading.set(key, promise);
    return promise;
  }

  private ensureContext(): AudioContext | null {
    if (!this.hasUserGesture || typeof window === 'undefined') {
      return null;
    }
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public preloadAll(): void {
    (Object.keys(SFX_URLS) as SfxKey[]).forEach((key) => {
      void this.loadBuffer(key);
    });
  }

  private async loadBuffer(key: SfxKey): Promise<AudioBuffer | null> {
    const existing = this.buffers.get(key);
    if (existing) return existing;

    const inflight = this.decoding.get(key);
    if (inflight) return inflight;

    const ctx = this.ensureContext();
    if (!ctx) return null;

    const promise = this.fetchRaw(key)
      .then((raw) => (raw ? ctx.decodeAudioData(raw.slice(0)) : null))
      .then((decoded) => {
        if (decoded) {
          this.buffers.set(key, decoded);
        }
        this.decoding.delete(key);
        return decoded;
      })
      .catch(() => {
        this.decoding.delete(key);
        return null;
      });

    this.decoding.set(key, promise);
    return promise;
  }

  private trigger(
    key: SfxKey,
    volume = 0.72,
    pitchJitter = 0,
    baseRate = 1,
    delaySec = 0
  ): void {
    if (!this.enabled || !this.hasUserGesture) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const playDecoded = (buffer: AudioBuffer) => {
      try {
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        const jitter =
          pitchJitter > 0 ? (Math.random() * 2 - 1) * pitchJitter : 0;
        source.playbackRate.value = Math.max(0.5, baseRate + jitter);
        gain.gain.value = Math.max(0, Math.min(1, volume * MASTER_SFX_GAIN));
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(delaySec > 0 ? ctx.currentTime + delaySec : 0);
      } catch {
        // Ignore playback edge cases
      }
    };

    const cached = this.buffers.get(key);
    if (cached) {
      playDecoded(cached);
    } else {
      void this.loadBuffer(key).then((decoded) => {
        if (decoded && this.enabled) {
          playDecoded(decoded);
        }
      });
    }
  }

  public playUiTap(): void {
    this.trigger('uiTap', 0.44, 0.025);
  }

  public playUiOpen(): void {
    this.trigger('uiOpen', 0.46, 0.02);
  }

  public playWarning(): void {
    this.trigger('uiWarning', 0.56, 0);
  }

  public playShuffle(): void {
    this.trigger('shuffle', 0.82, 0.015);
  }

  public playDealTick(): void {
    const key = DEAL_KEYS[this.dealCursor % DEAL_KEYS.length];
    this.dealCursor += 1;
    this.trigger(key, 0.68, 0.04);
  }

  public playCardSelect(): void {
    this.trigger('select', 0.54, 0.03);
  }

  public playCardSnap(): void {
    const key = PLAY_KEYS[this.playCursor % PLAY_KEYS.length];
    this.playCursor += 1;
    this.trigger(key, 0.88, 0.03);
  }

  public playTrickGather(): void {
    this.trigger('gather', 0.76, 0.02);
  }

  public playTrumpChosen(): void {
    this.trigger('trump', 0.76, 0);
  }

  public playGameStart(): void {
    this.trigger('trickWin', 0.68, 0, 1.08, 0);
    this.trigger('trump', 0.52, 0, 1.15, 0.14);
  }

  public playTrickWin(isMyTeam: boolean): void {
    this.trigger(isMyTeam ? 'trickWin' : 'trickLoss', isMyTeam ? 0.68 : 0.5, 0);
  }

  public playHandFinish(isSpecialKot: boolean): void {
    this.trigger('handWin', isSpecialKot ? 0.88 : 0.72, 0);
  }

  public playMatchVictory(): void {
    this.trigger('handWin', 0.92, 0, 1.0, 0);
    this.trigger('trump', 0.62, 0, 1.12, 0.28);
    this.trigger('trickWin', 0.66, 0, 1.22, 0.52);
  }

  public playMatchDefeat(): void {
    this.trigger('trickLoss', 0.65, 0, 0.88, 0);
  }
}

export const hokmSound = new HokmSoundEngine();
