# Junkyard Draft — design (rules v10)

## Pitch

Every yard is a job for the harbor bridge: six orders, each bigger than the last. The line already runs; each shift you keep one card, build its parts in, and watch the money against the order. Every order you fill raises your prices for the rest of the game. Three stars for orders filled, money for the board. A full run takes about 5–8 minutes.

## Decision: orders, kits and a running start (rules v6, the fun card, 2026-11-01)

The owner asked for trial and error against a scorecard. Rules 5 scored 55 of 100 on 40 held-out yards (`docs/baselines/fun/card-rules5.json`), with its lowest dimension at 23: 8.8 % of picks were real choices, 24.5 % of shifts were flat, and a plain recipe with nothing added earned 80 % of the expert's money. The agent panel said the same in words: fun 3 of 5, nobody wanted to play tomorrow, all eight got stuck (`docs/baselines/fun/panel-r1/`). The cause is arithmetic. A line's rate is its slowest stage, and a Hopper, a Crusher and a tuned Furnace tie at one item per 2 seconds, so no single part adds anything: once the recipe ran, shifts 4 to 6 were the same shift three times.

**What changed:**

- **Orders.** A job is now six orders in money (`RULES.job.orders`, one table for ingot jobs and one for plate jobs). Fill a shift's order and every price rises 25 % from the next shift on (`job.raise`, carried on `Layout.rate`); a raise is never taken back and a miss costs only that raise. Two, four and six orders filled are the stars. The money earned is the score, so the job and the board still pull the same way.
- **A running start.** Every generated yard opens with a Crusher and the job's machine on the belt, so the job's goods ship in the first shift. The first decision is how to widen a line, not how to finish a recipe. The lessons still teach the recipe by hand.
- **Kits.** A card can now pay by itself: a Hopper brings its Crusher (a new feed), the job's machine brings a Splitter (a new branch). `cardParts` in `sim/run.ts` is the one place that says so. Lessons and `classic-*` yards deal single parts.
- **The deal.** A job yard deals its own machine, the Hopper, the rival machine, a Dock and from shift 2 a Tuner (`job.deal`, `tunerFrom`), never a lone Crusher or Splitter. Four spare belts on the shelf instead of two.
- **A second buyer.** From shift 4 the other product sells at the job's price too (`secondBuyerFrom`, `Layout.premium2`), so the rival machine is a real late card.
- **Machines take from the sides.** A Crusher, Furnace or Press takes items from behind or either side, never head-on; a Splitter takes from behind and sends ahead, left and right in turn. Newcomers turned parts until something fed them, and that was friction, not a puzzle. The Sieve keeps its behind-only rule, deferred as it is.

**Evidence.** Trials on 24 tune yards from a base of about 50: the second buyer +13, kits +10, a head start 0 to +5 by itself, Tuner changes +2. Orders were priced on paper first (`tools/fun-orders.ts`, replaying the tree of each yard with raises applied), which lifted the paper score from about 30 to about 71; held out from the tuning, the chosen table gave flat shifts 6.7 %, last shift best 95.8 %, real picks 24.3 %, median orders filled novice 2, casual 4, competent 6, expert 6, and all six orders for 62.5 % of competent games and 66.7 % of expert games. A third of expert games miss one, which is where a second try comes from. The whole card on the built game, on the same 40 held-out yards as rules 5: **77 of 100, lowest dimension 50** (rules 5: 55 and 23), flat shifts 4 %, last shift best 87.5 %, real picks 20 %, the ruins −22, −30, −47, −11, −38, −3 (`docs/baselines/fun/card-rules6.json`).

**Paid for.** The rules are harder to state: "fill the order, your prices rise" is a second number beside the money, and the card and every screen had to learn it. `tests/guide.test.ts` and the job bar's order strip carry that. The old star marks in units are gone from job yards (`orders` absent keeps them for the lessons' own marks and the tests that name them).

## Decision: the scrap truck (rules v11, 2026-11-02)

Every returning panel said the second half of a game asks nothing new: "add a hopper, add a furnace" again. Now, as shift 4 starts, a scrap truck drops a Hopper with a Crusher in front of it on two cells the yard chose two or more from the line (`withDelivery`, `truckCells`, `truckLoad` in `sim/yard.ts`, `RULES.yard.truck`). The cells are kept free until then (`Layout.reserved`: a part is refused there, and the estimate, the bots and the card treat them as junk), the job card says so, and the spot is marked on the yard from the first shift. Its shards need somewhere to go: a card's machine in front of the Crusher (`idleMaker` in `render/estimate.ts`, so the lit spots and Sal can do it too), or belts to the line. The orders of shifts 4 to 6 are 15 % higher, because the gift lifts every player.

- **The way there.** A Hopper alone (`TRIAL.delivery`): on the card +1 on tune yards and +1 held out, and blind comparison 4 (`docs/baselines/fun/blind-4/`, four returning agents, each version played first twice) chose it three times in four, "something to look forward to and plan around"; but the gift never paid, facing an empty cell with the coach calling it a dead end. With its Crusher and no change to the orders the stars came too easily (72 against 74); with the late orders 10 % higher 74, 15 % higher 77 on tune yards, 74 against 73 held out.
- **Blind comparison 5** (`docs/baselines/fun/blind-5/`, the same four on the Hopper with its Crusher and the higher orders): three of four chose it, fun 4 against 3 twice and 4 and 4 once ("the truck is the only thing that changed how a shift felt"; "the final order was tight enough that I had to add a Tuner and another furnace"). The fourth chose the plain game after the lit spots put a part on the truck's cells and no truck came; so did one of the three on his first game. Across both comparisons the truck was chosen six times in eight.
- **The cells kept for it.** That bug is why `Layout.reserved` exists. With it, held out: 76 against 73: the problem keeps moving 65 to 79 (limits per game 2.95 to 3.38), real picks 49 to 54 with every card a healthy pick, skill 12 to 18, the ladder at 100 (novices' first star 0.9, competent second 0.875, experts' third 0.6). The full card with the ruins is `docs/baselines/fun/card-rules11.json` (STATUS).
- **Paid for.** A yard's right half or a corner is spoken for until shift 4, and a player who wanted it waits; the job card and the mark say so from the start. The truck's spot is chosen apart from the line, so on a cramped yard it may stand where a player would rather build: the refusal says why.

## Decision: the first game is the player's to work out (2026-11-02, no rules change)

Lit spots came in with rules 7 because the third panel was stuck without them, and they stayed on through a player's first game. The eighth panel, six strangers on their first game (`docs/baselines/fun/panel-r8/`), asked four times in their own words to decide for themselves ("make me decide something every shift instead of tapping where it glows", "stop lighting every square for me"), and every best moment they named was a part they had placed themselves with the forecast agreeing. So the ninth panel was the same six personas on a build where a game's spots are dark until asked for (`docs/baselines/fun/panel-r9/`), lessons lit as before.

