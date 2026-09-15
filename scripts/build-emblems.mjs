/**
 * Works out which part of each flag is the emblem, for the Silhouette quiz.
 *
 * This looks like an image-segmentation problem and is not one, because these
 * flags are not images. Every one is an SVG, so Canada's maple leaf is already
 * a separate object in the file; it simply has a field drawn behind it. The
 * job is to say which objects are the field and which are the charge, and
 * there is a rule that settles it almost every time:
 *
 *   the field reaches the edge of the flag, and an emblem does not.
 *
 * Canada's two red bars reach it, the leaf does not. The stripes of the United
 * States reach it and so does the canton; the fifty stars do not. Denmark's
 * cross runs to all four edges, so Denmark has no emblem and drops out of the
 * mode, which is the right answer rather than a failure.
 *
 * "Edge" means the edge of the flag, not of the canvas. Nepal is not a
 * rectangle, and measured against the canvas border its crimson field would
 * look like a floating shape - an emblem - rather than the field it is.
 *
 * ---
 *
 * The first version of this rendered every element on its own to see where it
 * landed, which is the obvious way and cost six hundred milliseconds an
 * element: Spain alone has five hundred and forty-two of them, and the build
 * never finished. resvg's cost is almost all per-call overhead rather than per
 * pixel, so the fix is to make one call instead of hundreds - every element is
 * painted a colour that encodes its own index, the flag is rendered once, and
 * the colour of a pixel says which element put it there.
 *
 * Output: data/flag-emblems.json
 * Run with: npm run build:emblems
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countDrawables,
  drawableTags,
  mapDrawables,
  sliceSvg,
  flatten,
  viewBoxOf,
} from '../assets/js/svg-slice.js';

/** Flags to explain in detail, for when one of them comes out wrong. */
const EXPLAIN = new Set(process.argv.slice(2).filter((a) => !a.startsWith('-')));

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const W = 240;
const H = 180;

/** Coarse grid the silhouettes are compared on, to find the ones that match. */
const GRID_X = 40;
const GRID_Y = 30;

/** An emblem this small is a speck; this large is a failure of the rule. */
const MIN_AREA = 0.005;
const MAX_AREA = 0.5;

/**
 * How much of its own bounding box a silhouette may fill.
 *
 * A shape that fills its box completely is a rectangle, and a rectangle is not
 * the silhouette of anything. This is what stops a misread flag - where the
 * rule picked out a band rather than a charge - from shipping as a question.
 */
const MAX_BOXINESS = 0.93;

/** How closely the cut-out emblem must match what was measured, or it is dropped. */
const MUST_MATCH = 0.97;

/** Two silhouettes are the same question when they overlap this much. */
const SAME = 0.88;

const crisp = 1; // resvg ShapeRendering.crispEdges

/**
 * A colour that means "element number i".
 *
 * Blue is pinned so that a stray blended pixel is unlikely to decode as
 * anything; red and green carry the index. Rendering is anti-aliasing-free, so
 * these come back exactly as they went in.
 */
const MARK_BLUE = 0xaa;
const mark = (i) =>
  `#${(((i + 1) >> 8) & 0xff).toString(16).padStart(2, '0')}` +
  `${((i + 1) & 0xff).toString(16).padStart(2, '0')}` +
  `${MARK_BLUE.toString(16)}`;

const render = (svg) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: W }, shapeRendering: crisp }).render()
    .pixels; // the getter allocates: read once

function boxiness(on, area) {
  let minX = W;
  let maxX = -1;
  let minY = H;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!on[y * W + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return 1;
  return area / ((maxX - minX + 1) * (maxY - minY + 1));
}

/** The silhouette reduced to a coarse occupancy grid, for comparing. */
function grid(on) {
  const cells = new Float32Array(GRID_X * GRID_Y);
  for (let cy = 0; cy < GRID_Y; cy++) {
    for (let cx = 0; cx < GRID_X; cx++) {
      const sx = Math.floor((cx * W) / GRID_X);
      const ex = Math.floor(((cx + 1) * W) / GRID_X);
      const sy = Math.floor((cy * H) / GRID_Y);
      const ey = Math.floor(((cy + 1) * H) / GRID_Y);
      let hit = 0;
      let n = 0;
      for (let y = sy; y < ey; y++) {
        for (let x = sx; x < ex; x++) {
          hit += on[y * W + x];
          n++;
        }
      }
      cells[cy * GRID_X + cx] = hit / n;
    }
  }
  return cells;
}

/** Overlap of two masks or grids: 1 is identical, 0 is nothing in common. */
function overlap(a, b) {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    both += Math.min(a[i], b[i]);
    either += Math.max(a[i], b[i]);
  }
  return either === 0 ? 0 : both / either;
}

