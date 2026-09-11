/**
 * Free-text answer matching and suggestions.
 *
 * The goal is to grade knowledge, not spelling. Somebody who types
 * "Kyrgystan" or "cote divoire" knew the answer, and the quiz should say so.
 */

/**
 * Folds a typed answer to a comparable key: accents stripped, case dropped,
 * punctuation and spacing flattened. "Côte d'Ivoire" and "cote d ivoire" land
 * on the same key.
 *
 * Names in scripts with no Latin characters fold to an empty string and are
 * skipped by the index, which is correct: they cannot be typed on the
 * keyboards this input is built for.
 */
export function fold(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every spelling that should be accepted for a country. */
export function acceptedNames(country) {
  return [country.name, country.officialName, ...(country.altNames ?? [])];
}

/**
 * Edit distance, bailing out once it exceeds `max`. Only ever runs against a
 * single country's own names, so it never scans the whole dataset.
 */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, curr[j]);
    }
    if (best > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/**
 * How wrong a spelling may be before it stops counting. Short names get no
 * slack, because at four characters a single edit is usually a different
 * country: Chad and Cuba, Mali and Malí, Iran and Iraq.
 */
function tolerance(length) {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  return 2;
}

/** Builds the lookup structures for one pool of countries. */
export function buildIndex(pool) {
  const exact = new Map();
  const names = [];

  for (const country of pool) {
    for (const name of acceptedNames(country)) {
      const key = fold(name);
      if (!key) continue;
      if (!exact.has(key)) exact.set(key, new Set());
      exact.get(key).add(country.code);
    }
    // Suggestions match on aliases too, so "cote" finds Ivory Coast and "espana"
    // finds Spain. The canonical name is always what gets displayed.
    names.push({ country, key: fold(country.name), primary: true });
    for (const alias of [country.officialName, ...(country.altNames ?? [])]) {
      const key = fold(alias);
      if (key && key !== fold(country.name)) names.push({ country, key, primary: false });
    }
  }

  return { exact, names, byCode: new Map(pool.map((c) => [c.code, c])) };
}

/**
 * Suggestions for the type-ahead.
 *
 * Prefix matches rank above substring matches, so typing "ind" offers India
 * and Indonesia before British Indian Ocean Territory.
 */
export function suggest(index, query, limit = 6) {
  const key = fold(query);
  if (key.length < MIN_SUGGEST_CHARS) return [];

  // Tiers, best first: English name prefix, English name substring, then the
  // same two over aliases and translations. Aliases rank below every English
  // match so typing "ne" offers Nepal and Netherlands rather than Germany via
  // the Hungarian "Nemetorszag" - but "cote" and "espana", which match nothing
  // in English, still find Ivory Coast and Spain.
  const tiers = [[], [], [], []];

  for (const { country, key: name, primary } of index.names) {
    const starts = name.startsWith(key);
    if (!starts && !name.includes(key)) continue;
    const tier = primary ? (starts ? 0 : 1) : starts ? 2 : 3;
    tiers[tier].push(country);
  }

  const seen = new Set();
  const out = [];
  for (const tier of tiers) {
    for (const country of tier) {
      if (seen.has(country.code)) continue;
      seen.add(country.code);
      out.push(country);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Two characters, not one.
 *
 * A single letter would list a whole alphabetical block and turn the input
 * into a browsable index of every country, which is the one thing a typed
 * answer is meant to avoid. Two characters means the player has already
 * recalled how the name starts, and everything after that is spelling help.
 */
export const MIN_SUGGEST_CHARS = 2;

/**
 * Grades a typed answer.
 *
 * Returns whether it was right, and which country the player appears to have
 * named, so a wrong answer can be reported as what they actually said rather
 * than just "incorrect".
 */
export function judge(index, query, answer) {
  const key = fold(query);
  if (!key) return { correct: false, named: null };

  const exact = index.exact.get(key);
  if (exact) {
    if (exact.has(answer.code)) return { correct: true, named: answer };
    const [first] = exact;
    return { correct: false, named: index.byCode.get(first) ?? null };
  }

  // Not a known spelling: allow for typos, but only against the right answer.
  const max = tolerance(key.length);
  if (max > 0) {
    for (const name of acceptedNames(answer)) {
      const candidate = fold(name);
      if (!candidate) continue;
      if (editDistance(key, candidate, max) <= max) {
        return { correct: true, named: answer };
      }
    }
  }

  return { correct: false, named: null };
}
