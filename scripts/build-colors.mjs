/**
 * Measures what proportion of each flag is each colour, for the colour-based
 * quizzes (Colour Pie, Palette Bar, Swatches).
 *
 * Runs at build time because it needs a rasteriser. The site only ever loads
 * the resulting JSON.
 *
 * Output: data/flag-colors.json
 * Run with: npm run build:colors
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * We want area proportions, not detail, and the flags are a uniform 4:3 so
 * every render is the same size.
 *
 * Aspect ratio does not matter here: scaling x and y independently multiplies
 * every region's area by the same factor, so relative proportions survive the
 * 4:3 normalisation exactly.
 */
const WIDTH = 800;

/**
 * Anti-aliasing is the enemy of this measurement.
 *
 * Smoothed edges invent colours that are not in the flag - blends sitting on
 * the line between two real ones - and on a striped flag like the United
 * States there are enough edge pixels for a blend to look like a genuine
 * colour worth several percent. Rendering with crisp edges removes them at
 * source: the US goes from 13 shades to exactly 3.
 *
 * It also measures *better*. A hard edge lands on one side or the other with
 * no bias, so the disc on Bangladesh comes out at 26.16% against a true
 * 26.18%, closer than the anti-aliased 25.89%.
 */
const CRISP_EDGES = 1; // resvg ShapeRendering.crispEdges

/** A colour must reach this share to seed a cluster, and to survive the cut. */
const SEED_MIN_SHARE = 0.004;
const MIN_SHARE = 0.004;
const MAX_SEEDS = 16;

/** Seeds closer than this are the same colour rendered twice. */
const SEED_MERGE_DISTANCE = 26;

/** Below this alpha a pixel is background, not flag. */
const ALPHA_FLOOR = 128;

/**
 * Weighted RGB distance ("redmean"), a cheap approximation of perceptual
 * difference that is much better than plain Euclidean RGB for deciding whether
 * two reds are the same red.
 */
function distance(a, b) {
  const rMean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db
  );
}

const hex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/** Exact colour histogram of one rendered flag, ignoring transparent pixels. */
function histogram(pixels) {
  const counts = new Map();
  let opaque = 0;
  let transparent = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < ALPHA_FLOOR) {
      transparent++;
      continue;
    }
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
    opaque++;
  }
  return { counts, opaque, transparent };
}

/**
 * Collapses a histogram of thousands of shades into the handful of colours a
 * person would actually name.
 *
 * Anti-aliased edges sit on the line between two real flag colours and are
 * individually rare, so rather than merging by a distance threshold (which
 * risks fusing two genuinely similar reds), only colours with real coverage
 * become cluster centres. Everything else is assigned to its nearest centre,
 * which is where an edge pixel belongs anyway.
 */
function cluster(counts, opaque) {
  const sorted = [...counts.entries()]
    .map(([key, n]) => ({ rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255], n }))
    .sort((a, b) => b.n - a.n);

  const seeds = [];
  for (const { rgb, n } of sorted) {
    if (seeds.length >= MAX_SEEDS) break;
    if (n / opaque < SEED_MIN_SHARE) break;
    if (seeds.every((s) => distance(s.rgb, rgb) >= SEED_MERGE_DISTANCE)) {
      seeds.push({ rgb, n: 0 });
    }
  }

  // A flag whose detail is all fine enough to fall below the seed threshold
  // (a busy coat of arms on a plain field) still needs somewhere to put its
  // pixels.
  if (!seeds.length) seeds.push({ rgb: sorted[0].rgb, n: 0 });

  for (const { rgb, n } of sorted) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < seeds.length; i++) {
      const d = distance(seeds[i].rgb, rgb);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    seeds[best].n += n;
  }

  const kept = seeds.filter((s) => s.n / opaque >= MIN_SHARE);
  const total = kept.reduce((sum, s) => sum + s.n, 0);

  return kept
    .map((s) => ({ hex: hex(s.rgb), share: s.n / total }))
    .sort((a, b) => b.share - a.share);
}

/**
 * Two flags are palette twins when their pie charts are the same pie: the same
 * number of slices, each matching one in the other by both colour and size.
 *
 * This matters because a colour quiz strips away everything that tells Guinea
 * from Mali, or Chad from Romania. Those questions have more than one correct
 * answer, and the quiz has to say so rather than mark a fair answer wrong.
 *
 * Slice *count* is part of the test: Cyprus and Japan are both mostly white,
 * but Cyprus has an extra slice and the two pies do not look alike.
 */
