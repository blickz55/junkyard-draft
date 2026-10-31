# Junkyard Draft: the UX and copy standard

Written after the owner's first real playtest (2026-10-31). The owner played and could not tell what the goal was, lost the advice the moment they acted on it, and found words on screen that belong in a 2003 web form. This document is the bar. Every screen, string and interaction is held to it, and the parts a machine can check are checked in `npm test`.

**The reader:** a working adult with no gaming vocabulary, on a phone, half paying attention, who has never seen this game. If they have to think about the interface, the interface is wrong.

## The five questions

Every screen answers these within three seconds, without scrolling and without reading more than one sentence.

1. **Where am I?** The screen says what it is.
2. **What's the point?** The goal is on screen: the job, the stars, the board.
3. **What do I do right now?** One thing, stated as an instruction, and it is highlighted.
4. **What just happened?** The result of the last action is visible and stays visible until the next one.
5. **How do I get out?** There is always a way out, in plain words, that loses nothing.

## Rules for interaction

1. **One primary action per screen.** It is the biggest, brightest thing. Everything else steps back.
2. **Never make the player remember.** Advice stays on screen until it stops being true. Nothing the game told you disappears because you clicked something.
3. **Show what to touch.** When the game says "put it there", _there_ is lit up. Words alone are not an instruction.
4. **Everything can be asked about.** Any piece on the board, in any phase, tells you what it does when you tap it. No hover-only information anywhere.
5. **The obvious move works.** Dropping a part on the belt puts it in the belt. A part dropped in line faces the way the line runs. The player should not have to clear a space, rotate or read a rule to do the obvious thing.
6. **Mistakes are cheap and explained.** Undo reverses what the player did in one step, however many steps it took inside. A refusal says what to do instead, at the place it happened.
7. **Nothing is lost by leaving.** Leaving saves. The way out never asks the player to understand what will happen to their game.
8. **Choices say what they cost.** "Pick ONE" says the others are gone. "New offers" says the price on the button.
9. **Results explain themselves.** A number is always next to what it means: against the job, against your best, against the board.
10. **Touch first.** Every action works with one thumb. Targets are at least 44 px. Keyboard and mouse are shortcuts, never the only way.

## Rules for words

1. **Say it the way you would say it to a friend standing next to you.** "Start the shift", not "Run simulation". "Back to the menu", not "Title".
2. **Buttons are verbs that say what will happen.** "Play today's yard", "Keep this part", "Skip the lesson". Never "OK", "Submit", "Continue" alone when a real verb exists.
3. **One instruction at a time, twelve words or fewer.** Detail goes behind a tap. Two sentences is the limit for an instruction.
4. **Every word on screen earns its place.** If removing it changes nothing, remove it.
5. **No words from the machine room.** Nothing a developer would say to another developer reaches a player. See the banned list.
6. **One name for one thing, everywhere.** A shift is a shift, never a round. The shelf is the shelf, never a bin. The list lives in `game/src/content/glossary.ts`.
7. **Numbers carry units and meaning.** "$24 each", "34 of 100 ingots", "12 short of the third star".
8. **Tell the player what to do, not what the system did.** "Pick a part first", not "Action not permitted in current phase".
9. **Errors never blame.** They say what is possible now.
10. **Keys are a footnote.** "(Space)" belongs on a tooltip or in Help, not on a button a phone user reads.

## Banned words

Beyond the existing list (seed, tick, verifier, replay, hash, histogram, percentile, reroll, bin, token, draft as a noun, round), these never reach a player:

| Banned                                       | Say instead                                                  |
| -------------------------------------------- | ------------------------------------------------------------ |
| Title, Title screen                          | Menu, Home                                                   |
| Submit                                       | Put my score on the board                                    |
| Import, Export                               | Open, Save                                                   |
| Diagnostics                                  | Copy a problem report                                        |
| Resolution, DPI, pixel ratio                 | Graphics                                                     |
| Audio buses, UI, Factory (as a volume label) | Sounds, Machines, Music                                      |
| Telemetry, Stats (as jargon)                 | Anonymous play data                                          |
| Custom yard                                  | Pick a yard by name                                          |
| Archive                                      | Past days                                                    |
| Mode, Provisional, Ranked                    | Plain sentences: "Today's scores count until tomorrow night" |
| Grid, Cell                                   | The yard, a spot                                             |
| Input, Output                                | Goes in, comes out                                           |

`tests/strings.test.ts` fails on any of them in the string table. The legal pages and the fairness page may use exact terms where the law or precision needs them.

## The loop a player must be able to state

After one lesson a player can say, in their own words:

> "I get a job, like ship 100 ingots. Each shift I keep one part, put it on the belt, and watch it run. Stars for how much I ship. Beat everyone on today's board."

If a playtester cannot say that, the game has failed the standard, however clean the tests are.

## How this is enforced

- **The string lint** (`tests/strings.test.ts`, `tools/strings-lint.ts`) fails on banned words and on prose outside the string table.
- **The walkthrough test** (`tests/walkthrough-e2e.test.mjs`) plays the lesson touching only what the game highlights. If the highlights do not lead to the end, the lesson is broken.
- **The screen audit** (same file) asserts that every game screen shows the job, one primary action and a way out.
- **The viewport matrix** (`tests/layout-e2e.test.mjs`) holds all of it at phone size and at 130 % text.
- **People.** Tests cannot tell whether a game is clear. Before a release, someone who has not seen it plays the lesson with no help. Where they stop is a bug.
