/**
 * Client error log (production roadmap 0.8.0). Production builds ship without source maps and nothing reports errors
 * anywhere, so a player saying "it broke" could not be diagnosed. This keeps the last ten uncaught errors and unhandled
 * rejections on the device, each with the build id, and renders a diagnostics text the player can copy from the title's
 * settings and paste into a bug report. Nothing is sent anywhere; the identity token is never included.
 */
import { loadSettings, storageFailed } from './storage';

const KEY = 'jd.errors.v1';
const MAX = 10;
export interface ErrorEntry {
  at: string;
  build: string;
  kind: 'error' | 'rejection';
  message: string;
  stack?: string;
}

const isEntry = (v: unknown): v is ErrorEntry =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as ErrorEntry).at === 'string' &&
  typeof (v as ErrorEntry).message === 'string' &&
  ((v as ErrorEntry).kind === 'error' || (v as ErrorEntry).kind === 'rejection');
export function loadErrors(): ErrorEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter(isEntry).slice(-MAX) : [];
  } catch {
    return [];
  }
}
export function recordError(kind: ErrorEntry['kind'], message: string, stack?: string): ErrorEntry {
  const entry: ErrorEntry = {
    at: new Date().toISOString(),
    build: import.meta.env.BUILD,
    kind,
    message: String(message).slice(0, 300),
    ...(stack ? { stack: String(stack).slice(0, 600) } : {}),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify([...loadErrors(), entry].slice(-MAX)));
  } catch {
    /* storage unavailable: the entry lives in memory only */
  }
  recent.push(entry);
  if (recent.length > MAX) recent.shift();
  return entry;
}
const recent: ErrorEntry[] = [];
const describe = (reason: unknown): { message: string; stack?: string } =>
  reason instanceof Error
    ? { message: `${reason.name}: ${reason.message}`, stack: reason.stack }
    : {
        message:
          typeof reason === 'string'
            ? reason
            : (() => {
                try {
                  return JSON.stringify(reason);
                } catch {
                  return String(reason);
                }
              })(),
      };

let installed = false;
/** Hook window error events once. */
export function installErrorLog(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    const d = e.error ? describe(e.error) : { message: e.message || 'error' };
    recordError('error', d.message, d.stack ?? (e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const d = describe((e as PromiseRejectionEvent).reason);
    recordError('rejection', d.message, d.stack);
  });
}

/** The diagnostics text for a bug report: build, browser, screen, settings, storage health and the recent errors. No identity, no token. */
export function diagnostics(extra: Record<string, unknown> = {}): string {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const settings = (() => {
    try {
      return loadSettings();
    } catch {
      return null;
    }
  })();
  const stored = loadErrors();
  const errors = stored.length ? stored : recent;
  return JSON.stringify(
    {
      build: import.meta.env.BUILD,
      at: new Date().toISOString(),
      page: typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : undefined,
      userAgent: nav?.userAgent,
      language: nav?.language,
      viewport: typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio } : undefined,
      storage: storageFailed() ? 'failing' : 'ok',
      settings,
      errors,
      ...extra,
    },
    null,
    2,
  );
}