- **Against the eighth, persona by persona:** fun 4, 3, 3, 4, 2, 3 became 3, 4, 4, 4, 3, 3 (mean 3.17 to 3.5; three up, one down, two level); a game finished 3 of 6 to 4 of 6; a second game by choice 0 to 1; back tomorrow one yes, four maybe, one no to six maybe. Stuck at least once went from five to all six, and the stuck moments are the list below. Agents are not people: this is a direction, not a result.
- **Where the dark game stuck them, and what changed:** two of the slowest did not know where their first unlit part went, and the button that lights it was cut off on a phone ("Show me wher"): it now keeps its width. Four were told "No easy spot yet, move a machine" with empty squares all round; the card now says why no spot pays, in the line's own terms: "Pays less per shard" for a Plate Press on an ingot yard (with the two prices in the coach's line), "the line is short of scrap", or which machine is the slow one. Two were asked again and again where a kit's spare Dock should go after the line was finished; once the card's plan is all in, the coach says the spare can wait on the shelf. One was told for four shifts to put a Tuner beside a Crusher boxed in on all four sides; the advice now asks for a Tuner only where one could stand. One saw Buy a belt half hidden under the forecast on a 360-pixel phone; it now stands beside Start. One could not tell which way Turn and Turn back spin; they say Turn right and Turn left. And "Lit spots: when you ask" did not say whether they were on; it says "Show where parts go: on" or "off".
- **Parts that turn themselves:** a Hopper faced a Tuner on the way into a Furnace, and another turned to an old Crusher before its own card's Crusher was down, so a feed sat idle for a shift. A Hopper now faces the way its scrap reaches a Crusher, a Crusher dropped beside its own card's Hopper turns that Hopper to it, a machine with nothing to feed never faces a Hopper beside it, and any part a drop turns says so in a note at that part.
- **The tenth panel, the same six on c662f7d with those fixes** (`docs/baselines/fun/panel-r10/`): fun 3, 3, 3, 3, 3, 4 (mean 3.17 again), a game finished 3 of 6, a second game by choice 2 of 6 (0 in the eighth, 1 in the ninth), stuck moments 14 against the ninth's 19 and the eighth's 13. Across three rounds the same persona scored 3 or 4 by how the session went: fun is flat within the noise of six agents, a second game rose, and the dark default stays. Its fixes: "every machine keeps up; it needs more scrap" where the coach had said "try a change", a piece that leads nowhere is mentioned only when something reaches it, "held you back" waits for lesson 3 (which teaches it; "waiting for scrap" stays, it says itself), and level with Sal says how to beat him ("he builds a shift at a time and never moves a machine").
- **A Sal who plans, measured and set aside:** for each card on offer, Sal's own game played out to the end, and the card with the best finish (new offers included): on nine yards 1.2 % above Sal at the mean, 4.9 % at most, never below. The room above him is in placement, where the agents found 20 to 60 %, not in which card.
- **Heard, not changed:** a figure on each card (one agent; the figure made the pick a matter of reading the biggest number, rules 7); a try's better run counting (the owner's decision); a board to chase after the first game (the test link has none by design); lessons that light every move (the lessons are the place for that, and the first game now is not).

## Tried and set aside: a second product worth building late (2026-11-02, no rules change)

Two of the seventh panel's four said the second half asked nothing new: "add a hopper, add a furnace" again. The card's tree on 24 tune yards agrees on where the choices thin out: real picks by shift 42, 38, 29, 21, 21, 17 %, and on an ingot yard, two in three, nothing new pays after the second buyer comes, because a Plate Press earns half of what a Furnace does per shard.

- **Tried** (`TRIAL` in `sim/rules.ts`, the card on 24 tune yards, the game at 73): the second buyer paying twice for plates, 72; the other product's machine dealt as a kit with its own Splitter and Dock, and lit off the job's machine or a Splitter's free side, 73; that kit with plates at 150, 73; at 200, 73. The kit alone was taken less often than the lone Press (6 % against 11 %). At 200 the Press was taken 18 % of the times it was offered and the climax rose to 100, but real picks fell to 24 % and three ways to win to 42 % of yards: a better price makes one more clear winner, not a choice.
- **So it went.** `TRIAL` stays, empty, for the next one; the card's `--trials` and `override` read `TRIAL.<name>`. A question that is new in the second half needs something the line has not met, not a better price for something it has.

## Decision: what the seventh panel found (2026-11-02, no rules change)

Four returning agents on rules 10 (`docs/baselines/fun/panel-r7/`) and a blind comparison of rules 10 against rules 9 (`docs/baselines/fun/blind-3/`). Fun 4, 4, 3, 3; clear 4, 4, 3, 3; two played another game by choice; back tomorrow: two yes, two maybe, where the same day on rules 9 had four maybe. Both blind agents chose rules 10, one playing it first and one second.

