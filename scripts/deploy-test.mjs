#!/usr/bin/env node
// Puts the tester build online: `npm run deploy:test`. Builds dist-test/, then deploys it from a scratch folder outside this repository
// with wrangler 3, because wrangler 4 turns Pages commands into a Workers deployment and rewrites the repository to do it. The project
// and database names live in .test-link.json, which is not in Git: this repository is public and the link is meant to stay unlisted.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTest } from './build-test.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { project, database, databaseId } = JSON.parse(fs.readFileSync(path.join(ROOT, '.test-link.json'), 'utf8'));
const dist = path.join(ROOT, 'dist-test');
const { commit } = await buildTest({ root: ROOT, dist });
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-test-link-'));
fs.cpSync(dist, path.join(cwd, 'dist-test'), { recursive: true });
fs.writeFileSync(
  path.join(cwd, 'wrangler.toml'),
  `name = "${project}"\npages_build_output_dir = "./dist-test"\ncompatibility_date = "2026-10-01"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${database}"\ndatabase_id = "${databaseId}"\n`,
);
execSync(`npx --yes wrangler@3 pages deploy dist-test --project-name ${project} --branch main --commit-dirty=true`, { cwd, stdio: 'inherit' });
fs.rmSync(cwd, { recursive: true, force: true });
console.log(`deployed commit ${commit} to https://${project}.pages.dev/`);
