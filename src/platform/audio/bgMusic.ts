/**
 * Lightweight Looping Background Music Manager for Eyvan.
 * - Streams the compressed ~470KB MP3 lazily after first user interaction (0 bytes on initial load).
 * - Loops seamlessly across the platform at a gentle, unobtrusive default level (80% lower than before).
 * - Halves volume smoothly (50% of default) when entering an active game,
 *   and restores default ambient volume upon returning to the menu/lobby.
 * - Automatically respects the user's sound toggle and pauses when the tab is hidden.
 */

const BGM_SRC = '/assets/audio/eyvan_bgm.mp3';
const BASE_VOLUME = 0.072; // 80% lower than previous 0.36 default
const IN_GAME_VOLUME = BASE_VOLUME * 0.5; // Half of the default level during active gameplay (0.036)

class EyvanBackgroundMusic {
  private audio: HTMLAudioElement | null = null;
  private enabled = true;
  private inGame = false;
  private unlocked = false;
  private initialized = false;
  private rampRaf: number | null = null;

  public init(): void {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    const unlock = () => {
      this.unlocked = true;
      this.removeUnlockListeners(unlock);
      if (this.enabled && !document.hidden) {
        this.ensureAudioAndPlay();
      }
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (!this.audio) return;
      if (document.hidden) {
        this.audio.pause();
      } else if (this.enabled && this.unlocked) {
        void this.audio.play().catch(() => {});
      }
    });
  }

  private removeUnlockListeners(fn: () => void): void {
    window.removeEventListener('pointerdown', fn);
    window.removeEventListener('keydown', fn);
    window.removeEventListener('touchstart', fn);
  }

  private getTargetVolume(): number {
    return this.inGame ? IN_GAME_VOLUME : BASE_VOLUME;
  }

  private ensureAudioAndPlay(): void {
    if (typeof window === 'undefined') return;
    if (!this.audio) {
      const el = new Audio();
      el.preload = 'none';
      el.loop = true;
      el.src = BGM_SRC;
      el.volume = this.getTargetVolume();
      this.audio = el;
    }
    this.rampVolume(this.getTargetVolume(), 450);
    if (this.audio.paused) {
      void this.audio.play().catch(() => {
        // Browser may still block until next gesture
      });
    }
  }

  private rampVolume(target: number, durationMs = 550): void {
    if (!this.audio) return;
    if (this.rampRaf !== null) {
      cancelAnimationFrame(this.rampRaf);
      this.rampRaf = null;
    }

    const startVol = this.audio.volume;
    const clampedTarget = Math.max(0, Math.min(1, target));
    if (Math.abs(startVol - clampedTarget) < 0.005) {
      this.audio.volume = clampedTarget;
      return;
    }

    const startTime = performance.now();
    const step = (now: number) => {
      if (!this.audio) return;
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = t * (2 - t);
      this.audio.volume = Math.max(
        0,
        Math.min(1, startVol + (clampedTarget - startVol) * eased)
      );
      if (t < 1) {
        this.rampRaf = requestAnimationFrame(step);
      } else {
        this.rampRaf = null;
      }
    };

    this.rampRaf = requestAnimationFrame(step);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      if (this.audio) {
        this.audio.pause();
      }
      return;
    }
    if (this.unlocked && typeof document !== 'undefined' && !document.hidden) {
      this.ensureAudioAndPlay();
    }
  }

  public setInGame(inGame: boolean): void {
    if (this.inGame === inGame) return;
    this.inGame = inGame;
    if (this.audio && this.enabled) {
      this.rampVolume(this.getTargetVolume(), 600);
    }
  }

  public getCurrentTargetVolume(): number {
    return this.getTargetVolume();
  }
}

export const eyvanBgMusic = new EyvanBackgroundMusic();
