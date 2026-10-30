/**
 * The installable web app (production roadmap 0.10.3): the service worker's registration and update flow, and the install
 * offer. A new worker is never applied mid-run: the title screen asks `updateReady` when it mounts and subscribes for the
 * rest of its life; `applyUpdate()` tells the waiting worker to take over and reloads once it has. The install offer waits
 * for the second completed run, is never shown inside an installed app, and stays quiet for two weeks after "Not now";
 * where the browser offers no prompt (iOS Safari) the offer is a line of guidance. `shouldOfferInstall` is pure (tested).
 */
import { countRuns, readJson, writeJson } from './storage';

export const INSTALL_KEY = 'jd.install.v1';
export const INSTALL_SNOOZE_DAYS = 14;
export const INSTALL_AFTER_RUNS = 2;

export interface InstallState {
  dismissedAt?: string;
  installed?: boolean;
}
export type InstallOffer = 'prompt' | 'ios' | null;

/** The install decision from its inputs. */
export function shouldOfferInstall(i: {
  runs: number;
  standalone: boolean;
  installed: boolean;
  dismissedAt: string | null;
  hasPrompt: boolean;
  ios: boolean;
  now: Date;
}): InstallOffer {
  if (i.standalone || i.installed) return null;
  if (i.runs < INSTALL_AFTER_RUNS) return null;
  if (i.dismissedAt) {
    const t = Date.parse(i.dismissedAt);
    if (Number.isFinite(t) && i.now.getTime() - t < INSTALL_SNOOZE_DAYS * 86_400_000) return null;
  }
  if (i.hasPrompt) return 'prompt';
  if (i.ios) return 'ios';
  return null;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

class Pwa {
  private reg: ServiceWorkerRegistration | null = null;
  private waiting: ServiceWorker | null = null;
  private reloadWanted = false;
  private readonly updateFns = new Set<() => void>();
  private deferred: BeforeInstallPromptEvent | null = null;
  private readonly installFns = new Set<() => void>();

  /** Register ./sw.js in production (the dev server serves none; `?sw=1` forces it there) and watch for a waiting worker. */
  register(dev: boolean, search = location.search): void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return; // the desktop shell
    if (dev && !new URLSearchParams(search).has('sw')) return;
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        this.reg = reg;
        const consider = (w: ServiceWorker | null) => {
          if (w && w.state === 'installed' && navigator.serviceWorker.controller) {
            this.waiting = w;
            for (const fn of this.updateFns) fn();
          }
        };
        consider(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => consider(w));
        });
      })
      .catch(() => {
        /* no worker: the page works without one */
      });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (this.reloadWanted) location.reload(); // only when the title asked: the first install's claim must not reload a page mid-boot
    });
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      for (const fn of this.installFns) fn();
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      writeJson<InstallState>(INSTALL_KEY, { ...this.installState(), installed: true });
    });
  }
  /** A new version is installed and waiting (the title shows it; the game scene never does). */
  get updateReady(): boolean {
    return this.waiting != null;
  }
  onUpdateReady(fn: () => void): () => void {
    this.updateFns.add(fn);
    return () => {
      this.updateFns.delete(fn);
    };
  }
  /** Let the waiting worker take over and reload with it. */
  applyUpdate(): void {
    if (!this.waiting) return;
    this.reloadWanted = true;
    this.waiting.postMessage('skip-waiting');
  }
  /** Ask the browser for new worker (the e2e and a long-lived tab use it; browsers check on their own on navigation). */
  checkForUpdate(): Promise<void> {
    return this.reg?.update().then(() => undefined) ?? Promise.resolve();
  }

  installState(): InstallState {
    const v = readJson<InstallState>(INSTALL_KEY);
    return v && typeof v === 'object' ? v : {};
  }
  get standalone(): boolean {
    return (
      (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  }
  get ios(): boolean {
    const ua = navigator.userAgent;
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }
  /** What the title may offer now. */
  installOffer(now = new Date()): InstallOffer {
    const s = this.installState();
    return shouldOfferInstall({
      runs: countRuns(),
      standalone: this.standalone,
      installed: !!s.installed,
      dismissedAt: s.dismissedAt ?? null,
      hasPrompt: this.deferred != null,
      ios: this.ios,
      now,
    });
  }
  onInstallPrompt(fn: () => void): () => void {
    this.installFns.add(fn);
    return () => {
      this.installFns.delete(fn);
    };
  }
  /** Show the browser's install prompt; true when the player accepted. */
  async promptInstall(): Promise<boolean> {
    const e = this.deferred;
    if (!e) return false;
    this.deferred = null;
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'accepted') writeJson<InstallState>(INSTALL_KEY, { ...this.installState(), installed: true });
      return outcome === 'accepted';
    } catch {
      return false;
    }
  }
  /** "Not now": quiet for INSTALL_SNOOZE_DAYS. */
  snoozeInstall(now = new Date()): void {
    writeJson<InstallState>(INSTALL_KEY, { ...this.installState(), dismissedAt: now.toISOString() });
  }
}
export const pwa = new Pwa();
