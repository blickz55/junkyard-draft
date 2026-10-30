/**
 * Browser entry for the cross-engine determinism check (production roadmap 0.8.11): tests/engines-e2e.test.mjs bundles this
 * file with esbuild, loads it in Chromium, Firefox and WebKit and asks each engine to re-simulate every golden replay and
 * hash the outcome; the hashes must equal the ones Node recorded in tests/golden/INDEX.json. Nothing here touches the DOM.
 */
import { decodeReplay } from '../game/src/sim/replay';
import { digestReplay, sha256Hex } from '../game/src/sim/digest';
import { RULES_VERSION } from '../game/src/sim/types';

declare global {
  interface Window {
    __jdEngine: {
      rulesVersion: number;
      ua: string;
      digest: (replayText: string) => { score: number; state: string; rounds: string[] };
      sha256: (text: string) => string;
    };
  }
}

window.__jdEngine = {
  rulesVersion: RULES_VERSION,
  ua: navigator.userAgent,
  digest: (replayText: string) => digestReplay(decodeReplay(replayText)),
  sha256: sha256Hex,
};