/** Runs of consecutive indices, so Mexico's eagle stores as one pair. */
function ranges(indices) {
  const out = [];
  for (const i of indices) {
    const last = out[out.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  }
  return out;
}

// ------------------------------------------------------------------- corpus
const countries = JSON.parse(readFileSync(join(root, 'data', 'countries.json'), 'utf8'));
const byName = Object.fromEntries(countries.map((c) => [c.code, c.name]));

const emblems = {};
const shapes = new Map();
const rejected = { noElements: 0, allTouchEdge: 0, tooSmall: 0, tooBig: 0, boxy: 0, mismatch: 0 };

for (const country of countries) {
  const svg = readFileSync(join(root, country.flag), 'utf8');

  /**
   * Some flags wrap everything in one group - Japan's disc and its white field
   * are both inside a clipped `g` - so descend until there is a choice to make.
   */
  const into = [];
  while (into.length < 3 && countDrawables(svg, into) === 1 && drawableTags(svg, into)[0] === 'g') {
    into.push(0);
  }

  const count = countDrawables(svg, into);
  if (count < 2) {
    rejected.noElements++;
    continue;
  }

  // ---- one render, every element wearing its own number -------------------
  const marked = mapDrawables(svg, into, (text, i) => flatten(text, mark(i)));
  const pixels = render(marked);

  const owner = new Int16Array(W * H).fill(-1);
  const outside = new Uint8Array(W * H);
  const area = new Int32Array(count);
  const touches = new Uint8Array(count);

  for (let i = 0; i < W * H; i++) {
    if (pixels[i * 4 + 3] < 128) {
      outside[i] = 1; // not part of the flag at all: Nepal's corners
      continue;
    }
    if (pixels[i * 4 + 2] !== MARK_BLUE) continue; // a blend, or something unmarked
    const index = ((pixels[i * 4] << 8) | pixels[i * 4 + 1]) - 1;
    if (index < 0 || index >= count) continue;
    owner[i] = index;
    area[index]++;
  }

  /**
   * The edge test runs on connected regions, not on whole elements.
   *
   * Canada draws its two red bars and its maple leaf as subpaths of one path,
   * so asking "does this element reach the edge" gets a yes and loses the
   * leaf. Asking it of each connected region gets three answers: both bars
   * reach the edge, the leaf does not.
   */
  const region = new Int32Array(W * H).fill(-1);
  const regions = [];
  const stack = [];
  for (let start = 0; start < W * H; start++) {
    if (owner[start] < 0 || region[start] >= 0) continue;
    const id = regions.length;
    const mine = owner[start];
    const box = { minX: W, maxX: -1, minY: H, maxY: -1 };
    let size = 0;
    let edge = false;
    region[start] = id;
    stack.push(start);
    while (stack.length) {
      const at = stack.pop();
      const x = at % W;
      const y = (at - x) / W;
      size++;
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const next = ny * W + nx;
        if (outside[next]) edge = true; // the flag stops here: Nepal's corners
        if (owner[next] !== mine || region[next] >= 0) continue;
        region[next] = id;
        stack.push(next);
      }
    }
    regions.push({ owner: mine, size, edge, box });
  }

  const inner = regions.filter((r) => !r.edge);
  if (!inner.length) {
    rejected.allTouchEdge++;
    if (EXPLAIN.has(country.code)) {
      console.log(`${country.code}: every one of ${regions.length} regions reaches the edge`);
    }
    continue;
  }

  /**
   * Prefer whole elements, and only fall back to cutting one up.
   *
   * An element every one of whose regions is interior can be kept exactly as
   * it is, and that covers most flags. Clipping is for the ones where it finds
   * nothing - Canada, whose bars and leaf are subpaths of a single path - and
   * it is deliberately not used anywhere else: Mexico's eagle is three hundred
   * elements and seven hundred regions, and cutting it to seven hundred
   * rectangles both bloats the file and leaks bits of the field back in.
   */
  const dirty = new Set(regions.filter((r) => r.edge).map((r) => r.owner));
  const cleanOwners = [...new Set(inner.map((r) => r.owner))]
    .filter((o) => !dirty.has(o))
    .sort((a, b) => a - b);

  const keep = cleanOwners.length
    ? cleanOwners
    : [...new Set(inner.map((r) => r.owner))].sort((a, b) => a - b);
  const kept = new Set(keep);
  const needsClip = cleanOwners.length === 0;
  const scale = viewBoxOf(svg).width / W;
  const clip = needsClip
    ? inner
        .filter((r) => kept.has(r.owner))
        .map((r) => [
          Number((r.box.minX * scale).toFixed(1)),
          Number((r.box.minY * scale).toFixed(1)),
          Number(((r.box.maxX - r.box.minX + 1) * scale).toFixed(1)),
          Number(((r.box.maxY - r.box.minY + 1) * scale).toFixed(1)),
        ])
    : null;

  // The mask is whatever the kept elements actually contribute, which is all
  // of them when nothing is clipped and only the interior parts when it is.
  const wanted = new Set(
    regions
      .map((r, i) => [r, i])
      .filter(([r]) => kept.has(r.owner) && (needsClip ? !r.edge : true))
      .map(([, i]) => i)
  );
  const on = new Uint8Array(W * H);
  let emblemArea = 0;
  let flagArea = 0;
  for (let i = 0; i < W * H; i++) {
    if (!outside[i]) flagArea++;
    if (region[i] >= 0 && wanted.has(region[i])) {
      on[i] = 1;
      emblemArea++;
    }
  }

  if (EXPLAIN.has(country.code)) {
    console.log(
      `${country.code}: ${count} elements, ${regions.length} regions, ` +
        `${inner.length} interior, keep ${JSON.stringify(keep)}, ` +
        `clip ${needsClip ? clip.length + ' rects' : 'none'}, ` +
        `share ${(emblemArea / flagArea).toFixed(3)}`
    );
  }

  const share = emblemArea / flagArea;
  if (share < MIN_AREA) {
    rejected.tooSmall++;
    continue;
  }
  if (share > MAX_AREA) {
    rejected.tooBig++;
    continue;
  }
  if (boxiness(on, emblemArea) > MAX_BOXINESS) {
    rejected.boxy++;
    continue;
  }

  /**
   * The second and last render: cut the emblem out the way the site will, and
   * check it is the shape that was just measured. The site slices the same SVG
   * with the same code, so if these disagree the file has been read wrongly
   * somewhere and the flag has no business being in the mode.
   */
  const cutPixels = render(sliceSvg(svg, { into, keep, clip, colour: '#ffffff' }));
  const cut = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) cut[i] = cutPixels[i * 4 + 3] >= 128 ? 1 : 0;
  const fidelity = overlap(on, cut);
  if (EXPLAIN.has(country.code)) console.log(`${country.code}: cut matches ${fidelity.toFixed(3)}`);
  if (fidelity < MUST_MATCH) {
    rejected.mismatch++;
    continue;
  }

  shapes.set(country.code, grid(on));
  emblems[country.code] = {
    ...(into.length ? { into } : {}),
    keep: ranges(keep),
    ...(clip ? { clip } : {}),
    share: Number(share.toFixed(4)),
  };
}

