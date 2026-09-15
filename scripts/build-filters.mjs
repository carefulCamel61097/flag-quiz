/**
 * Finds the flags a CSS filter merges into each other.
 *
 * The filter modes look like the cheapest in the set - one line of CSS, no
 * pipeline - and that is a trap, because some filters throw information away
 * and information thrown away is exactly how a question ends up with more than
 * one right answer.
 *
 *   invert()       one-to-one. Every colour maps to exactly one other colour,
 *                  so two flags that differed before still differ after. This
 *                  is why Inverted shipped with no analysis behind it and was
 *                  right to.
 *   grayscale()    throws away two dimensions of three. Austria and the
 *                  Netherlands are both a red band, a white band and a dark
 *                  band; Cuba and Puerto Rico are the same flag with the blue
 *                  and red exchanged, which in grey is no exchange at all.
 *   hue-rotate()   looks one-to-one and is not. The filter is a fixed matrix
 *                  applied in linear RGB, and its output is clamped to the
 *                  0-255 box, so any colour pushed outside lands on the wall
 *                  alongside everything else pushed to the same place.
 *
 * Rather than reason about which is which, every filter is measured the same
 * way: apply it, reduce each flag to a grid of average colours, and see which
 * pairs come out indistinguishable.
 *
 * Output: data/flag-filters.json
 * Run with: npm run build:filters
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
 * How close two filtered flags have to be before they are the same question.
 *
 * 70, near the 75 the crop and mosaic builds use. A filter mode shows the
 * whole layout, so two flags only collide here when the shapes line up *and*
 * what is left of the colour does too - and at that point the player is
 * matching a pattern against a flag they remember in its real colours, with
 * nothing to hold it beside.
 */
const SAME = 70;

const crisp = 1; // resvg ShapeRendering.crispEdges

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * The filters, as the browser applies them.
 *
 * grayscale uses the luminance weights from the filter effects spec, and
 * hue-rotate its fixed matrix for the given angle - not an HSL rotation, which
 * is what the name suggests and not what any browser does.
 */
function hueRotate(deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const m = [
    [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
    [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283],
    [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
  ];
  return ([r, g, b]) => m.map((row) => clamp(row[0] * r + row[1] * g + row[2] * b));
}

const FILTERS = {
  greyscale: {
    css: 'grayscale(1)',
    apply: ([r, g, b]) => {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return [y, y, y];
    },
  },
  'hue-rotate': {
    css: 'hue-rotate(180deg)',
    apply: hueRotate(180),
  },
};

function distance(a, b) {
  const rMean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db
  );
}

/**
 * The filtered flag as a grid of average colours.
 *
 * The filter runs per pixel and the averaging comes after, in that order,
 * because that is the order the browser does it in: it filters the rendered
 * flag, then the screen averages what it cannot resolve.
 */
function signature(pixels, apply) {
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
          if (pixels[i + 3] < 128) continue; // outside the flag (Nepal)
          const [fr, fg, fb] = apply([pixels[i], pixels[i + 1], pixels[i + 2]]);
          r += fr;
          g += fg;
          b += fb;
          n++;
        }
      }
      cells.push(n ? [r / n, g / n, b / n] : null);
    }
  }
  return cells;
}

function alike(a, b) {
  for (let i = 0; i < a.length; i++) {
    if ((a[i] === null) !== (b[i] === null)) return false;
    if (a[i] && distance(a[i], b[i]) > SAME) return false;
  }
  return true;
}

const countries = JSON.parse(readFileSync(join(root, 'data', 'countries.json'), 'utf8'));
const byName = Object.fromEntries(countries.map((c) => [c.code, c.name]));

const rasters = new Map();
for (const country of countries) {
  const svg = readFileSync(join(root, country.flag), 'utf8');
  const image = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    shapeRendering: crisp,
  }).render();
  rasters.set(country.code, image.pixels); // the getter allocates: read once
}

const filters = {};
for (const [id, filter] of Object.entries(FILTERS)) {
  const signatures = new Map(
    countries.map((c) => [c.code, signature(rasters.get(c.code), filter.apply)])
  );

  const twins = {};
  for (const country of countries) {
    // Flags that are the same artwork are already accepted everywhere.
    const identical = new Set([country.code, ...(country.sameFlagAs ?? [])]);
    const found = countries
      .filter(
        (o) => !identical.has(o.code) && alike(signatures.get(country.code), signatures.get(o.code))
      )
      .map((o) => o.code);
    if (found.length) twins[country.code] = found;
  }

  filters[id] = { css: filter.css, twins };
  console.log(`\n${id} (${filter.css}) merges ${Object.keys(twins).length} flags:`);
  console.log(
    Object.entries(twins)
      .map(([c, list]) => `  ${byName[c]} = ${list.map((x) => byName[x]).join(', ')}`)
      .join('\n') || '  nothing'
  );
}

writeFileSync(
  join(root, 'data', 'flag-filters.json'),
  JSON.stringify(
    {
      meta: {
        generatedBy: 'scripts/build-filters.mjs',
        raster: `${W}x${H}`,
        grid: `${GRID_X}x${GRID_Y}`,
        tolerance: SAME,
        note: 'Per filter, the flags it makes indistinguishable from each other. They are accepted as answers for each other in that mode, and never offered against each other as wrong options. invert() is absent on purpose: it is one-to-one and merges nothing.',
      },
      filters,
    },
    null,
    0
  ) + '\n'
);
console.log('\nWrote data/flag-filters.json');
