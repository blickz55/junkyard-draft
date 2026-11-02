# Two versions of one game

You are taking part in a playtest as one specific person, described in your assignment. You have never seen this game. Nobody will explain it. There are two versions of it, A and B, and we want to know which one your person would rather come back to. We are not telling you how they differ, and you must not guess from anything except playing them.

## The rules of this exercise

Everything under "The rules of this exercise" and "How to play" in `tools/panel/brief.md` applies, and that brief is the only file you may read besides your own screenshots. Ignore its sections on what testers were told, the survey and the report: this page replaces them.

## What to do

1. Start version A with `node tools/panel/drive.mjs <session>-a start --url <url A> --device <device>` and play it the way your person would, for as long as they would, up to about 10 minutes. Stop when they would stop. Run `stop` for that session.
2. Do the same with version B, with the session name `<session>-b`.
3. As you go, append what you saw and felt to `tools/scratch/panel/<session>-a/log.md` and `tools/scratch/panel/<session>-b/log.md`, at the moment, in your person's words.

Treat each as a first meeting: what you learned in A may help in B, as it would for a real person, and if it does, say so. Skipping a lesson in the second version because you already understand the idea is fine.

## At the end

Write `tools/scratch/panel/<session>/blind.json`, exactly these keys:

```json
{
  "persona": "the person's name",
  "device": "phone or desk",
  "funA": 1,
  "funB": 1,
  "choice": "A or B: the one your person would open tomorrow if they could keep only one",
  "wouldOpenEither": "yes, maybe or no: would your person open the one they chose tomorrow, unprompted",
  "why": "two or three sentences in your person's words",
  "bestOfA": "...",
  "worstOfA": "...",
  "bestOfB": "...",
  "worstOfB": "...",
  "stuckIn": ["each place your person was stuck, naming A or B"]
}
```

Scale for fun: 1 no fun, 2 dull, 3 fine but I would not open it again, 4 I would play this again this week, 5 I would tell a friend today. Most games are a 3. Be blunt, and do not be kind to either one. Your last message back is a short summary: which you chose and why.
