// ESLint flat config (production roadmap 0.9.5): ESLint's recommended rules, typescript-eslint's recommended set, no unused
// variables (an underscore prefix marks the deliberate ones), lines under 160 characters (strings, template literals, URLs and
// comments excepted: the player-facing copy and the roadmap references are long on purpose), and eslint-config-prettier so no
// formatting rule argues with Prettier. Generated output, the vendored Phaser and the scratch folders are ignored.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.dev-build/**',
      'release/**',
      'server/dist/**',
      'vendor/**',
      'tools/scratch*/**',
      'tools/scratch/**',
      '.control-room/**',
      'docs/**',
      'game/public/**',
      'tests/golden/**',
      'tests/fixtures/**',
      'research_notes/**',
      'reports/**',
      '_delivery/**',
      'phaserjs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.es2024 } },
    rules: {
      'max-len': [
        'error',
        { code: 160, tabWidth: 2, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true, ignoreComments: true },
      ],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }], // `catch {}` around storage and clipboard calls is the house pattern: the fallback is the next line
      'no-constant-condition': ['error', { checkLoops: 'allExceptWhileTrue' }],
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }, // scratch and tooling scripts may use require
  },
  {
    files: ['game/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } }, // the service worker (0.10.3)
  },
);
