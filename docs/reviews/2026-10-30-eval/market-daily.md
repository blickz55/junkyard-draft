# Daily and web-first score-attack games: market research for Junkyard Draft

Prepared 2026-10-29 for (a) the product-idea interview with the owner and (b) the roadmap to a production-quality 1.0.

Scope: the growth loops, retention mechanics, community structures and business models of the most successful daily and web-first puzzle/score-attack games, and what transplants to a deterministic draft-and-build factory score-attack game with a server-minted daily seed, replay-verified histogram leaderboard, bot par, forgiving streak, groups, challenge links, clips and a Wordle-style share grid.

Conventions: every number carries a URL. **[est.]** marks a third-party estimate, **[inf.]** marks my inference, **[unverified]** marks a claim I could not confirm against a primary source. Several official pages (puzzmo.com, lichess.org blog, NYT help centre) refused automated fetches; where that happened I say so and cite secondary coverage. Numbers from 2025–2026 are preferred where they exist.

---

## 1. Executive summary

1. The daily format's engine is not the puzzle; it is **one shared object per day + a spoiler-free way to talk about it**. Wordle went from 90 players (1 Nov 2021) to ~300,000 in two months once players could post the emoji grid ([NPR/WHYY](https://whyy.org/npr-story/the-new-york-times-buys-wordle)); the grid was added after players were already hand-typing emoji on Twitter ([TechCrunch](https://techcrunch.com/2022/05/04/wordle-new-york-times-user-growth)). Junkyard Draft already has the grid; the gap is the social surface around it (section 8).
2. **Scale is a bundle business; small scale is a supporter business.** NYT Games was played 11.2 billion times in 2025 ([NBC Chicago](https://www.nbcchicago.com/entertainment/entertainment-news/hardest-wordle-connections-games-2025/3868912/)) and is sold as part of a 6.48 M-subscriber bundle ([NYT Q4 2025 release](https://www.sec.gov/Archives/edgar/data/71691/000007169126000008/pressrelease12312025.htm)). Nobody at 10–300 daily players reproduces that; the relevant precedents are Squaredle, Trainwreck Labs, Bandle, TETR.IO and shapez.io, all run by one to ten people.
3. **Free web → paid Steam works for factory games specifically.** shapez.io's free web build (100–200 k monthly users) still drives 2,500–3,000 Steam sales a month years later; Steam wishlist-to-purchase conversion was 39.9 % ([GameDiscoverCo](https://newsletter.gamediscover.co/p/deep-dive-how-shapezio-went-from)). The Steam version added achievements, cloud saves, DLC and a price that rose from $3.99 to $6.99. This is the closest published analogue to Junkyard Draft's plan.
4. **Replays beat anti-cheat.** Slay the Spire's daily leaderboards are now "defunct" after mod-inflated scores ([wiki](https://slay-the-spire.fandom.com/wiki/Score)); NecroDancer's daily board survives because every entry carries a full replay ([Brace Yourself](https://braceyourselfgames.com/crypt-of-the-necrodancer/updates)). Junkyard Draft's re-simulated replays are already the right architecture; make it visible.
5. **Leaderboards demoralise; percentiles and personal bests do not.** Puzzmo's own reviewer: "I get bummed out when I finish a puzzle and see I'm in the bottom 20%" ([Adrian Hon](https://adrianhon.substack.com/p/puzzmo)). Duolingo leagues run on loss aversion and demotion fear by design ([Deconstructor of Fun](https://duolingo.deconstructoroffun.com/mechanics/leagues)). The histogram + par + "beat yesterday's you" model is the ethical and small-population-safe one.
6. **Ads are a poor fit at this scale; a supporter tier with non-gameplay perks is the fit.** TETR.IO: 0.03 % Patreon conversion before in-game purchase; 600–750 k ad impressions/day needed for ads to matter ([osk](https://blog.osk.sh/post.php?p=6099b8a61939d7.85346753)). YouGov: 24 % of Wordle players would pay something, 10 % would pay $4–6/month ([YouGov](https://yougov.com/en-us/articles/41128-wordle-willingness-to-pay-poll)). Precedent price points cluster at $3.99/mo or $39.99/yr (Puzzmo, NYT Games), $5/mo (Trainwreck Club) and $9.99/yr (Squaredle).

---

## 2. Case studies

### 2.1 Wordle and NYT Games

**Acquisition and growth loop.** Josh Wardle built Wordle in 2021 for his partner; 90 players on 1 November 2021, ~300,000 by early January 2022 ([NPR](https://whyy.org/npr-story/the-new-york-times-buys-wordle)). The grid share was added in November/December 2021 after players were posting emoji blocks manually; at the peak Twitter saw ~500,000 Wordle tweets a day, coinciding with the Times purchase ([TechCrunch](https://techcrunch.com/2022/05/04/wordle-new-york-times-user-growth)). Wordle results were shared 1.2 million times on Twitter between 1 and 13 January 2022 ([Wikipedia, citing The Guardian](https://en.wikipedia.org/wiki/The_New_York_Times_Games)). Sale price: "low seven figures," announced 31 January 2022 ([NPR](https://whyy.org/npr-story/the-new-york-times-buys-wordle)).

**Wardle's GDC 2022 "incorrect tips"** ([PocketGamer.biz](https://www.pocketgamer.biz/gdc-josh-wardle-shares-his-incorrect-tips-for-wordles-success/)): make a word game (players arrive with the skill); replace infinite play with one per day (he had infinite play in 2013 and switched after seeing the NYT games page); build a website not an app ("you're supposed to make an app"); do not promote (the shared grid did not even link back); sell rather than run a business. Wardle also said the shared daily word becoming a conversation was unintentional ([Game Developer](https://www.gamedeveloper.com/marketing/josh-wardle-reflects-on-the-the-unconventional-road-to-wordle-s-success)).

**Scale (2024–2025).**

| Metric | Value | Source |
|---|---|---|
| NYT Games plays 2024 | 11.1 B (Wordle 5.3 B, Connections 3.3 B, Strands 1.3 B) | [The Verge via Wikipedia](https://en.wikipedia.org/wiki/The_New_York_Times_Games) |
| NYT Games plays 2025 | 11.2 B (Wordle 4.2 B, Connections 1.6 B*, Strands 1.5 B, Mini 1.4 B, Spelling Bee 667 M, Pips 612 M) | [NBC Chicago](https://www.nbcchicago.com/entertainment/entertainment-news/hardest-wordle-connections-games-2025/3868912/) |
| Daily players (2024) | >10 M across platforms | [Adweek via Wikipedia](https://en.wikipedia.org/wiki/The_New_York_Times_Games) |
| Games-app DAU | 886 k (Oct 2022) → 2.6 M (2023) | [Vanity Fair via Wikipedia](https://en.wikipedia.org/wiki/The_New_York_Times_Games) |
| Games premium subscribers | >1 M (2023) | [Digiday via Wikipedia](https://en.wikipedia.org/wiki/The_New_York_Times_Games) |
| Wordle streaks ended by one puzzle (15 Oct 2024) | 5.6 M; 2.8 M players use the same starter word daily | [AP/AOL](https://www.aol.com/exclusive-wordle-puzzle-ended-5-013624721.html) |
| NYT digital-only subs, end 2025 | 12.21 M; bundle 6.48 M; single-product 4.27 M; digital sub revenue $1,434 M (+14.3 %); ARPU $9.72 | [NYT 8-K Q4 2025](https://www.sec.gov/Archives/edgar/data/71691/000007169126000008/pressrelease12312025.htm) |
| NYT digital-only subs, Q2 2026 | 13.4 M (+280 k); digital sub revenue ~$408 M (+16.4 %) | [Motley Fool transcript](https://www.fool.com/earnings/call-transcripts/2026/08/12/nyt-nyt-q2-2026-earnings-call-transcript/) |

\*The 2025 Connections figure (1.6 B) comes from a single outlet and would be a steep fall from 3.3 B; treat as **[unverified]** until a second source appears. NYT does not break out Games revenue and says it will stop reporting bundle/single-product splits after Q4 2025, so Games-specific numbers are unlikely to appear again.

**Why the bundle matters.** Head of Games Jonathan Knight: subscribers who engage with both news and games in a given week "have the strongest long-term subscriber retention profile of any at the Times" ([GamesBeat](https://gamesbeat.com/how-the-new-york-times-is-expanding-into-puzzle-games-like-wordle/)). Games is a retention product for a $1.4 B subscription line, not a standalone P&L. Standalone Games pricing is widely reported at ~$5.99/month or $39.99/year with heavy first-year promotions ([App Store IAP tracker](https://apppricinglab.com/iap/apple/307569751); [Adrian Hon](https://adrianhon.substack.com/p/puzzmo)).

**Paywall choreography (what is free, what is not).** Daily Wordle: free. Wordle Archive (1,000+ puzzles, launched May 2024): subscribers only ([TechCrunch](https://techcrunch.com/2024/05/07/nyt-games-launches-a-wordle-archive-with-access-to-more-than-1000-past-puzzles/)); archive plays count toward stats but not streaks ([NYT Help Center via search](https://thenewyorktimeshelpcenter.helpjuice.com/24611727334932-Wordle)). The stats page (Played, Win %, Current/Max Streak) is listed as a subscriber feature, though stats display for free players in practice **[unverified detail]**. WordleBot was free for about two months in 2022 and then moved behind the paywall ([Tom's Guide](https://www.tomsguide.com/opinion/happy-first-birthday-wordle-heres-5-ways-you-should-improve)). In August 2025 the Mini Crossword, Tiles and Letter Boxed lost free daily play ([Kotaku/Book Riot via Wikipedia](https://en.wikipedia.org/wiki/The_New_York_Times_Games)). Spelling Bee stops free play at the "Good"/"Solid" rank. Pattern: **the daily stays free; depth (archive, analysis, history, unlimited) is paid**.

**Connections/Strands expansion.** Connections released June 2023 and became the second most-played game within months ([Yahoo/The New Daily](https://au.news.yahoo.com/connections-york-times-most-played-202419838.html)); Strands beta March 2024, full June 2024. The expansion lesson is "one more daily object with its own emoji share," not "more of the same puzzle".

### 2.2 Puzzmo (Zach Gage, Orta Therox / Hearst)

Launched October 2023 with a deliberately slow gate: 500 new players a day, a printed puzzle mailed to each ([TechRadar](https://www.techradar.com/gaming/zach-gage-is-letting-500-people-into-his-new-puzzle-app-each-day-but-theres-a-catch)). Acquired by Hearst in December 2023, with Gage and Therox still leading ([AlternativeTo news](https://alternativeto.net/news/2023/12/hearst-acquires-online-puzzle-platform-puzzmo-plans-integration-across-50-media-brands)); syndicated to Postmedia in Canada (April 2024) and to libraries via Hoopla "BingePass" (March 2025) ([BusinessWire](https://www.businesswire.com/news/home/20250326593738/en)). Gage's stated goal is a company "run as a very successful and very profitable business forever," growing to "hundreds of thousands or even millions" ([Game Developer](https://www.gamedeveloper.com/design/puzzmo-co-creator-zach-gage-on-building-newspaper-games-that-can-last-forever)).

**Price and tiers.** Puzzmo Plus: $3.99/month or $39.99/year per the iOS listing ([App Store via search](https://apps.apple.com/us/app/-/id6714482734)); $40/year in most coverage. Free: the daily set (about 40 minutes of play). Plus: ad-free, archive, two-player, exclusive/experimental games, leaderboard inclusion, statistics and **groups** ([Adrian Hon](https://adrianhon.substack.com/p/puzzmo); [ADN](https://www.adn.com/puzzles/2024/06/08/play-traditional-newspaper-games-with-a-new-spin/)).

**Hints and assists as designed friction, not failure.** Crossword hints add time to the clock and lower the score, and the first hint is a "more obvious clue" rather than the answer; Typeshift and Wordbind reveal one step at a time ([Adrian Hon](https://adrianhon.substack.com/p/puzzmo)). Gage frames it as "how do I support the player who has nothing?" without slowing experts ([Game Developer](https://www.gamedeveloper.com/design/puzzmo-co-creator-zach-gage-on-building-newspaper-games-that-can-last-forever)).

**Social layer.** Every game has a global leaderboard plus percentile graphs after each solve; groups track collective stats; weekly and monthly boards and streaks "encourage you to come back every day" ([Digital Trends](https://www.digitaltrends.com/gaming/puzzmo-announcement-zach-gage-interview/); [Adrian Hon](https://adrianhon.substack.com/p/puzzmo)). Orta's public API gist sketches per-game leaderboards and proposed daily/weekly meta-leaderboards ([gist](https://gist.github.com/orta/8d975a33a9be14ca0fba52c6aecfd454)).

**What worked, what grates.** Worked: a free daily set generous enough to form the habit; paying for *social* rather than for *content*; web-first to avoid the 15–30 % store cut. Grates: speed-weighted scoring makes small slips "plummet" you; being told you are in the bottom 20 % demoralises; a manifesto that "disavows gamification" while "gamification infuses every single aspect" ([Adrian Hon](https://adrianhon.substack.com/p/puzzmo)). No subscriber numbers have been published.

### 2.3 GeoGuessr

| Item | Value | Source |
|---|---|---|
| Registered players | 40 M (Jul 2022); "over 60 M in 140+ countries" (Sep 2024) | [Wikipedia](https://en.wikipedia.org/wiki/GeoGuessr); [Tubefilter](https://www.tubefilter.com/2024/09/16/location-obsessed-creators-put-geoguessr-on-the-map/) |
| Revenue | <$500 k (2019) → >$18 M (2022); $24 M 2025 **[est., Dealroom]** | [Tubefilter](https://www.tubefilter.com/2024/09/16/location-obsessed-creators-put-geoguessr-on-the-map/); [Dealroom](https://dealroom.co/companies/geoguessr/) |
| Funding | $46 M growth equity at $508 M valuation, Orkila Capital, Apr 2025 **[Dealroom]** | [Dealroom](https://dealroom.co/companies/geoguessr/) |
| Pricing (Jan 2026) | Pro Basic $4.99/mo or $35.88/yr; Pro Unlimited $6.99/mo or $47.88/yr; Elite $10.99/mo or $71.88/yr | [PriceTimeline](https://pricetimeline.com/data/price/geoguessr) |
| Free tier | Daily Challenge only: 5 locations per 24 h, solo, free account required | [EraGuessr guide](https://eraguessr.ai/guides/why-geoguessr-is-not-free) |

GeoGuessr moved almost everything behind the subscription in January 2024 with no advance warning, citing Street View tile costs ([EraGuessr guide](https://eraguessr.ai/guides/why-geoguessr-is-not-free)). The free Daily Challenge was kept as the one free object: the acquisition funnel. Creators drove the growth: Rainbolt's channel passed 1.6 M subscribers and ~80 M monthly views in 2024 ([Tubefilter](https://www.tubefilter.com/2024/09/16/location-obsessed-creators-put-geoguessr-on-the-map/)). World Cup finals have run yearly since 2022 (Paris, 2023, 2024, Copenhagen 2025, Berlin 2026) ([Wikipedia](https://en.wikipedia.org/wiki/GeoGuessr)).

**2025 controversies.** The Steam edition launched to "overwhelmingly negative" reviews (15 % positive, May 2025), IGN called it the second-worst-rated game on Steam; by January 2026 it had recovered to "mostly positive" ([Wikipedia](https://en.wikipedia.org/wiki/GeoGuessr)). On 15 May 2025 GeoGuessr announced an Esports World Cup event in Riyadh; map creators made their maps unplayable on 21 May; GeoGuessr withdrew on 22 May, CEO Daniel Antell saying the company "got it wrong" ([esports.gg](https://esports.gg/news/esports/geoguessr-withdraws-event-from-esports-world-cup-after-backlash/); [Engadget](https://engadget.com/gaming/geoguessr-community-maps-go-dark-in-protest-of-ewc-ties-to-human-rights-abuses-221037118.html)). Lesson: the community's user-generated content is leverage; the company's dependence on it was total. Community share cards exist only as third-party extensions (GGShare copies a per-round emoji summary and link) ([Firefox add-ons](https://addons.mozilla.org/uk/firefox/addon/ggshare/)), a gap Junkyard Draft already fills natively.

### 2.4 Chess.com and Lichess

Chess.com free (Basic) accounts get three rated puzzles a day plus one Puzzle Rush and one Puzzle Battle; Premium is unlimited ([Chess.com support](https://support.chess.com/en/articles/8608686-how-do-puzzles-work-on-chess-com); [Premium plans](https://support.chess.com/en/articles/8562418)). Puzzle Rush: 3-minute, 5-minute or Survival, three strikes and out, does not touch your puzzle rating; it has Friends and Personal tabs ([Chess.com news](https://www.chess.com/news/view/new-puzzle-rush-chess)). Puzzle Battle is "a 3-minute puzzle rush, but played against another player," with its own rating, season points for every match win or lose, and standings sortable global/friends and season/daily/hourly ([Chess.com support](https://support.chess.com/en/articles/8708930-what-is-puzzle-battle-on-chess-com)). Lichess's Puzzle Storm is the free equivalent (3 minutes, time added and subtracted) and Puzzle Racer is the live multi-player race ([Lichess team page](https://bn.lichess.org/team/puzzle-storm-on-lichess); the lichess.org blog refused the fetch).

Transferable design: (1) the *daily puzzle* is the shared object, the *rush* is the repeatable session and the *battle* is the social wrapper on the same content; (2) a separate rating for the fast mode protects the "serious" rating; (3) hourly/daily/season standings give a newcomer a board they can top. Chess.com's gating of the daily *count* (3 puzzles) is the free-vs-paid lever; Junkyard Draft's analogue is attempts or seeds, not the daily itself.

### 2.5 Trackmania: Track of the Day and Cup of the Day

Track of the Day (TOTD) is a Nadeo-curated community map released daily at 19:00 CE(S)T with its own 24-hour leaderboard; access requires Standard or Club ([Trackmania docs](https://doc.trackmania.com/play/what-is-totd/)). Cup of the Day runs three times a day on the TOTD and requires Club Access: a 15-minute Time Attack qualifier (10 minutes to finish, 5 to improve), then players are sorted into divisions of 64 by qualifying time and race knockout rounds (a warm-up round, then eliminations of 4, 2 and 1 per round as the field shrinks) ([Trackmania docs](https://doc.trackmania.com/play/how-to-play-cotd/); [Dot Esports](https://dotesports.com/general/news/how-to-play-cup-of-the-day-mode-in-trackmania)). Community estimates put daily COTD participation at ~2,200–3,500 players, i.e. roughly 35–55 divisions ([ReedyBear](https://reedybear.bearblog.dev/a-love-letter-to-trackmania/); [Steam forum](https://steamcommunity.com/app/2225070/discussions/0/3770110414846511139/)). Trophies, not leaderboard position, are the persistent reward: nine trophy tiers each worth 10× the one below, never lost, summed into a world rank with ten categories ([Trackmania news](https://www.trackmania.com/news/1020?lang=en)); TOTD leaderboards close and award trophies by final placement. Zone leaderboards (county → region → country → world) descend from the ManiaZone system ([Wikipedia, TM United](https://en.wikipedia.org/wiki/TrackMania_United)). A free COTD weekend was run once as a promotion ([Trackmania news](https://www.trackmania.com/news/6859?lang=en)); Nadeo added a Cup of the Week in January 2026 ([Trackmania blog](https://blog.trackmania.com/2026/01/26/cup-of-the-week/)).

**A "COTD" for a six-minute factory game.** Junkyard Draft's run is ~6 rounds × 80 ticks, well under COTD's 15-minute qualifier. A knockout needs synchronous presence that 10–300 daily players cannot supply at a fixed hour, so the transplant is asynchronous: (1) the daily is the qualifier; (2) at freeze, players are bucketed into "divisions" of 16–64 by score (same idea as COTD's division by qualifying time) and each division gets its own mini-board and medal, so a mid-table player tops *something*; (3) a weekly "cup" takes everyone's best-of-N daily placements and ranks within division; (4) trophies that are never lost (like Trackmania's) rather than rank that decays. This preserves the knockout's "everyone has a bracket they belong to" without needing live servers.

### 2.6 Free web games that later went paid elsewhere

| Game | Web build | Paid build | What paid added | Outcome | Source |
|---|---|---|---|---|---|
| shapez.io | Free web + itch (May 2020); open source; 100–200 k MAU today | Steam $3.99 (Jun 2020) → $4.99 → $6.99 (Mar 2021) | Achievements, Wires update, Puzzle DLC ($62 k gross, 17 k units), cloud; later China partner | 138 k wishlists → 54 k purchases (39.9 %); web still drives 2.5–3 k Steam sales/month; itch ~$8 k total; "$1 M Steam hit" | [GameDiscoverCo](https://newsletter.gamediscover.co/p/deep-dive-how-shapezio-went-from) |
| Vampire Survivors | itch HTML5, Mar 2021, little engagement | Steam EA $2.99 (17 Dec 2021); $4.99 Sep 2022; 1.0 Oct 2022 | Content updates; web build frozen as "pretty much a demo" | Breakout after YouTubers, Jan 2022 | [Wikipedia](https://en.wikipedia.org/wiki/Vampire_Survivors); [itch page](https://poncle.itch.io/vampire-survivors) |
| Cookie Clicker | Free web, ~4 M DAU before Steam launch | Steam $4.99, 1 Sep 2021 | C418 soundtrack, Steam Cloud, browser-save import | >60 k concurrent at launch | [Wikipedia](https://en.wikipedia.org/wiki/Cookie_Clicker); [Gamespress](https://www.gamespress.com/Hit-Web-Game-Cookie-Clicker-Comes-to-Steam-on-September-1st-After-8-Ye) |
| A Dark Room | Free web, still free | Paid Steam | Packaging | Listed among browser→Steam successes | [Dinogame](https://dinogame.gg/blog/browser-games-that-became-steam-games/) |
| Krunker | Free web | Free Steam, 1 Feb 2021; reportedly pulled by 2024 | Daily challenges/badges came as general updates | Steam presence unclear | [Gamespress](https://gamespress.com/Cult-favourite-multiplayer-FPS-Krunker-launches-Season-5-update); [Steam forum](https://steamcommunity.com/app/1408720/discussions/0/4041482690812466335) |
| TETR.IO | Free web; Supporter sub via Xsolla; menu-only banner ads | **No Steam by choice** ("I don't use software distribution platforms like Steam") | — | 12 k → 46 k daily users in six months after ads; 0.03 % Patreon conversion | [osk blog](https://blog.osk.sh/post.php?p=643dbb578e1ba3.57021842); [ads post](https://blog.osk.sh/post.php?p=6099b8a61939d7.85346753) |

Kingdom of Loathing (free browser; West of Loathing is a separate paid Steam game) and Exapunks (Steam-only) are not web-to-Steam ports of the same game and are weak precedents **[inf.]**. What the paid build consistently adds: achievements, cloud/offline saves, soundtrack, DLC, a price that rises with content, and Steam's own discovery (New & Trending, Similar Games, Daily Deals doubled shapez's sales). What never works: paid ads for a sub-$10 game (shapez: 8,000 .io-ad clicks → 4 sales; YouTube ads $28 per sale) ([GameDiscoverCo](https://newsletter.gamediscover.co/p/deep-dive-how-shapezio-went-from)).

### 2.7 Daily runs in premium games

| Game | Daily format | Scoring | Attempts | Anti-cheat | Notes | Source |
|---|---|---|---|---|---|---|
| Mini Motorways | Same map + random modifiers, resets 00:00 GMT; weekly challenge; one Expert daily per week since May 2023 | Score (cars served) | **First attempt only** counts | Platform leaderboards (Game Center/Steam) | 1.48 M daily and 794 k weekly challenges played by Dec 2021; backend moved to a server-side challenge database so dailies can be fixed/added without a client patch | [DPC blog](https://dinopoloclub.com/2023/05/04/buckle-up-for-new-daily-challenges-with-the-extra-for-experts-update/); [Gamespress](https://gamespress.com/Best-Selling-Strategy-Sim-Mini-Motorways-Speeds-into-the-Holiday-Seaso); [wiki](https://minimotorways.miraheze.org/wiki/Daily_Challenge) |
| Spelunky HD/2 | Same seed, one run | Money + depth | One per day | None; S2 daily was broken at launch | Critics: top-8 names repeat only 7/52 times over a week, so the board rewards luck | [Spelunky wiki](https://spelunky.fandom.com/wiki/Daily_Challenge_Mode_(HD)); [Ludite](https://theludite.com/2014/06/23/spelunky-when-scoring-goes-bad/); [MobyGames](https://www.mobygames.com/game/150492/) |
| Slay the Spire | Same seed, 3 random modifiers | Additive points | One | None; boards "defunct" after 220 k+ modded scores | Winning a daily unlocks Custom Mode; StS2 beta switched to sort by win → badges → speed "instead of opaque score math" | [wiki](https://slay-the-spire.fandom.com/wiki/Score); [Steam forum](https://steamcommunity.com/app/646570/discussions/0/1743357605566110144); [sts2 patch](https://sts2.untapped.gg/en/articles/patch-v01030) |
| Dead Cells | Same level and loot, 4:30 timer | Score (not time) | Separate first-run board | — | Blueprints at 1st/5th/10th completion; needs mid-game unlock | [PC Gamer](https://pcgamer.com/dead-cells-adds-daily-challenge-mode); [wiki](https://deadcells.fandom.com/wiki/Daily_Run?oldid=5902) |
| NecroDancer | Daily + weekly (since 4.0) | Depth/score | One | **Full replay and cause of death next to every entry** | Cross-platform replays | [Brace Yourself](https://braceyourselfgames.com/crypt-of-the-necrodancer/updates) |
| Balatro | Seeded runs exist; daily promised in AMA; 1.1 slipped to 2026 | — | — | — | Community uses speedrun.com set-seed categories meanwhile | [Siliconera](https://www.siliconera.com/balatro-daily-challenge-mode-will-appear-in-future-update/); [Notebookcheck](https://www.notebookcheck.org/La-primera-gran-actualizacion-1-1-de-Balatro-se-acerca-segun-insinua-el-desarrollador-en-sus-entradas-de-blog-sobre-nuevos-contenidos.1397705.0.html); [speedrun.com](https://www.speedrun.com/Balatro_Category_Extensions) |

Isaac and Desktop Dungeons dailies were not confirmed by any primary source in this pass **[unverified]**. No publisher discloses how many players a daily retains. The transferable facts: (1) "first attempt counts" is standard and defensible; (2) opaque additive scores invite both cheating and resentment, so StS2 moved to lexicographic sorting; (3) replays attached to entries are the only anti-cheat that also entertains; (4) server-side challenge definitions pay off operationally; (5) small unlock rewards for the 1st/5th/10th daily (Dead Cells) are a gentle streak substitute.

### 2.8 Indie daily web games 2022–2026

| Game | Creator / owner | Monetisation | Scale | Fate | Source |
|---|---|---|---|---|---|
| Waffle | Waffle Studio (~10 people), UK | Ads only; declined an acquisition offer three times (2022) | ~475 k DAU, stable | Alive; Miniclip has a soft-launched clone | [mobilegamer.biz](https://mobilegamer.biz/daily-word-game-studio-waffle-is-the-latest-small-dev-to-find-a-big-audience/) |
| Immaculate Grid | Brian Minter → Sports Reference (Jul 2023) | Owner's site traffic | 100 k daily plays by Jun 2023; >200 k later | Acquired, integrated | [Sports Reference](https://www.sports-reference.com/blog/2023/07/sports-reference-acquires-immaculate-grid/); [Lindy's](https://lindyssports.com/other-sports/how-i-play-immaculate-grid-the-wordle-for-sports-nerds) |
| Bandle | Johann Levy | Ads; full-time since end 2024 | ~100 k daily players | Alive | [Berklee](https://online.berklee.edu/takenote/bandle-creator-johann-levy-on-the-music-quiz-100k-daily-players-love/) |
| Globle / Trainwreck Labs | Abe Train | Ads via NitroPay + **Trainwreck Club $5/month** (ad-free, multiplayer modes, all games) | "100,000+ daily players" (self-reported) | Alive, multi-game network | [hey.gg](https://hey.gg/blog/trainwrecklabs); [Trainwreck Club](https://trainwrecklabs.com/trainwreck-club); [Nitro](https://blog.nitropay.com/publisher-showcase-trainwreck-labs/) |
| Worldle / Teuteuf | Antoine Teuf → Teuteuf Games | Ads + Premium (archive access) | — | Alive, geography network | [Worldle FAQ](https://worldle.teuteuf.fr/faq) |
| Squaredle | Michael Giuffrida | Ko-fi tips + "Squaredle Squared" ($1.99/mo, $4.99/qtr, $9.99/yr): archive, extra weekly puzzle, ad-free, leaderboards, sync | — | Alive | [Help centre](https://help.squaredle.app/support/solutions/articles/151000129729-what-are-the-benefits-of-squaredle-squared-); [App Store](https://apps.apple.com/app/id6748396327); [Ko-fi](https://ko-fi.com/squaredle) |
| Framed | anonymous | Ko-fi link | — | Alive | [NME](https://www.nme.com/news/wordle-spin-off-framed-asks-cinema-fans-to-guess-films-from-still-images-3189472) |
| Heardle | → Spotify (Jul 2022) | None | — | **Shut down 5 May 2023**, visits shrinking | [TechCrunch](https://techcrunch.com/2023/04/14/spotify-is-shutting-down-heardle-the-wordle-like-music-guessing-game-it-bought-last-year) |
| Semantle | David Turner | — | — | Alive | [Wikipedia](https://en.wikipedia.org/wiki/Semantle) |
| Hexcodle, Costcodle, Rankdle, Travle, Timeguessr | small teams | Timeguessr has an app; others unconfirmed | — | **[unverified]** | [Creative Bloq](https://www.creativebloq.com/news/hexcodle-wordle-colour-game) |

Why most faded **[inf. from the above]**: a single mechanic with no second object to talk about; dependence on a platform owner (Heardle); ads that require six-figure DAU to pay rent (one guide's $0.50–2 CPM claim is **[unverified]** but consistent with osk's "not yet six digits" at 600–750 k impressions/day); and no reason to return once the novelty of the *theme* passed. The survivors either own a traffic source (Sports Reference), run a *network* of dailies under one account and one subscription (Trainwreck, Teuteuf), or sell a cheap membership whose perks are archive, sync and ad-free (Squaredle).

---

## 3. Business models for a free web game with a premium desktop sibling

**Ads.** Portals: Poki keeps 100 % of revenue from players the developer brings and splits traffic Poki sends ([Playgama](https://playgama.com/blog/business-faqs/poki-vs-crazygames-vs-gamedistribution-revenue-share/)); CrazyGames' only published figures are jam terms of 60 % ad / 70 % IAP to the developer ([Cinevva](https://app.cinevva.com/guides/publish-game-crazygames)); the one developer datapoint is ~€1.20 per 1,000 plays (2018-era) ([Bountyboard](https://www.bountyboard.gg/blog/how-to-monetize-an-html5-game)). **Restrictions that matter for Junkyard Draft:** Poki blocks external requests by default, allows leaderboards as an exception, forbids email/Google/Facebook login (username+password only, profanity-filtered, no personal data), blocks Google Analytics, and permits only its own ads ([Poki SDK external resources](https://sdk.poki.com/external-resources); [requirements](https://sdk.poki.com/requirements.html)). CrazyGames requires removing external login and logout while on CrazyGames and only its SDK ads ([CrazyGames docs](https://docs.crazygames.com/requirements/intro/)). A verifier call, a Discord webhook and a device-token identity are all "external requests"; a portal build would need a stripped mode. Direct ads (AdinPlay, NitroPay) on your own domain avoid the rules but need the impressions TETR.IO had.

**Subscriptions / memberships.** Observed price points: $3.99/mo or $39.99/yr (Puzzmo Plus; NYT Games ~$5.99/$39.99), $5/mo (Trainwreck Club), $1.99/mo or $9.99/yr (Squaredle Squared), $4.99–10.99/mo (GeoGuessr). Observed perks that do not touch fairness: archive, ad-free, statistics, sync across devices, groups/leaderboards, extra weekly puzzle, two-player, experimental games, cosmetics. Observed conversion: 24 % of Wordle players *say* they would pay something (8 % $1–3, 10 % $4–6, 3 % $7+) ([YouGov](https://yougov.com/en-us/articles/41128-wordle-willingness-to-pay-poll)); TETR.IO's actual voluntary conversion was 0.03 % via Patreon before in-game checkout ([osk](https://blog.osk.sh/post.php?p=6099b8a61939d7.85346753)); NYT's >1 M subscribers against >10 M daily players is ~10 % but includes the crossword's century-old audience **[inf.]**. Plan for 1–3 % of *engaged* (D30-retained) players, not of visitors **[inf.]**.

**Donations and PWYW.** Ko-fi: 0 % on tips, 5 % default on memberships/shop ([Cartmango](https://cartmango.com/patreon-vs-ko-fi/)); Patreon: single plan at 10 % for creators joining from August 2025, ~12–15 % all-in ([Schoolmaker](https://schoolmaker.com/blog/patreon-pricing)); itch.io: developer sets the cut, 10 % default ([itch post](https://itch.io/post/12681249)). shapez's itch total was ~$8 k against a seven-figure Steam total ([GameDiscoverCo](https://newsletter.gamediscover.co/p/deep-dive-how-shapezio-went-from)).

**Steam.** 30 % to $10 M lifetime, 25 % to $50 M, 20 % beyond, per game, plus the $100 app fee ([TechCrunch](https://techcrunch.com/?p=1753729); [Steam forum copy of the announcement](https://steamcommunity.com/discussions/forum/1/2865910087352094298)). Steam is also a merchant of record: VAT, sales tax and refunds are handled.

**Payments and VAT for a solo developer.** Paddle and Lemon Squeezy (now a Stripe company) both act as merchant of record at 5 % + $0.50 ([Dodo](https://dodopayments.com/blogs/paddle-vs-lemon-squeezy/)); raw Stripe is 2.9 % + $0.30 but leaves you the merchant of record for VAT/OSS filings ([Fungies](https://fungies.io/paddle-vs-lemon-squeezy)). Ko-fi and Patreon handle VAT on memberships. For a US-based solo developer the lowest-friction stack is Steam (desktop) + Ko-fi or Lemon Squeezy (web supporter) **[inf.]**.

**Compatibility with "no pay-to-win, same seed for everyone".** Everything in the perk list above passes except: paid extra attempts on the ranked daily, paid hints that change the ranked outcome, and paid-only seeds that feed the main board. Puzzmo's approach (pay for *social* and *archive*, never for the daily) and TETR.IO's (cosmetics earned by play, optionally bought for convenience, "nothing required") are the two templates that fit.

---

## 4. Community and creator loops

**Share-image design.** Wordle's grid works because it is spoiler-free, legible as text, and shows *process* (six rows) not just outcome; Connections shares four coloured rows; GeoGuessr's community card shows per-round emoji plus total and a link; Steam Replay is a once-a-year image card. 25 % of US Wordle players share every time or most times, 42 % never ([YouGov](https://yougov.com/en-us/articles/41128-wordle-willingness-to-pay-poll)); 35 % of UK players have posted at least once, 12 % daily ([YouGov UK](https://yougov.com/en-gb/articles/40799-wordle-starter-words-hard-mode-and-x6-how-are-brit)). Wardle's grid did not even link back; Junkyard Draft's should carry the "beat this" link, which GGShare users bolt on by hand.

**Friend leagues vs groups.** Duolingo leagues: cohorts of 30, weekly, ten tiers, promotion from 67 % (Bronze) down to 17 % (Obsidian), demotion for the bottom slice, deliberately powered by loss aversion and notifications like "You're out of the top 5" ([Deconstructor of Fun](https://duolingo.deconstructoroffun.com/mechanics/leagues)); academic work documents "gamification misuse" and pressure in its forums ([arXiv](https://arxiv.org/pdf/2203.16175)). Puzzmo groups are opt-in, self-selected, paid, and about collective stats rather than demotion. Chess.com's Friends tab on Puzzle Rush is the lightest version. For 10–300 daily players, random-cohort leagues cannot even fill cohorts; opt-in groups by code (already built) are the correct unit.

**Discord and Reddit.** Guidance for small game servers converges on: start with announcements, general, feedback/bugs, screenshots; add channels only as the community grows because empty channels kill conversation; role-gate a spoiler channel; use `||spoiler||` syntax ([Bugnet](https://bugnet.io/blog/how-to-set-up-a-discord-server-for-your-game); [GameAnalytics](https://www.gameanalytics.com/blog/building-discord-community)). shapez built its Discord from the free web build before Steam launch ([GameDiscoverCo](https://newsletter.gamediscover.co/p/deep-dive-how-shapezio-went-from)). For a daily game the natural structure is one auto-posted daily thread (the webhook already exists) that unlocks after the 48-hour window, plus a permanent spoiler-free "share grid" channel.

**Streamers.** Growth for GeoGuessr (Rainbolt), Vampire Survivors (YouTubers in January 2022) and shapez (Giantwaffle, KatherineOfSky, a 1.25 M-view DangerouslyFunny video) came from creators who already played an adjacent genre; shapez's pitch was "Zen Mode Factorio" and outreach was 500–1,000 emails ([GameDiscoverCo](https://newsletter.gamediscover.co/p/deep-dive-how-shapezio-went-from)). The daily format gives creators a repeatable segment ("race the daily") and the challenge link gives viewers a call to action.

**Notifications and email.** Nothing ethical and effective is documented for small dailies beyond opt-in digests; Duolingo's model is the anti-pattern. A weekly opt-in email with your histogram position, your group's results and next week's weekly seed is the defensible version **[inf.]**.

---

## 5. Retention and engagement benchmarks

No publisher publishes daily-game retention. Available proxies:

| Benchmark | Value | Source / quality |
|---|---|---|
| Mobile puzzle D1/D7/D30 | ~32 % / 12 % / 5 % (Segwise); 30–40 / 10–20 / 3–7 % (Playio); median 35 / 14 / 6 % (GameInsights) | Vendor blogs **[est.]** ([Segwise](https://segwise.ai/blog/mobile-gaming-app-user-retention-strategies); [Playio](https://blog.playio.co/d1-d7-d30-retention-benchmarks-2026); [GameInsights](https://www.gameinsights.ai/tools/retention-benchmarks)) |
| Top-50 mobile puzzle (AppMagic) | D1 42.8 %, D7 25.0 %, D30 15.7 % | Skewed to giants ([Gamigion](https://www.gamigion.com/benchmarks-from-the-top-50-mobile-puzzle-games/)) |
| Wordle play frequency | 57 % every day, 25 % most days, 18 % less | [YouGov](https://yougov.com/en-us/articles/41128-wordle-willingness-to-pay-poll) |
| Wordle time of day | 57 % done by noon; 11 % at/just after midnight | same |
| NYT Games DAU vs daily players | 2.6 M app DAU (2023) vs >10 M daily players (2024) across platforms | [Wikipedia](https://en.wikipedia.org/wiki/The_New_York_Times_Games) |
| Streak fragility | one puzzle ended 5.6 M streaks (2024) | [AP/AOL](https://www.aol.com/exclusive-wordle-puzzle-ended-5-013624721.html) |
| Waffle DAU stability | ~475 k DAU, flat for years, ads only | [mobilegamer.biz](https://mobilegamer.biz/daily-word-game-studio-waffle-is-the-latest-small-dev-to-find-a-big-audience/) |
| TETR.IO | daily users 12 k → 46 k in six months; CTR 0.2 ‰ | [osk](https://blog.osk.sh/post.php?p=6099b8a61939d7.85346753) |
| shapez web→Steam | 100–200 k MAU → 2.5–3 k sales/mo (≈1.5–3 % of MAU per month **[inf.]**) | [GameDiscoverCo](https://newsletter.gamediscover.co/p/deep-dive-how-shapezio-went-from) |

Streak distributions are not published anywhere; the 5.6 M broken streaks on one day imply tens of millions of live streaks and hence that *streak protection* is the emotional centre of the product **[inf.]**, which Junkyard Draft's grace rule addresses.

---

## 6. Asynchronous competitive formats at 10–300 daily players

Formats proven elsewhere and safe at small populations:

- **Ghosts.** Ghosts are "a form of highscore list that contains the whole game session instead of only the score" ([Game Design Patterns](https://tecfa.unige.ch/tecfa/maltt/VIP/Ressources/Articles/Game%20Design%20Patterns/collection/Alphabetical_Patterns/Ghosts.htm)); Phantom Abyss shows previous players' attempts in the same temple ([Screenhub](https://www.screenhub.com.au/2021/07/30/phantom-abyss-is-a-social-game-without-the-scheduling-nightmare/)). Junkyard Draft's replay watching is a ghost; a side-by-side "ghost build" overlay of the par bot or a chosen friend is the natural extension.
- **Histogram + percentile + par.** Puzzmo shows percentile after every solve; Trackmania shows medals (bronze/silver/gold/author) that are fixed targets independent of population; Chess.com's Puzzle Rush "Personal" tab. A par set by a bot is Junkyard Draft's "author medal".
- **Beat yesterday's you.** Adrian Hon's remedy for leaderboard gloom: "focusing on personal trends" and celebrating personal bests ([Adrian Hon](https://adrianhon.substack.com/p/puzzmo)).
- **Group boards.** Puzzmo groups; Chess.com Friends tabs; Mini Motorways' platform friends boards.
- **Weekly ladders without demotion.** Trackmania trophies accumulate and are never lost; Chess.com Puzzle Battle awards season points win or lose.
- **Division by score at freeze** (COTD's division-of-64 idea, asynchronous).
- **Tournaments by bracket of seeds.** GeoGuessr added a Tournaments mode in October 2026 ([Wikipedia](https://en.wikipedia.org/wiki/GeoGuessr)); NecroDancer and Mini Motorways both run a weekly alongside the daily.

Formats that fail at small populations: random-cohort leagues (cannot fill), live knockouts at fixed hours, global rank as the headline number (Spelunky's top-8 churn shows it measures luck), and opaque additive scores (StS).

---

## 7. Synthesis for Junkyard Draft

### 7.1 The growth loop, step by step

1. **Land on the daily with zero friction** (Wardle: website not app; GeoGuessr: the daily is the only free object). The URL is the product; no sign-up before the first run. *Precedent: Wordle, GeoGuessr free tier.*
2. **End the run on a result card that answers "how did I do?" without a leaderboard**: histogram position, percentile, par delta, personal-best delta, medal. *Precedent: Puzzmo percentile graphs, Trackmania medals; the anti-pattern is "bottom 20 %".*
3. **One-tap share of the spoiler-free grid with a "beat this" link embedded** (fix Wardle's "didn't link back"). *Precedent: Wordle grid + GGShare's link; Connections emoji.*
4. **The link lands the newcomer on the same seed with the challenger's ghost/replay available after they finish.** *Precedent: GeoGuessr challenge links, NecroDancer replays, Phantom Abyss ghosts.*
5. **Nudge into a group by code at the second visit**, not the first. *Precedent: Puzzmo groups (paid), Chess.com friends tabs.*
6. **Weekly seed + Discord daily thread give the group a reason to talk after the 48-hour freeze.** *Precedent: NecroDancer weekly, Mini Motorways weekly, Trackmania Cup of the Week.*
7. **Creators get a repeatable segment** ("race today's junkyard", challenge link in the title) and a clip export; outreach to factory-game creators with a one-line pitch ("a six-minute Factorio daily"). *Precedent: shapez's "Zen Mode Factorio", 500–1,000 emails.*
8. **The web build is the demo; Steam is the collector's edition** with achievements, cloud/offline, soundtrack, archive and a sandbox. *Precedent: shapez, Cookie Clicker, Vampire Survivors.*

### 7.2 Ten most transplantable features, ranked by evidence

| # | Feature | Evidence strength | Precedent |
|---|---|---|---|
| 1 | Spoiler-free share grid that carries the challenge link | Strong (Wordle growth; YouGov share rates; GGShare demand) | Wordle, Connections, GGShare |
| 2 | Replay attached to every verified entry, watchable from the board | Strong (StS boards died, NecroDancer's lived) | NecroDancer, Phantom Abyss |
| 3 | Percentile + par + personal-best card instead of rank as headline | Strong qualitative (Hon; Spelunky luck critique) | Puzzmo, Trackmania medals |
| 4 | First attempt counts; later attempts are practice with separate stats | Strong convention | Mini Motorways, Spelunky, Dead Cells |
| 5 | Weekly seed with its own board and a never-lost trophy track | Medium (TM trophies, Puzzle Battle season points) | Trackmania, Chess.com, NecroDancer |
| 6 | Groups by code as the only "league"; no random cohorts, no demotion | Strong by contrast (Duolingo problems; Puzzmo groups) | Puzzmo, Chess.com Friends |
| 7 | Server-side daily/weekly definitions (modifiers, expert days) | Medium (DPC backend change; GeoGuessr tournaments) | Mini Motorways |
| 8 | Division-by-score mini-boards at freeze (asynchronous COTD) | Medium (COTD structure; 2–3.5 k players make ~50 divisions) | Trackmania COTD |
| 9 | Small unlock rewards at the 1st/5th/10th completed daily (cosmetic) | Medium | Dead Cells, TETR.IO cosmetics |
| 10 | Archive of past seeds as the first paid perk | Strong commercial convention | NYT, Puzzmo, Squaredle, Teuteuf |

### 7.3 Monetisation path for a solo developer with no budget

Phase A (now → 1.0): **free, no ads, Ko-fi tips** (0 % fee). Ads at 10–300 DAU would earn single-digit dollars a month on any published rate and would trip portal rules on external requests ([Poki](https://sdk.poki.com/external-resources)); portals are useful only for a stripped, no-verifier arcade build.

Phase B (1.0, web): **Supporter at $3.99/month or $29.99–39.99/year** via Ko-fi membership or Lemon Squeezy (merchant of record, 5 % + $0.50). Perks, all fairness-neutral: archive of past seeds with practice boards, cross-device sync of history, extended stats, a supporter badge and cosmetic machine skins, group size above the free cap, GIF/WebM export at higher resolution. Expected conversion **[inf. from TETR.IO 0.03 % voluntary, YouGov 24 % stated, 1–3 % of engaged users typical]**: at 300 DAU, 5–10 supporters, roughly $20–40/month. This is a signal, not an income.

Phase C (Steam, after 1.0): **$5.99–7.99 premium** with achievements, cloud saves, offline mode, soundtrack, the archive and a sandbox/puzzle mode, with the web daily still free and feeding it. shapez's ratio (100–200 k MAU → 2.5–3 k sales/month) implies roughly 1.5–3 % of monthly web users per month **[inf.]**; at 2,000 MAU that is 30–60 sales/month, ~$150–300 net after Steam's 30 % and refunds. Price can rise with content as shapez did ($3.99 → $6.99). DLC later (shapez's puzzle DLC: 17 k units, $62 k).

Avoid: paid attempts, paid hints on the ranked daily, paid-only seeds on the main board, archive-gating of *today's* result, and any portal deal that requires removing the verifier.

### 7.4 Community plan

- Discord: four channels at launch (announcements, general, bugs, grids), one role-gated spoiler channel per day opened by the webhook when the 48-hour window closes; add channels only when a channel is busy ([Bugnet](https://bugnet.io/blog/how-to-set-up-a-discord-server-for-your-game)).
- Reddit: post the weekly seed result in r/factorio-adjacent and r/WebGames the way shapez did (r/factorio gave 1,300 upvotes, r/WebGames 70) ([GameDiscoverCo](https://newsletter.gamediscover.co/p/deep-dive-how-shapezio-went-from)).
- Creators: a short list of factory/puzzle YouTubers, the "race the daily" format, challenge link in the description; one email each, no paid promotion.
- Groups: ship group codes to streamers' communities as their league.
- Name moderation and report flow already exist; publish the policy page (NYT and Puzzmo both rely on it).

### 7.5 Retention targets (proposed, derived)

Use D1/D7/D30 and a "daily completion rate" (completed dailies ÷ daily visitors) as the four KPIs. Targets: D1 ≥ 30 %, D7 ≥ 12 %, D30 ≥ 5 % (puzzle-genre medians from vendor data **[est.]**), completion ≥ 60 % (Wordle: 57 % play every day), share rate ≥ 15 % of completions (Wordle: 25 % share most times), group membership ≥ 20 % of D7-retained players **[inf.]**. Instrument first; the Control Room already records what it needs.

### 7.6 Pitfalls

- **Fading dailies**: single-mechanic clones fade; survive by adding a second shared object (weekly, expert day, modifiers) rather than more of the same (Connections, Strands, Mini Motorways Expert).
- **Archive paywalls that annoy**: NYT's August 2025 removal of free Mini/Tiles/Letter Boxed drew coverage; keep today's and the recent week free, sell the deep archive.
- **Streak anxiety**: 5.6 M streaks broken by one word; grace already exists, never add "streak freeze" purchases.
- **Leagues at low population**: cohorts cannot fill; use groups and divisions-by-score.
- **Leaderboard demoralisation**: lead with percentile and personal best; hide rank below the fold.
- **Opaque scores and cheating**: keep score additive and explained; attach replays; consider StS2-style lexicographic tie-breaks.
- **Portal restrictions**: Poki/CrazyGames forbid external requests, email login and third-party ads; the verifier, webhook and device token would all need a stripped mode.
- **Platform dependency**: Heardle died inside Spotify; GeoGuessr's EWC reversal shows a community can shut the product down in a day. Own the domain, the identity and the data.
- **Paid ads**: unprofitable for sub-$10 games (shapez's numbers); growth comes from creators, Reddit and search.

---

## 8. Source list (primary and near-primary first)

- NYT 8-K Q4 2025: https://www.sec.gov/Archives/edgar/data/71691/000007169126000008/pressrelease12312025.htm
- NYT Q2 2026 call transcript: https://www.fool.com/earnings/call-transcripts/2026/08/12/nyt-nyt-q2-2026-earnings-call-transcript/
- NYT Games 2025 plays: https://www.nbcchicago.com/entertainment/entertainment-news/hardest-wordle-connections-games-2025/3868912/
- NYT Games 2024 plays, streaks: https://www.aol.com/exclusive-wordle-puzzle-ended-5-013624721.html
- NYT Games Wikipedia (cited numbers): https://en.wikipedia.org/wiki/The_New_York_Times_Games
- Wordle growth and acquisition: https://whyy.org/npr-story/the-new-york-times-buys-wordle ; https://techcrunch.com/2022/05/04/wordle-new-york-times-user-growth
- Wordle archive paywall: https://techcrunch.com/2024/05/07/nyt-games-launches-a-wordle-archive-with-access-to-more-than-1000-past-puzzles/
- WordleBot paywall: https://www.tomsguide.com/opinion/happy-first-birthday-wordle-heres-5-ways-you-should-improve
- Wardle GDC 2022: https://www.pocketgamer.biz/gdc-josh-wardle-shares-his-incorrect-tips-for-wordles-success/ ; https://www.gamedeveloper.com/marketing/josh-wardle-reflects-on-the-the-unconventional-road-to-wordle-s-success
- Knight on the bundle: https://gamesbeat.com/how-the-new-york-times-is-expanding-into-puzzle-games-like-wordle/
- YouGov Wordle (US): https://yougov.com/en-us/articles/41128-wordle-willingness-to-pay-poll ; (UK) https://yougov.com/en-gb/articles/40799-wordle-starter-words-hard-mode-and-x6-how-are-brit
- Puzzmo: https://www.gamedeveloper.com/design/puzzmo-co-creator-zach-gage-on-building-newspaper-games-that-can-last-forever ; https://adrianhon.substack.com/p/puzzmo ; https://www.digitaltrends.com/gaming/puzzmo-announcement-zach-gage-interview/ ; https://www.techradar.com/gaming/zach-gage-is-letting-500-people-into-his-new-puzzle-app-each-day-but-theres-a-catch ; https://www.businesswire.com/news/home/20250326593738/en ; https://gist.github.com/orta/8d975a33a9be14ca0fba52c6aecfd454
- GeoGuessr: https://en.wikipedia.org/wiki/GeoGuessr ; https://www.tubefilter.com/2024/09/16/location-obsessed-creators-put-geoguessr-on-the-map/ ; https://pricetimeline.com/data/price/geoguessr ; https://eraguessr.ai/guides/why-geoguessr-is-not-free ; https://dealroom.co/companies/geoguessr/ ; https://esports.gg/news/esports/geoguessr-withdraws-event-from-esports-world-cup-after-backlash/ ; https://engadget.com/gaming/geoguessr-community-maps-go-dark-in-protest-of-ewc-ties-to-human-rights-abuses-221037118.html ; https://addons.mozilla.org/uk/firefox/addon/ggshare/
- Chess.com: https://support.chess.com/en/articles/8608686-how-do-puzzles-work-on-chess-com ; https://support.chess.com/en/articles/8708930-what-is-puzzle-battle-on-chess-com ; https://support.chess.com/en/articles/8562418 ; https://www.chess.com/news/view/new-puzzle-rush-chess ; Lichess https://bn.lichess.org/team/puzzle-storm-on-lichess
- Trackmania: https://doc.trackmania.com/play/what-is-totd/ ; https://doc.trackmania.com/play/how-to-play-cotd/ ; https://www.trackmania.com/news/1020?lang=en ; https://www.trackmania.com/news/6859?lang=en ; https://blog.trackmania.com/2026/01/26/cup-of-the-week/ ; https://reedybear.bearblog.dev/a-love-letter-to-trackmania/ ; https://dotesports.com/general/news/how-to-play-cup-of-the-day-mode-in-trackmania
- TETR.IO: https://blog.osk.sh/post.php?p=6099b8a61939d7.85346753 ; https://blog.osk.sh/post.php?p=643dbb578e1ba3.57021842 ; https://blog.osk.sh/post.php?p=60133c956e4c75.84579268
- shapez.io: https://newsletter.gamediscover.co/p/deep-dive-how-shapezio-went-from
- Vampire Survivors: https://en.wikipedia.org/wiki/Vampire_Survivors ; https://poncle.itch.io/vampire-survivors
- Cookie Clicker: https://en.wikipedia.org/wiki/Cookie_Clicker ; https://www.gamespress.com/Hit-Web-Game-Cookie-Clicker-Comes-to-Steam-on-September-1st-After-8-Ye
- Mini Motorways: https://dinopoloclub.com/2023/05/04/buckle-up-for-new-daily-challenges-with-the-extra-for-experts-update/ ; https://gamespress.com/Best-Selling-Strategy-Sim-Mini-Motorways-Speeds-into-the-Holiday-Seaso ; https://minimotorways.miraheze.org/wiki/Daily_Challenge
- Spelunky: https://spelunky.fandom.com/wiki/Daily_Challenge_Mode_(HD) ; https://theludite.com/2014/06/23/spelunky-when-scoring-goes-bad/
- Slay the Spire: https://slay-the-spire.fandom.com/wiki/Score ; https://sts2.untapped.gg/en/articles/patch-v01030
- Dead Cells: https://pcgamer.com/dead-cells-adds-daily-challenge-mode ; NecroDancer: https://braceyourselfgames.com/crypt-of-the-necrodancer/updates
- Balatro: https://www.siliconera.com/balatro-daily-challenge-mode-will-appear-in-future-update/
- Indie dailies: https://mobilegamer.biz/daily-word-game-studio-waffle-is-the-latest-small-dev-to-find-a-big-audience/ ; https://www.sports-reference.com/blog/2023/07/sports-reference-acquires-immaculate-grid/ ; https://online.berklee.edu/takenote/bandle-creator-johann-levy-on-the-music-quiz-100k-daily-players-love/ ; https://hey.gg/blog/trainwrecklabs ; https://trainwrecklabs.com/trainwreck-club ; https://worldle.teuteuf.fr/faq ; https://help.squaredle.app/support/solutions/articles/151000129729-what-are-the-benefits-of-squaredle-squared- ; https://techcrunch.com/2023/04/14/spotify-is-shutting-down-heardle-the-wordle-like-music-guessing-game-it-bought-last-year
- Portals and payments: https://sdk.poki.com/external-resources ; https://sdk.poki.com/requirements.html ; https://docs.crazygames.com/requirements/intro/ ; https://playgama.com/blog/business-faqs/poki-vs-crazygames-vs-gamedistribution-revenue-share/ ; https://dodopayments.com/blogs/paddle-vs-lemon-squeezy/ ; https://schoolmaker.com/blog/patreon-pricing ; https://cartmango.com/patreon-vs-ko-fi/ ; https://itch.io/post/12681249 ; https://techcrunch.com/?p=1753729
- Leagues and async design: https://duolingo.deconstructoroffun.com/mechanics/leagues ; https://arxiv.org/pdf/2203.16175 ; https://tecfa.unige.ch/tecfa/maltt/VIP/Ressources/Articles/Game%20Design%20Patterns/collection/Alphabetical_Patterns/Ghosts.htm ; https://www.screenhub.com.au/2021/07/30/phantom-abyss-is-a-social-game-without-the-scheduling-nightmare/ ; https://www.gamedeveloper.com/game-platforms/analysis-asynchronicity-in-game-design
- Retention benchmarks (vendor): https://segwise.ai/blog/mobile-gaming-app-user-retention-strategies ; https://blog.playio.co/d1-d7-d30-retention-benchmarks-2026 ; https://www.gamigion.com/benchmarks-from-the-top-50-mobile-puzzle-games/
- Discord guidance: https://bugnet.io/blog/how-to-set-up-a-discord-server-for-your-game ; https://www.gameanalytics.com/blog/building-discord-community
