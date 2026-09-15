/**
 * Taking a flag apart into the shapes it is drawn from.
 *
 * Silhouette needs the emblem on its own - the maple leaf without Canada, the
 * eagle without Mexico - and that sounds like an image-segmentation problem
 * until you remember these are not images. Every flag here is an SVG, so the
 * leaf is already a separate object; it just has a field drawn behind it.
 *
 * This module does the cutting: list a flag's drawable elements, keep a chosen
 * few, and flatten what is left to one colour. scripts/build-emblems.mjs uses
 * it to work out which elements are the emblem, and the site uses it to redraw
 * that emblem from the flag it already has. No second copy of anything is
 * generated or shipped.
 *
 * The parsing here is deliberately small. It is not an XML parser and does not
 * want to be: it handles the shapes flag-icons actually uses, and every result
 * is rendered and checked against the original at build time, so a file it
 * reads wrongly drops out of the mode instead of shipping broken.
 */

/** Tags that put marks on the page. `defs` and friends deliberately absent. */
const DRAWABLE = new Set([
  'path',
  'circle',
  'rect',
  'ellipse',
  'polygon',
  'polyline',
  'line',
  'g',
  'use',
  'image',
  'text',
  'switch',
]);

/** Index of the '>' that closes the tag starting at `from`, ignoring quotes. */
function endOfTag(text, from) {
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return text.length - 1;
}

/** Where the element starting at `from` ends, following nesting of its own tag. */
function endOfElement(text, from, tag) {
  const openEnd = endOfTag(text, from);
  if (text[openEnd - 1] === '/') return openEnd + 1;

  let depth = 1;
  let at = openEnd + 1;
  while (depth > 0) {
    const nextOpen = text.indexOf(`<${tag}`, at);
    const nextClose = text.indexOf(`</${tag}`, at);
    if (nextClose === -1) return text.length;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      at = endOfTag(text, nextOpen) + 1;
    } else {
      depth--;
      at = endOfTag(text, nextClose) + 1;
    }
  }
  return at;
}

/**
 * Splits the inside of an element into pieces, marking which ones draw.
 *
 * Everything that does not draw - defs, comments, whitespace - is kept as it
 * is, because a kept shape may well point at a clip path or a gradient defined
 * up there.
 */
function split(inner) {
  const pieces = [];
  let i = 0;
  while (i < inner.length) {
    const lt = inner.indexOf('<', i);
    if (lt === -1) {
      pieces.push({ draws: false, text: inner.slice(i) });
      break;
    }
    if (lt > i) pieces.push({ draws: false, text: inner.slice(i, lt) });

    if (inner.startsWith('<!--', lt)) {
      const end = inner.indexOf('-->', lt);
      const to = end === -1 ? inner.length : end + 3;
      pieces.push({ draws: false, text: inner.slice(lt, to) });
      i = to;
      continue;
    }

    const name = /^<\s*([A-Za-z0-9:_-]+)/.exec(inner.slice(lt, lt + 40));
    if (!name) {
      pieces.push({ draws: false, text: inner.slice(lt) });
      break;
    }
    const tag = name[1];
    const end = endOfElement(inner, lt, tag);
    pieces.push({ draws: DRAWABLE.has(tag), tag, text: inner.slice(lt, end) });
    i = end;
  }
  return pieces;
}

/** An element's own open tag, inner content and closing tag. */
function open(text) {
  const tag = /^<\s*([A-Za-z0-9:_-]+)/.exec(text)[1];
  const openEnd = endOfTag(text, 0);
  if (text[openEnd - 1] === '/') return null; // self-closing: nothing inside
  const close = text.lastIndexOf(`</${tag}`);
  return {
    head: text.slice(0, openEnd + 1),
    inner: text.slice(openEnd + 1, close),
    tail: text.slice(close),
  };
}

/** The `<svg ...>` wrapper and what is inside it. */
function root(svg) {
  const at = svg.indexOf('<svg');
  const openEnd = endOfTag(svg, at);
  const close = svg.lastIndexOf('</svg');
  return {
    head: svg.slice(0, openEnd + 1),
    inner: svg.slice(openEnd + 1, close),
    tail: svg.slice(close),
  };
}

function rebuild(inner, into, keep) {
  let index = -1;
  return split(inner)
    .map((piece) => {
      if (!piece.draws) return piece.text;
      index += 1;
      if (into.length) {
        // Descending: keep only the container, and cut inside it instead.
        if (index !== into[0]) return '';
        const parts = open(piece.text);
        if (!parts) return '';
        return parts.head + rebuild(parts.inner, into.slice(1), keep) + parts.tail;
      }
      return keep.includes(index) ? piece.text : '';
    })
    .join('');
}

