# Junkyard Draft — design (rules v2)

## Pitch
Draft salvaged machines, arrange them in a small workshop, run a short production simulation, and ship scrap as valuable products. Six rounds, one cumulative score, instant retry. A full run takes about 5–8 minutes.

## Loop
1. **Draft** — three seeded offers; pick one (round 1 always includes a Crusher so the first upgrade is reachable in the first minute).
2. **Build** — drag parts from the bin onto an 8×6 grid; R / right-click rotates; drop onto the bin to remove. Everything can be rearranged every round. Keyboard-only: arrow keys move a cursor (first press reveals it on the selected machine), Enter places the next bin part or picks up / drops a machine, Tab cycles bin parts into the hand, R rotates, Delete returns to the bin, Esc drops / deselects / hides the cursor.
3. **Run** — 80 fixed ticks. Items move one cell per tick; processing machines hold items for a fixed number of ticks.
4. **Result** — money earned, what shipped, and diagnostics (blocked hopper, jammed machines, items stuck in transit).
5. Repeat for 6 rounds → final score = sum of round earnings → retry same seed / random / daily.

## Starter workshop
Hopper → Conveyor ×3 → Dock in row 3. Ships raw scrap for $1 each (38 per round).

## Machines
| Machine | Input | Output | Behaviour |
|---|---|---|---|
| Scrap Hopper | none | forward | Emits one scrap every 2 ticks into the cell ahead if it accepts. Blocked ticks are reported. |
| Conveyor | behind or either side | forward | Moves an item one cell per tick. Never accepts head-on. |
| Splitter | behind only | alternates left / right | Falls back to the other side if one is blocked. |
| Crusher | behind only | forward | Scrap → Shards. Holds 2 ticks. Other materials pass through unchanged. |
| Furnace | behind only | forward | Shards → Ingot. Raw scrap → Slag. Holds 3 ticks. Ingots pass through. |
| Plate Press | behind only | forward | Stores shards; the 2nd shard becomes one Plate ($8) and holds 2 ticks. The stored shard is absorbed (no refund at round end). Other materials pass through (2 ticks). |
| Shipping Dock | any side | — | Consumes items instantly and pays their value. |

Orientation is the core puzzle: processors and splitters only take items from behind. Conveyors side-load so lines can merge.

## Materials
Scrap $1 · Shards $3 · Plate $8 · Ingot $12 · Slag $1 (the "wrong order" product — visible, cheaper than selling raw scrap).

The press is the "take it now" option: two $3 shards become an $8 plate (+33%), it accepts a shard every tick and halves the traffic behind it, but $4 per shard is a third of the furnace's $12. A furnace beats it on a single fed line; a press wins when furnaces are scarce or a shared belt to the dock is the bottleneck.

An unwanted drafted part can be **sold from the bin for $10** (action `sell`, replay-verified). Placed machines cannot be sold, so the bonus never competes with building.

## Throughput facts (why layouts matter)
- One hopper supplies 40 items per round. A crusher (2 ticks) keeps up; a furnace (3 ticks) handles ~26 → the hopper backs up.
- A splitter feeding two furnaces lifts a single-hopper line from ~25 to ~37 ingots. A second hopper then becomes the next bottleneck fix.
- Chains move as a unit each tick (head first), so a free dock never starves a full line.

## Draft offer weights
Conveyor 30 · Crusher 18 · Furnace 15 · Splitter 15 · Hopper 10 · Press 10 · Dock 8 (distinct kinds per offer, seeded by `seed:draft:round`).

## Determinism & replays
- `seed` → draft offers; the sim has no randomness. Same seed + same actions ⇒ same score.
- Replay file v1: `{format, rulesVersion, seed, actions[], claimedScore, createdAt, build}`. `verifyReplay` re-simulates and only accepts a finished run whose score matches; any illegal action rejects the file.
- `RULES_VERSION` guards every tuning value in `game/src/sim/rules.ts`.

## Presentation
Warm industrial palette (charcoal floor, amber accents, rust/steel/green machines), procedural vector textures generated at boot, synthesized WebAudio sounds (place, rotate, ship chimes scaled by value, jam thud, round fanfare). Jams tint cells red live; `+$n` floats at docks; transforms flash in the product colour.

## Competitive foundation
Identical seeds give identical offers; nothing in progression changes scoring. Local bests are labelled local/unverified. A server verifier will re-run `verifyReplay` on submitted replays before any leaderboard shows a score.

## Decisions log
- 2026-10-25 Grid 8×6, 80-tick rounds, 6 rounds: fits a laptop at 1120×700 and keeps a run under 10 minutes.
- 2026-10-25 Furnace melts raw scrap into slag instead of refusing it: flow stays visible and the lesson is cheap.
- 2026-10-25 Sell-from-bin ($10) added after the autoplayer showed ~1/3 of drafts cannot improve a line; slag lowered to $1 so raw scrap in a furnace costs something.
- 2026-10-25 Round summary moved onto the grid: per-machine badges (out/blocked, made/waited, $/shipped) replace an opaque overlay.
- 2026-10-25 Press balance pass (`tools/balance.ts`, 40 seeds × 120 tries, identical offers, press drafted vs refused): v2 press is taken in 19 of 56 rounds it is offered (34%), never lowers a seed's score (0 worse / 7 better, +44 mean when taken, +247 best) and lifts the mean by 19. A 1-tick hold is statistically identical (+1 mean), so not worth a version bump. Plate $9 / $10 raise the pick rate to 41% but turn the press into a trap for a greedy drafter (3 seeds regress, worst −394): the machine must stay clearly below the furnace per shard. Decision: keep v2 unchanged; a shard left in a press at round end is shown on its badge.
- 2026-10-25 Rules v2: Plate Press added (2 shards → 1 plate $8, 2 ticks) as the first machine with a real draft decision against the furnace; conveyor weight 34 → 30 to make room. Keyboard-only placement added for accessibility; it reuses the same rule-checked actions as the mouse.
- 2026-10-25 Chain movement resolved by repeated passes (bounded by item count) rather than two-phase planning: simpler, deterministic; the earlier fixed 8-pass cap falsely stalled long chains and was removed.
