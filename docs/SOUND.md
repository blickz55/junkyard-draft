# The sound of Junkyard Draft

The owner's verdict on the first sound set was "midi files from nintendo". That set was bare square, triangle and sawtooth oscillators, a drone and two tiny WAVs. This is its replacement: a sound library written as code, aimed at the opposite of chiptune. Wood, felt, muted metal, air. Soft attacks, energy low in the spectrum, one shared room, and a line that plays a gentle melody instead of beeping. The test of it is one question: would someone leave the sound on for twenty minutes of play?

**Nobody who built this could hear it.** Every claim below is either a number a test holds it to or a design intention. The last section keeps the two apart.

## Where it lives

| File                                                                    | What it holds                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game/src/sound/dsp.ts`                                                 | Primitives, pure and browser-free: seeded noise, one-pole and biquad filters, a swept filter, envelopes, modal synthesis, a falling thump, Karplus-Strong, saturation, a delay-network reverb, an inverse FFT and spectral loops, the master limit |
| `game/src/sound/recipes.ts`                                             | One short function per sound, from a seed to samples                                                                                                                                                                                               |
| `game/src/sound/catalog.ts`                                             | The list of sounds (id, bus, class, render order), the mix levels, and `Bank`, which renders a slice at a time                                                                                                                                     |
| `game/src/sound/line.ts`                                                | The note choice: scales, the walk, thinning, the step grid, which rendered note a pitch plays through                                                                                                                                              |
| `game/src/sound/measure.ts`, `shift.ts`                                 | Measurements and the offline shift. Tests and tools only; the game never imports them                                                                                                                                                              |
| `game/src/render/audio.ts`                                              | The public `audio` object: the WebAudio graph, voices, the bed, the Sound test                                                                                                                                                                     |
| `game/src/render/mixer.ts`                                              | Voice caps, the tick plan, the bed's targets                                                                                                                                                                                                       |
| `tools/make-sfx.ts`, `tests/sound.test.ts`, `tests/render-e2e.test.mjs` | Export for reference, the numbers, the live checks                                                                                                                                                                                                 |

There are no asset bytes. After the first user gesture the browser runs the recipes in slices of at most about 4 ms, one slice every 16 ms, into `AudioBuffer`s kept for the session. Everything renders at 24 kHz (the beds at 12 kHz, the room at the context's rate), because warm sounds need nothing above 12 kHz and half the rate is half the work. Long recipes are generators that yield between stages. A sound not rendered yet is silent, and a recipe that fails is skipped; nothing throws.

The same recipes run in Node, so what the tests measure is what the browser plays.

## The signal chain

```
voice (buffer > rate > optional low-pass > gain > optional pan)
  > bus (ui, factory, music; the player's levels)
      > master volume > soft limit > hide fader > output
      > send (ui 0.12, factory 0.24, music 0.32) > room > master volume
```

- **The room** is a `ConvolverNode` with a 0.65 s impulse, a short noise burst through a four-line feedback delay network with damped lines (RT60 target 0.6 s), scaled to unit energy so a send level means what it says.
- **The soft limit** is a `WaveShaperNode`: linear up to 0.5, bending toward a ceiling of 0.84 (-1.5 dBFS) that it cannot pass. It is a safety net; in the busy shifts below it is never reached.
- **The context is asked for 48 kHz** whatever the hardware runs at. This machine's output is 96 kHz, which doubled the room's cost before this was pinned.

## The line makes music

Each shipped item is a chance for a note. `LineComposer` decides whether it sounds and which note it is. The choice is pure and seeded per shift; rendering never touches the simulation.

- **Pulse.** The grid is the 1× tick, 170 ms, on the wall clock. At 2× and 4× the ticks only subdivide it, so the melody keeps its pace at every speed and a busy line sounds fuller, not faster. Two notes are at least two steps apart: at most about 2.9 a second. Each note is scheduled on the grid plus 30 ms, so frame jitter does not reach the ear.
- **Thinning.** The ship rate is smoothed over about three seconds. Under 6 a second any step may sound. From there a 16-step euclidean pattern keeps a groove while it thins: seven steps open (gaps 3 2 2 3 2 2 2), six above 16 ships a second (gaps 3 3 2 3 3 2). The most valuable waiting good takes the note.
- **Two players.** Goods under $8 are wood, plates and up are metal bars an octave above, each player with its own stepwise walk, so a mix of goods is two smooth lines rather than one that leaps. The better good of a pair sits one degree higher. Products worth $20 and more, and strong steps with a second good waiting, add a bar a fourth or fifth below.
- **Walk.** Mostly single scale degrees, sometimes two, with a direction that turns now and then; bar starts land on the root or fifth. The same note never comes three times running.
- **Dynamics.** Accents on the bar, a slow swell over two bars, a little unevenness. A harder stroke is also brighter (each voice has its own low-pass).
- **Scales**, one per shift, each over its root and each with a perfect fifth for the pad: C major pentatonic; D 0 2 5 7 9; E minor pentatonic; G major pentatonic; A 0 2 5 7 10; C 0 2 4 7 11. Stings move with the shift's root, at most a tritone, so they stay in key and in register.
- **Machines** obey the same floor: one hit a step, the same machine at most every two pulses, slightly different rate and level each time, and the busier the floor the softer each hit (at most -7 dB).

## The ambient bed

From run start to the settle the music bus carries a pad and a belt. Both are spectral loops: gaussian bands of frequency with random phases, transformed back, which gives a seamless, uncorrelated stereo pair (the PADsynth idea).

- **Pad:** root, fifth, octave and twelfth with soft harmonics, about 5.5 s long, rendered on C3 and played up to each shift's root.
- **Belt:** a low rumble with sixteen slow swells per loop, through a low-pass that opens from 300 Hz to 2 kHz as items fill the line, and a level that follows them.
- **Jam:** the pad drifts 16 cents sharp of the melody, and a muted rattle plays at most once every 0.9 s.
- **The last ten ticks** swell the pad a little. The old octave climb is gone.
- **End:** the bed fades with a 0.16 s time constant under the settle and its loops are stopped; on a scene change it fades in 0.04 s. `info().hum.loops` counts live loops and the e2e waits for zero.

Reduced audio has no bed, at most one sound a tick, never a dyad, and nothing delayed to a later tick.

A hidden tab fades in about 100 ms and suspends the context; coming back resumes it unless the game itself is paused. This answers the owner's "humming or buzzing" from a hidden tab: the old drone kept running while the page's frames had stopped.

## Every sound

Ids are what `audio.previewList()` returns and the Sound test in Settings plays. Loudness is the loudest 50 ms after a 100 Hz high-pass, in dBFS at full volume.

| Id                           | Bus     | Heard when                               | What it is                                                                                                           | Loudness            |
| ---------------------------- | ------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `click`                      | ui      | any button                               | A tiny wooden tick, nearly subliminal                                                                                | -36.9               |
| `place`                      | ui      | a machine lands                          | A low falling thump, wood and steel body modes, a hint of metal, a touch of saturation so it survives small speakers | -16.1               |
| `rotate`                     | ui      | a machine turns                          | Three small pawl clicks and a low wooden stop                                                                        | -28.6               |
| `invalid`                    | ui      | a refused action                         | Two soft low taps, the second lower. Felt, never a buzzer                                                            | -20.6               |
| `pick`                       | ui      | a card taken (`audio.pick`)              | A muted Karplus-Strong pluck with a little paper                                                                     | -24.6               |
| `swap`                       | ui      | two machines trade places (`audio.swap`) | A short slide, then two clacks                                                                                       | -22.8               |
| `lock`                       | ui      | a part kept or a reroll                  | Two quick rising wood notes                                                                                          | -21.1               |
| `wood-low`, `wood-high`      | factory | scrap, shards                            | A soft mallet on rosewood, partials near 1 : 3.93 : 9.2, the tube holding the fundamental                            | -16.4, -15.6        |
| `bar-low`, `bar-high`        | factory | plate, ingot, product                    | Felt on an aluminium bar, 1 : 3.98 : 9.87 with a stray mode, a longer ring                                           | -14.1, -13.8        |
| `crush`                      | factory | shards made                              | Nine irregular bites of noise through two body resonances over a low thump                                           | -26.5               |
| `press`                      | factory | plate made                               | A low thud with a muted metal ring                                                                                   | -22.8               |
| `smelt`                      | factory | ingot made                               | A breath of filtered noise rising, with small flecks of sizzle                                                       | -23.2               |
| `slag`                       | factory | slag made                                | A dull low plop                                                                                                      | -28.5               |
| `jam`                        | factory | a jam, thinned                           | A small part rattling to rest, muted                                                                                 | -28.2               |
| `stall`                      | factory | the stall mark                           | Two soft falling bar notes                                                                                           | -19.8               |
| `run`                        | music   | shift starts                             | A low wood dyad and the line breathing in                                                                            | -23.8               |
| `settle`                     | music   | shift ends                               | The breath falling away over one low note                                                                            | -22.0               |
| `round-good`                 | music   | a good shift, the results                | An ascending wood phrase blooming into a warm bar dyad                                                               | -20.6               |
| `round-flat`                 | music   | a flat shift                             | Two gentle falling notes over a low bar. Neutral, not sad                                                            | -21.1               |
| `star-1`, `star-2`, `star-3` | music   | a star mark (`audio.star`)               | Soft bells, one, two and four notes rising over a warm bar                                                           | -21.4, -21.6, -20.9 |
| `job-done`                   | music   | the job finished (`audio.jobDone`)       | A rolled open chord from low wood through bars to a bell                                                             | -19.6               |
| `pad`, `belt`                | music   | the bed                                  | See above                                                                                                            | -36.8, -38.3        |
| `room`                       | music   | never alone                              | The impulse response. Not in the Sound test                                                                          |                     |

## What was measured, and what needs the owner's ears

**Measured in `tests/sound.test.ts`, for every recipe:** finite samples; peak at most 0.5; DC under 0.1 % of the peak; no first-sample jump; half level no sooner than 0.25 ms (0.7 ms for mallet notes); silence by the last sample, with the last 10 ms more than 50 dB under the peak; loudness inside a band per class; spectral centroid under a ceiling per class; under 0.2 % of the power above 6 kHz for what is heard all the time; not a plain periodic waveform (spectral flatness, inharmonicity and whether the overtones die first, with square, saw and triangle controls that the check does catch). Also: determinism, tuning of the mallets, loop seams, the room's energy and decay, and the bed sitting at least 16 dB under a mallet note.

**Measured on a simulated 60 s busy shift** through the same note choice, gains and room, at full volume with 5 ships a second at 1× (20 at 4×) and every sting stacked on top:

|                         | 1×         | 4×         |
| ----------------------- | ---------- | ---------- |
| Master true peak        | -5.8 dBFS  | -5.5 dBFS  |
| Mean level              | -21.9 dBFS | -21.1 dBFS |
| Note attacks a second   | 2.9        | 2.2        |
| Machine hits a second   | 2.8        | 4.3        |
| Longest run of one note | 2          | 2          |
| Different notes         | 12         | 10         |

At an absurd 2.5× gain the limit still holds under -1 dBFS.

**Measured in Chromium (`tests/render-e2e.test.mjs` and a one-off capture of a real round at default volume):** the catalog renders after the first gesture with no failures and no audio file fetched; a captured round peaked at -13.5 dBFS with a mean of -28.8 dBFS; the bed's loops start and stop; a hidden tab suspends and resumes; every row of the Sound test plays. Rendering the whole catalog cost 50 ms of main thread in total, the worst single unit 2.8 ms; with the CPU throttled 4× it was 209 ms and 15.7 ms, that one being the `ConvolverNode` taking its impulse, which no slicing can split. The longest slice seen in a real game was about 5 ms, and 13.5 ms under the same throttle.

**Weight:** about 5.3 KiB gzip over the code it replaced.

**Not measured, and it cannot be from here:**

- Whether any of it is pleasant. Everything above says a sound is soft, warm and in key; none of it says it is nice.
- Whether the wood reads as wood or as a soft sine, and whether the second partial needs to be stronger.
- The balance on real speakers, phones especially. The thumps sit low and rely on their upper modes there.
- Whether the crusher's bites read as a crunch or as static, and whether the furnace is a breath or a hiss.
- How the machines wear over twenty minutes, and whether the melody starts to feel like wallpaper or like nagging.
- Whether the pad is too quiet to matter or just quiet enough, and whether the jam's detune is felt at all.
- Whether the room is audible as a room, and whether the delay network rings. A measured decay says nothing about metallic colour.
- Firefox and Safari. The live checks ran in Chromium only.

## Adding a recipe

1. Write a short function in `recipes.ts`: `(seed, rate) => Float32Array` or a stereo pair, or a generator that yields between stages if it runs past about a millisecond. Build it from `dsp.ts`, finish it with `done(x, level)`, and use no `Math.random` and no browser object.
2. Add it to `RECIPES`, and add its id to a row in `catalog.ts` under the right bus and class. Row order is render order.
3. Call it from `audio.ts` through `#touch`, `#sting` or `#play`, inside a granted voice.
4. Add its label `sound.<id>` to the string table.
5. Run `node --import tsx --test tests/mixer.test.ts tests/sound.test.ts`, then look at its spectrogram. A new class needs its own band and ceilings in the test.

## Auditioning

- **In the game:** Settings, Sound test, one Play button per id.
- **As files:** `node --import tsx tools/make-sfx.ts [--out dir] [--only id,id] [--no-png] [--no-shift]` writes every sound as a WAV with a spectrogram PNG and prints its measurements. It also writes `shift-1x` and `shift-4x`, a minute of the simulated line through the room. With no `--out` it uses `junkyard-draft-sfx` under the system temp folder. The spectrograms need ffmpeg on PATH. Avoid ffmpeg's `start` and `stop` zoom options: they draw lines that are not in the signal.
