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

  /**
   * Deep, heavy, bassy cinematic Trump Cut ("بریدن") table-shatter impact:
   * - Massive sub-bass seismic boom (120Hz -> 26Hz)
   * - Heavy low wooden table crack & splintering crunch
   * - Zero high cheesy brass/bell synths
   */
  public playTrumpCut(): void {
    if (!this.enabled || !this.hasUserGesture) return;

    // Layer 1: Low-pitched double card slam onto heavy wood
    const key1 = PLAY_KEYS[this.playCursor % PLAY_KEYS.length];
    const key2 = PLAY_KEYS[(this.playCursor + 1) % PLAY_KEYS.length];
    this.playCursor += 2;
    this.trigger(key1, 0.95, 0.01, 0.62, 0);
    this.trigger(key2, 0.85, 0.01, 0.5, 0.032);

    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      // Warm soft-clipping saturator for visceral sub punch
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i * 2) / 256 - 1;
        curve[i] = Math.tanh(x * 3.2);
      }
      const shaper = ctx.createWaveShaper();
      shaper.curve = curve;
      shaper.oversample = '2x';
      const masterPunch = ctx.createGain();
      masterPunch.gain.value = 0.78;
      shaper.connect(masterPunch);
      masterPunch.connect(ctx.destination);

      // Layer 2: Deep chest-thumping sub-bass drop (118Hz -> 24Hz)
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(118, now);
      subOsc.frequency.exponentialRampToValueAtTime(44, now + 0.09);
      subOsc.frequency.exponentialRampToValueAtTime(24, now + 0.58);
      subGain.gain.setValueAtTime(0.001, now);
      subGain.gain.linearRampToValueAtTime(0.76, now + 0.008);
      subGain.gain.exponentialRampToValueAtTime(0.24, now + 0.24);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.66);
      subOsc.connect(subGain);
      subGain.connect(shaper);
      subOsc.start(now);
      subOsc.stop(now + 0.68);

      // Layer 3: Hollow mahogany table body thud (155Hz -> 42Hz)
      const bodyOsc = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      bodyOsc.type = 'triangle';
      bodyOsc.frequency.setValueAtTime(155, now);
      bodyOsc.frequency.exponentialRampToValueAtTime(42, now + 0.22);
      bodyGain.gain.setValueAtTime(0.001, now);
      bodyGain.gain.linearRampToValueAtTime(0.54, now + 0.007);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      bodyOsc.connect(bodyGain);
      bodyGain.connect(shaper);
      bodyOsc.start(now);
      bodyOsc.stop(now + 0.3);

      // Layer 4: Wood/table cracking & splintering burst (crackle bursts filtered low-mid)
      const crackLen = Math.floor(ctx.sampleRate * 0.44);
      const crackBuf = ctx.createBuffer(1, crackLen, ctx.sampleRate);
      const data = crackBuf.getChannelData(0);
      for (let i = 0; i < crackLen; i++) {
        const t = i / ctx.sampleRate;
        const mainEnv = Math.pow(1 - i / crackLen, 1.85);
        // Simulate 3 rapid wood-fracture snaps at 0ms, 45ms, 105ms
        const snap1 = t < 0.03 ? 1.5 : 1;
        const snap2 = t > 0.042 && t < 0.078 ? 1.45 : 1;
        const snap3 = t > 0.098 && t < 0.145 ? 1.25 : 1;
        data[i] = (Math.random() * 2 - 1) * mainEnv * snap1 * snap2 * snap3;
      }
      const crackSrc = ctx.createBufferSource();
      crackSrc.buffer = crackBuf;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.Q.value = 1.8;
      lowpass.frequency.setValueAtTime(1450, now);
      lowpass.frequency.exponentialRampToValueAtTime(220, now + 0.4);

      const crackGain = ctx.createGain();
      crackGain.gain.setValueAtTime(0.001, now);
      crackGain.gain.linearRampToValueAtTime(0.52, now + 0.008);
      crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

      crackSrc.connect(lowpass);
      lowpass.connect(crackGain);
      crackGain.connect(shaper);
      crackSrc.start(now);
      crackSrc.stop(now + 0.44);

      // Layer 5: Dark low rumble tail (55Hz + 82.4Hz deep bass fifth)
      const rumbleFilter = ctx.createBiquadFilter();
      rumbleFilter.type = 'lowpass';
      rumbleFilter.frequency.setValueAtTime(260, now + 0.015);
      rumbleFilter.frequency.exponentialRampToValueAtTime(95, now + 0.65);
      rumbleFilter.connect(ctx.destination);

      [55.0, 82.41].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + 0.015);
        osc.frequency.linearRampToValueAtTime(freq * 0.94, now + 0.64);
        g.gain.setValueAtTime(0.0001, now + 0.015);
        g.gain.linearRampToValueAtTime(idx === 0 ? 0.19 : 0.12, now + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.66);
        osc.connect(g);
        g.connect(rumbleFilter);
        osc.start(now + 0.015);
        osc.stop(now + 0.68);
      });
    } catch {
      // Ignore Web Audio synthesis fallback edge cases
    }
  }

  /**
   * Bright ascending crystal chime when the flying glowing light orb merges into the scoreboard pip.
   */
  public playScoreOrbLand(isMyTeam = true): void {
    if (!this.enabled || !this.hasUserGesture) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const notes = isMyTeam ? [659.25, 880, 1318.51] : [392, 329.63];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        const t0 = now + i * 0.048;
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(isMyTeam ? 0.14 : 0.075, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.32);
      });
    } catch {
      // Ignore Web Audio error
    }
  }

  /**
   * Realistic staggered card toss/slide flurry when all 4 players throw remaining cards onto the felt.
   */
  public playCardScatter(): void {
    if (!this.enabled || !this.hasUserGesture) return;
    const offsets = [0, 0.065, 0.135, 0.21, 0.295, 0.38, 0.47];
    offsets.forEach((delay, idx) => {
      const key = DEAL_KEYS[(this.dealCursor + idx) % DEAL_KEYS.length];
      this.trigger(key, 0.44 + (idx % 2) * 0.12, 0.06, 0.92 + idx * 0.025, delay);
    });
    this.dealCursor += offsets.length;
  }

  private ttsBufferCache = new Map<string, AudioBuffer>();
  private ttsLoading = new Map<string, Promise<AudioBuffer | null>>();
  private activeVoiceSource: AudioBufferSourceNode | null = null;

  private async fetchTtsBuffer(calloutId: string): Promise<AudioBuffer | null> {
    const cached = this.ttsBufferCache.get(calloutId);
    if (cached) return cached;

    const inflight = this.ttsLoading.get(calloutId);
    if (inflight) return inflight;

    const ctx = this.ensureContext();
    if (!ctx) return null;

    const promise = fetch(`/api/tts/callout/${encodeURIComponent(calloutId)}`, {
      method: 'GET',
      credentials: 'same-origin',
    })
      .then((res) => (res.ok ? res.arrayBuffer() : null))
      .then((arr) => (arr && arr.byteLength > 64 ? ctx.decodeAudioData(arr.slice(0)) : null))
      .then((decoded) => {
        if (decoded) {
          this.ttsBufferCache.set(calloutId, decoded);
        }
        this.ttsLoading.delete(calloutId);
        return decoded;
      })
      .catch(() => {
        this.ttsLoading.delete(calloutId);
        return null;
      });

    this.ttsLoading.set(calloutId, promise);
    return promise;
  }

  /**
   * Expressive deep masculine Persian voice callout via server-side Gemini 3.8 TTS.
   * ZERO synthetic click/fanfare SFX — plays ONLY the natural spoken voice clip!
   */
  public playVoiceCallout(calloutId: string, spokenText: string): void {
    if (!this.enabled || !this.hasUserGesture) return;

    const playSpokenFallback = () => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      try {
        const synth = window.speechSynthesis;
        synth.cancel();
        const utter = new SpeechSynthesisUtterance(spokenText);
        const voices = synth.getVoices();
        const faVoice =
          voices.find((v) => v.lang.toLowerCase().startsWith('fa')) ??
          voices.find((v) => v.lang.toLowerCase().startsWith('ar'));
        if (faVoice) {
          utter.voice = faVoice;
          utter.lang = faVoice.lang;
        } else {
          utter.lang = 'fa-IR';
        }
        utter.rate = 0.96;
        utter.pitch = 0.72; // Deep masculine register fallback
        utter.volume = 0.95;
        synth.speak(utter);
      } catch {
        // Ignore SpeechSynthesis errors in restricted WebViews
      }
    };

    const ctx = this.ensureContext();
    if (!ctx) {
      playSpokenFallback();
      return;
    }

    const playDecodedVoice = (buffer: AudioBuffer) => {
      try {
        if (this.activeVoiceSource) {
          try {
            this.activeVoiceSource.stop();
          } catch {
            // Already stopped
          }
          this.activeVoiceSource = null;
        }
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        gain.gain.value = 0.92;
        source.connect(gain);
        gain.connect(ctx.destination);
        this.activeVoiceSource = source;
        source.onended = () => {
          if (this.activeVoiceSource === source) {
            this.activeVoiceSource = null;
          }
        };
        source.start(0);
      } catch {
        playSpokenFallback();
      }
    };

    const cached = this.ttsBufferCache.get(calloutId);
    if (cached) {
      playDecodedVoice(cached);
      return;
    }

    void this.fetchTtsBuffer(calloutId).then((decoded) => {
      if (!this.enabled) return;
      if (decoded) {
        playDecodedVoice(decoded);
      } else {
        playSpokenFallback();
      }
    });
  }

  public playGameStart(): void {
    this.trigger('trump', 0.56, 0, 1.08, 0);
  }

  /**
   * Unmistakably cheerful, bright, uplifting ascending major chord when OUR team wins a trick,
   * vs a soft, subtle low muted tone when opponents take a trick.
   */
  public playTrickWin(isMyTeam: boolean): void {
    if (!this.enabled || !this.hasUserGesture) return;
    const ctx = this.ensureContext();
    if (!ctx) {
      this.trigger(isMyTeam ? 'trump' : 'trickLoss', isMyTeam ? 0.55 : 0.36, 0);
      return;
    }
    try {
      const now = ctx.currentTime;
      if (isMyTeam) {
        // Bright, triumphant ascending C-major sparkle arpeggio (C5 -> E5 -> G5 -> C6)
        const chord = [523.25, 659.25, 783.99, 1046.5];
        chord.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const overtone = ctx.createOscillator();
          const gain = ctx.createGain();
          const t0 = now + i * 0.052;
          osc.type = 'triangle';
          overtone.type = 'sine';
          osc.frequency.setValueAtTime(freq, t0);
          overtone.frequency.setValueAtTime(freq * 2, t0);
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.linearRampToValueAtTime(i === chord.length - 1 ? 0.14 : 0.11, t0 + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (i === chord.length - 1 ? 0.42 : 0.28));

          const ovGain = ctx.createGain();
          ovGain.gain.value = 0.28;
          osc.connect(gain);
          overtone.connect(ovGain);
          ovGain.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          overtone.start(t0);
          osc.stop(t0 + 0.46);
          overtone.stop(t0 + 0.46);
        });
      } else {
        // Soft, brief subdued low two-note descent for opponent trick win
        const notes = [329.63, 277.18];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const t0 = now + i * 0.075;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t0);
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.linearRampToValueAtTime(0.075, t0 + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + 0.26);
        });
      }
    } catch {
      this.trigger(isMyTeam ? 'trump' : 'trickLoss', 0.5, 0);
    }
  }

  /**
   * Joyful celebratory fanfare when our team wins a hand (with extra sparkle on Kot),
   * or a somber muted cadence if the opponent team takes the hand.
   */
  public playHandFinish(isMyTeamWin: boolean, isSpecialKot = false): void {
    if (!this.enabled || !this.hasUserGesture) return;
    const ctx = this.ensureContext();
    if (!ctx) {
      this.trigger(isMyTeamWin ? 'handWin' : 'trickLoss', isSpecialKot ? 0.85 : 0.65, 0);
      return;
    }
    try {
      const now = ctx.currentTime;
      if (isMyTeamWin) {
        const notes = isSpecialKot
          ? [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98]
          : [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const t0 = now + i * 0.068;
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, t0);
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.linearRampToValueAtTime(0.15, t0 + 0.016);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (i === notes.length - 1 ? 0.62 : 0.34));
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + 0.65);
        });
      } else {
        const notes = [392.0, 349.23, 293.66];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const t0 = now + i * 0.095;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t0);
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.linearRampToValueAtTime(0.095, t0 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + 0.38);
        });
      }
    } catch {
      this.trigger(isMyTeamWin ? 'handWin' : 'trickLoss', 0.65, 0);
    }
  }

  public playMatchVictory(): void {
    this.playHandFinish(true, true);
    this.trigger('handWin', 0.62, 0, 1.06, 0.22);
  }

  public playMatchDefeat(): void {
    this.trigger('trickLoss', 0.62, 0, 0.88, 0);
  }
}

export const hokmSound = new HokmSoundEngine();
