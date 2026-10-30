import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_VERIFIER_URL = 'http://127.0.0.1:4400';

/**
 * Phaser gates optional code with `typeof FLAG` and its own webpack build replaces the whole expression; esbuild's define
 * cannot, so this plugin does it in the source text (production roadmap 0.10.2). Both renderers stay (the perf gate measures
 * Canvas, phones without WebGL fall back to it); sound (the game has its own WebAudio bus), the 3D camera, the Facebook
 * plugin and the WebGL debug build go.
 */
export const PHASER_FLAGS = {
  WEBGL_RENDERER: 'true',
  CANVAS_RENDERER: 'true',
  FEATURE_SOUND: 'false',
  PLUGIN_CAMERA3D: 'false',
  PLUGIN_FBINSTANT: 'false',
  WEBGL_DEBUG: 'false',
};
export function phaserFlagsPlugin() {
  return {
    name: 'phaser-flags',
    setup(build) {
      build.onLoad({ filter: /[\\/]phaser[\\/]src[\\/].*\.js$/ }, async (args) => {
        let s = await fs.promises.readFile(args.path, 'utf8');
        for (const [k, v] of Object.entries(PHASER_FLAGS)) s = s.replaceAll(`typeof ${k}`, v);
        return { contents: s, loader: 'js' };
      });
    },
  };
}
/** Phaser's version and notice for the bundle's one legal comment (the per-file banners are dropped: the same MIT notice 17 times). */
export function phaserNotice(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'phaser', 'package.json'), 'utf8'));
  return `/*! Phaser v${pkg.version} Copyright 2013-2025 Phaser Studio Inc. MIT License https://github.com/phaserjs/phaser/blob/master/LICENSE.md */`;
}

export function buildOptions({
  root,
  outdir,
  dev,
  commit = 'dev',
  version = '0.0.0',
  verifierUrl = process.env.VERIFIER_URL || DEFAULT_VERIFIER_URL,
  entryNames = 'main',
}) {
  return {
    entryPoints: [path.join(root, 'game', 'src', 'main.ts')],
    bundle: true,
    format: 'esm',
    // 0.10.2: the game is built from phaser/src with only the modules it uses (game/phaser-entry.cjs); the types still come from the package
    alias: { phaser: path.join(root, 'game', 'phaser-entry.cjs') },
    plugins: [phaserFlagsPlugin()],
    legalComments: 'none',
    banner: { js: phaserNotice(root) },
    target: ['es2022', 'chrome110', 'firefox110', 'safari16'],
    outdir,
    entryNames, // dev: main.js (the dev server proxies it); production: main-[hash].js so the hosted bundle can be cached immutably (0.8.5)
    sourcemap: dev ? 'inline' : false,
    logLevel: 'info',
    define: {
      'import.meta.env.DEV': JSON.stringify(!!dev),
      'import.meta.env.BUILD': JSON.stringify(`${version}+${commit}`),
      // default verifier the title/results screens talk to; `?verifier=` overrides it at runtime only in dev builds and on loopback pages (game/src/render/config.ts)
      'import.meta.env.VERIFIER_URL': JSON.stringify(verifierUrl),
    },
    loader: { '.png': 'file', '.wav': 'file' },
  };
}

/**
 * Content-Security-Policy for the page (production roadmap 0.8.0), injected into index.html's `__CSP__` by the dev server
 * and the production build (the Electron shell loads the built page, so it gets the same policy). Scripts only from the
 * page's own origin (no inline, no eval); connections only to the page and the baked verifier (dev: any loopback port and
 * any https host, since `?verifier=` overrides count there); images and media from blobs for the share card and clips.
 * Inline styles stay allowed: the DOM overlay sets `style` attributes and that is a far smaller surface than script.
 */
export function cspFor({ dev, verifierUrl = process.env.VERIFIER_URL || DEFAULT_VERIFIER_URL, header = false }) {
  let origin = verifierUrl;
  try {
    origin = new URL(verifierUrl).origin;
  } catch {
    /* keep as given */
  }
  const connect = dev ? "'self' http://127.0.0.1:* http://localhost:* https:" : `'self' ${origin}`;
  const policy = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src ${connect}; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`;
  // frame-ancestors is ignored in a <meta> policy, so only the HTTP header variant (deploy/_headers, 0.8.5) carries it
  return header ? `${policy}; frame-ancestors 'none'` : policy;
}

/**
 * Render deploy/_headers (the Cloudflare Pages header file, 0.8.5) for a built site: the CSP as a header too and the
 * content-hashed bundle's immutable cache rule. `__CSP__` and `__BUNDLE__` are the placeholders.
 */
export function renderHeaders(template, { verifierUrl = process.env.VERIFIER_URL || DEFAULT_VERIFIER_URL, bundle }) {
  if (!bundle) throw new Error('renderHeaders: bundle file name required');
  return template.replaceAll('__CSP__', cspFor({ dev: false, verifierUrl, header: true })).replaceAll('__BUNDLE__', bundle);
}
