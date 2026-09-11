# Flag Quiz

### ▶ [Play it](https://carefulcamel61097.github.io/flag-quiz/)

A small static site of flag guessing games, where every puzzle is **derived
programmatically from one clean set of source flags** rather than authored by
hand. Show the player a distorted, abstracted or partial view of a flag; they
name the country.

Because every game mode is just a transform over the same 250 SVGs, adding a
new mode costs one function, not 250 pieces of content.

Status: **playable** — the site is live with the first mode (Inverted). The
other nineteen are listed in the app as Soon. See [Roadmap](#roadmap).

## Game modes

Every mode is a transform over the same 250 SVGs, so the list below is ordered
by **build order**: mainly how likely a mode is to actually get played, and
secondarily how much work it is to make. Effort assumes the shared colour and
crop pipelines already exist.

### Ship these first

| # | Mode | What the player sees | Appeal | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Inverted** | The flag with RGB values inverted. Red becomes cyan, white becomes black. Surprisingly hard, and instantly recognisable once it clicks. | High | Trivial — one canvas pass or a CSS filter, nothing precomputed |
| 2 | **Zoomed** | A small crop blown up. The classic format, and the most immediately understandable. | High | Medium — needs the crop pipeline below |
| 3 | **Colour pie** | A pie chart of the flag's colours, sized by how much of the flag each covers. No shapes, no layout — just the palette and its proportions. | High | Medium — needs the colour pipeline below |
| 4 | **Low-res mosaic** | The flag downsampled to an N×M block grid. Difficulty is a single integer, which makes this the cleanest difficulty dial in the set and a natural progressive-reveal mode. | High | Low |
| 5 | **Blur reveal** | Starts heavily blurred and sharpens on a timer. Points decay as it gets easier. | High | Low |
| 6 | **Real or fake?** | A flag with one property subtly altered — stripe order swapped, a colour shifted 15° in hue, a star miscounted, band widths changed. Real or fake? | High | Low–medium |

Real or fake is the sleeper pick. It is endlessly generative from 250 source
flags, and it tests something no other mode does: precision of memory rather
than recognition. Worth building early even though it is not an obvious
headline feature.

### Strong follow-ups

| # | Mode | What the player sees | Appeal | Effort |
| --- | --- | --- | --- | --- |
| 7 | **Greyscale** | Layout intact, colour gone. Separates the flags you know by shape from the ones you know by colour. | Medium | Trivial |
| 8 | **Twin flags** | Chad and Romania side by side, or Indonesia and Monaco. Which is which? | Medium–high | Low, once palette-collision data exists |
| 9 | **Silhouette** | The emblem only, flattened to one colour on a plain field. Brutal, and great for the flags with coats of arms. | Medium | Medium — needs emblem isolation |
| 10 | **Scrambled** | The flag cut into a grid and shuffled. | Medium | Low |
| 11 | **Palette bar** | The colour-pie data as a stacked bar, which hides the "which slice is biggest" tell a pie gives away. | Medium | Trivial, once the pie exists |
| 12 | **Polar** | The flag remapped into polar coordinates so it becomes a disc. Horizontal tricolours turn into concentric rings, vertical ones into wedges. Visually striking and it defamiliarises flags you would otherwise know instantly. | Medium | Low — about ten lines of canvas maths |

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
npm run build:flags
```

[`scripts/build-flags.mjs`](scripts/build-flags.mjs) copies the 4:3 SVGs into
`assets/flags/4x3/` and writes `data/countries.json` and `data/sources.json`.
It is idempotent: it clears the output directory each run, so flags dropped
upstream do not linger. Bump the versions in `package.json` to pick up
upstream changes.

## How the colour analysis will work

The colour modes need to know that the Netherlands is 33% `#ae1c28`, 34%
`#ffffff`, 33% `#21468b`. That is computed **at build time**, not in the
browser:

1. Rasterise each SVG at a fixed size (a few hundred pixels wide is plenty —
   we want colour proportions, not detail).
2. Count pixels per colour.
3. Quantise. Anti-aliased edges and gradients produce thousands of
   near-identical colours; snap them to the nearest dominant colour so the
   Netherlands reports three colours, not four thousand.
4. Drop anything under a threshold (~0.5%), which removes stray edge pixels
   while keeping genuinely small details like a thin fimbriation.
5. Write the result to `data/flag-colors.json`.

Two details worth knowing before implementing this:

- **Aspect ratio does not matter.** `flag-icons` normalises every flag to 4:3,
  which is not the official ratio for most of them. This turns out to be
  harmless: scaling x and y independently multiplies every region's area by
  the same factor, so *relative* colour proportions are preserved exactly.
- **Nepal is not a rectangle.** Its SVG has a transparent background around
  the pennant shape. Transparent pixels must be excluded from the count, or
  Nepal comes out as mostly "nothing". It is the only flag with this
  property, but it is the one that will silently break a naive
  implementation.

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

## Difficulty can be computed too

Most of what makes a flag easy or hard is measurable from the same data, so
difficulty tiers need not be hand-assigned:

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
assets/js/data.js             dataset loading and scopes
assets/js/app.js              hash router
assets/js/views/home.js       the hub
assets/js/views/quiz.js       the play screen (shared by every mode)
assets/flags/4x3/*.svg        250 flags, generated
data/countries.json           250 country records, generated
data/sources.json             upstream package versions
scripts/build-flags.mjs       the generator
scripts/serve.mjs             local dev server, no dependencies
```

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
- [x] Mode 1, inverted
- [ ] Free-text answers with fuzzy matching against `altNames`
- [ ] Colour extraction into `data/flag-colors.json`
- [ ] Mode 3, colour pie
- [ ] Crop analysis into `data/flag-crops.json`, thresholds tuned by eye
- [ ] Mode 2, zoomed
- [ ] Modes 4-6: low-res mosaic, blur reveal, real or fake
- [ ] Difficulty weighting and palette-collision distractors
- [ ] Strong follow-ups (modes 7-12)
- [ ] Angled crops (45°, -45°, 90°, -90°)

## Licence

Project code: [MIT](LICENSE).

Flag SVGs are MIT licensed by lipis/flag-icons; the upstream licence is kept
at [`assets/flags/LICENSE-flag-icons`](assets/flags/LICENSE-flag-icons).
Country metadata is ODbL-1.0 from mledoze/countries.