const TWIN_COLOUR_MAX = 110;
const TWIN_SHARE_MAX = 0.05;

function twinTest(a, b) {
  if (a.length !== b.length) return false;

  const pairs = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) pairs.push([i, j, distance(a[i].rgb, b[j].rgb)]);
  }
  pairs.sort((p, q) => p[2] - q[2]);

  const usedA = new Set();
  const usedB = new Set();
  let worstColour = 0;
  let worstShare = 0;

  // Greedy one-to-one matching, closest colours first.
  for (const [i, j, d] of pairs) {
    if (usedA.has(i) || usedB.has(j)) continue;
    usedA.add(i);
    usedB.add(j);
    worstColour = Math.max(worstColour, d);
    worstShare = Math.max(worstShare, Math.abs(a[i].share - b[j].share));
  }
  return worstColour < TWIN_COLOUR_MAX && worstShare < TWIN_SHARE_MAX;
}

const countries = JSON.parse(readFileSync(join(root, 'data', 'countries.json'), 'utf8'));
const flags = {};
const report = [];

for (const country of countries) {
  const svg = readFileSync(join(root, country.flag), 'utf8');
  const image = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
    shapeRendering: CRISP_EDGES,
  }).render();

  // `image.pixels` is a getter that allocates a fresh Buffer on every read.
  // Touching it inside a per-pixel loop exhausts memory; read it once.
  const pixels = image.pixels;
  const { counts, opaque, transparent } = histogram(pixels);

  const colours = cluster(counts, opaque);
  flags[country.code] = colours.map((c) => ({
    hex: c.hex,
    share: Number(c.share.toFixed(4)),
  }));

  report.push({
    code: country.code,
    name: country.name,
    shades: counts.size,
    colours: colours.length,
    transparent: transparent / (image.width * image.height),
  });
}

// Palette twins, computed over every pair.
const codes = Object.keys(flags);
const parsed = Object.fromEntries(
  codes.map((code) => [
    code,
    flags[code].map((c) => ({
      rgb: [
        parseInt(c.hex.slice(1, 3), 16),
        parseInt(c.hex.slice(3, 5), 16),
        parseInt(c.hex.slice(5, 7), 16),
      ],
      share: c.share,
    })),
  ])
);
const twins = Object.fromEntries(codes.map((code) => [code, []]));
for (let i = 0; i < codes.length; i++) {
  for (let j = i + 1; j < codes.length; j++) {
    if (twinTest(parsed[codes[i]], parsed[codes[j]])) {
      twins[codes[i]].push(codes[j]);
      twins[codes[j]].push(codes[i]);
    }
  }
}

writeFileSync(
  join(root, 'data', 'flag-colors.json'),
  JSON.stringify(
    {
      meta: {
        generatedBy: 'scripts/build-colors.mjs',
        raster: `${WIDTH}x${(WIDTH * 3) / 4}`,
        minShare: MIN_SHARE,
        note: 'Shares are of opaque pixels only, and sum to 1 per flag.',
      },
      flags,
      twins,
    },
    null,
    0
  ) + '\n'
);

const counts = report.map((r) => r.colours);
const transparentFlags = report.filter((r) => r.transparent > 0.01);

console.log(`Wrote colours for ${report.length} flags to data/flag-colors.json`);
console.log(
  `Colours per flag: min ${Math.min(...counts)}, max ${Math.max(...counts)}, ` +
    `mean ${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)}`
);
console.log(
  'Raw shades per flag: max ' + Math.max(...report.map((r) => r.shades)) +
    ` (${report.reduce((a, b) => (a.shades > b.shades ? a : b)).name})`
);
const twinned = codes.filter((c) => twins[c].length);
console.log(
  `Palette twins: ${twinned.length} of ${codes.length} flags have at least one, ` +
    `most is ${Math.max(...codes.map((c) => twins[c].length))}`
);
console.log(
  'Flags with transparent area: ' +
    (transparentFlags.map((r) => `${r.name} ${(r.transparent * 100).toFixed(1)}%`).join(', ') ||
      'none')
);