// ------------------------------------------------------------- what matches
/**
 * Two flags whose emblems are the same shape in the same place are the same
 * question. A plain disc is a plain disc: Japan, Bangladesh, Palau and Laos
 * all have one, and only its size and position differ.
 */
for (const [code, mine] of shapes) {
  const twins = [];
  for (const [other, theirs] of shapes) {
    if (other !== code && overlap(mine, theirs) >= SAME) twins.push(other);
  }
  if (twins.length) emblems[code].with = twins;
}

writeFileSync(
  join(root, 'data', 'flag-emblems.json'),
  JSON.stringify(
    {
      meta: {
        generatedBy: 'scripts/build-emblems.mjs',
        raster: `${W}x${H}`,
        note: 'Which drawable elements of each flag make up its emblem. `into` names the groups to descend through first, `keep` is inclusive index ranges at that level, `with` names flags whose silhouette is the same shape in the same place. The site cuts the emblem out of the flag SVG it already has, so nothing extra is shipped.',
      },
      emblems,
    },
    null,
    0
  ) + '\n'
);

const kept = Object.keys(emblems);
console.log(`Found an emblem in ${kept.length}/${countries.length} flags`);
console.log(
  `Rejected: ${rejected.noElements} with nothing to choose between, ` +
    `${rejected.allTouchEdge} where every shape reaches the edge, ` +
    `${rejected.tooSmall} too small, ${rejected.tooBig} too large, ` +
    `${rejected.boxy} too rectangular, ${rejected.mismatch} that did not cut cleanly`
);

const missing = countries.filter((c) => !emblems[c.code]).map((c) => c.name);
console.log(`\nNo silhouette: ${missing.length} flags`);

const shared = kept.filter((c) => emblems[c].with);
console.log(`\nSilhouettes shared with another flag: ${shared.length}`);
const seen = new Set();
for (const code of shared) {
  const group = [code, ...emblems[code].with].sort();
  const key = group.join('-');
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`  ${group.map((c) => byName[c]).join(' = ')}`);
}

const sample = ['ca', 'jp', 'mx', 'us', 'br', 'ch', 'in', 'kr', 'tr', 'np', 'sa', 'ke', 'pt', 'dk', 'gb'];
console.log('\nA few, with how much of the flag the emblem covers:');
for (const code of sample) {
  const e = emblems[code];
  console.log(
    `  ${(byName[code] ?? code).padEnd(20)}` +
      (e ? `${(e.share * 100).toFixed(1).padStart(5)}%  keep ${JSON.stringify(e.keep)}` : '    - no emblem')
  );
}
