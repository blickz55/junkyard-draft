# Junkyard Draft

A deterministic draft-and-build factory game you can finish over a coffee. Six rounds: draft a
salvaged machine, place it on an 8×6 yard, run the line for 80 ticks, ship what comes out, keep
the money. The same seed is the same game for everyone, so a score is a claim anyone can check:
the verifier re-simulates your replay before it goes on a board.

- **Play:** https://junkyarddraft.com (the hosted build; the daily opens at 00:00 UTC, the
  weekly on Fridays at 18:00 UTC). A Windows desktop edition is attached to each release.
- **Daily and weekly challenges** with verified boards, medals by percentile, an archive of
  every closed day, groups by code, challenge links and forks.
- **No accounts.** Your device makes a key; the verifier knows only its hash. The in-game
  *Privacy & data* panel downloads or deletes everything stored about you.

## For players

The rules the game follows and the limits the verifier applies are generated from the code
into the in-game **Fairness policy** ([docs/POLICY.md](docs/POLICY.md)). The
[privacy notice](game/public/legal/privacy.html), [terms of play](game/public/legal/terms.html)
and [community guidelines](game/public/legal/guidelines.html) are served next to the game at
`/legal/` and shown inside it under *Privacy & data*. Moderation appeals:
moderation@junkyarddraft.com. Anything else: contact@junkyarddraft.com.

A verified score means the replay was re-simulated with the stated rules version and reached
the same result inside the event's window. It does not certify that a human played unassisted;
the game is deterministic and its source is open. The guidelines ask you not to automate the
ranked boards, and the terms let the operator remove entries that break them.

## For contributors

The repository holds the game (`game/`, TypeScript + Phaser 3.90, bundled by esbuild), the
pure simulation it shares with the verifier (`game/src/sim/`, browser-free and deterministic),
the replay verifier (`server/`, Node 24, a JSON board with hot/cold storage, Docker image),
the desktop shell (`desktop/`, Electron), the deployment files (`deploy/`) and the tools and
tests that gate every change.

```bash
npm install
npx playwright install chromium   # the browser tests
npm run dev:all                   # game on http://127.0.0.1:5173, Control Room on :4310
npm run verifier                  # a local verifier on http://127.0.0.1:4400
npm test                          # simulation, verifier, browser e2e, deploy rehearsal
```

Read [CLAUDE.md](CLAUDE.md) for the commands and the rules of the road, [docs/STATUS.md](docs/STATUS.md)
for what works and what is next, [docs/PRODUCTION-ROADMAP.md](docs/PRODUCTION-ROADMAP.md) for the
plan to 1.0 and [docs/DESIGN.md](docs/DESIGN.md) for the game's rules. Two rules matter more than
the rest: the simulation never depends on rendering, and any change to a rule or tuning value
bumps `RULES_VERSION` and regenerates the golden replays. Bug reports and pull requests are
welcome through GitHub issues; a found verifier exploit goes to contact@junkyarddraft.com first
(the guidelines give credit in the changelog).

## Licence

Source-available: read, run and modify it for yourself, contribute back; no public instances,
no redistribution, no commercial use, and the name, art and sounds are reserved. The full text
is [LICENSE](LICENSE). Phaser and the other dependencies keep their own licences.
