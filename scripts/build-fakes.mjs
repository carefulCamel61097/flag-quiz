/**
 * Picks the altered flags used by the Real or Fake quiz.
 *
 * The mode shows one flag and asks whether it is the genuine article. That
 * only works if a "fake" is genuinely wrong, and the two ways it can fail to
 * be are opposites:
 *
 *   - Too subtle. Mirroring Bangladesh moves its disc from just left of centre
 *     to just right of it. Nobody can answer that, and nobody learns anything.
 *   - Not fake at all. Mirroring Ireland produces the flag of Cote d'Ivoire;
 *     flipping Indonesia produces Poland. A player who answers "real" is right,
 *     and the reveal would be telling them a lie.
 *
 * So every candidate alteration is rendered and measured against two bars: it
 * has to differ from the flag it came from by more than MIN_CHANGE, and it must
 * not resemble *any* of the 250 real flags. What survives is a fair question
 * with a correct answer.
 *
 * Output: data/flag-fakes.json
 * Run with: npm run build:fakes
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseColour, svgColours, recolourSvg } from '../assets/js/svg-colour.js';
import { colourName } from '../assets/js/tells.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Working raster. Same as the crop build: enough detail, cheap to compare. */
const W = 160;
const H = 120;

/** The whole flag reduced to a grid of average colours, for comparisons. */
const GRID_X = 12;
const GRID_Y = 9;

/** Two candidates are the same picture when every cell is this close. */
const SAME = 75;

/**
 * How close an alteration may come to a real flag before the question stops
 * being fair. Much looser than SAME, and deliberately so.
 *
 * At 75 a mirrored Ireland was shipped as a fake, because Ireland's green
 * (#009a49) is not Cote d'Ivoire's green (#00cd00) and its orange is not their
 * orange. That measurement is correct and irrelevant: nobody holds the two
 * side by side, and a player who says "real, that is Cote d'Ivoire" is right.
 * 175 is roughly the width of a colour family - two greens match, green and
 * orange do not, blue and navy do not - which is the distinction a player
 * actually makes from memory.
 */
const CONFUSABLE = 175;

/**
 * How far an alteration must move the flag, averaged over every cell, before
 * it is worth asking about. Below this the change is real but invisible, which
 * makes for a coin toss dressed up as a question.
 */
const MIN_CHANGE = 34;

/** A colour is only worth swapping if there is enough of it to notice. */
const MIN_SWAP_SHARE = 0.08;

/** Swaps are drawn from the largest few colours, pairwise. */
const MAX_SWAP_COLOURS = 3;

/** Kept per flag. The quiz picks one at random each time it asks. */
const PER_FLAG = 4;

const crisp = 1; // resvg ShapeRendering.crispEdges

function distance(a, b) {
  const rMean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db
  );
}

function render(svg) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: W }, shapeRendering: crisp })
    .render()
    .pixels; // the getter allocates a fresh buffer: read it once
}

/** Average colour of each cell of a GRID_X x GRID_Y split of the whole flag. */
function signature(pixels) {
  const cells = [];
  for (let cy = 0; cy < GRID_Y; cy++) {
    for (let cx = 0; cx < GRID_X; cx++) {
      const sx = Math.floor((cx * W) / GRID_X);
      const ex = Math.floor(((cx + 1) * W) / GRID_X);
      const sy = Math.floor((cy * H) / GRID_Y);
      const ey = Math.floor(((cy + 1) * H) / GRID_Y);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = sy; y < ey; y++) {
        for (let x = sx; x < ex; x++) {
          const i = (y * W + x) * 4;
          // Transparent pixels are outside the flag (Nepal); treat as absent.
          if (pixels[i + 3] < 128) continue;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          n++;
        }
      }
      cells.push(n ? [r / n, g / n, b / n] : null);
    }
  }
  return cells;
}

/** Signature comparison. A missing cell never matches a present one. */
function alike(a, b, tolerance) {
  for (let i = 0; i < a.length; i++) {
    if ((a[i] === null) !== (b[i] === null)) return false;
    if (a[i] && distance(a[i], b[i]) > tolerance) return false;
  }
  return true;
}

/** How far apart two signatures are on average: the size of the alteration. */
function meanChange(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] === null) !== (b[i] === null)) sum += 255;
    else if (a[i]) sum += distance(a[i], b[i]);
  }
  return sum / a.length;
}

/** Mirror, flip or turn a raster. Done on pixels so nothing has to re-render. */
function reorient(pixels, kind) {
  const out = Buffer.alloc(pixels.length);
  const flipX = kind === 'mirror' || kind === 'rot180';
  const flipY = kind === 'flip' || kind === 'rot180';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const from = ((flipY ? H - 1 - y : y) * W + (flipX ? W - 1 - x : x)) * 4;
      pixels.copy(out, (y * W + x) * 4, from, from + 4);
    }
  }
  return out;
}

const SAYS = {
  mirror: 'Flipped left to right.',
  flip: 'Flipped top to bottom.',
  rot180: 'Turned upside down.',
};

// ------------------------------------------------------------------- corpus
const countries = JSON.parse(readFileSync(join(root, 'data', 'countries.json'), 'utf8'));
const palettes = JSON.parse(
  readFileSync(join(root, 'data', 'flag-colors.json'), 'utf8')
).flags;

