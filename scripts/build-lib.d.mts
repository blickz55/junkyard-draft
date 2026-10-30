export function buildDist(opts: {
  root: string;
  dist: string;
  verifierUrl?: string;
  reports?: boolean;
}): Promise<{ size: number; commit: string; version: string; bundle: string; precache: string[] }>;
export function listFiles(dir: string, base?: string): string[];
export function renderServiceWorker(template: string, opts: { version: string; precache: string[] }): string;
