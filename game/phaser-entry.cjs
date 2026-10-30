// The custom Phaser entry (production roadmap 0.10.2). The npm package's `dist/phaser.esm.js` is one 1.2 MB file that no
// bundler can trim, so the game is built from `phaser/src` with only the modules it uses: the WebGL and Canvas renderers,
// the 2D camera, images, graphics, text, containers, groups and the two shapes, the keyboard, mouse and touch input, the
// SVG, binary and image loaders, tweens, the clock, textures and the scale manager. No physics, tilemaps, sound (the game
// has its own WebAudio bus in game/src/render/audio.ts), particles, sprites, animations beyond what the core needs, or
// cameras in 3D. scripts/esbuild-config.mjs aliases `phaser` to this file for the dev server, the production build and the
// hardening test alike, and rewrites Phaser's `typeof FLAG` build switches the way its own webpack build does; TypeScript
// keeps reading the package's types. Adding a Phaser feature means adding its module here: a factory registers itself with
// the GameObjectFactory when required, a loader file type with the LoaderPlugin, a scene plugin with the PluginCache.
require('../node_modules/phaser/src/polyfills/requestVideoFrame');
const CONST = require('../node_modules/phaser/src/const');
const Extend = require('../node_modules/phaser/src/utils/object/Extend');

// game object factories and creators (this.add.*, this.make.*)
require('../node_modules/phaser/src/gameobjects/image/ImageFactory');
require('../node_modules/phaser/src/gameobjects/graphics/GraphicsFactory');
require('../node_modules/phaser/src/gameobjects/graphics/GraphicsCreator');
require('../node_modules/phaser/src/gameobjects/text/TextFactory');
require('../node_modules/phaser/src/gameobjects/container/ContainerFactory');
require('../node_modules/phaser/src/gameobjects/group/GroupFactory');
require('../node_modules/phaser/src/gameobjects/shape/rectangle/RectangleFactory');
require('../node_modules/phaser/src/gameobjects/shape/arc/ArcFactory');
// loader file types (this.load.*)
require('../node_modules/phaser/src/loader/filetypes/SVGFile');
require('../node_modules/phaser/src/loader/filetypes/BinaryFile');
require('../node_modules/phaser/src/loader/filetypes/ImageFile');
// the scene plugins every scene gets (plugins/DefaultPlugins.js names them; each registers in the PluginCache when required)
require('../node_modules/phaser/src/time/Clock');
require('../node_modules/phaser/src/tweens/TweenManager');
require('../node_modules/phaser/src/input/InputPlugin');
require('../node_modules/phaser/src/loader/LoaderPlugin');
require('../node_modules/phaser/src/data/DataManagerPlugin');
require('../node_modules/phaser/src/gameobjects/lights/LightsPlugin');

let Phaser = {
  Cameras: { Scene2D: require('../node_modules/phaser/src/cameras/2d') },
  Core: require('../node_modules/phaser/src/core'),
  Class: require('../node_modules/phaser/src/utils/Class'),
  Display: { Color: require('../node_modules/phaser/src/display/color') },
  DOM: require('../node_modules/phaser/src/dom'),
  Events: require('../node_modules/phaser/src/events'),
  Game: require('../node_modules/phaser/src/core/Game'),
  GameObjects: {
    Events: require('../node_modules/phaser/src/gameobjects/events'),
    DisplayList: require('../node_modules/phaser/src/gameobjects/DisplayList'),
    GameObjectCreator: require('../node_modules/phaser/src/gameobjects/GameObjectCreator'),
    GameObjectFactory: require('../node_modules/phaser/src/gameobjects/GameObjectFactory'),
    UpdateList: require('../node_modules/phaser/src/gameobjects/UpdateList'),
    Components: require('../node_modules/phaser/src/gameobjects/components'),
    GameObject: require('../node_modules/phaser/src/gameobjects/GameObject'),
    Graphics: require('../node_modules/phaser/src/gameobjects/graphics/Graphics'),
    Group: require('../node_modules/phaser/src/gameobjects/group/Group'),
    Image: require('../node_modules/phaser/src/gameobjects/image/Image'),
    Text: require('../node_modules/phaser/src/gameobjects/text/Text'),
    TextStyle: require('../node_modules/phaser/src/gameobjects/text/TextStyle'),
    Container: require('../node_modules/phaser/src/gameobjects/container/Container'),
    Rectangle: require('../node_modules/phaser/src/gameobjects/shape/rectangle/Rectangle'),
    Arc: require('../node_modules/phaser/src/gameobjects/shape/arc/Arc'),
  },
  Input: {
    Events: require('../node_modules/phaser/src/input/events'),
    InputManager: require('../node_modules/phaser/src/input/InputManager'),
    InputPlugin: require('../node_modules/phaser/src/input/InputPlugin'),
    Pointer: require('../node_modules/phaser/src/input/Pointer'),
    Keyboard: require('../node_modules/phaser/src/input/keyboard'),
    Mouse: require('../node_modules/phaser/src/input/mouse'),
    Touch: require('../node_modules/phaser/src/input/touch'),
  },
  Loader: {
    Events: require('../node_modules/phaser/src/loader/events'),
    File: require('../node_modules/phaser/src/loader/File'),
    LoaderPlugin: require('../node_modules/phaser/src/loader/LoaderPlugin'),
  },
  Math: {
    Clamp: require('../node_modules/phaser/src/math/Clamp'),
    Easing: require('../node_modules/phaser/src/math/easing'),
    Between: require('../node_modules/phaser/src/math/Between'),
    DegToRad: require('../node_modules/phaser/src/math/DegToRad'),
  },
  Plugins: require('../node_modules/phaser/src/plugins'),
  Renderer: require('../node_modules/phaser/src/renderer'),
  Scale: require('../node_modules/phaser/src/scale'),
  Scene: require('../node_modules/phaser/src/scene/Scene'),
  Scenes: require('../node_modules/phaser/src/scene'),
  Structs: { Size: require('../node_modules/phaser/src/structs/Size'), List: require('../node_modules/phaser/src/structs/List') },
  Textures: require('../node_modules/phaser/src/textures'),
  Time: require('../node_modules/phaser/src/time'),
  Tweens: require('../node_modules/phaser/src/tweens'),
};
Phaser = Extend(false, Phaser, CONST); // VERSION, AUTO, CANVAS, WEBGL, the blend and scale mode constants
module.exports = Phaser;
