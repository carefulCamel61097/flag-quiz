/**
 * Explains what separates two flags that make almost the same pie.
 *
 * A colour quiz strips away everything except the palette, so a wrong answer
 * is often a near miss: the right shape of pie, the wrong country. Saying
 * "wrong" and moving on teaches nothing. Saying *which* slice gave it away -
 * a deeper blue, a slightly larger stripe - is the thing worth learning, and
 * it is the only way the near-identical pairs ever become answerable.
 *
 * Everything here is derived at read time from data/flag-colors.json; no extra
 * data is generated for it.
 */

const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Weighted RGB distance, as used everywhere else in the project. */
function distance(a, b) {
  const rMean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db
  );
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function hsl([r, g, b]) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (max === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** A plain name for a colour, so the explanation can point at a slice. */
export function colourName(hex) {
  const c = rgb(hex);
  const { h, s, l } = hsl(c);
  if (l > 0.93) return 'white';
  if (l < 0.09) return 'black';
  if (s < 0.12) return l > 0.5 ? 'light grey' : 'grey';

  const hues = [
    [12, 'red'],
    [38, 'orange'],
    [66, 'yellow'],
    [160, 'green'],
    [200, 'teal'],
    [250, 'blue'],
    [295, 'purple'],
    [340, 'pink'],
    [360, 'red'],
  ];
  const name = hues.find(([limit]) => h <= limit)?.[1] ?? 'red';
  if (name === 'red' && l < 0.3) return 'dark red';
  if (name === 'blue' && l < 0.25) return 'navy';
  return name;
}

/** Greedy one-to-one pairing of two palettes by colour similarity. */
function pair(a, b) {
  const options = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      options.push([i, j, distance(rgb(a[i].hex), rgb(b[j].hex))]);
    }
  }
  options.sort((p, q) => p[2] - q[2]);

  const usedA = new Set();
  const usedB = new Set();
  const pairs = [];
  for (const [i, j, d] of options) {
    if (usedA.has(i) || usedB.has(j)) continue;
    usedA.add(i);
    usedB.add(j);
    pairs.push({ a: a[i], b: b[j], distance: d });
  }
  return pairs;
}

const percent = (n) => `${Math.round(n * 100)}%`;

/**
 * How the answer's palette differs from the one the player named.
 *
 * Returns null when the two are too different to be a near miss - there is no
 * insight in telling someone who answered Japan for Brazil that the greens
 * differ, because there was no green.
 */
export function tellApart(answerColours, guessColours, answerName, guessName) {
  if (!answerColours?.length || !guessColours?.length) return null;

  /**
   * A different number of slices only counts as a near miss when everything
   * else lines up: one extra colour on an otherwise matching palette, as with
   * Paraguay and Russia. Otherwise the counts differing is not information,
   * and "Close" said too often stops meaning anything.
   */
  if (answerColours.length !== guessColours.length) {
    if (Math.abs(answerColours.length - guessColours.length) > 1) return null;
    const shared = pair(answerColours, guessColours);
    if (Math.max(...shared.map((p) => p.distance)) > 90) return null;
    return (
      `Close. ${answerName} has ${answerColours.length} colours in it, ` +
      `${guessName} has ${guessColours.length}.`
    );
  }

  const pairs = pair(answerColours, guessColours);

  // Too far apart to be a near miss at all.
  const worstColour = Math.max(...pairs.map((p) => p.distance));
  const worstShare = Math.max(...pairs.map((p) => Math.abs(p.a.share - p.b.share)));
  if (worstColour > 190 || worstShare > 0.16) return null;

  // Whichever difference is more noticeable: a shade, or a size.
  const byColour = pairs.reduce((best, p) => (p.distance > best.distance ? p : best));
  const byShare = pairs.reduce((best, p) =>
    Math.abs(p.a.share - p.b.share) > Math.abs(best.a.share - best.b.share) ? p : best
  );

  const shareGap = Math.abs(byShare.a.share - byShare.b.share);
  // A colour difference has to be reasonably clear to beat a size difference,
  // because a shade is harder to judge without the two side by side.
  const colourWins = byColour.distance > 55 && byColour.distance / 220 > shareGap / 0.25;

  if (colourWins) {
    const name = colourName(byColour.a.hex);
    const a = hsl(rgb(byColour.a.hex));
    const b = hsl(rgb(byColour.b.hex));
    const lighter = luminance(rgb(byColour.a.hex)) > luminance(rgb(byColour.b.hex));

    let how;
    if (Math.abs(a.l - b.l) > 0.08) how = lighter ? 'lighter' : 'darker';
    else if (Math.abs(a.s - b.s) > 0.15) how = a.s > b.s ? 'more vivid' : 'more muted';
    else how = 'a different shade';

    // Phrased without possessives: "the Netherlands's blue" is a mouthful and
    // the apostrophe rules differ for names already ending in s.
    return how === 'a different shade'
      ? `Close. The ${name} is a different shade in ${guessName}.`
      : `Close. The ${name} in ${answerName} is ${how} than in ${guessName}.`;
  }

  if (shareGap >= 0.02) {
    const name = colourName(byShare.a.hex);
    return (
      `Close. The ${name} is ${percent(byShare.a.share)} of ${answerName} ` +
      `but ${percent(byShare.b.share)} of ${guessName}.`
    );
  }

  return `Close. ${answerName} and ${guessName} are nearly the same pie.`;
}
