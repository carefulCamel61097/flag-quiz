/**
 * Picks the crops used by the Zoomed quiz.
 *
 * A randomly placed crop has a worse failure mode than being hard: it can be
 * unanswerable. A solid red square cropped from Japan also appears in China,
 * Turkey, Morocco, Switzerland and dozens of others, so there is no correct
 * answer to give. Difficulty and ambiguity are different things, and only the
 * second one can be measured against the whole corpus.
 *
 * So: enumerate candidate crops at several sizes, give each a signature, and
 * count how many *other* flags contain a near-identical crop anywhere. That
 * count is the difficulty, and it guarantees the question is answerable.
 *
 * Output: data/flag-crops.json
 * Run with: npm run build:crops
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Working raster. Crops are expressed as fractions, so this is just detail. */
const W = 160;
const H = 120;

/**
 * Crop sizes as a fraction of flag width. Size is a difficulty axis in its own
 * right, so candidates are generated at several rather than committing to one.
 */
const SIZES = [0.16, 0.22, 0.3];

/** How far apart candidate crops are placed, as a fraction of flag width. */
const STEP = 0.06;

/** Signature grid: each crop is reduced to GRID x GRID average colours. */
const GRID = 4;

/**
 * Two crops count as the same when every cell of their signatures is this
 * close. The unit is a distance between two average colours.
 *
 * At 42 this was far too strict: Chad and Romania never collided, even though
 * a zoomed crop of either shows a blue-yellow boundary and the two blues are
 * only distinguishable side by side. 75 is in the same territory as the
 * palette-twin threshold used for the colour pie, allowing for the fact that
 * these cells are averages across an edge.
 */
const SAME = 75;

/** Crops that are almost one flat colour carry nothing and are discarded. */
const MIN_VARIANCE = 18;

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

/** Average colour of each cell of a GRID x GRID split of one crop. */
function signature(pixels, x0, y0, w, h) {
  const cells = [];
  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      const sx = x0 + Math.floor((cx * w) / GRID);
      const ex = x0 + Math.floor(((cx + 1) * w) / GRID);
      const sy = y0 + Math.floor((cy * h) / GRID);
      const ey = y0 + Math.floor(((cy + 1) * h) / GRID);
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

/** How much the cells differ from each other: a flat crop scores near zero. */
function variance(cells) {
  const present = cells.filter(Boolean);
  if (present.length < 2) return 0;
  const mean = [0, 1, 2].map((k) => present.reduce((s, c) => s + c[k], 0) / present.length);
  return Math.sqrt(
    present.reduce((s, c) => s + distance(c, mean) ** 2, 0) / present.length
  );
}

/** Signature comparison. Missing cells never match a present one. */
function sameCrop(a, b) {
  for (let i = 0; i < a.length; i++) {
    if ((a[i] === null) !== (b[i] === null)) return false;
    if (a[i] && distance(a[i], b[i]) > SAME) return false;
  }
  return true;
}

const countries = JSON.parse(readFileSync(join(root, 'data', 'countries.json'), 'utf8'));

// ---------------------------------------------------------------- rasterise
const rasters = new Map();
for (const country of countries) {
  const svg = readFileSync(join(root, country.flag), 'utf8');
  const image = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    shapeRendering: crisp,
  }).render();
  rasters.set(country.code, image.pixels); // getter allocates: read once
}

// ----------------------------------------------------------- candidate crops
const candidates = new Map();
for (const country of countries) {
  const pixels = rasters.get(country.code);
  const list = [];

  for (const size of SIZES) {
    // Square in pixels, which is square on screen too: the raster is 4:3 and
    // so is every flag, so the crop is shown without distortion.
    const w = Math.round(size * W);
    const h = w;
    const step = Math.max(1, Math.round(STEP * W));
    for (let y = 0; y + h <= H; y += step) {
      for (let x = 0; x + w <= W; x += step) {
        const cells = signature(pixels, x, y, w, h);
        const detail = variance(cells);
        if (detail < MIN_VARIANCE) continue;
        list.push({ x: x / W, y: y / H, size, cells, detail });
      }
    }
  }
  candidates.set(country.code, list);
}

// ------------------------------------------------------------- collision count
/**
 * For each candidate, how many other flags contain a crop that looks the same.
 *
 * Only crops of the same size are compared: a small crop and a large one are
 * different questions even where they overlap.
 */
