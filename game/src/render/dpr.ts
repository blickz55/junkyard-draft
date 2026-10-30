/**
 * Device-pixel-ratio rendering (DOSSIER-v1 0.3.10). The canvas backing store is DPR times the container's CSS size and
 * each scene's camera zooms by DPR (times the board fit in the game scene; render/viewport.ts, render/layout.ts), so art
 * and text are crisp on HiDPI screens. Capped at MAX_DPR because fill cost grows with DPR²; `renderQuality: 'low'` (set by
 * the adaptive probe in GameScene or by the title-screen button) forces 1. `?dpr=` overrides for tests. Pointer handlers
 * must read world coordinates (pointer.worldX/Y).
 */
import { loadSettings } from './storage';

export const MAX_DPR = 2;

function computeDpr(): number {
  try {
    const q = new URLSearchParams(location.search).get('dpr');
    if (q != null && Number.isFinite(Number(q)) && Number(q) >= 1) return Math.min(MAX_DPR, Number(q));
    if (loadSettings().renderQuality === 'low') return 1;
    return Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
  } catch {
    return 1;
  }
}

/** Effective device pixel ratio for this page load (fixed at boot; a change needs a reload). */
export const DPR = computeDpr();
