/**
 * Chooses the block grid each flag is shown at in the Mosaic quiz.
 *
 * Mosaic has the cleanest difficulty dial in the set - one integer, the number
 * of blocks - and two ways to set it wrong, which are opposites.
 *
 *   - Too coarse and the question has no answer. At four by three, Japan,
 *     Poland, Indonesia, Monaco, Singapore and Peru are all a white rectangle
 *     with some red in it.
 *   - Too faithful and there is no question at all. The first version of this
 *     script picked four by three for Russia and called it answerable, which it
 *     was: the blocks landed exactly on the three bands, so the "mosaic" was
 *     the Russian flag, pixel for pixel. Every plain tricolour came out the
 *     same way, and for half the corpus the mode was Classic with extra steps.
 *
 * So a grid has to clear both bars: it must destroy enough of the flag to be
 * worth asking about, and what is left must still tell it apart from the other
 * 249. The grids below have deliberately awkward row and column counts, so
 * that a flag in thirds never lines up with them and its bands blend at the
 * block boundaries instead.
 *
 * Output: data/flag-mosaics.json
 * Run with: npm run build:mosaics
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Working raster. */
const W = 160;
const H = 120;

/**
 * Coarsest first; the coarsest that clears both bars is the one used.
 *
 * None of the row counts divide three, and none of the column counts divide
 * two or three, so horizontal and vertical bands always straddle a boundary.
 * That is the whole reason the mode works on a tricolour at all.
 */
const GRIDS = [
  [5, 4],
  [7, 5],
  [11, 8],
  [16, 11],
];

/** Reference grid the blocking is measured against: near enough the real flag. */
const REF_X = 32;
const REF_Y = 24;

/**
 * How much of the flag the blocks have to destroy, averaged over the reference
 * grid. Below this the mosaic is the flag and the question is not a question.
 */
const MIN_LOSS = 26;

/**
 * How close two mosaics have to be before they are the same question.
 *
 * Held at the 75 the crop build uses, not the 175 the alteration build uses,
 * and the difference between those two numbers is the difference between the
 * two jobs. An alteration is judged against a flag the player is remembering,
 * so it has to allow for the fact that nobody recalls a shade. A mosaic is
 * right there on screen with its colours intact, so a green band and a blue
 * band are plainly different.
 *
 * The first run of this used 175 and had Bulgaria's mosaic accepting "Russia",
 * which is not generosity, it is grading the wrong answer as right.
 */
const SAME = 75;

/** A grid is answerable when this few other flags are still indistinguishable. */
const CLEAN = 3;

/** Grids kept per flag, coarsest first, so repeat plays are not identical. */
const PER_FLAG = 2;

const crisp = 1; // resvg ShapeRendering.crispEdges

/** Transparent blocks: the area outside Nepal's pennant, and nothing else. */
const EMPTY = '...';

function distance(a, b) {
  const rMean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db
  );
}

