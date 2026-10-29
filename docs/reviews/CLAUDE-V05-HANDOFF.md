# Claude handoff: stabilize Junkyard Draft, then plan v0.5

Review baseline: `bc191b7`, 0.4.0 / rules 2. Read [the detailed independent review](<C:/dev/junkyard draft/docs/reviews/PRE-V05-REVIEW-2026-10-29.md>) before implementing. It contains verified file/line references, reproduction evidence, priorities, and acceptance criteria.

The baseline passes typecheck, all 81 tests including browsers and packaged desktop, the production build, and the verifier bundle. These checks miss real defects. Keep the pure deterministic sim, server re-simulation, RoundController, atomic persistence, and existing build path.

**First, implement stabilization in small PRs with focused regressions:**

1. Make telemetry validation total and guard the complete async handler: missing event `name` can terminate the verifier (F01).
2. Fix hook redaction: complete matched tokens are retained before `[redacted]` (F02). Use synthetic-token tests.
3. Canonicalize action property order before replay hashing: identical replays currently bypass duplicates (F03).
4. Replace `window.prompt` with shared DOM dialogs: Electron player naming, custom seeds, import, and first submission fail (F04).
5. Scope gameplay keyboard capture to grid focus and suspend it behind dialogs. Native button Enter/Tab and Tips are currently broken (F05).
6. Preserve cached bot pars in accepted-submission board updates (F08).
7. Give replay advancement one owner and invalidate stale callbacks: Space during a watched summary can lose a round (F09).
8. Remove verification claims from local clips, and bind results rank/histogram to the exact current replay rather than the stored seed-best hash (F10–F11).
9. Prevent in-flight telemetry completion from restoring events after opt-out (F12).
10. Fix inherited-property seed dictionaries and DPR-aware shipping scale (F14–F15). Decide whether to redefine/defer the legally unreachable Full Grid badge (F16).

**Before hosting:** include all verifier imports in Docker's COPY/ignore layout (F06); cap bot-par work admission, queue/failure maps, and persisted pars (F07). Add image startup/submission/restart smoke coverage. Add correctness CI; the only workflow currently measures performance, has no committed CI baseline, and can pass missing or unmatched reports. Do not claim a Docker image was tested until it actually was.

**Before the first v3 rules change:**

- Partition local bests/submissions by rules version and test migration from a real v2 profile. Preserve unrelated preferences/progress.
- Resolve the tutorial namespace compatibility exception (F13): `tutorial-*` changed under rules 2, so the claim that all v0.2 replays still verify is false. Add release-tag golden replays and explicitly version future scenario behavior.
- Generalize the Press-specific balance tool to accept the candidate machine and reroll policy; persist paired seed results, metadata, and replay-verified actions; make acceptance gates executable.
- Write PLAN-v2 with What / Why / Accept, dependency order, exact rule changes, migration, deployment/rollback policy, and evidence requirements. Update STATUS's next task and CONTINUE pointer deliberately.
- Reconcile the instruction to bump on every rules change with PLAN-v1's instruction to bump only after balance. Use an isolated versioned rules experiment and do not publish changed behavior under an existing public rules identity.

**Re-cut gameplay work in this order:**

1. Prove a same-inventory mixed-material fixture where Sieve routing creates a useful tradeoff against separated routes. The current greedy search misses neutral setup moves; pick-rate targets alone are insufficient evidence.
2. Implement Sieve + tiered offers with all materials/orientations, blocked-exit waits, conservation, advice/art/tip coverage, and deterministic replay support.
3. Implement one paid reroll per round as pure replay-authoritative state. Specify cost boundaries, tutorial behavior, same-offer policy, undo/save behavior, purpose-specific RNG, and production + sales − reroll-cost accounting.
4. Derive final-round machine count server-side and share one tie comparator across board, histogram, retention, and own-rank views.
5. Run paired sweeps and fresh-player tests, then make the release decision. Put new evidence under a v0.5/rules-3 baseline directory.

For every PR: state the concrete failure/behavior, run the relevant regressions plus required full checks, exercise affected user flows, inspect screenshots when appearance changes, keep Control Room instrumentation accurate, and record actual evidence. Avoid an architecture rewrite or extra social features while these prerequisites remain open.
