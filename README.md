# Flag Quiz

A small static site of flag guessing games, where every puzzle is **derived
programmatically from one clean set of source flags** rather than authored by
hand. Show the player a distorted, abstracted or partial view of a flag; they
name the country.

Because every game mode is just a transform over the same 250 SVGs, adding a
new mode costs one function, not 250 pieces of content.

Status: **early** — flag assets and country data are in place, the site itself
is not built yet. See [Roadmap](#roadmap).

## Game modes

**Built from colour composition**

| Mode | What the player sees |
| --- | --- |
| **Colour pie** | A pie chart of the flag's colours, sized by how much of the flag each covers. No shapes, no layout — just the palette and its proportions. |
| **Palette bar** | The same data as a single stacked bar, which hides the "which slice is biggest" tell that a pie gives away. |
| **Wrong proportions** | The flag's real colours, but redistributed into even stripes. |

**Built from pixel transforms**

| Mode | What the player sees |
| --- | --- |
| **Inverted** | The flag with RGB values inverted. Red becomes cyan, white becomes black. Surprisingly hard, and instantly recognisable once it clicks. |
| **Zoomed** | A small crop blown up. Difficulty is a function of crop size and where it lands — a corner of a tricolour is near-impossible, a corner of a canton is a gift. |
| **Greyscale** | Layout intact, colour gone. Separates the flags you know by shape from the ones you know by colour. |
| **Blur reveal** | Starts heavily blurred and sharpens on a timer. Points decay as it gets easier. |
| **Silhouette** | The emblem only, flattened to a single colour on a plain field. Brutal, and great for the flags with coats of arms. |
| **Scrambled** | The flag cut into a grid and shuffled. |
| **One colour removed** | One colour knocked out to transparent. |
| **Single row** | One row of pixels, stretched vertically. Trivial for horizontal tricolours, very hard for anything else. |

**Comparison modes**

| Mode | What the player sees |
| --- | --- |
| **Odd one out** | Four flags, three share a property (a colour, a region, a layout); pick the outlier. |
| **More or less** | Two flags: which one is more red? |
| **Blend** | Two flags averaged together; name both. |

Each mode can be scored on a shared basis: time to answer, streak, and a
difficulty weight derived from the flag itself (see
[Difficulty](#difficulty-can-be-computed-too)).

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

A static site, deployed to GitHub Pages from the repository root. No backend,
no framework requirement, no runtime build.

```
assets/flags/4x3/*.svg   250 flags, generated
data/countries.json      250 country records, generated
data/sources.json        upstream package versions
scripts/build-flags.mjs  the generator
```

Everything the site needs is a static file that can be fetched and cached.
The transforms run client-side on a `<canvas>`, except colour analysis, which
is precomputed because it needs a rasteriser.

## Roadmap

- [x] Source clean flag images for every country
- [x] Country dataset with names, regions and sovereignty tiers
- [ ] Colour extraction into `data/flag-colors.json`
- [ ] Quiz engine: question generation, distractor selection, scoring
- [ ] First mode end to end (colour pie)
- [ ] Remaining pixel-transform modes
- [ ] GitHub Pages deploy
- [ ] Difficulty weighting and palette-collision distractors

## Licence

Project code: [MIT](LICENSE).

Flag SVGs are MIT licensed by lipis/flag-icons; the upstream licence is kept
at [`assets/flags/LICENSE-flag-icons`](assets/flags/LICENSE-flag-icons).
Country metadata is ODbL-1.0 from mledoze/countries.
