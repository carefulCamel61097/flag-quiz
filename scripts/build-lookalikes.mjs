/**
 * Finds the flag pairs that people mix up, for the Twin Flags quiz.
 *
 * Every other analysis in this project looks for flags that are *the same* and
 * then accepts both answers. This one wants the opposite, and the difference
 * is the whole design of the mode. Twin Flags puts two flags side by side and
 * asks which is which, so a pair has to be
 *
 *   - close enough to be worth asking about. Chad and Romania, Indonesia and
 *     Monaco, Ireland and Cote d'Ivoire. Two flags nobody confuses make a
 *     question nobody has to think about.
 *   - far enough apart to have an answer. Norway and Svalbard fly the same
 *     flag; "which one is Norway" has no answer and never will.
 *
 * So a pair is kept when the flags are alike on average and still differ
 * somewhere in particular: there has to be a tell, even a small one, or the
 * question is a coin toss.
 *
 * Output: data/flag-lookalikes.json
 * Run with: npm run build:lookalikes
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const W = 160;
const H = 120;
const GRID_X = 12;
const GRID_Y = 9;

/**
 * How alike two flags have to be, averaged over every cell, to be a pair worth
 * asking about. Roughly "you would have to look twice".
 */
const NEAR = 78;

/**
 * And how different they have to be *somewhere*, in their most different cell.
 *
 * This is the bar that keeps the mode answerable, and it is set far lower than
 * the equivalent bar anywhere else in the project, deliberately.
 *
 * Twin Flags is the only mode that puts both flags on the screen at the same
 * time. Everywhere else a shade difference is useless, because the player is
 * comparing what they see against a memory - which is why the alteration build
 * treats anything within 175 as the same colour. Here the two are side by side
 * and a difference of fifty is plain to see, so it counts as evidence.
 *
 * The first run used 110 and threw out Chad and Romania, Indonesia and Monaco:
 * the pairs the mode exists for, and the ones named in its own description.
 * All this has to exclude is flags with no visible difference at all.
 */
const TELL = 30;

/** Lookalikes kept per flag, closest first. */
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

/** The same signature with its rows reversed. */
function mirror(cells) {
  const out = [];
  for (let y = 0; y < GRID_Y; y++) {
    for (let x = 0; x < GRID_X; x++) out.push(cells[y * GRID_X + (GRID_X - 1 - x)]);
  }
  return out;
}

/** Mean and worst cell difference between two flags. */
function compare(a, b) {
  let sum = 0;
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    let d;
    if ((a[i] === null) !== (b[i] === null)) d = 255;
    else if (a[i] === null) d = 0;
    else d = distance(a[i], b[i]);
    sum += d;
    if (d > worst) worst = d;
  }
  return { mean: sum / a.length, worst };
}

const countries = JSON.parse(readFileSync(join(root, 'data', 'countries.json'), 'utf8'));
const byName = Object.fromEntries(countries.map((c) => [c.code, c.name]));

const signatures = new Map();
for (const country of countries) {
  const svg = readFileSync(join(root, country.flag), 'utf8');
  const image = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    shapeRendering: crisp,
  }).render();
  signatures.set(country.code, signature(image.pixels)); // getter allocates: read once
}

const pairs = {};
let tooIdentical = 0;

for (const country of countries) {
  // The same artwork is the same artwork: there is nothing to tell apart.
  const identical = new Set([country.code, ...(country.sameFlagAs ?? [])]);
  const found = [];

  for (const other of countries) {
    if (identical.has(other.code)) continue;
    const mine = signatures.get(country.code);
    const theirs = signatures.get(other.code);
    const direct = compare(mine, theirs);

    /**
     * Mirror images count as lookalikes too, and they are the best pairs in
     * the set: Ireland and Cote d'Ivoire, Guinea and Mali, Italy and Mexico.
     * Comparing cell against matching cell says those are nothing alike, which
     * is true of the pixels and false of every person who has ever confused
     * them. What makes the pair hard is knowing which way round it goes.
     *
     * How alike they are is the better of the two readings; whether the
     * question has an answer is judged on what is actually on screen, which is
     * never the mirrored version.
     */
    const flipped = compare(mine, mirror(theirs));
    const mean = Math.min(direct.mean, flipped.mean);

    if (mean > NEAR) continue;
    if (direct.worst < TELL) {
      tooIdentical++;
      continue;
    }
    found.push({
      code: other.code,
      mean: Number(mean.toFixed(1)),
      tell: Number(direct.worst.toFixed(1)),
      ...(flipped.mean < direct.mean ? { mirrored: true } : {}),
    });
  }

  found.sort((a, b) => a.mean - b.mean);
  if (found.length) pairs[country.code] = found.slice(0, PER_FLAG);
}

writeFileSync(
  join(root, 'data', 'flag-lookalikes.json'),
  JSON.stringify(
    {
      meta: {
        generatedBy: 'scripts/build-lookalikes.mjs',
        raster: `${W}x${H}`,
        grid: `${GRID_X}x${GRID_Y}`,
        near: NEAR,
        tell: TELL,
        note: 'Flags that look enough alike to be worth confusing, and still differ somewhere definite. `mean` is how alike overall, `tell` is how different their most different region is. Used by Twin Flags, which shows two of them and asks which is which.',
      },
      pairs,
    },
    null,
    0
  ) + '\n'
);

const withPairs = Object.keys(pairs).length;
const total = Object.values(pairs).reduce((n, list) => n + list.length, 0);
console.log(
  `Wrote ${total} lookalikes for ${withPairs}/${countries.length} flags to data/flag-lookalikes.json`
);
console.log(`Rejected ${tooIdentical} pairs as too identical to have an answer`);

// Each pair turns up twice, once from either side; show each only once.
const seen = new Set();
const closest = Object.entries(pairs)
  .map(([code, list]) => ({ code, other: list[0].code, mean: list[0].mean, tell: list[0].tell }))
  .sort((a, b) => a.mean - b.mean)
  .filter((p) => {
    const key = [p.code, p.other].sort().join('-');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .slice(0, 16);

console.log('\nThe most confusable pairs:');
for (const p of closest) {
  console.log(
    `  ${byName[p.code]} vs ${byName[p.other]}  (alike ${p.mean}, tell ${p.tell})`
  );
}
