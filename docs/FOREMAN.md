# The foreman — character sheet (production roadmap 0.9.1, text only)

The foreman is the one voice in Junkyard Draft. He speaks on the home screen, at the end of a shift and on the results screen, and the instruction card in a game wears his name; later (0.11.5) he opens and closes every daily thread, and with the art commission (0.12.2) he gets a face. Until then he is a name and a line in a box. The voice is reviewed by the owner ⚑; the lines live in `game/src/content/strings.ts` under `foreman.*` and are picked in `game/src/content/foreman.ts`.

## Name

**Sal.** Salvatore Brannock to the payroll, Sal to everyone in the yard. One syllable, easy to type in a thread, not a brand. The box shows `SAL` as a small tag before the line.

## Who he is

The man who has run this yard for thirty years and has seen every line a new hand can lay down. He wants your shift to pay. He is dry, warm underneath, and short of breath for long sentences. He notices things ("the furnace is the slow one") and says them once. He is pleased when a line flows and says so plainly. He does not flatter and he does not scold.

## How he talks

- Short sentences. One idea each. A line is one or two sentences, never a paragraph.
- Plain words, the glossary's words: yard, shift, second, checked, the shelf, crews, a try. He never says the technical word for anything.
- He speaks to "you", about "the yard", "the line", "the dock". He names machines by their plain names.
- Numbers only when they carry the point ("better than most of the yard today" rather than a percentage; the percentage is on the card already).
- He is the same man for everyone: on a given day every player hears the same line in the same spot. Variants exist so that the days differ, not the players.

## What he never says

- Never a banned word (seed, tick, verifier, verified, replay, hash, histogram, percentile, reroll, bin, token, protocol…). The string lint holds him to it.
- Never "wrong", "fail", "bad", "stupid", "noob", "loser", or any word that grades the player instead of the line.
- Never fake urgency ("hurry", "last chance", "don't miss") and never a dark pattern (no guilt about a missed day; a broken streak gets no comment at all).
- Never a claim the game cannot back: he says "checked" only after the server checked, "best on this device" for a local best, and nothing about other players when the board is unreachable.
- Never gaming vocabulary (meta, buff, nerf, grind, RNG, OP, GG), never emoji, never exclamation marks in a row.
- Never about money outside the game, never about the player's life, never anything that would read differently to a child.

## Where he speaks (situations)

| situation | when | teaching? |
|---|---|---|
| welcome | the title screen | no |
| dailyOpen / dailyFinal | the title strip says which (today's board open, or final) | no |
| roundGood / roundFlat | the round-end banner: the round earned more than the one before, or not | no |
| results.* | the results screen by band: top (better than 80 %), upper (50 %), lower, few (under five checked games), offline, first game | no |
| streak3 / streak7 / streak30 | the title, on the day a streak reaches 3, 7, 30 | no |
| firstShare / firstCrew | once, after the first share copy and the first crew joined or created | no |

Since rules v4 the instructions in a game are the coach's (`render/guide.ts`, one instruction at a time, docs/UX-STANDARD.md), so everything here is flavour: **Sal: Quiet** in Settings silences all of it.

## Variants and choice

Three to five lines per situation. The line a player sees is chosen from the UTC date (the day's yard), so everyone sees the same one on the same day and the next day brings another. `tests/foreman.test.ts` pins the choice per (situation, date) in a snapshot so a change of wording is a deliberate one.
