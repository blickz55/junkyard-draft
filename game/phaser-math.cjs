// What Phaser's core takes from its Math namespace, and nothing more (Goal 12): core/Config.js sets `RND` here from the game's seed and
// utils/object/GetAdvancedValue.js reads it for a randomised config value. The whole namespace (matrices, quaternions, vectors in 3D)
// came in through those two requires alone; scripts/esbuild-config.mjs points them at this file. The game's own Phaser.Math is in
// game/phaser-entry.cjs.
module.exports = { RandomDataGenerator: require('../node_modules/phaser/src/math/random-data-generator/RandomDataGenerator') };