const sources = new Map();
const real = [];
for (const country of countries) {
  const svg = readFileSync(join(root, country.flag), 'utf8');
  const cells = signature(render(svg));
  sources.set(country.code, { svg, cells });
  real.push({ code: country.code, cells });
}

const unknownTokens = new Set();

/** The real flags a candidate could be mistaken for, its own twins aside. */
function looksReal(cells, country) {
  const twins = new Set([country.code, ...(country.sameFlagAs ?? [])]);
  return real
    .filter((r) => !twins.has(r.code) && alike(cells, r.cells, CONFUSABLE))
    .map((r) => r.code);
}

// -------------------------------------------------------------------- fakes
const fakes = {};
const rejected = { subtle: 0, real: 0, duplicate: 0, unnameable: 0 };
const collisions = [];
let kept = 0;

for (const country of countries) {
  const { svg, cells: originalCells } = sources.get(country.code);
  const candidates = [];

  // --- reorientations: free, and they never invent a colour ---------------
  const originalPixels = render(svg);
  for (const kind of ['mirror', 'flip', 'rot180']) {
    candidates.push({
      kind,
      says: SAYS[kind],
      cells: signature(reorient(originalPixels, kind)),
    });
  }

  // --- colour swaps -------------------------------------------------------
  /**
   * Swaps are defined on the measured palette rather than on the SVG text,
   * because what matters is how much of the flag a colour actually covers. A
   * colour named once in the file can be most of the flag, and a colour named
   * fifty times can be a hairline inside an emblem.
   */
  const { colours, unknown } = svgColours(svg);
  for (const token of unknown) unknownTokens.add(`${country.code}: ${token}`);

  const swappable = (palettes[country.code] ?? [])
    .filter((c) => c.share >= MIN_SWAP_SHARE && colours.has(normaliseColour(c.hex)))
    .slice(0, MAX_SWAP_COLOURS);

  for (let i = 0; i < swappable.length; i++) {
    for (let j = i + 1; j < swappable.length; j++) {
      const a = normaliseColour(swappable[i].hex);
      const b = normaliseColour(swappable[j].hex);
      const nameA = colourName(a);
      const nameB = colourName(b);
      // Two colours sharing a plain name cannot be described afterwards, and a
      // swap nobody can describe is a swap nobody could see.
      if (nameA === nameB) {
        rejected.unnameable++;
        continue;
      }
      const swap = { [a]: b, [b]: a };
      candidates.push({
        kind: 'swap',
        says: `The ${nameA} and the ${nameB} have traded places.`,
        swap,
        cells: signature(render(recolourSvg(svg, swap))),
      });
    }
  }

  // --- filter -------------------------------------------------------------
  const keep = [];
  for (const candidate of candidates) {
    if (meanChange(originalCells, candidate.cells) < MIN_CHANGE) {
      rejected.subtle++;
      continue;
    }
    const matches = looksReal(candidate.cells, country);
    if (matches.length) {
      rejected.real++;
      collisions.push(`${country.code} ${candidate.kind} -> ${matches.join(' ')}`);
      continue;
    }
    // Horizontal stripes have no left and right, so turning them upside down
    // and flipping them produce the same picture. Ship one of the two.
    if (keep.some((k) => alike(k.cells, candidate.cells, SAME))) {
      rejected.duplicate++;
      continue;
    }
    keep.push(candidate);
  }

  /**
   * Swaps first. A flag whose only fakes are reorientations teaches the player
   * to look for a flip instead of to know the flag, and a recoloured flag is
   * the question this mode exists to ask.
   */
  keep.sort((a, b) => (b.kind === 'swap') - (a.kind === 'swap'));
  const chosen = keep.slice(0, PER_FLAG).map(({ cells, ...rest }) => rest);

  if (chosen.length) fakes[country.code] = chosen;
  kept += chosen.length;
}

writeFileSync(
  join(root, 'data', 'flag-fakes.json'),
  JSON.stringify(
    {
      meta: {
        generatedBy: 'scripts/build-fakes.mjs',
        raster: `${W}x${H}`,
        note: 'Each entry is one alteration of that flag, verified to resemble no real flag. `swap` maps colour to colour and is applied to the SVG text when the flag is shown; the other kinds are CSS transforms.',
      },
      fakes,
    },
    null,
    0
  ) + '\n'
);

const withFakes = Object.keys(fakes).length;
const byKind = {};
for (const list of Object.values(fakes)) {
  for (const f of list) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
}
console.log(
  `Wrote ${kept} fakes for ${withFakes}/${countries.length} flags to data/flag-fakes.json`
);
console.log(`By kind: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(
  `Rejected: ${rejected.subtle} too subtle, ${rejected.real} matched a real flag, ` +
    `${rejected.duplicate} duplicates, ${rejected.unnameable} unnameable swaps`
);
if (collisions.length) {
  console.log(`Alterations that landed on a real flag: ${collisions.join(', ')}`);
}
const none = countries.filter((c) => !fakes[c.code]);
if (none.length) {
  console.log(`No usable fake (only ever shown genuine): ${none.map((c) => c.name).join(', ')}`);
}
if (unknownTokens.size) {
  console.warn(`Colour tokens not understood: ${[...unknownTokens].join(', ')}`);
}
