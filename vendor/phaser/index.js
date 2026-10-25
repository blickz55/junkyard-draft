// Default-export shim so `import Phaser from 'phaser'` works with the vendored ESM build
// exactly as it does with the npm package (whose main entry is CommonJS).
import * as Phaser from './phaser.esm.js';
export default Phaser;
export * from './phaser.esm.js';
