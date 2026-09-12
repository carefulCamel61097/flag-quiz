# Flag Quiz

### ▶ [Play it](https://carefulcamel61097.github.io/flag-quiz/)

A small static site of flag guessing games, where every puzzle is **derived
programmatically from one clean set of source flags** rather than authored by
hand. Show the player a distorted, abstracted or partial view of a flag; they
name the country.

Because every game mode is just a transform over the same 250 SVGs, adding a
new mode costs one function, not 250 pieces of content.

Status: **playable** — three modes are live (Classic, Inverted, Colour Pie),
with free-text or multiple-choice answers. The other eighteen are listed as
planned. See [Roadmap](#roadmap).

## Game modes

Every mode is a transform over the same 250 SVGs, so the list below is ordered
by **build order**: mainly how likely a mode is to actually get played, and
secondarily how much work it is to make. Effort assumes the shared colour and
crop pipelines already exist.

### Ship these first

| # | Mode | What the player sees | Appeal | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Classic** | The flag, untouched. The quiz everyone expects to find, and the baseline every other mode is measured against. | High | Built |
| 2 | **Inverted** | The flag with RGB values inverted. Red becomes cyan, white becomes black. Surprisingly hard, and instantly recognisable once it clicks. | High | Built |
| 3 | **Zoomed** | A small crop blown up. The classic format, and the most immediately understandable. | High | Medium — needs the crop pipeline below |
| 4 | **Colour pie** | A pie chart of the flag's colours, sized by how much of the flag each covers. No shapes, no layout — just the palette and its proportions. | High | Built |
| 5 | **Low-res mosaic** | The flag downsampled to an N×M block grid. Difficulty is a single integer, which makes this the cleanest difficulty dial in the set and a natural progressive-reveal mode. | High | Low |
| 6 | **Blur reveal** | Starts heavily blurred and sharpens on a timer. Points decay as it gets easier. | High | Low |
| 7 | **Real or fake?** | A flag with one property subtly altered — stripe order swapped, a colour shifted 15° in hue, a star miscounted, band widths changed. Real or fake? | High | Low–medium |

Real or fake is the sleeper pick. It is endlessly generative from 250 source
flags, and it tests something no other mode does: precision of memory rather
than recognition. Worth building early even though it is not an obvious
headline feature.

### Strong follow-ups

| # | Mode | What the player sees | Appeal | Effort |
| --- | --- | --- | --- | --- |
| 8 | **Greyscale** | Layout intact, colour gone. Separates the flags you know by shape from the ones you know by colour. | Medium | Trivial |
| 9 | **Twin flags** | Chad and Romania side by side, or Indonesia and Monaco. Which is which? | Medium–high | Low, once palette-collision data exists |
| 10 | **Silhouette** | The emblem only, flattened to one colour on a plain field. Brutal, and great for the flags with coats of arms. | Medium | Medium — needs emblem isolation |
| 11 | **Scrambled** | The flag cut into a grid and shuffled. | Medium | Low |
| 12 | **Palette bar** | The colour-pie data as a stacked bar, which hides the "which slice is biggest" tell a pie gives away. | Medium | Trivial — the data and the twin handling already exist |
| 13 | **Polar** | The flag remapped into polar coordinates so it becomes a disc. Horizontal tricolours turn into concentric rings, vertical ones into wedges. Visually striking and it defamiliarises flags you would otherwise know instantly. | Medium | Low — about ten lines of canvas maths |

### Long tail and variations

Cheap to add once the pipelines exist, each worth having as a rotating
curiosity rather than a headline mode.

| Mode | What the player sees | Effort |
| --- | --- | --- |
| **Hue rotate** | Hue turned 180° but luminance preserved — a different puzzle from inversion. | Trivial |
| **Swatches only** | The flag's colours as unordered squares, proportions stripped out. | Trivial |
| **One colour removed** | One colour knocked out to transparent. | Low |
| **Single row** | One row of pixels stretched vertically. Trivial for horizontal tricolours, very hard for anything else. | Trivial |
| **Mirror / rotate** | Flipped or turned 90°. Weakened by how many flags are symmetric. | Trivial |
| **More or less** | Two flags: which one is more red? | Low |
| **Odd one out** | Four flags, three share a property; pick the outlier. | Medium |
| **Blend** | Two flags averaged together; name both. | Low |
| **Difference** | Flag A minus flag B as a difference image. | Low |
| **Hex hunt** | Which country's flag contains `#ae1c28`? | Low |
| **Rank by redness** | Order five flags by how much red they contain. | Low |
| **Wrong proportions** | The flag's real colours redistributed into even stripes. | Medium |
| **Wireframe** | SVG paths stroked rather than filled. | Medium |

Each mode can be scored on a shared basis: time to answer, streak, and a
difficulty weight derived from the flag itself (see
[Difficulty](#difficulty-can-be-computed-too)).

**Not possible with this dataset:** a "guess the real proportions" mode.
`flag-icons` normalises every flag to 4:3 and discards the official ratios,
so that would need a separate data source.

## Source data

Both inputs are pinned npm packages, vendored into the repo at build time, so
the published site needs no network calls and no build step of its own.

| What | Source | Licence |
| --- | --- | --- |
| Flag SVGs | [lipis/flag-icons](https://github.com/lipis/flag-icons) `7.5.0` | MIT |
| Country names, capitals, regions, UN membership | [mledoze/countries](https://github.com/mledoze/countries) (`world-countries` `5.1.0`) | ODbL-1.0 |
| Country prominence | English Wikipedia pageviews + World Bank population | CC BY-SA / CC BY |

`flag-icons` was chosen over the alternatives because it is curated for
consistency rather than scraped: every flag is a clean SVG on a uniform
`0 0 640 480` viewBox, named by lowercase ISO 3166-1 alpha-2 code. That
uniformity is what makes the transforms above trivial — no per-flag special
casing for size or aspect ratio.

### What's in the set

250 flags, classified in [`data/countries.json`](data/countries.json) by a
`sovereignty` field so each quiz can pick its own scope:

| `sovereignty` | Count | |
| --- | --- | --- |
| `un-member` | 193 | The default "countries of the world" set |
| `observer-state` | 2 | Vatican City, Palestine |
| `partially-recognised` | 2 | Taiwan, Kosovo |
| `territory` | 53 | Greenland, Puerto Rico, Hong Kong, … |

A record looks like this:

```json
{
  "code": "nl",
  "code3": "nld",
  "name": "Netherlands",
  "officialName": "Kingdom of the Netherlands",
  "altNames": ["Holland", "Nederland", "Pays-Bas", "…"],
  "capital": "Amsterdam",
  "region": "Europe",
  "subregion": "Western Europe",
  "sovereignty": "un-member",
  "flag": "assets/flags/4x3/nl.svg"
}
```

`altNames` carries official names, alternative spellings and translations, so
a free-text answer box can accept "Holland" or "Nederland" without a
hand-maintained synonym list.

### Regenerating

```bash
npm install
npm run build        # prominence, then flags and country data, then colours
```

[`scripts/build-flags.mjs`](scripts/build-flags.mjs) copies the 4:3 SVGs into
`assets/flags/4x3/` and writes `data/countries.json` and `data/sources.json`.
It is idempotent: it clears the output directory each run, so flags dropped
upstream do not linger. Bump the versions in `package.json` to pick up
upstream changes.

[`scripts/build-colors.mjs`](scripts/build-colors.mjs) then measures every
flag and writes `data/flag-colors.json`. It takes about two minutes, and needs
`@resvg/resvg-js` — a build-time dependency only, never shipped to the
browser.

[`scripts/build-fame.mjs`](scripts/build-fame.mjs) is the only script that
touches the network, and it skips itself when `data/fame.json` already exists.
Pass `--refresh` to re-fetch.

## How the colour analysis works

The colour modes need to know that the Netherlands is exactly one third
`#ae1c28`, one third `#ffffff` and one third `#21468b`. That is measured **at
build time** by [`scripts/build-colors.mjs`](scripts/build-colors.mjs), which
rasterises every flag with [resvg](https://github.com/yisibl/resvg-js),
counts pixels, and writes `data/flag-colors.json` (36 KB). The site only ever
loads the JSON.

It is accurate to about **0.03 percentage points**. Bangladesh's disc measures
26.15% against a true 26.18% derived from the SVG geometry; Japan's measures
22.74% against 22.77%.

Four things decide whether this works:

**Turn anti-aliasing off.** This matters more than anything else. Smoothed
edges invent colours that are not in the flag — blends sitting on the line
between two real ones — and on a striped flag there are enough edge pixels for
a blend to look like a real colour. The United States came out with a phantom
pink at 3.5%, which would have shown up as a genuine slice in the pie.
Rendering with `crispEdges` removes them at source: the US drops from 13
shades to exactly 3, Greece from 17 to 2. It also measures *better*, because a
hard edge lands on one side or the other with no bias.

**Seed clusters from coverage, not distance.** What survives anti-aliasing
removal is gradients and shading in coats of arms. Rather than merging colours
within some distance of each other, which risks fusing two genuinely similar
reds, only colours with real coverage become cluster centres and everything
else is assigned to its nearest one. An edge or shading pixel belongs there
anyway.

**Aspect ratio does not matter.** `flag-icons` normalises every flag to 4:3,
which is not the official ratio for most of them. Harmless: scaling x and y
independently multiplies every region's area by the same factor, so *relative*
proportions are preserved exactly.

**Nepal is not a rectangle.** Its SVG is 64% transparent around the pennant
shape. Transparent pixels are excluded, or Nepal would come out as mostly
"nothing". It is the only flag like this, and the one that silently breaks a
naive implementation.

One footgun worth recording: resvg's `image.pixels` is a getter that allocates
a fresh Buffer on every read. Touching it inside a per-pixel loop exhausts
memory within seconds.

## When a question has more than one right answer

Hiding a flag can hide the very thing that told it apart from another flag.
The quiz has to know when that has happened, or it marks fair answers wrong.
Two kinds of collision, both computed at build time:

**Identical flags.** Thirteen flags in three groups are byte-identical: every
French overseas territory flies the French tricolour, Heard Island flies
Australia's, Saint Helena flies the Union Jack. Shown the tricolour in the
"All 250 flags" scope, there are nine correct answers. `build-flags.mjs`
hashes the artwork and records `sameFlagAs` on each country. This affects
every mode, including the plain Classic quiz.

**Palette twins.** In a colour mode, Guinea and Mali make the same pie.
So do Belgium and Germany, Czechia and Slovakia, Chad and Romania, and
Indonesia with Monaco, Poland and Singapore. `build-colors.mjs` compares
every pair: same number of slices, and each slice matching one in the other by
both colour and size. 73 of 250 flags have at least one twin.

Slice *count* is part of that test, and it is what makes the metric work.
Earlier attempts — share-weighted colour distance, then earth-mover distance —
both called Japan and Tonga twins, because most of the mass matches at near
zero cost. But Japan is 77% white and Tonga is 76% red; the pies look nothing
alike. Matching slice-to-slice and taking the *worst* pair catches that.

What the quiz does with it:

- Any equivalent country is accepted as correct, and the player is told why:
  *"Also accepted — Germany makes the same pie as Belgium."* A question with
  two right answers should say so, not quietly pick one.
- No two equivalents are ever offered in the same multiple-choice question,
  so there is never a second correct option to pick from.

The same reasoning is what the [zoom crop pipeline](#how-the-zoom-crops-will-work)
will need, and this is the first place it has been built.

## How the zoom crops will work

A randomly placed crop has a failure mode that is worse than being too hard:
it can be **unanswerable**. A solid red square cropped from Japan is not a
difficult question, because that same crop appears in China, Turkey, Morocco,
Switzerland and roughly eighty others. There is no correct answer to give.

Difficulty and ambiguity are separate axes, and the second one is measurable
against the corpus. At build time:

1. Rasterise all 250 flags small (64×48 is enough).
2. Enumerate candidate crops on a sliding grid — a few hundred per flag,
   **at several sizes**, since crop size is itself a difficulty axis rather
   than a single value to commit to up front.
3. Give each crop a cheap signature: a downsampled colour vector, or a
   perceptual hash.
4. For each crop, count how many *other* flags contain a near-identical crop
   anywhere in them.

That collision count is the difficulty score:

| Collisions | Meaning | Use |
| --- | --- | --- |
| 0 | Unique in the world — the maple leaf, the Brazilian globe | Easy and medium tiers |
| 1–3 | Narrows it to a handful | Hard tier, **multiple choice only** |
| Many | A solid colour field carrying no information | Discard, never serve |

The payoff is a guarantee that every free-text question is solvable, which
random cropping cannot offer. The ambiguous middle tier is not wasted either:
a crop matching three flags is a fair multiple-choice question as long as the
distractors exclude the other two, and that is the hardest question type in
the whole game.

The thresholds here are guesses. Crop sizes, the similarity cutoff and the
tier boundaries all want tuning against real output before they are trusted.

### Future option: angled crops

Crops are axis-aligned to start with. Rotating the crop window by 45°, -45°,
90° or -90° before extracting would add a whole second difficulty dimension
at very little cost — the collision analysis is unchanged, it just runs over
a rotated sampling grid. Rotation is especially valuable against horizontal
tricolours, where an axis-aligned crop is often a flat band of one colour but
an angled one cuts across a boundary and carries real information.

## Which flags a quiz uses

Four selections, chosen on the home page before you start and carried into
every quiz. They are cumulative, so widening adds obscure flags rather than
swapping the familiar ones out:

| Selection | Flags | |
| --- | --- | --- |
| Best known | 60 | The countries that come up most. Nothing obscure. |
| A few obscure | 130 | Adds countries you may have to stop and think about. |
| Plenty obscure | 193 | Every UN member, down to Tuvalu, Nauru and Kiribati. |
| Obscure territories too | 250 | Adds Greenland, Hong Kong, Puerto Rico and the rest. |

The choice lives on the home page rather than only inside the quiz. Buried in
the play screen it was effectively invisible: a flag on screen takes all of
the attention, and a small dropdown below it takes none. Choosing before you
start is also the more natural order.

It stays pinned under the masthead as you scroll the quiz list, compressed to a
single row, so it reads as one setting governing everything below rather than
part of the intro. Worth knowing if you touch this: a sticky element only
sticks inside its own parent's box, so the bar is a direct child of the page.
Nested in the intro block it unpinned the moment the intro scrolled away.

Answers are graded against **every** country, not only the ones in the current
selection. An answer can be right without being in scope - in the 130-flag
selection, Indonesia's pie is also Monaco's, and Monaco is not in the pool -
and a guess that names a real country reads better as "That is Kiribati" than
as "not a country we recognised". Suggestions stay inside the selection, since
those are the flags the round can actually ask about.

### Not "Easy, Medium, Hard"

They are named for what they are. Difficulty is still unmeasured, and
labelling a set "Easy" would be the same invented claim the mode cards used to
make before the labels came out. What *is* measured is prominence, which is a
different thing: how much a country is in the world's attention, not how
recognisable its flag is.

### How prominence is measured

Two signals, blended 70/30, both on a log scale:

**English Wikipedia traffic**, median monthly views over twelve months.

**Population**, from the World Bank.

Both are **captured once and committed**, not fetched live.
[`scripts/build-fame.mjs`](scripts/build-fame.mjs) writes the snapshot to
`data/fame.json` and every other build reads it from there, so the site makes
no third-party requests, works offline, and cannot change ranking under you
because a country was in the news this week. Re-capture deliberately with
`npm run build:fame -- --refresh`. The snapshot records the period it covers
and the date it was taken.

Neither works alone, which is the whole reason for blending:

- On traffic alone, Mauritius and Monaco outranked Belgium and Greece. Looking
  a country up is driven by tourism, migration and news, not by familiarity.
- On population alone, Burkina Faso and Madagascar outranked Denmark and
  Ireland.

Log scale because both distributions are heavy-tailed: India has 200 times the
population of Iceland, but its flag is not 200 times better known. The 70/30
weighting was picked by scoring candidate weights against a checklist of flags
a general audience plausibly does and does not know, and taking the best.

Three things went wrong while building this, all worth remembering:

- **The median, not the total.** Summing twelve months lets one news month
  swamp a year: Cape Verde drew 3.8M views in a single month against a 150k
  baseline, which put it above the United Kingdom. The most recent month also
  comes back near zero because it is still being aggregated. The median is
  immune to both.
- **Redirects and disambiguation pages measure nothing.** Pageviews count the
  exact title asked for, so "Czechia" returns the traffic on a redirect stub
  rather than the article. Worse, "Georgia" is a disambiguation page: the
  country ranked dead last out of 193 until it was caught. The build now
  resolves redirects first and *fails* if any title is a disambiguation page.
- **Never swallow a fetch error.** The first run returned zero views for 73
  rate-limited countries and produced a ranking that looked entirely
  plausible. Silent zeros are worse than a crash. The build now retries, and
  refuses to write a ranking with holes in it.

The honest summary: this is the least bad *computable* stand-in. It is not
what the tiers should eventually be cut from - that is play data, below.

## Difficulty

There are no difficulty labels in the app. There were briefly — Easy, Medium,
Hard, Varies — and they were invented. Nobody had played the quizzes, so the
labels were guesses dressed up as information, and a wrong label is worse than
no label: it tells players a mode is beneath them, or scares them off one they
would have enjoyed.

Two honest sources of difficulty exist. One can be computed today. The other
has to be earned from real play.

### What can be computed

Most of what makes a flag easy or hard is measurable from the flag itself:

- **Colour count and entropy** — a three-colour tricolour carries far less
  information than a flag with a coat of arms.
- **Palette collisions** — how many *other* flags share nearly the same
  palette. Chad/Romania, Indonesia/Monaco and Ireland/Côte d'Ivoire are hard
  in the colour modes for reasons that fall straight out of the numbers.
- **Layout complexity** — SVG path count, or edge density in the raster, is a
  decent proxy.

The same collision data gives good distractors: in multiple choice, offering
the three flags with the most similar palettes is much harder than offering
three at random.

### What has to be measured

Computed difficulty only ever describes the image. It cannot know that people
confuse Chad with Romania but never with Yemen, or that an inverted Japan is
trivial while an inverted Ireland is not. That lives in what players actually
do.

Worth recording, once there is somewhere to put it:

| Field | Why |
| --- | --- |
| mode, flag code | The unit that matters is the **pair**, not the mode. "Zoomed" has no single difficulty; "Zoomed, Peru, crop 14" does. |
| correct | The raw signal. |
| time to answer | Separates *hard* from *unknown*. A slow correct answer and a fast wrong one are different states. |
| answer method | Typed answers are strictly harder than multiple choice, so the two cannot share a difficulty scale. |
| what was chosen or typed | The most valuable field, and the least obvious. |

The engine already timestamps every answer (`elapsedMs` on each result), so
the per-question timing exists in memory today. Nothing consumes it yet.

**Item difficulty, not just mode difficulty.** The interesting unit is one
flag inside one mode, sometimes one *crop* inside one mode. Aggregate p(correct)
per pair gives an empirical difficulty that can then order questions within a
round, calibrate the modes currently marked "Varies", and pick zoom crops at a
target difficulty rather than at a guessed threshold. With enough volume the
standard move is to separate item difficulty from player ability, so a hard
flag is not mistaken for a weak player.

**The confusion matrix is the real prize.** Recording *which* country a player
named instead of the right one builds an empirical map of which flags people
actually mix up. That is strictly better than the computed palette-collision
data planned for distractor selection, because it captures confusions that
have nothing to do with colour — shared history, similar names, neighbouring
countries. Computed collisions are the cold-start substitute; play data is the
real thing.

**The honest blocker:** this is a static site with no backend, so there is
nowhere to aggregate anything. Options, cheapest first: keep per-player stats
in `localStorage` (useful immediately, personal only, no aggregate); or add a
small endpoint on something free — a Cloudflare Worker with KV, or Supabase —
which stays compatible with GitHub Pages hosting. Anything collected from
other people needs a plain word about it in the interface first.

## Future option: combining transforms

Modes are single transforms today. They could stack: the colour pie drawn in
inverted colours, a zoomed crop of a greyscale flag, a blurred mosaic. Most of
these are close to free, since the pieces already exist.

Two things to get right first.

**Combinations must be a modifier, not new entries.** Twenty-one modes pair
into more than two hundred, and a registry listing all of them would bury the
site in exactly the clutter the current structure avoids. A stack belongs as a
toggle on a mode - a "twist" - so the hub still lists twenty-one things.

**Ambiguity does not compose automatically.** Each mode knows which countries
are indistinguishable under it, and stacking changes that:

- *Inversion preserves it exactly.* Inverting is a bijection on colours, so two
  identical palettes stay identical and two different ones stay different. An
  inverted pie has precisely the same twins as a normal pie - the existing data
  works unchanged.
- *Greyscale does not.* It collapses every colour of equal luminance onto one
  grey, so a greyscale pie has strictly more twins than a colour pie, and some
  flags that are currently distinguishable stop being so.

So a stack either inherits its ambiguity data, or needs its own computed.
Getting that wrong means marking fair answers wrong, which is the failure this
project has already had to fix twice.

## A note on cheating

Flags are served as `assets/flags/4x3/<iso-code>.svg`, so the answer is
visible in devtools or in a saved image's filename. For a casual quiz this is
fine. If it ever matters, serve the assets under content-hashed names and keep
the hash-to-country mapping out of the page until after the answer is given.

## Architecture

A static site, deployed to GitHub Pages from the repository root. Vanilla ES
modules, no framework, no bundler, no runtime build. Everything the site needs
is a static file that can be fetched and cached.

```
index.html                    shell
assets/css/style.css
assets/js/registry.js         what quizzes exist  <-- single source of truth
assets/js/engine.js           rounds, distractors, scoring (mode-agnostic)
assets/js/matching.js         free-text grading and type-ahead suggestions
assets/js/data.js             dataset loading and scopes
assets/js/app.js              hash router
assets/js/views/home.js       the hub
assets/js/views/quiz.js       the play screen (shared by every mode)
assets/flags/4x3/*.svg        250 flags, generated
data/countries.json           250 country records, generated
data/flag-colors.json         measured palettes and palette twins, generated
data/fame.json                Wikipedia and population snapshot, generated
data/sources.json             upstream package versions
scripts/build-fame.mjs        prominence snapshot (the only script that fetches)
scripts/build-flags.mjs       flags, country data, prominence ranking
scripts/build-colors.mjs      colour measurement and twin detection
scripts/serve.mjs             local dev server, no dependencies
```

### Answering

Two ways to answer, switchable mid-round and remembered between visits.

**Type it** (the default) grades knowledge, not spelling. "Kyrgystan",
"cote divoire" and "Holland" are all accepted; accents, case and punctuation
are folded away, and a typo within one or two edits of a real name still
counts. The tolerance scales with length and is zero at four characters,
because at that size one edit is usually a different country — Chad and Cuba,
Iran and Iraq, Mali and Malta.

Suggestions appear **after two characters**, never one. This is the line
between help and giving it away: one character would list a whole alphabetical
block and turn the box into a browsable index of every country, which is
exactly what a typed answer exists to avoid. Two characters means the player
has already recalled how the name starts, and everything after that is
spelling assistance. Aliases are searched too, so "cote" finds Ivory Coast and
"espana" finds Spain, but English names always rank first.

**Multiple choice** stays available for anyone who wants it, and is the easier
option on a phone. Its distractors come from the answer's own region, since
four unrelated flags make most questions trivial.

### On phones

The quiz is built to be played one-handed. Every control clears a 44px touch
target, the answer input is 16px so iOS does not zoom the page on focus, and
the flag is capped as a fraction of viewport height so it can never push the
input off-screen. Suggestions open **upward**, because the on-screen keyboard
covers everything below the input. Layout is verified at 390px wide and in
landscape, and neither the hub nor the play screen scrolls sideways.

### Keeping twenty-plus quizzes from turning into a mess

The risk with this many modes is a site that becomes an undifferentiated wall
of tiles. Three rules hold that off:

**One registry, everything derived.** [`registry.js`](assets/js/registry.js)
is the only place a mode is declared. The home page, the category navigation
and the router all read from it, so the site cannot list a quiz that does not
exist, or quietly miss one that does. There is no hand-maintained menu to
drift.

**Categories describe what the player sees, not how it is built.** Colour,
Detail, Distortion and Compare are distinctions you can feel while playing.
Grouping by implementation would file Inverted next to Colour Pie because both
touch colour data, which helps nobody.

**Unbuilt modes are visible but clearly marked.** Listing all twenty with
`Soon` badges keeps the eventual shape of the site honest, and makes the
ordering argument above checkable against what is actually playable.

Adding a mode is one registry entry plus, at most, one transform. Modes
expressible as a CSS filter (Inverted, Greyscale, Blur, Hue Shift) need no
code at all beyond that entry, and stay vector-crisp at any size.

### Running it locally

```bash
npm start        # http://localhost:4173
```

## Roadmap

- [x] Source clean flag images for every country
- [x] Country dataset with names, regions and sovereignty tiers
- [x] GitHub Pages deploy
- [x] Site shell: registry, categories, hash router
- [x] Quiz engine: rounds, region-matched distractors, scoring, results
- [x] Free-text answers with typo tolerance and type-ahead
- [x] Phone layout
- [x] Mode 1, classic
- [x] Mode 2, inverted
- [x] Colour extraction into `data/flag-colors.json`
- [x] Identical-flag and palette-twin detection, with twin-aware grading
- [x] Mode 4, colour pie
- [x] Prominence ranking, and four flag selections cut from it
- [ ] Crop analysis into `data/flag-crops.json`, thresholds tuned by eye
- [ ] Mode 3, zoomed
- [ ] Modes 5-7: low-res mosaic, blur reveal, real or fake
- [ ] Somewhere to store play data, then measured difficulty
- [ ] Difficulty weighting and palette-collision distractors
- [ ] Strong follow-ups (modes 7-12)
- [ ] Angled crops (45°, -45°, 90°, -90°)
- [ ] Combining transforms as a "twist" modifier

## Licence

Project code: [MIT](LICENSE).

Flag SVGs are MIT licensed by lipis/flag-icons; the upstream licence is kept
at [`assets/flags/LICENSE-flag-icons`](assets/flags/LICENSE-flag-icons).
Country metadata is ODbL-1.0 from mledoze/countries.
