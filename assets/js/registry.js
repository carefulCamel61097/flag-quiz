/**
 * The single source of truth for what quizzes exist.
 *
 * The home page, the category navigation and the router are all derived from
 * this file. Nothing else hand-maintains a list of modes, so the site cannot
 * drift out of sync with what is actually playable.
 *
 * Adding a mode means adding one entry here (plus a transform, if it needs
 * something a CSS filter cannot express).
 */

/**
 * Categories describe *what the puzzle does to the flag*, which is the
 * distinction a player can actually feel. Grouping by implementation detail
 * would put "inverted" and "pie chart" together, which helps nobody.
 */
export const CATEGORIES = [
  {
    id: 'basics',
    name: 'The Basics',
    tagline: 'No tricks. The flag exactly as it is.',
  },
  {
    id: 'colour',
    name: 'Colour',
    tagline: 'The palette is the puzzle. Layout is thrown away or left alone.',
  },
  {
    id: 'detail',
    name: 'Detail',
    tagline: 'You get part of the flag, or all of it with the detail taken out.',
  },
  {
    id: 'distortion',
    name: 'Distortion',
    tagline: 'The whole flag, bent out of the shape you know it in.',
  },
  {
    id: 'compare',
    name: 'Compare',
    tagline: 'More than one flag on screen. Tell them apart.',
  },
];

/**
 * A mode is `live` (playable now) or `soon` (listed so the shape of the site
 * is visible, and so the ordering argument in the README stays honest).
 *
 * `filter` is a CSS filter string. Any mode expressible that way needs no
 * canvas work and stays vector-crisp at any size, which is why `inverted`
 * ships first: it is the only headline mode with no build pipeline behind it.
 */
