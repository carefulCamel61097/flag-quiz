/**
 * Reading and rewriting the colours of a flag SVG.
 *
 * Real or Fake needs a flag with two of its colours swapped. Doing that by
 * shipping a second copy of every altered SVG would add megabytes for nothing
 * - Serbia alone is 180KB - so the alteration is expressed as a tiny map of
 * colour to colour and applied to the SVG text at the moment it is shown.
 *
 * This module is imported by both the site and scripts/build-fakes.mjs, so the
 * build measures exactly the image the player will see.
 */

/**
 * The CSS colour names flag-icons actually uses, plus the obvious neighbours.
 * A name outside this table is left alone rather than guessed at: the build
 * warns about it instead of silently skipping a colour that matters.
 */
const NAMED = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  gold: '#ffd700',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  orange: '#ffa500',
  maroon: '#800000',
  navy: '#000080',
  teal: '#008080',
  olive: '#808000',
  purple: '#800080',
  lime: '#00ff00',
  fuchsia: '#ff00ff',
  aqua: '#00ffff',
};

/**
 * One colour token as a six-digit lowercase hex, or null if it is not a plain
 * colour at all (`none`, `url(#gradient)`, `currentColor`).
 *
 * Normalising matters because the same colour is written several ways across
 * the corpus: Germany's red is `red`, Italy's is `#ce2b37`, and shorthand
 * `#fc0` appears alongside full-length spellings of the same yellow.
 */
export function normaliseColour(token) {
  const value = String(token).trim().toLowerCase();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    // An eight-digit hex carries alpha; the colour is still the first six.
    if (hex.length === 6 || hex.length === 8) return `#${hex.slice(0, 6)}`;
    return null;
  }
  return NAMED[value] ?? null;
}

/** Every place a flat colour is stated. Gradients state theirs in stops. */
const COLOUR_ATTR = /\b(fill|stop-color)="([^"]*)"/g;

/** Every distinct colour named anywhere in the SVG, normalised. */
export function svgColours(svg) {
  const found = new Set();
  const unknown = new Set();
  for (const [, , value] of svg.matchAll(COLOUR_ATTR)) {
    const hex = normaliseColour(value);
    if (hex) found.add(hex);
    else if (!/^(none|url\(|currentcolor)/i.test(value.trim())) unknown.add(value);
  }
  return { colours: found, unknown };
}

/**
 * Applies a colour-to-colour map to an SVG.
 *
 * Every attribute is rewritten from the original text in a single pass, so a
 * swap really is a swap: replacing red with blue and then blue with red in two
 * passes would leave the flag entirely blue.
 */
export function recolourSvg(svg, map) {
  return svg.replace(COLOUR_ATTR, (whole, attr, value) => {
    const to = map[normaliseColour(value)];
    return to ? `${attr}="${to}"` : whole;
  });
}
