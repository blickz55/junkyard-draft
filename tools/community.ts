/**
 * The community database from the operator's side (production roadmap 0.11.0). The verifier migrates up by itself at start;
 * this reads where a data directory stands and takes it back down, one migration at a time, with the verifier stopped.
 *   node --import tsx tools/community.ts <data-dir> status
 *   node --import tsx tools/community.ts <data-dir> down <version>      keep migrations up to <version>, reverse the rest
 * Exit 0 with a JSON summary, 1 on any failure, 2 on usage.
 */
import path from 'node:path';
import { COMMUNITY_DB, CommunityStore, inspectDatabase } from '../server/community';

const [dataDir, command, arg] = process.argv.slice(2);
const target = Number(arg);
if (!dataDir || (command !== 'status' && !(command === 'down' && Number.isInteger(target) && target >= 0))) {
  console.error('usage: community <data-dir> status | down <version>');
  process.exit(2);
}
try {
  const file = path.join(dataDir, COMMUNITY_DB);
  let reversed: number[] = [];
  if (command === 'down') {
    const store = new CommunityStore(file, { migrate: false });
    reversed = store.rollback(target);
    store.close();
  }
  console.log(JSON.stringify({ file, ...inspectDatabase(file), reversed }, null, 2));
} catch (e) {
  console.error(`FAIL ${(e as Error).message}`);
  process.exitCode = 1;
}