export const MODES = [
  {
    id: 'classic',
    name: 'Classic',
    category: 'basics',
    rank: 1,
    status: 'live',
    blurb: 'Just the flag. No filter, no crop, nothing hidden. Name the country.',
    hint: 'The one everyone starts with.',
    preview: 'br',
  },
  {
    id: 'inverted',
    name: 'Inverted',
    category: 'colour',
    rank: 2,
    status: 'live',
    blurb: 'Every colour flipped to its opposite. Red goes cyan, white goes black.',
    hint: 'Think in opposites: cyan is red, yellow is blue, black is white.',
    // Inverted Japan is a near-black tile; South Africa has enough colours
    // that the flipped palette actually reads as a flag.
    preview: 'za',
    filter: 'invert(1)',
  },
  {
    id: 'zoomed',
    name: 'Zoomed',
    category: 'detail',
    rank: 3,
    status: 'live',
    blurb: 'A small crop blown up. Sometimes a gift, sometimes almost nothing.',
    hint: 'Crops are picked to be answerable, never to be a solid colour.',
    preview: 'br',
    // Draws a region of the flag chosen at build time, and grades against the
    // other flags that region could equally belong to.
    stage: 'crop',
    ambiguity: 'crop',
  },
  {
    id: 'colour-pie',
    name: 'Colour Pie',
    category: 'colour',
    rank: 4,
    status: 'live',
    blurb: 'Just a pie chart of the flag&rsquo;s colours and how much of it each covers.',
    hint: 'Slice sizes are exact. Order tells you nothing.',
    preview: 'za',
    // Draws from the measured palette instead of showing the flag, and grades
    // against palette twins because several flags make the same pie.
    stage: 'pie',
    ambiguity: 'palette',
  },
  {
    id: 'mosaic',
    name: 'Mosaic',
    category: 'detail',
    rank: 5,
    status: 'live',
    blurb: 'The flag reduced to a handful of coloured blocks.',
    hint: 'Each flag is shown at the blockiest grid that still tells it apart from the rest.',
    preview: 'br',
    // Draws the blocks measured at build time, and grades against the flags
    // whose blocks are indistinguishable from them.
    stage: 'mosaic',
    ambiguity: 'mosaic',
  },
  {
    id: 'blur',
    name: 'Blur Reveal',
    category: 'detail',
    rank: 6,
    status: 'live',
    blurb: 'Starts as a smear and sharpens on a timer. Answer early, score more.',
    hint: 'It always comes into focus. The question is how long you need.',
    preview: 'br',
    // The card shows the starting blur. In play the blur is set in pixels
    // scaled to the flag on screen, so it looks the same on a phone.
    filter: 'blur(14px)',
    stage: 'reveal',
    scoring: 'decay',
  },
  {
    id: 'real-or-fake',
    name: 'Real or Fake?',
    category: 'compare',
    rank: 7,
    status: 'live',
    blurb: 'One flag, altered or not. Two colours traded, or the whole thing flipped.',
    hint: 'Every alteration is checked against all 250 flags, so a fake is never another country.',
    // A mirrored United States: the canton jumps to the right, which says what
    // the mode is at a glance without needing the altered-flag machinery here.
    preview: 'us',
    previewTransform: 'scaleX(-1)',
    // Shows the flag either genuine or altered, and asks about the flag rather
    // than about the country, so it has its own answer control.
    stage: 'altered',
    answer: 'binary',
  },
  {
    id: 'greyscale',
    name: 'Greyscale',
    category: 'colour',
    rank: 8,
    status: 'live',
    blurb: 'Layout intact, colour gone. Do you know it by shape or by colour?',
    hint: 'Fifteen flags lose the thing that told them apart. Those accept each other.',
    preview: 'br',
    filter: 'grayscale(1)',
    // Unlike inverting, turning a flag grey destroys information: Austria and
    // the Netherlands come out the same flag.
    ambiguity: 'greyscale',
  },
  {
    id: 'twins',
    name: 'Twin Flags',
    category: 'compare',
    rank: 9,
    status: 'live',
    blurb: 'Chad and Romania. Indonesia and Monaco. Which one is which?',
    hint: 'The only quiz that shows you both. A shade of blue counts as evidence here.',
    preview: 'ro',
    // Two flags at once, so this one takes the place of the stage rather than
    // filling it, and you answer by pointing at one.
    stage: 'pair',
    answer: 'pair',
  },
  {
    id: 'silhouette',
    name: 'Silhouette',
    category: 'detail',
    rank: 10,
    status: 'soon',
    blurb: 'The emblem alone, flattened to one colour on an empty field.',
  },
  {
    id: 'scrambled',
    name: 'Scrambled',
    category: 'distortion',
    rank: 11,
    status: 'soon',
    blurb: 'Cut into a grid and shuffled. Reassemble it in your head.',
  },
  {
    id: 'palette-bar',
    name: 'Palette Bar',
    category: 'colour',
    rank: 12,
    status: 'live',
    blurb: 'The same colours as one stacked bar, shuffled so only the widths help.',
    hint: 'Order is random here. The pie always runs biggest first; this does not.',
    preview: 'za',
    // Same measured palette as the pie, so the same flags make the same bar.
    stage: 'bar',
    ambiguity: 'palette',
  },
  {
    id: 'polar',
    name: 'Polar',
    category: 'distortion',
    rank: 13,
    status: 'soon',
    blurb: 'Wrapped into a disc. Stripes become rings, or wedges.',
  },
  {
    id: 'hue-rotate',
    name: 'Hue Shift',
    category: 'colour',
    rank: 14,
    status: 'live',
    blurb: 'Hue turned halfway round the wheel, brightness untouched.',
    hint: 'Nothing is hidden, only moved. Red goes cyan-ish, green goes violet.',
    preview: 'br',
    filter: 'hue-rotate(180deg)',
    // Near enough one-to-one, but the build measures that rather than assuming
    // it: the CSS filter is a matrix whose output is clamped.
    ambiguity: 'hue-rotate',
  },
  {
    id: 'swatches',
    name: 'Swatches',
    category: 'colour',
    rank: 15,
    status: 'soon',
    blurb: 'The colours as loose squares. No order, no proportions, no help.',
  },
  {
    id: 'single-row',
    name: 'One Pixel Row',
    category: 'detail',
    rank: 16,
    status: 'soon',
    blurb: 'A single row of pixels, stretched tall. Easy for stripes, cruel otherwise.',
  },
  {
    id: 'mirror',
    name: 'Mirrored',
    category: 'distortion',
    rank: 17,
    status: 'soon',
    blurb: 'Flipped or turned a quarter turn.',
  },
  {
    id: 'odd-one-out',
    name: 'Odd One Out',
    category: 'compare',
    rank: 18,
    status: 'soon',
    blurb: 'Four flags, three with something in common. Find the outsider.',
  },
  {
    id: 'more-or-less',
    name: 'More or Less',
    category: 'compare',
    rank: 19,
    status: 'soon',
    blurb: 'Two flags, one question: which one is more red?',
  },
  {
    id: 'blend',
    name: 'Blend',
    category: 'compare',
    rank: 20,
    status: 'soon',
    blurb: 'Two flags averaged into one. Name both.',
  },
  {
    id: 'wireframe',
    name: 'Wireframe',
    category: 'distortion',
    rank: 21,
    status: 'soon',
    blurb: 'Outlines only, every fill removed.',
  },
];

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
export const MODE_BY_ID = new Map(MODES.map((m) => [m.id, m]));

export const liveModes = () => MODES.filter((m) => m.status === 'live');
export const modesInCategory = (id) =>
  MODES.filter((m) => m.category === id).sort((a, b) => a.rank - b.rank);