const bySize = new Map();
for (const size of SIZES) bySize.set(size, []);
for (const [code, list] of candidates) {
  for (const crop of list) bySize.get(crop.size).push({ code, crop });
}

const picked = {};
let total = 0;

for (const country of countries) {
  const scored = [];

  /**
   * Flags that are literally the same flag do not count as collisions.
   *
   * France shares its artwork with eight overseas territories, so every crop
   * of the tricolour matched eight others and France dropped out of the quiz
   * entirely. But those eight are already accepted as correct answers by the
   * equivalence handling, so they are not competing answers at all.
   */
  const twins = new Set(country.sameFlagAs ?? []);

  for (const crop of candidates.get(country.code)) {
    const others = new Set();
    for (const other of bySize.get(crop.size)) {
      if (other.code === country.code || twins.has(other.code)) continue;
      if (others.has(other.code)) continue;
      if (sameCrop(crop.cells, other.crop.cells)) others.add(other.code);
    }
    scored.push({ crop, collisions: others.size, with: [...others] });
  }

  /**
   * A crop that matches other flags is not thrown away, it is *shared*: the
   * flags it matches become accepted answers, exactly as palette twins do in
   * the colour pie. A crop of a red-white boundary really could be the
   * Netherlands or Russia or Indonesia, and saying so is more honest than
   * marking one of them wrong.
   *
   * Below four is the normal case. The wider cap is a fallback for flags that
   * have nothing tighter anywhere: without it the Netherlands, Russia,
   * Indonesia, Poland, Austria and Monaco could never be asked at all, because
   * every crop of a horizontal bicolour matches half a dozen others.
   */
  const CLEAN = 3;
  const FALLBACK = 8;
  let usable = scored.filter((s) => s.collisions <= CLEAN);
  if (!usable.length) usable = scored.filter((s) => s.collisions <= FALLBACK);
  /**
   * Among crops that are equally answerable, prefer the ones that show
   * something. A plain boundary between two bands is technically a fair
   * question and a dull one; a corner with an emblem in it is the same
   * difficulty to grade and far better to look at.
   */
  usable.sort((a, b) => a.collisions - b.collisions || b.crop.detail - a.crop.detail);

  /**
   * Keep a spread, not simply the best.
   *
   * Sorting on collisions alone handed back nothing but the largest size:
   * bigger crops carry more information, so they collide less and win every
   * comparison. Size is meant to be the difficulty dial, so each size gets its
   * own quota, and positions are spread across the flag.
   */
  const PER_SIZE = 4;
  const keep = [];
  for (const size of SIZES) {
    const seen = new Set();
    let taken = 0;
    for (const s of usable) {
      if (s.crop.size !== size || taken >= PER_SIZE) continue;
      const slot = `${Math.round(s.crop.x * 5)}:${Math.round(s.crop.y * 5)}`;
      if (seen.has(slot)) continue;
      seen.add(slot);
      taken++;
      keep.push({
        x: Number(s.crop.x.toFixed(4)),
        y: Number(s.crop.y.toFixed(4)),
        size: s.crop.size,
        collisions: s.collisions,
        with: s.with,
      });
    }
  }

  picked[country.code] = keep;
  total += keep.length;
}

writeFileSync(
  join(root, 'data', 'flag-crops.json'),
  JSON.stringify(
    {
      meta: {
        generatedBy: 'scripts/build-crops.mjs',
        raster: `${W}x${H}`,
        sizes: SIZES,
        note: 'Crop x/y/size are fractions of the flag. `collisions` counts other flags containing a near-identical crop; `with` names them.',
      },
      crops: picked,
    },
    null,
    0
  ) + '\n'
);

const counts = countries.map((c) => picked[c.code].length);
const none = countries.filter((c) => !picked[c.code].length);
console.log(`Wrote ${total} crops for ${countries.length} flags to data/flag-crops.json`);
console.log(
  `Crops per flag: min ${Math.min(...counts)}, max ${Math.max(...counts)}, ` +
    `mean ${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)}`
);
const unique = countries.filter((c) => picked[c.code].some((k) => k.collisions === 0)).length;
const shared = countries.filter((c) => picked[c.code].every((k) => k.collisions > 0));
console.log(`Flags with at least one unique crop: ${unique}/${countries.length}`);
if (shared.length) {
  console.log(
    `Every crop shared with other flags (answers accepted either way): ` +
      shared.map((c) => c.name).join(', ')
  );
}
if (none.length) console.warn(`No usable crop for: ${none.map((c) => c.name).join(', ')}`);