/**
 * How many drawable elements sit at a given depth.
 *
 * Some flags wrap everything in one group - Japan's disc and its white field
 * are both inside a clipped `g` - so "the elements of this flag" means the
 * children of that group, not the group itself.
 */
export function countDrawables(svg, into = []) {
  let inner = root(svg).inner;
  for (const step of into) {
    const drawables = split(inner).filter((p) => p.draws);
    const parts = open(drawables[step]?.text ?? '');
    if (!parts) return 0;
    inner = parts.inner;
  }
  return split(inner).filter((p) => p.draws).length;
}

/**
 * Rewrites every drawable element at a given depth through `fn(text, index)`.
 *
 * This exists so the build can paint each element a different colour and learn
 * what all of them cover from a single render. Rendering them one at a time
 * was the obvious way and cost six hundred milliseconds per element: Spain has
 * five hundred and forty-two of them.
 */
export function mapDrawables(svg, into, fn) {
  const { head, inner, tail } = root(svg);

  const walk = (text, depth) => {
    let index = -1;
    return split(text)
      .map((piece) => {
        if (!piece.draws) return piece.text;
        index += 1;
        if (depth < into.length) {
          if (index !== into[depth]) return piece.text;
          const parts = open(piece.text);
          if (!parts) return piece.text;
          return parts.head + walk(parts.inner, depth + 1) + parts.tail;
        }
        return fn(piece.text, index);
      })
      .join('');
  };

  return head + walk(inner, 0) + tail;
}

/** The tag names of the drawable elements at a given depth. */
export function drawableTags(svg, into = []) {
  let inner = root(svg).inner;
  for (const step of into) {
    const drawables = split(inner).filter((p) => p.draws);
    const parts = open(drawables[step]?.text ?? '');
    if (!parts) return [];
    inner = parts.inner;
  }
  return split(inner)
    .filter((p) => p.draws)
    .map((p) => p.tag);
}

const COLOUR_ATTR = /\b(fill|stop-color|stroke)="([^"]*)"/g;
/** Anything that would make part of the shape see-through. */
const FADE_ATTR = /\s(fill-opacity|stroke-opacity|opacity)="[^"]*"/g;

/**
 * Every colour in the fragment replaced by one, so what is left is a shape and
 * nothing else.
 *
 * `none` is left alone: a shape drawn only as an outline says `fill="none"`,
 * and filling it in would turn a wreath into a blob. Opacity is stripped, so
 * the parts of a coat of arms drawn as faint shading come through solid rather
 * than as ghosts.
 */
export function flatten(fragment, colour) {
  return fragment
    .replace(FADE_ATTR, '')
    .replace(COLOUR_ATTR, (whole, attr, value) =>
      value.trim().toLowerCase() === 'none' ? whole : `${attr}="${colour}"`
    );
}

/** The flag's own coordinate system, so a clip can be expressed in it. */
export function viewBoxOf(svg) {
  const found = /viewBox="([\d.\-+eE\s]+)"/.exec(root(svg).head);
  const [x, y, width, height] = (found?.[1] ?? '0 0 640 480').trim().split(/\s+/).map(Number);
  return { x, y, width, height };
}

/**
 * The flag with only the chosen elements left, optionally flattened to one
 * colour and cut down to a few rectangles.
 *
 * The clip exists for flags that draw the field and the charge as one shape:
 * Canada's two red bars and its maple leaf are subpaths of a single `path`, so
 * there is no element to keep on its own. Keeping that path and cutting it
 * down to the box the leaf sits in gets the leaf, and gets it as vector rather
 * than as a traced bitmap.
 *
 * The clip goes on at the very top, outside anything the flag does with
 * transforms, so its rectangles mean what they say in the flag's own
 * coordinates.
 */
export function sliceSvg(svg, { into = [], keep = [], colour = null, clip = null } = {}) {
  const { head, inner, tail } = root(svg);
  let body = rebuild(inner, into, keep);
  if (colour) body = flatten(body, colour);

  if (clip?.length) {
    const rects = clip
      .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`)
      .join('');
    body =
      `<clipPath id="emblem-cut">${rects}</clipPath>` +
      `<g clip-path="url(#emblem-cut)">${body}</g>`;
  }

  return head + body + tail;
}
