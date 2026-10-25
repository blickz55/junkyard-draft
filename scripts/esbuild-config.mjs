import path from 'node:path';

export function buildOptions({ root, outdir, dev, commit = 'dev', version = '0.0.0', verifierUrl = process.env.VERIFIER_URL || 'http://127.0.0.1:4400' }) {
  return {
    entryPoints: [path.join(root, 'game', 'src', 'main.ts')],
    bundle: true,
    format: 'esm',
    target: ['es2022', 'chrome110', 'firefox110', 'safari16'],
    outdir,
    entryNames: 'main',
    sourcemap: dev ? 'inline' : false,
    logLevel: 'info',
    define: {
      'import.meta.env.DEV': JSON.stringify(!!dev),
      'import.meta.env.BUILD': JSON.stringify(`${version}+${commit}`),
      // default verifier the title/results screens talk to; `?verifier=` in the URL still overrides at runtime
      'import.meta.env.VERIFIER_URL': JSON.stringify(verifierUrl),
    },
    loader: { '.png': 'file', '.wav': 'file' },
  };
}
