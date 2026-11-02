# The goals

Written 2026-11-01, when the owner handed the work over: keep improving the game without being watched, test with agents, find what is most fun, and set goals very, very hard to meet. These are built to be failed for a long time. A goal is met only when the number is read from a tool's output, on yards the tuning never saw. Where a number comes from agents, it says agents: an agent is not a person, and nothing here may be quoted as what customers think.

**The one that matters:** a stranger plays one game, wants a second, and comes back tomorrow unasked. Everything below is a proxy for that, because no person has played yet.

## The goals

| # | Goal | The bar | Measured by |
|---|---|---|---|
| 1 | The card is high | Fun scorecard 90 of 100 or more on held-out yards, and no dimension under 70 | `tools/fun-card.ts` |
| 2 | The card cannot be fooled | Six deliberately ruined versions of the game each score at least 15 points lower | `tools/fun-card.ts --validate` |
| 3 | No dead shift | An expert's flat shifts at 2 % or less (it was 24 % at v3, in a greedy study). Money rises in 95 % of steps from one shift to the next, and the last shift is the best shift in 90 % of games | the card |
| 4 | Every pick is a real choice | In 60 % of picks the best two cards are within 5 % of each other and the worst is at least 10 % behind. No card is taken more than 60 % or less than 10 % of the times it is offered | the card |
| 5 | Skill shows | Four tiers of bot in strict order on 95 % of yards, the top tier earning 4× the bottom, and 8× the thinking still adding 5 % | the card |
| 6 | The problem keeps moving | Four or more different things limit the line over a game, for a good player | the card |
| 7 | More than one way to win | Three or more different sets of parts within 5 % of the best on 80 % of yards, and no set best on more than 15 % of yards | the card |
| 8 | The stars are a ladder | First star: 90 % of novices. Second: 70 % of competent players. Third: 40–70 % of experts. A third of games end within 10 % of the next star, so "one more try" is real | the card |
| 9 | Strangers get it | 24 agents, each a different kind of person, in a real browser at phone size, cold, with only the words testers get: 95 % say the goal correctly, 90 % finish a game with no help, and none is stuck with no idea what to do | agent panel |
| 10 | Strangers want more | From that panel, told to stop whenever they would stop: 75 % choose to play again, median fun 4.5 of 5 under a persona told to be hard to please, and 75 % pick the new build over the old one in a blind comparison | agent panel |
| 11 | Nothing breaks | 1,000 sessions of random tapping with no page error, a million random actions through the rules with no crash, every game re-simulated to the same score | `tools/monkey.ts` |
| 12 | Instant | First visit 250 KiB gzip or less (294.7 today), tappable in 2 s on slow 4G (2.5 today), first money on screen within 60 s of landing, and no gate in `perf.yml` loosened to get there | existing gates |

## How the work runs

1. Measure first. No change is called better until the card or a panel says so, and the number is read from the output.
2. One yard set tunes the game and a different one judges it, so the card cannot be gamed by fitting.
3. Rules may change: no public board exists, so nothing is lost. A change bumps `RULES_VERSION`, regenerates the golden corpus and records its evidence in `docs/DESIGN.md`.
4. `main` stays green and the owner's game keeps working. The private test link is redeployed only from a green commit.
5. Results go in `docs/STATUS.md` as they land, so nobody has to watch.

## What stays with the owner

Spending money, anything public or sent to real people, legal choices and anything destructive. Real testers are the owner's call: the link and the instructions are ready. Goals 9 and 10 stand in until then, and they do not replace it.