/** Average colour of each cell of a gx by gy split of the flag. */
function average(pixels, gx, gy) {
  const cells = [];
  for (let cy = 0; cy < gy; cy++) {
    for (let cx = 0; cx < gx; cx++) {
      const sx = Math.floor((cx * W) / gx);
      const ex = Math.floor(((cx + 1) * W) / gx);
      const sy = Math.floor((cy * H) / gy);
      const ey = Math.floor(((cy + 1) * H) / gy);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = sy; y < ey; y++) {
        for (let x = sx; x < ex; x++) {
          const i = (y * W + x) * 4;
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

/**
 * Cells quantised to three hex digits and run together into one string.
 *
 * Quantising costs at most eight units per channel, invisible in a flat block,
 * and saves two thirds of the file. Everything below compares the quantised
 * values, so what is measured is exactly what is shown.
 */
const pack = (cells) =>
  cells
    .map((c) => (c ? c.map((v) => Math.round(v / 17).toString(16)).join('') : EMPTY))
    .join('');

const unpack = (packed) => {
  const cells = [];
  for (let i = 0; i < packed.length; i += 3) {
    const code = packed.slice(i, i + 3);
    cells.push(code === EMPTY ? null : [0, 1, 2].map((k) => parseInt(code[k], 16) * 17));
  }
  return cells;
};

/** Cell-by-cell comparison. A missing block never matches a present one. */
function alike(a, b) {
  for (let i = 0; i < a.length; i++) {
    if ((a[i] === null) !== (b[i] === null)) return false;
    if (a[i] && distance(a[i], b[i]) > SAME) return false;
  }
  return true;
}

/**
 * How much the blocking changed the flag, averaged over the reference grid.
 *
 * Each reference cell is compared with the block it falls inside, so a grid
 * whose blocks happen to land exactly on the flag's own bands scores zero.
 */
function loss(reference, cells, gx, gy) {
  let sum = 0;
  for (let ry = 0; ry < REF_Y; ry++) {
    for (let rx = 0; rx < REF_X; rx++) {
      const ref = reference[ry * REF_X + rx];
      const block =
        cells[Math.min(gy - 1, Math.floor((ry * gy) / REF_Y)) * gx +
          Math.min(gx - 1, Math.floor((rx * gx) / REF_X))];
      if ((ref === null) !== (block === null)) sum += 255;
      else if (ref) sum += distance(ref, block);
    }
  }
  return sum / (REF_X * REF_Y);
}

// ------------------------------------------------------------------- corpus
const countries = JSON.parse(readFileSync(join(root, 'data', 'countries.json'), 'utf8'));

const rasters = new Map();
for (const country of countries) {
  const svg = readFileSync(join(root, country.flag), 'utf8');
  const image = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    shapeRendering: crisp,
  }).render();
  rasters.set(country.code, image.pixels); // the getter allocates: read once
}

const references = new Map(
  countries.map((c) => [c.code, average(rasters.get(c.code), REF_X, REF_Y)])
);

/** grid index -> code -> { packed, cells, loss } */
const byGrid = GRIDS.map(([gx, gy]) => {
  const out = new Map();
  for (const country of countries) {
    const packed = pack(average(rasters.get(country.code), gx, gy));
    const cells = unpack(packed);
    out.set(country.code, {
      packed,
      cells,
      loss: loss(references.get(country.code), cells, gx, gy),
    });
  }
  return out;
});

// ---------------------------------------------------------------- selection
const picked = {};
const usedGrid = {};
const rejected = { faithful: 0, ambiguous: 0 };
const dropped = [];

for (const country of countries) {
  // Flags that are literally the same artwork are already accepted answers
  // everywhere else, so they are not competing answers here either.
  const twins = new Set([country.code, ...(country.sameFlagAs ?? [])]);
  const usable = [];

  for (let g = 0; g < GRIDS.length; g++) {
    const [gx, gy] = GRIDS[g];
    const mine = byGrid[g].get(country.code);

    if (mine.loss < MIN_LOSS) {
      rejected.faithful++;
      continue;
    }

    const clash = [];
    for (const other of countries) {
      if (twins.has(other.code)) continue;
      if (alike(mine.cells, byGrid[g].get(other.code).cells)) clash.push(other.code);
    }
    if (clash.length > CLEAN) {
      rejected.ambiguous++;
      continue;
    }

    usable.push({ gx, gy, cells: mine.packed, with: clash });
  }

  /**
   * A flag with nothing usable drops out of this mode, exactly as Indonesia
   * and Poland drop out of Zoomed. There is no grid at which the flag is both
   * reduced to blocks and still itself, so there is no question to ask.
   */
  if (!usable.length) {
    dropped.push(country);
    continue;
  }

  picked[country.code] = usable.slice(0, PER_FLAG);
  const key = `${usable[0].gx}x${usable[0].gy}`;
  usedGrid[key] = (usedGrid[key] ?? 0) + 1;
}

writeFileSync(
  join(root, 'data', 'flag-mosaics.json'),
  JSON.stringify(
    {
      meta: {
        generatedBy: 'scripts/build-mosaics.mjs',
        raster: `${W}x${H}`,
        grids: GRIDS.map(([gx, gy]) => `${gx}x${gy}`),
        note: `Cells run left to right, top to bottom, three hex digits each (multiply by 17 for 8-bit). "${EMPTY}" is a transparent block. 'with' names the flags whose mosaic is indistinguishable at that grid; they are accepted as answers.`,
      },
      mosaics: picked,
    },
    null,
    0
  ) + '\n'
);

const kept = Object.keys(picked).length;
const total = Object.values(picked).reduce((n, list) => n + list.length, 0);
console.log(`Wrote ${total} mosaics for ${kept}/${countries.length} flags to data/flag-mosaics.json`);
console.log(
  `Coarsest usable grid: ${Object.entries(usedGrid)
    .map(([k, n]) => `${k} for ${n}`)
    .join(', ')}`
);
console.log(
  `Rejected: ${rejected.faithful} too faithful to the flag, ${rejected.ambiguous} too ambiguous`
);
if (dropped.length) {
  console.log(`No usable grid: ${dropped.map((c) => c.name).join(', ')}`);
}
const shared = countries.filter((c) => picked[c.code]?.[0].with.length);
console.log(`Sharing their coarsest mosaic with another flag: ${shared.length}`);
console.log(
  shared
    .slice(0, 10)
    .map((c) => `${c.code}->${picked[c.code][0].with.join('/')}`)
    .join(', ')
);