- **The wall moved, it did not vanish.** Nobody stood with every card saying "No easy spot yet"; the two who stopped short did so at the last order, $4 and $254 away, which is where the third star is meant to take more than the lights. Three of four found the Plate Press by themselves and called it their best moment.
- **Fixed:** Home counted games and showed bests under the rules as they stand only, so a returning player read "No finished games yet" (games are now counted under any rules, and an earlier best is shown, said to be under earlier rules); Sal sold a spare kit Dock each shift for $10 and a player following the lights sat exactly $10 behind him for three shifts (Sal sells nothing now); and on a touch screen the coach says to tap the spare part on the shelf first, because a tap on the yard with nothing in hand only lets go. Making that tap place the part was tried and broke the rule a stray tap must keep.
- **Heard, not changed:** a try from a missed order goes on no board (the owner's decision), and two agents minded that their best run was a try. The turn goes one way only and costs taps. The shelf at eight parts packs closely enough to grab the wrong one.

## Decision: the cards that grow a line bring their own Dock (rules v10, 2026-11-02)

The sixth panel's casual players stopped at a wall: from shift 3 or 4 every card said "No easy spot yet", on yards with rows to spare, because a new machine had to find its way back to the first Dock within two belts. Played Sal's way on 60 tune yards, no card fitted on 7, 10 and 15 % of picks in shifts 4 to 6, and 3 games went flat.

- **A Hopper card brings a Crusher and a Dock, and the job machine's card a Splitter and a Dock** (`cardParts`); a Dock is no longer dealt alone. A new feed sells where it stands and a second machine sells beside itself: no card fits on 2 % of picks or fewer in every shift, the dead first deal included, and no game goes flat.
- **Tried first, on the same measures:** Tuners that stack (the wall 3, 7, 12 %; card +0), the second buyer paying twice for plates (5, 10, 8 %; card +3), a Dock with the job machine only (7, 13, 13 %), turning one machine first (a paying plan in 3 of 24 stuck picks), taking one machine off first (11 of 24, median +4 %), keeping junk off the first branch (no change). Kits with a Dock while the lone Dock card was still dealt scored 72 against 74 on the card: the lone Dock went unused.
- **Orders:** Sal earns about 10 % more, so each variant's scale moved (standard ×1.10 ingot and ×1.05 plate, two machines ×1.12, a Tuner ×1.00 and ×1.08), and a variant that does not fit its yard now takes the standard scale, where it had kept the table unscaled. Sal takes two stars on 71 to 100 % of yards per variant and three on 0 to 11 %.
- **Held-out card, 40 yards** (`docs/baselines/fun/card-rules10.json`): 76, lowest 32, against 75 and 34 for rules 9 (Alive 100, Pick 49 with real picks at 28.8 %, the most yet, Skill 32, Moving 65, Ways 83, Ladder 100, One more try 100, Climax 87, Yards 77, Forgiving 100; medians $8,460, $12,432, $13,083, $15,909). Ruined versions: −28, −23, −38, −15, −38 and +1: the card still cannot tell every yard alike from the game.
- The shelf packs past seven parts, so the last one stays inside its frame (`setShelfCount` in `render/layout.ts`).

**Paid for.** The Dock as a choice of its own is gone, and with it "Gives your line room to grow"; three parts to a card fill the shelf sooner.

## Decision: what the sixth panel found (2026-11-02, no rules change)

Four returning agents on rules 9 (`docs/baselines/fun/panel-r6/`) and a blind comparison of rules 9 against rules 8 (`docs/baselines/fun/blind-2/`). Fun 4, 4, 3, 3; all four finished a game; none started another; all four "maybe" for tomorrow. The blind pair split one each, and each chose the version it played second.

- **Two games on one yard.** The two who kept the spots dark took three stars and beat Sal by more than double, rebuilding the line from the forecast; they stopped because nothing was left to chase. The two who followed the lights hit a wall at shifts 3 and 4, every card "No easy spot yet", and were told to move a machine without being told which. The day's yard under rules 9 is a cramped one where Sal's game stops growing at $1,791 from shift 4. About 4 % of yards go flat that way, the same in every variant; keeping junk off the cells beside the first Splitter's piece, and moving the Tuner off the branch's route, were both tried and changed nothing.
- **Taking one machine off first** when nothing fits: on 60 yards it found a paying plan in 11 of the 24 picks where none fitted, worth a median 4 % of the line. Too little to build. The casual players' one change was the same in both: show what to move, and where.
- **Fixed:** the rank counts each yard's best stars under any rules, because Home said 0 stars the morning after the change (the bests stay per rules, since money under new rules is not money under old). The race against Sal counts his money after what he paid for new offers, where it had been $80 adrift of the results. Level with Sal or behind him, the results say what his game cannot do: it takes the card that pays most this shift and never moves a machine.

## Decision: yards open three ways, with orders to match (rules v9, 2026-11-02)

Two of the fifth panel's four agents stopped because a second yard opened exactly like the first: the same $888 first shift, the same advice. On 60 tune yards Sal's first card was the Furnace on 33 of 41 ingot yards, which then paid $840 on 27 of them, and the Hopper on 18 of 20 plate yards. Shape, rubble and deal varied; what the line was short of did not.

- **A yard opens one of three ways** (`RULES.yard.variants`, drawn from `${seed}:variant` so nothing else about the yard moves): as before, short of making; with a second job machine and its own Dock behind a Splitter, so it is short of scrap and the Hopper comes first; or with a Tuner at the job's machine, so feed and making tie. Home and the job card say which (`yardNote`).
- **On the card, 24 tune yards:** the two line variants scored 77 against 72. Pick 33 to 54, with every card taken between 10 and 60 % of the times it is offered; Moving 61 to 72; Yards 89 to 100; nothing fell. Adding junk piled high and the second buyer from shift 1 gave 73: neither changed an opening, so both went.
- **Orders per variant** (`RULES.yard.orderScale`). Under one table Sal's game took three stars on 10 of 11 two-Furnace ingot yards and two stars on only 39 % of Tuner ingot yards. Sal's choices do not read the orders, so his shifts were re-paid on paper under scaled tables: two-machine yards ×1.25 (ingot) and ×1.15 (plate), Tuner yards ×0.95 and ×1.05, rounded to $10. Sal now takes two stars on 72 to 89 % of yards in every variant.
- **Held-out card, 40 yards** (`docs/baselines/fun/card-rules9.json`): 75, lowest 34, against 72 and 31 for rules 8 (Alive 99, Pick 34, Skill 40, Moving 73, Ways 87, Ladder 100, One more try 100, Climax 75, Yards 81, Forgiving 100; medians $7,941, $11,112, $12,528, $15,415). Ruined versions: −35, −19, −38, −15, −36 and −2: "every yard alike" now switches the variants off too and still costs only 2, because each yard is measured on its own.
- A first deal where nothing fits stays rare, about 1 yard in 25 in every variant, so the deal is unchanged.

**Paid for.** A third of yards open with more on them, and the first good card is no longer the same everywhere: tests that assumed the Furnace ask the card's tag now. While building, last shift's advice stays in place, faded once the line changes, because taking it away moved every button under it.

## Decision: what the fifth panel changed (2026-11-02, no rules change)

Four agents on 242b7d3 (`docs/baselines/fun/panel-r5/`): two strangers and, for the first time, two returning players whose device had done the lessons and one game the day before (`tools/panel/returning.md`, `drive.mjs start --returning`). Fun 4, 4, 3, 3; clear 4 for all four; three of four played another game by choice; back tomorrow one yes and three maybe.

- **Help on request works for the players it was for.** The returning accountant kept the spots dark, built every shift herself from the forecast and the price list, and beat Sal by $2,635 with three stars (fun 4, back tomorrow: yes). The returning Candy Crush player read "Lit spots: off" as something taken away and switched it on at once. So the job card now says "Lit spots: always" or "Lit spots: when you ask", the coach's button says "Show me where", and the advice card's button names its machine ("Show the Furnace"), because a "Show me" beside a suggested Tuner was taken for a way to place the Tuner.
- **Following the lights ties Sal, and nobody could tell why.** Three agents saw "You're level with Sal" shift after shift and found it suspicious. The lit spots are his game; the line now says so and says how to pass him.
- **Advice that was wrong:** "A Tuner touching it would clear it" beside a Furnace that had one. The sim counts a Tuner's work on the Tuner's cell, and the advice read the Furnace's, so it never saw the Tuner (fixed in `sim/bottleneck.ts`, which also read the same field to judge a starved machine). "The Press held you back" on the yard while the lesson said the Hopper was short: a starved machine's label now says "waiting for scrap". "Only takes things from behind" for a Crusher, Furnace or Press has been false since rules 6; the warning says either side now.
- **New offers asks first when a card fits.** Two more agents paid $40 with a card that fitted, and one lost a tie with Sal by exactly that. The rules are unchanged; the game asks before taking the money.
- **Lessons:** a lesson's "turn this belt" turns on the first tap (one agent tapped, saw only a frame and thought it had failed), a pick in a lesson no longer puts a part in hand just before the words say to tap it, and an order is defined on the job card.
- **What is not solved:** two agents stopped because a second yard opened exactly like the first, the same $888 and the same advice. On the card, "every yard alike" still costs nothing. The casual returning player was $277 from her last star with no way to find it. A slow reader spent 18 minutes in the three lessons before his first choice.

## Decision: the late game, help on request, and New offers stays (2026-11-02, no rules change)

The fourth panel (four agents on rules 8) and a blind comparison (four more, rules 8 against rules 5) chose the new build, and named two things: the guided shifts read as filling in a form, and from shift 5 every card said "No easy spot yet". On the yard they played, every side of the Dock was taken, so nothing new could reach it.

- **A plan can lay belts.** `cardGain` routes a new machine to a free side up to two belts away (`routeMap` in `render/estimate.ts`), and a Dock card with every dock side taken is offered a free spot as room to grow (`game.cardRoom`), which the shift's advice explains (`bottleneck.docksFull`). On 60 yards played the coach's way, some card fits in 97, 92, 88, 88, 93 and 83 % of shifts 1 to 6. A card that adds under a twentieth of the line says "Adds a little".
- **The card on the same 40 held-out yards** (`docs/baselines/fun/card-rules8b.json`): **72, lowest 31**, against 72 and 29 before. Alive 97, Pick 31, Skill 33, Moving 66, Ways 90, Ladder 100, One more try 100, Climax 80, Yards 64, Forgiving 95; ruins −39, −21, −37, −16, −32, −0. "Every yard alike" still costs nothing on the card: it straightens the yards and clears the rubble, and each yard is still measured on its own.
- **Help on request.** The lit spots are on for a device's first game and then wait for "Show me", which lights the card just picked; the job card still turns them on or off for good. Where no spot pays, the coach says that moving a machine can make one instead of "put it where you think".
- **New offers stays.** It was to go, because two agents paid $40 for three more cards that did not fit either. Measured first (`node --import tsx tools/reroll-study.ts 60`, Sal's way on 60 tune yards): dealing again when no card fits happens 0.62 times a game, finds a better card 24 times in 37, and adds $275 a game on average (20 yards better, 4 worse, the worst −$140). Dealing again whenever the best card adds little adds $747 but loses on 20 yards, the worst by $2,404. So the coach suggests New offers only when no card fits, and Sal does the same; it is a real choice, and now the game says when it is worth making.
- **Sal sells what he could not place,** as a player who wanted to beat him would. It is worth $0 to $50 a game.

## Decision: what the third panel changed (rules v8, 2026-11-02)

Eight agents played rules 7 cold. Median fun 3, clear 4, six finished a game, two played another by choice, tomorrow: one yes, seven maybe, no one no. All eight were stuck at least once, and they were stuck at the same places (`docs/baselines/fun/panel-r3/`).

- **The Tuner stands in the line (rules).** It carries what a belt carries, so it can replace a belt piece beside the machine it speeds up. Four agents lost shifts to a Furnace with no free side, and one ended up asking why a Tuner "next to it" could not go anywhere. It speeds a Hopper too: a line short of feed had one answer, the Hopper card, which won 65 to 80 % of the picks it was in. Now a Tuner wins about as often as a Hopper in every shift from 2 to 5.
- **A belt piece between the Crusher and the job's machine (rules).** The first Splitter drops onto it. Before, the plan had to lift a working Furnace off the yard to make room, the forecast dipped, and five agents thought they had broken something.
- **A pick can be taken back until the shift starts (rules).** Build it, read the forecast, take it back, try another. Nothing has happened yet and nothing is hidden, and it replaces the figure on the card: the two agents who most wanted to reason about a pick get to do it with the real number.
- **Words that were false are gone.** "Tap the belt" with nothing lit, "the red mark" with no mark to find, advice repeated word for word after the player had taken it, and a results line, 283 × ingot at $48 = $13,584, next to a score of $10,920. Six agents named that last one: prices move, so it now adds up what each shift really paid.
- **Asked for and built:** a tap on the lit spot puts the lit part in; a Move button, so a machine can be picked up on purpose; the limit lit on the yard labels, which no longer overlap; an order filled stops the eye with a band across the yard; a try from the first order missed, which goes on no board; Lit spots on or off on the job card, because two agents asked for less help and four for more. A card says "Fits this line now" or "No easy spot yet", because "nothing yet" read as worthless and one such card was worth $966 to an agent who rearranged the line.
- **Sal is the foreman's mark everywhere.** The server worked out a mark with the autoplayer and the device worked out Sal's game, two numbers with one name. The verifier now plays Sal's game too, in milliseconds, and the autoplayer has left the image.
- **A rush job lost.** A card that is money and no part, a share of the shift's order, on the idea that it could rescue a near miss. Four versions on 24 yards scored 2 to 4 lower and real picks did not move, so it went.
- **The orders moved again:** ingot $450, $800, $1,400, $2,150, $3,200, $4,600 and plate $380, $500, $1,300, $1,900, $3,000, $4,300. A stronger Tuner lifts everyone, so on 60 tune yards a random card with the lights reaches the first star on 90 to 100 % of yards, Sal the second on 60 to 75 % and the third on 10 to 15 %.

**Paid for.** The Tuner has lost a small spatial puzzle, the crook of a corner. Lesson 3 still places it between two Furnaces, facing the Splitter so that nothing goes in head-on.

## Decision: lit spots, a card that says whether, and Sal's game (rules v7, 2026-11-02)

The estimate on a card already tried every sensible spot, so the game knew where a part paid and told the player only how much. A newcomer with a Hopper and a Crusher on the shelf and a blank yard had nothing to go on, and that is where the panel stalled.

- **Lit spots.** `cardGain` returns the placements as well as the gain, and the coach lights them one at a time, with the facing already right. Every plan, made with the game's own moves on 60 yards, earns exactly what the estimate said (`tests/estimate.test.ts`). A branch can step a machine along the belt to make room, so the job's machine says what it adds on 31 of 32 first shifts instead of 8.
- **What that exposed.** A player who only took the biggest figure and followed the lights scored a median $11,310 on 24 yards, with three stars on 23 of them, against the search's $11,736. The figure on the card had become the decision. So a card now says whether it adds to the line, not by how much, and how much shows in the forecast once it is built.
- **Sal's game.** That simple player became the target the second panel asked for: each shift Sal takes the card that adds most and builds it where the estimate says (`render/sal.ts`). It is worked out on the device, the same for everyone on a yard, needs no server, and carries his name: it is on no board and nothing in the rules reads it. The job card names it, the shift banner keeps the race, the results offer his recording.
- **There is room above him.** A search eight times deeper beat Sal by 13 % to 29 % on eight yards at list prices, with lines like Hopper, Tuner, Hopper, Furnace, Furnace, Furnace. He looks one shift ahead and never rearranges, so a player who plans has something to find.
- **The orders were re-priced for this (rules 7).** With the lights on, a player taking any card at random filled a median of four orders, and Sal filled all six on 55 of 60 yards, so the third star was free. The tables are now ingot $450, $640, $1,250, $1,900, $2,500, $3,900 and plate $380, $450, $1,200, $1,800, $2,500, $3,300. On 60 tune yards: a random card with the lights reaches the first star on every yard, the card that helps reaches the second on 65 to 70 %, Sal the second on 85 to 90 % and the third on 10 to 15 %, the search the third on 53 to 60 %. Three stars means you beat what the lights can do.

**The card moved under this.** Its tiers now play as a person does: a novice takes any card and follows the lights, a casual player takes one that says it helps, and competent is Sal. Before, a novice took a random card and the search found its best spot, and competent was an older bot that Sal beats. So the card fell from 77 to **72, lowest 35**, on the same yards, and most of that is the measure getting honest: Skill went from 76 to 36 because following the lights earns 57 % of the search's money, and tiers in order fell to 47 % because a random helpful card sometimes beats the greedy one. The ladder rose from 62 to 93 and the ruins are −38, −22, −42, −14, −37, −6 (`docs/baselines/fun/card-rules7.json`). Picks are at 35: 60 % of picks have one clear winner, and that winner is not on the card any more, which may be a better game than the measure can see. The panel decides that, not the card.

## Decision: every yard is a job (rules v4, the owner's playtest, 2026-10-31)

The owner played and asked "what's the goal, what's the point?". **What changed, and why:**

- **A job and three stars.** Each yard's seed names a material, ingots or plates, and three marks (`RULES.job.stars`). The job's material sells for `RULES.job.price` ($24) on that yard, so the job and the leaderboard pull the same way: stars never add money, shipping the job's goods simply pays best. The plain recipe (hopper, crusher, job machine, dock) earns exactly two stars on every yard in the study (`tools/job-study.ts`, `docs/baselines/0.11/job-study-v4.json`: 60 yards × 120 tries, plain line 2 stars on all 60); the third needs a widened line. Point of the game in one line: stars, then Sal's mark, then the top of today's board.
- **Real yards.** A yard's seed now also generates its belt (straight, bend or zigzag), its junk piles and two spare conveyors on the shelf (`game/src/sim/yard.ts`). "Random Yard always produces the same board" was literally true before: the starter never used the seed. The `classic-*` namespace keeps the old fixed starter for the tests and old recordings.
- **Junk piles.** `layout.rubble` cells refuse any machine; the line goes around them. They make yards differ without adding a rule to learn.
- **The first draft always offers the Crusher, the second the job's machine** (`guaranteed()` in `run.ts`), so a job can always be started.
- **The lesson** (`tutorial-1`) opens on a build with a gap in the belt: close it, start, then one machine a shift, then the first real choice (`docs/UX-STANDARD.md`; `tests/walkthrough-e2e.test.mjs` plays it touching only what is lit).
- **Corners** need no machine: a conveyor fed only from its side draws as a corner (`render/placement.ts`, `beltShape`), presentation only, it was always legal.
- **Stars in the world:** the verifier derives `stars` from the replay and stamps the entry (additive, protocol 2); boards and share text show them. **Ranks** (Scrap Picker to Scrap King) add up each yard's best stars on this device only (`content/ranks.ts`): never a claim about other players.

**An owner decision this overrides:** production roadmap §1 said no contracts ("depth systems: none of them"). A job is a contract in everything but name. The owner's playtest note asked for an end goal defined at the start ("build the X, find the X"), which the roadmap's decision did not foresee; the job is one sentence, no new rule to learn beyond the junk piles, and nothing about it needs reading to play. §1 and §3.5 carry a note.

**What the owner's other notes became, all without touching rules:** tap anything to see what it does, in any phase (`ui/Inspector.ts`); one instruction at a time with what to touch lit (`render/guide.ts`); last shift's advice pinned through the pick and the build; drop on the belt swaps, one Undo reverses it (`render/placement.ts`, `RoundController.actAll`); a Menu and a Home instead of "Title"; Pick ONE said out loud and shown by the cards that leave.

## Decision: belts are bought, not dealt (rules v5, the owner's second playtest, 2026-11-01)

The owner asked whether a player should be able to buy conveyors with the money they have earned, unless being short of belts is the puzzle. It is not, and the numbers say so (`docs/baselines/0.12/belt-study.json`, 30 yards, the autoplayer on both search policies). With 2, 4, 8 and 16 spare belts the greedy player scored the same $3,249 and ended on 3.5 belts unused, 4.1 on the yard. A conveyor was about one card in five (3.7 of 18 a game) and was taken 0.5 times a game. Taking it out of the offers raised the mean to $3,393 (+4.4 %) and three-star games from 8 to 10 of 30. The autoplayer undersells long branches, because it keeps a move only when the move pays by itself, so this is not proof that belts never bind: a wide line on a long yard can run short. It is proof they are not what the game is about.

**What changed:**

- **Buy a belt, $20, while building** (action `buy`). It comes off the running score, like new offers, so every belt shows on the board. It lands on the shelf, one at a time, and Undo gives the money back. Refused below $20 or with the shelf's seven slots full.
- **Conveyors leave the offers.** Every card is a machine, so every pick is a real one. Two spare belts on the shelf, and a belt comes back when a machine replaces it, as before.
- **$20 is above the $10 sale**, so buying and selling can never pay, and it is the money of about one good shift's start: a real choice in shift 2, small by shift 4. A beginner is never stuck past the first shift, and at the top of the board a tidy line still wins by $20 a piece.

## Decision: three lessons, one way through (rules v5, the owner's second playtest, 2026-11-01)

The owner asked for the whole tutorial to say "literally put this piece here", to say what each piece does, and to cover all of them. The old lesson taught three parts and then said "put it to work, or sell it".

- **Lesson 1, your first line:** Hopper, Conveyor, Dock, Crusher, Furnace. Three shifts.
- **Lesson 2, plates and a second feed:** the Press, turning a part, a belt joining from the side, a corner, a second Hopper and Crusher. Two shifts.
- **Lesson 3, find the slowest machine:** the Tuner, the Splitter, buying a belt, a second Dock, selling a spare. Four shifts, and the money shows it: $552, $840, $1,272.

**A lesson is a script** (`content/lessons.ts`): each shift is a list of moves, and each move names the part, the spot and what the part does. The first move not made is the instruction, the scene refuses any other edit with a word at the spot, and the shift cannot start early. The run is the only memory, so Undo steps the lesson back by itself. A lesson ends on its last shift with its job done: nothing unguided is left to finish, and each deals three cards with one lit, so ONE is something you see. `tests/lessons.test.ts` plays every lesson from the table and fails when a part the game can offer is placed in none of them.

## Decision: start over, never rewind (the owner's second playtest, 2026-11-01)

The owner asked for a restart in the lesson and wondered about every level. **Every game can go back to its first shift**, from the Menu at any moment, and the lesson shows the way beside "Skip the lesson". It asks first, because it drops the game in hand. The offers are the same, because they come from the yard. Nothing about the rules changed: an unfinished game was never sent anywhere, and leaving for Home and starting again already did this in more steps.

**It is never "this shift again".** On a scored yard the price of a second go is playing it again from the start. A one-shift rewind would make every shift free to retry until it came out right, and the board would reward patience over judgement. Undo still covers the build in hand, as it always has.

## Loop

1. **Draft** — three seeded offers; pick one card. On a job yard a Hopper card brings its Crusher and the job's machine brings a Splitter.
2. **Build** — drag parts from the bin onto an 8×6 grid; R / right-click rotates; drop onto the bin to remove. Everything can be rearranged every round. Keyboard-only: arrow keys move a cursor (first press reveals it on the selected machine), Enter places the next bin part or picks up / drops a machine, Tab cycles bin parts into the hand, R rotates, Delete returns to the bin, Esc drops / deselects / hides the cursor.
3. **Run** — 80 fixed ticks. Items move one cell per tick; processing machines hold items for a fixed number of ticks.
4. **Result** — money earned against the shift's order, what shipped, and diagnostics (blocked hopper, jammed machines, items stuck in transit). An order filled raises every price from the next shift.
5. Repeat for 6 rounds → final score = sum of round earnings, stars = orders filled → retry same seed / random / daily.

## Starter workshop

A seed's own yard: hopper, a generated belt with a Crusher and the job's machine on it and a belt piece between them, a dock, junk piles, four spare conveyors on the shelf. The `classic-*` seeds keep the old fixed one: Hopper → Conveyor ×3 → Dock in row 3, shipping raw scrap for $1 each (38 per shift).

## Machines

| Machine       | Input                 | Output             | Behaviour                                                                                                                                                             |
| ------------- | --------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scrap Hopper  | none                  | forward            | Emits one scrap every 2 ticks into the cell ahead if it accepts. Blocked ticks are reported.                                                                          |
| Conveyor      | behind or either side | forward            | Moves an item one cell per tick. Never accepts head-on.                                                                                                               |
| Splitter      | behind only           | ahead, left, right | Sends each item the next way round that is free; ways that lead nowhere are skipped.                                                                                  |
| Crusher       | behind or either side | forward            | Scrap → Shards. Holds 2 ticks. Other materials pass through unchanged.                                                                                                |
| Furnace       | behind or either side | forward            | Shards → Ingot. Raw scrap → Slag. Holds 3 ticks. Ingots pass through.                                                                                                 |
| Plate Press   | behind or either side | forward            | Stores shards; the 2nd shard becomes one Plate ($8) and holds 2 ticks. The stored shard is absorbed (no refund at round end). Other materials pass through (2 ticks). |
| Tuner         | behind or either side | forward            | Carries what a belt carries. Every Hopper, Crusher, Furnace or Press touching it works a second faster; two do not stack.                                             |
| Shipping Dock | any side              | —                  | Consumes items instantly and pays their value.                                                                                                                        |

Orientation is still the puzzle, with fewer ways to be wrong: nothing goes into a machine head-on, a Splitter only takes from behind, and everything else side-loads so lines can merge.

## Materials

Scrap $1 · Shards $3 · Plate $8 · Ingot $12 · Slag $1 (the "wrong order" product — visible, cheaper than selling raw scrap).

The press is the "take it now" option: two $3 shards become an $8 plate (+33%), it accepts a shard every tick and halves the traffic behind it, but $4 per shard is a third of the furnace's $12. A furnace beats it on a single fed line; a press wins when furnaces are scarce or a shared belt to the dock is the bottleneck.

An unwanted drafted part can be **sold from the bin for $10** (action `sell`, replay-verified). Placed machines cannot be sold, so the bonus never competes with building.

## Throughput facts (why layouts matter)

- One hopper supplies 40 items per round. A crusher (2 ticks) keeps up; a furnace (3 ticks) handles ~26 → the hopper backs up.
- A splitter feeding two furnaces lifts a single-hopper line from ~25 to ~37 ingots. A second hopper then becomes the next bottleneck fix.
- Chains move as a unit each tick (head first), so a free dock never starves a full line.

## Draft offer weights

On a job yard (rules v6): the job's machine 20 · Hopper 20 · Tuner 14 from shift 2 · the rival machine 10 · Dock 8 (distinct kinds per offer, seeded by `seed:draft:round`). Conveyors are bought (rules v5). `classic-*` yards keep the old weights: Crusher 18 · Furnace 15 · Splitter 15 · Hopper 10 · Press 10 · Dock 8 · Tuner 10 from shift 3.

## Determinism & replays

- `seed` → draft offers; the sim has no randomness. Same seed + same actions ⇒ same score.
- Replay file v1: `{format, rulesVersion, seed, actions[], claimedScore, createdAt, build}`. `verifyReplay` re-simulates and only accepts a finished run whose score matches; any illegal action rejects the file.
- `RULES_VERSION` guards every tuning value in `game/src/sim/rules.ts`.

## Presentation

Warm industrial palette (charcoal floor, amber accents, rust/steel/green machines), procedural vector textures generated at boot, synthesized WebAudio sounds (place, rotate, ship chimes scaled by value, jam thud, round fanfare). Jams tint cells red live; `+$n` floats at docks; transforms flash in the product colour. After each round one sentence names what held the line and the pool fixes (0.8.8, `sim/bottleneck.ts`: jammed cells are attributed along their outputs to the processor that was holding, or to a dead end or a merge; below an eighth of the round held, the least busy processor is "starved" or the round is "balanced"); the next draft's hint repeats it.

Colour audit (2026-10-25, `tools/a11y-audit.ts`, enforced by `tests/a11y.test.ts`): every text/background pair meets WCAG AA (≥ 4.5:1; large/bold ≥ 3:1), and the five materials plus the ok/bad/selection/cursor colours stay apart under protanopia, deuteranopia and tritanopia (Machado 2009). Materials also differ in shape (lump, shard triangle, flat plate, rounded ingot, cracked slag blob), so colour is never the only cue. Fixes from the audit: red #e5574a → #eb6757 (4.47 → 5.0:1 on the panel), build label #6f6758 → #948a79 (3.2 → 5.1:1), plate #9fb4c7 → #7f9bb8 (shards/plate ΔE 12.7 → ≥ 23 in every simulation), keyboard cursor frame on its own light tint (`P.cursor`) instead of the text blue. Contact sheets: `docs/a11y/materials-cvd-before.png` / `-after.png`.

Accessibility (title screen, persisted): **Motion: Reduced** keeps belts on one frame, drops flashes, pops and travelling floats (the `+$n` still appears and fades in place) and snaps items between cells; it defaults to the OS `prefers-reduced-motion`. **Text size** 100 / 115 / 130 % scales every font through the UI helpers while the fixed 1120×700 layout stays put (the canvas already fits the window, so font size is the lever that helps).

## Event → sound → visual (juice contract, PLAN-v1 0.4.4)

One sound and at most one visual per event; intensity scales with value; nothing shakes the screen or trails; idle machines are still so a jam stays visible. Reduced motion keeps the sound, drops the motion.

| Event / interaction              | Sound                                            | Visual (full motion)                                                                   | Reduced motion                       |
| -------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------ |
| draft pick (lock-in)             | `lockIn` two rising notes                        | card leaves the panel, part appears in the bin (panel rebuild)                         | same, no tween                       |
| place                            | `place` click + noise                            | 90 ms settle, scale 1.06 → 1                                                           | none                                 |
| rotate                           | `rotate` short blip                              | 60 ms snap, scale 0.94 → 1; facing updates                                             | facing updates                       |
| refused drop                     | `invalid` low saw                                | red cell flash 350 ms + reason in the hint strip                                       | reason in the hint strip             |
| run start                        | `run` rising saw                                 | panel switches to RUNNING                                                              | same                                 |
| `spawn` (hopper emits)           | —                                                | item appears at the hopper mouth                                                       | same                                 |
| `move`                           | —                                                | item eases one cell per tick; belts cycle 8 chevron frames                             | item snaps; belts stay on frame 0    |
| crusher holding                  | —                                                | jaws alternate open/closed each tick (`m-crusher` / `m-crusher-1`)                     | base frame                           |
| furnace holding                  | —                                                | warm tint                                                                              | warm tint (not motion)               |
| press holding                    | —                                                | ram descends over the hold (`m-press-1`, `m-press-2`)                                  | base frame                           |
| `transform`                      | `transform` blip                                 | one expanding ring in the output colour, 300 ms                                        | texture swap only                    |
| `absorb` (press takes a shard)   | —                                                | shard shrinks into the press, 220 ms                                                   | badge only                           |
| `ship`                           | `ship` chime, pitch by value, ingot adds a fifth | +$ pop rises 38 px and fades (pooled); dock lid lift 60 ms; HUD total pulses           | pop fades in place; HUD text changes |
| `jam` first tick                 | `jam` throttled noise                            | red wash on the cell while jammed                                                      | same (static)                        |
| stall (8 ticks, nothing shipped) | —                                                | red frame on the first blocking cell, pulsing; HUD stall line                          | static frame + HUD line              |
| round end                        | `roundEnd` fanfare (good/bad) then `settle`      | every machine eases 1 → 0.97 → 1, staggered 25 ms per column; result banner and badges | banner and badges only               |
| round summary → next             | `click`                                          | panel rebuild                                                                          | same                                 |

## Competitive foundation

Identical seeds give identical offers; nothing in progression changes scoring. Local bests are labelled local/unverified. The verifier re-runs `verifyReplay` on submitted replays before any leaderboard shows a score. The daily challenge seed is `daily-YYYY-MM-DD` in UTC, derived by the same function (`game/src/sim/daily.ts`) on the client and the verifier; `GET /daily` returns today's seed with its verified board and the title screen shows it (or says the verifier is offline). The verifier is a single-file Node service (`server/README.md`): per-IP rate limit on submissions, duplicate-replay hash, CORS origin allow-list, request log; the game build bakes in `VERIFIER_URL`. Players choose a display name (`jd.player`, 32 chars, asked once before the first submission, editable on the title screen); it is a label only, never an identity. After a submission the results screen shows the verified rank (position by replay hash among the top 100 for that seed) and offers share text that states exactly what was verified; the title strip shows this device's own daily rank, found by replay hash, not by name. Every verified entry can be watched: the verifier stores the actions, `GET /replay?hash=` serves them, and the client re-verifies the replay locally before playing it back labelled "verified replay by <name> ($score)"; playback never records bests, saves or submits. While watching: a blue REPLAY marker in the HUD, the original run's per-round earnings beside the live total, speed 1/2/4×, Skip to the round result, and Stop (Esc returns to the title instead of pausing). The verifier keeps replay actions only for each seed's top 100 entries; lower entries keep their score.

## Decisions log

- 2026-10-25 Grid 8×6, 80-tick rounds, 6 rounds: fits a laptop at 1120×700 and keeps a run under 10 minutes.
- 2026-10-25 Furnace melts raw scrap into slag instead of refusing it: flow stays visible and the lesson is cheap.
- 2026-10-25 Sell-from-bin ($10) added after the autoplayer showed ~1/3 of drafts cannot improve a line; slag lowered to $1 so raw scrap in a furnace costs something.
- 2026-10-25 Round summary moved onto the grid: per-machine badges (out/blocked, made/waited, $/shipped) replace an opaque overlay.
- 2026-10-25 Colour audit: palette nudges only (red, plate, build label, cursor); no shape changes were needed because every material already has a distinct silhouette. Thresholds live in `tools/a11y-audit.ts` and run with `npm test`.
- 2026-10-25 Press balance pass (`tools/balance.ts`, 40 seeds × 120 tries, identical offers, press drafted vs refused): v2 press is taken in 19 of 56 rounds it is offered (34%), never lowers a seed's score (0 worse / 7 better, +44 mean when taken, +247 best) and lifts the mean by 19. A 1-tick hold is statistically identical (+1 mean), so not worth a version bump. Plate $9 / $10 raise the pick rate to 41% but turn the press into a trap for a greedy drafter (3 seeds regress, worst −394): the machine must stay clearly below the furnace per shard. Decision: keep v2 unchanged; a shard left in a press at round end is shown on its badge.
- 2026-10-25 Rules v2: Plate Press added (2 shards → 1 plate $8, 2 ticks) as the first machine with a real draft decision against the furnace; conveyor weight 34 → 30 to make room. Keyboard-only placement added for accessibility; it reuses the same rule-checked actions as the mouse.
- 2026-10-25 Chain movement resolved by repeated passes (bounded by item count) rather than two-phase planning: simpler, deterministic; the earlier fixed 8-pass cap falsely stalled long chains and was removed.
- 2026-10-30 Dead rounds study (production roadmap 0.9.6, `tools/dead-rounds.ts`, 20 and 40 seeds × 120 tries): no candidate passes the gate (flat rounds under 12 of 120 from 29; the best, a late-round hopper-or-crusher guarantee, reaches 25 and leaves two of forty seeds worse). Rules v3 stays; the guarantee remains an inert knob (`RULES.lateOfferGuarantee`) so the study can be rerun; recommendation no-go, ⚑ the owner's written go/no-go below.

## Decision: dead rounds stay a tuning fact, not a system (production roadmap 0.9.6, 2026-10-30)

**Question.** Rounds 4–6 often offer nothing that improves a finished line ("flat" rounds: the autoplayer's best pick leaves the round's earnings where they were). The autoplay baseline since v0.5 counts 29 flat rounds in 120 (20 seeds × 6 rounds, 120 tries per round, greedy search). The roadmap allows one tuning pass before 1.0, provided it adds nothing a player must learn, and sets the gate: flat rounds under 12 of 120, no seed worse on identical offers, every score replay-verified, the derived sanity bound unchanged.

**Candidates measured** (`tools/dead-rounds.ts`; the baseline reproduces the v0.5 figure exactly; every score replay-verified under each candidate's rules; `docs/baselines/0.9/dead-rounds-0.9.6.json`):

| candidate                  | flat rounds (20 seeds, of 120) | by round 1..6 | median | mean Δ vs v3 | seeds worse / better | offers changed | bound | gate                         |
| -------------------------- | ------------------------------ | ------------- | ------ | ------------ | -------------------- | -------------- | ----- | ---------------------------- |
| rules v3 (baseline)        | **29**                         | 0/3/4/9/6/8   | $1748  | —            | —                    | —              | 20220 | —                            |
| late guarantee, rounds 4–5 | 25                             | 0/3/4/6/5/8   | $1748  | +39          | 0 / 5                | 13             | 20220 | fail: 25 ≥ 12                |
| late guarantee, rounds 4–6 | 24                             | 0/3/4/6/5/7   | $1748  | +37          | 0 / 6                | 16             | 20220 | fail: 24 ≥ 12                |
| slag $2                    | 29                             | 0/3/4/9/6/8   | $1748  | 0            | 0 / 0                | 0              | 20220 | fail: no effect              |
| sell $12                   | 29                             | 0/3/4/9/6/8   | $1748  | 0            | 0 / 0                | 0              | 20232 | fail: no effect, bound moves |
| furnace hold 2             | 36                             | 0/3/5/10/9/9  | $2290  | +402         | 0 / 19               | 0              | 20220 | fail: more flat rounds       |
| hopper period 3            | 36                             | 0/3/5/10/9/9  | $1542  | −327         | 20 / 0               | 0              | 13668 | fail: everything worse       |
| guarantee 4–5 + slag $2    | 25                             | 0/3/4/6/5/8   | $1748  | +39          | 0 / 5                | 13             | 20220 | fail: 25 ≥ 12                |

On 40 seeds (240 rounds; `dead-rounds-0.9.6-40seeds.json`): baseline 57 flat; guarantee 4–5 → 49 with 2 seeds worse and 8 better (+$18 mean); guarantee 4–6 → 47 with 2 worse and 11 better; slag $2 → 56 (one seed +$1); sell $12 → 57; furnace hold 2 → 75 (+$370 mean); hopper period 3 → 78 (all 40 worse).

**Reading.** The late-round guarantee is the only candidate that moves the number, and it moves it by about an eighth: the dead rounds are not mostly "no useful card on offer" but "the line is finished": on an 8×6 grid with one or two hoppers feeding one belt, by round 4 most seeds have a crusher, a furnace and the supply they can use, and another hopper or crusher adds nothing unless the player rebuilds. A faster furnace proves the point from the other side: it raises every score by a quarter and _adds_ dead rounds, because the line saturates a round earlier. Slag and sell nudges do not reach the metric at all (the greedy autoplayer neither melts raw scrap on purpose nor sells). A slower hopper only hurts.

**Decision (recommendation).** No candidate ships. Rules v3 stays; no `RULES_VERSION` bump, no golden regeneration, no cutover. The guarantee stays in the rules module as an inert knob (`lateOfferGuarantee: { rounds: [], kinds: ['hopper', 'crusher'] }`, byte-identical offers while the list is empty, `tests/draft-guarantee.test.ts`) so the study is reproducible and the policy page shows it off. Late-round depth, if the owner wants it at all, is a v1.x question (the roadmap's own answer is "none of them" to depth systems before 1.0); the social layer (v0.11) is what gives rounds 4–6 a reason: the same yard, other people's lines.

⚑ **Owner's written go/no-go:** pending. The recommendation is no-go; the numbers above are the evidence.

## Scenario namespaces and rules identity (review F13, 2026-10-29)

Reserved seed prefixes change what a seed does: `tutorial-*` constrains the first three drafts and adds spare conveyors (PLAN-v1 0.3.4). That is rules behaviour even though no tuning value changed, and it altered the outcome of pre-0.3 replays on tutorial-prefixed seeds without a `RULES_VERSION` bump — the one exception to the "every v0.2 replay verifies" claim. Policy from here: any change to a reserved namespace's behaviour, or a new reserved prefix, bumps `RULES_VERSION`; `daily-*` is a label only (same rules as any seed). The golden corpus under `tests/golden/` (ordinary seeds, a sold part, a press line, churn, the tutorial, a tutorial-looking ordinary name, a daily label) is re-simulated by `npm test` and is regenerated (`tools/make-golden.ts`) only together with a deliberate version bump.

## Decision: the Sieve is deferred (PLAN-v2 0.5.2, rules-v3 branch, 2026-10-29)

**Question.** Does a 1-cell Sieve (input from behind; raw scrap forward; shards, plate, ingot and slag to the right; a blocked chosen exit waits) earn its slot on a same-inventory mixed-material puzzle?

**Fixture** (`tests/sieve-fixture.test.ts`, `tools/sieve-fixture.ts`). Eleven machines each: the five starters plus six picks (hopper, crusher, furnace, dock, conveyor, and either a Sieve or a second conveyor). The Sieve line merges a raw belt with a crusher's shards on one conveyor, sorts them at the Sieve, sends scrap to one dock and shards right into a furnace whose ingots ship at a second dock. The separated line keeps the raw belt and the crusher → furnace → dock route apart.

|                                                                 | Sieve line   | separated routes      |
| --------------------------------------------------------------- | ------------ | --------------------- |
| money, standard pricing                                         | **$289**     | **$338** (+17 %)      |
| money if the second dock paid 2× for ingots and $0 for the rest | $577         | $638                  |
| furnace protected from raw scrap                                | yes (0 slag) | yes (never meets any) |

The Sieve does what it promises (ingots, no slag), but the merge it exists to sort costs more than it saves: the shared conveyor accepts one item per tick, so the crusher waits behind the hopper's scrap. On 8 × 6 with at most eleven machines the two routes always fit side by side, so the sorting detour is never forced. Even a dock that rewards sorting (the export-dock hypothesis) does not rescue it, because separation delivers the same sorted stream for free. The searched layouts (neutral policy, 300 tries × 4 streams from an empty grid) agree in direction and are weaker than the hand lines, which is a note against the from-empty search, not for the Sieve.

**Decision.** No convincing benefit: the Sieve stays in the simulation as an experimental kind (`RULES.experimental.sieve = false`, draft weight 0, no card) and does not enter the pool in v0.5. Two of PLAN-v2's named replacements were weighed: a Buffer cell adds nothing here because no processor is starved by burstiness beyond its own hold time, and a dock bonus is just a better dock (see the table). The v0.5 decision machine becomes a **Tuner**: a 1-cell machine with no input or output that shortens the hold of every orthogonally adjacent processor by one tick (minimum one). It spends a cell and a draft slot for throughput on the line's bottleneck (a furnace at 3 → 2 ticks is +50 % ingots), which is the Kaizen trade-off the plan wants, it composes with every existing machine, and it is measurable with `tools/balance.ts --machine tuner --gate`. PLAN-v2 0.5.3 is re-cut accordingly; the Sieve can return in a later version if a mode with scarcer cells or more machines ever makes merging necessary.

## Decision: the Tuner ships from round 3 (PLAN-v2 0.5.3, rules-v3 branch, 2026-10-29)

A Tuner shortens the hold of every orthogonally adjacent crusher, furnace or press by one tick (never under one; two tuners do not stack; one credit per item on its badge). Draft weight 10 from round 3. Greedy control on 40 seeds × 120 tries, identical offers: allowed vs banned mean $1768 vs $1581 (+$187, +12 %), 22 seeds better, 0 worse, 18 equal, +$340 on the 23 rounds it was picked; picked in 59 % of the 39 rounds offered (the bot chose a hopper 7 times and a furnace 5 times instead). Offering it from round 4 or 5 instead was worse on every count. A furnace-only variant (`tunerMinHold: 3`) was indistinguishable: the bot only ever tunes furnaces anyway. **Gate note:** the 25–50 % pick band inherited from PLAN-v1's Sieve criterion fails at 59 %; the hard criteria (no seed worse, positive paired lift, every score replay-verified, nothing above the sanity bound) pass, so the band for a throughput booster judged by an exact-score bot is widened to 25–65 % and the deviation is recorded here and in DESIGN rather than tuned away.

| condition (greedy control, 40 seeds × 120 tries) | mean  | pick rate when offered | seeds better / worse / equal vs ban | mean paired lift |
| ------------------------------------------------ | ----- | ---------------------- | ----------------------------------- | ---------------- |
| Tuner from round 3 (shipped)                     | $1768 | 0.59 (23 of 39)        | 22 / 0 / 18                         | +$187            |
| Tuner banned                                     | $1581 | —                      | —                                   | —                |
| Tuner from round 4                               | $1708 | 0.63 (20 of 32)        | 21 / 7 / 12                         | +$126            |
| Tuner from round 5                               | $1699 | 0.82 (18 of 22)        | 24 / 8 / 8                          | +$117            |
| holds ≥ 3 only (furnace)                         | $1768 | 0.59                   | 22 / 0 / 18                         | +$187            |

The later tiers are not same-offer comparisons against the banned run (the offer stream shifts), so their "worse" counts are confounded; they are listed because they rule out delaying the Tuner as a remedy. Report: `docs/baselines/0.5/balance-tuner-greedy.json` (+ `.log`, variants in `tuner-variants.json`).

## Decision: one paid reroll per round, $40 from the score (PLAN-v2 0.5.4, rules-v3 branch, 2026-10-29)

A reroll is a rule-checked replay action: draft phase only, once per round, refused below the cost and on tutorial seeds, new offers from `seed:draft:round:reroll:1` so later rounds never change, no crusher guarantee on the redraw, not undoable (it buys information). Accounting reads production + sales − rerolls on the results screen and in the detailed share line. Reroll study (`tools/balance.ts --reroll`, greedy search, 40 seeds × 120 tries, identical seeds and offers): never vs greedy-reroll mean $1767 vs $2013 (+$246, +14 %), 31 seeds better, 7 worse, 2 equal; 79 rerolls over 240 rounds = 32.9 %; every score replay-verified. Every losing seed lost at most what its rerolls cost (−12, five × −40, two × −80): a fruitless reroll is the price of information and the rule can never cost more than that, which is now the gate's hard criterion. **Gate note:** PLAN-v1's 10–30 % usage band (a skip-rate analogue) fails at 32.9 %; the bot rerolls almost exactly when no offer improves its line (a flat round for the greedy bot happens about a third of the time), and making its threshold stricter barely moved the rate (33.8 → 32.9 %), so the band is widened to 10–35 % and the deviation is recorded here and in DESIGN rather than tuned away. Report: `docs/baselines/0.5/reroll-study-greedy.json` (+ `.log`).

| greedy search, 40 seeds × 120 tries | never reroll | greedy reroll policy         |
| ----------------------------------- | ------------ | ---------------------------- |
| mean score                          | $1767        | $2013 (+$246)                |
| seeds better / worse / equal        | —            | 31 / 7 / 2                   |
| rerolls per round                   | 0            | 32.9 % (79 of 240)           |
| worst loss                          | —            | −$80 (two fruitless rerolls) |

## Decision: one tie-breaker, derived server-side (PLAN-v2 0.5.5, rules-v3 branch, 2026-10-29)

Equal scores rank by fewer machines on the grid in round 6, then by the earlier verified submission, then by replay hash. The verifier derives the machine count from the re-simulated replay (a payload cannot set it), every ranked view uses the same comparator, legacy entries derive from their stored replay or rank last among equals, and the rule is printed under every board. Score stays the single headline axis; the machine count is a secondary objective only where scores tie, and the Minimalist badge text says so.
