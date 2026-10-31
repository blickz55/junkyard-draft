# The art of Junkyard Draft

Everything the game shows on its canvas comes from one sprite sheet that is drawn in code, so the art can be changed by a programmer today and replaced by an artist later, one frame at a time, without touching the game.

## What ships

| File                           | What it is                                                                                                           | Budget       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------ |
| `game/public/art/sheet.webp`   | every frame, 2 sheet pixels per logical pixel                                                                        | about 200 KB |
| `game/src/render/sheet.ts`     | where each frame sits (generated, do not edit)                                                                       |              |
| `game/public/art/hero.webp`    | the title's dusk scrapyard, 1200 × 420; its left third is dark for text                                              | 60 KB        |
| `game/public/art/yard-bg.webp` | the page around the board, 1280 × 800, dark                                                                          | 30 KB        |
| `game/public/fonts/`           | Inter (variable, Latin), Barlow Condensed 700 (Latin), two small subsets for the pseudo-locale, and the OFL licences |              |

The sources are `tools/make-art.mjs` and `tools/make-art/`: `lib.mjs` (the kit), `belts.mjs`, `ports.mjs`, `machines.mjs`, `machines2.mjs`, `items.mjs`, `junk.mjs`, `ground.mjs`, `overlays.mjs`, `scenes.mjs`. Each frame is also exported as a plain SVG to `tools/make-art/svg/`, which opens in Inkscape or Illustrator. (`tools/export-svg.ts` wrote the first SVG set from the procedural drawings; it has no part in this pipeline.)

## Rebuilding

```
node tools/make-art.mjs                 # everything: sheet, manifest, SVG exports, item colours, hero, background
node tools/make-art.mjs --only sheet    # or --only scenes
node tools/make-art-fonts.mjs           # only to change a font version or face
```

The tool renders each SVG in Playwright's Chromium at 4 to 6 times its size, scales it down with a light unsharp mask, packs the frames on fixed positions with their edges extruded into a 4 px gutter (a scaled sprite never samples a neighbour), and encodes the sheet at `--quality 0.74`. The same input gives the same output. Nothing it uses ships in the bundle.

After a change: `node --import tsx --test tests/a11y.test.ts`, then look at the game (`?scene=game&seed=classic-demo` has the old fixed yard, any other seed a generated one with rubble, `tutorial-1` is the lesson).

## Replacing a frame

Put a file named after the frame in `tools/make-art/override/`, as `<key>.png` at the frame's size or `<key>.svg`, and run the tool. It takes that file instead of the drawing; everything else stays. To replace the whole style, do this for every key, or change the kit.

An artist's frame has to keep these rules, because the game depends on them:

- **Top down, facing east.** A machine turns by sprite angle (`dir × 90`), so its base frame faces east: input on the west edge, output on the east edge. A splitter takes from the west and outputs north and south.
- **Overhead light with no direction.** Ambient occlusion and a soft contact shadow all round, a rim that is the same on all four sides, no offset drop shadow. A directional shadow would flip when the machine turns. The ground never turns, so its relief may lean.
- **144 × 144 for a cell, 48 × 48 for an item, transparent around.** A shadow must fade before the frame's edge; only belts and ports reach the edge.
- **Belts line up.** The belt is the band y 42 to 102, between rails at y 30 to 42 and y 102 to 114, and it runs edge to edge. Machine ports sit on the same band, so a line reads as one piece. `belt-N` overlays hold only the band; they are drawn over `m-conveyor` and must cover it.
- **Belt frames loop.** The chevrons repeat every 72 px and step 9 px per frame, so frame 8 would equal frame 0. A corner uses the same phase along its arc, so a straight and a corner stay in step.
- **The corner.** `m-conveyor-bend` faces east like everything else: it enters at the south edge and leaves east (a right turn), turning about the cell's south-east corner. `SimView` flips it vertically for a left turn. `beltShape()` in `render/placement.ts` decides which.
- **Say which way it faces.** Blue chevron on the input, amber arrow on the output (`ports.mjs`). The dock takes from any side and shows inward chevrons; the hopper has only an output; the tuner has neither.
- **Shape first, colour second.** Each machine and item keeps its own outline at 40 px. `tests/a11y.test.ts` measures the item sprites and holds them apart under protanopia, deuteranopia and tritanopia; `node --import tsx tools/a11y-audit.ts --sheet` renders the evidence to `docs/a11y/materials-cvd.png`.

## The frames

| Keys                                                           | Size       | Notes                                                                                               |
| -------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `ground`                                                       | 1152 × 864 | the yard, one picture, slabs with faded corner marks                                                |
| `shelf`                                                        | 1152 × 200 | steel rack; the seven bays follow `binSlotXY` in `render/layout.ts`, the label sits on the top beam |
| `tile`                                                         | 144        | one slab, for the small yards the clip and the tips demo draw                                       |
| `tile-ok`, `tile-bad`, `tile-sel`, `tile-cursor`               | 144        | overlays; each means its thing by shape as well as colour                                           |
| `m-conveyor`, `m-conveyor-bend`, `belt-0..7`, `belt-bend-0..7` | 144        | the conveyor                                                                                        |
| `m-hopper`, `m-dock`, `m-tuner`                                | 144        |                                                                                                     |
| `m-crusher`, `m-crusher-1`                                     | 144        | jaws open, jaws shut (odd ticks while it holds an item)                                             |
| `m-furnace`, `m-furnace-1`                                     | 144        | banked, working                                                                                     |
| `m-press`, `m-press-1`, `m-press-2`                            | 144        | the ram coming down                                                                                 |
| `m-splitter`, `m-splitter-1`                                   | 144        | next item goes north, next item goes south                                                          |
| `rubble-0..3`                                                  | 144        | junk piles; `SimView.drawYard` picks one and a quarter turn from the cell index                     |
| `i-scrap`, `i-shards`, `i-plate`, `i-ingot`, `i-slag`          | 48         | the materials                                                                                       |
| `fx-glow`                                                      | 144        | a white soft light the game tints for a transform                                                   |

State frames are chosen by `machineFrame` in `render/simframes.ts`. A new frame is a row in `tools/make-art.mjs`, a procedural stand-in in `render/textures.ts`, and a key in the art test in `tests/render-e2e.test.mjs`.

## At runtime

`render/atlas.ts` loads the sheet once, behind Home (Home is DOM and needs none of it; the way into a game waits, `ui/opening.ts`), uses it as the atlas at 2 sheet pixels per logical pixel on a DPR 2 screen under WebGL, makes a canvas of it elsewhere (scaled on a lower ratio so frames blit 1:1; the Canvas renderer draws from a canvas much faster than from a decoded image), and registers every key as an alias into that one texture. If the sheet does not load, `render/textures.ts` draws every key procedurally: the game degrades to the old look, it never blanks.

## Fonts and licences

Inter and Barlow Condensed are under the SIL Open Font License 1.1; the licences travel with the files as `OFL-Inter.txt` and `OFL-BarlowCondensed.txt`. Neither font declares a Reserved Font Name, so the subsets may keep their names. `@font-face` rules are inline in `game/index.html` with `font-display: swap`, and the pseudo-locale's subsets load only for that locale's characters. Bundling them is what makes the layout the same on Windows and on the Ubuntu CI runner.
