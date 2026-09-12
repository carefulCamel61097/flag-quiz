/**
 * Builds the flag asset set and the country dataset from two pinned upstream
 * packages, so the site itself needs no build step and no network at runtime.
 *
 *   flag-icons      -> 4:3 SVG flag for every ISO 3166-1 alpha-2 code
 *   world-countries -> names, capitals, regions, UN membership
 *
 * Outputs:
 *   assets/flags/4x3/<code>.svg
 *   data/countries.json
 *   data/sources.json
 *
 * Run with: npm run build:flags
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'node_modules');

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const flagIcons = read(join(modules, 'flag-icons', 'country.json'));
const flagIconsPkg = read(join(modules, 'flag-icons', 'package.json'));
const worldCountries = read(join(modules, 'world-countries', 'countries.json'));
const worldCountriesPkg = read(join(modules, 'world-countries', 'package.json'));

// flag-icons ships subdivisions (gb-sct) and organisations (eu, un) alongside
// real countries. `iso: true` keeps only ISO 3166-1 alpha-2 entries.
// XK (Kosovo) is only "exceptionally reserved" rather than officially assigned,
// so flag-icons marks it non-ISO, but it ships the flag and world-countries
// lists the country. Keep it: it is fair quiz material.
const EXTRA_CODES = new Set(['xk']);
const svgFor = new Map(
  flagIcons
    .filter((e) => e.iso || EXTRA_CODES.has(e.code.toLowerCase()))
    .map((e) => [e.code.toLowerCase(), e.flag_4x3])
);

// world-countries reports Vatican City as a UN member; it is a permanent
// observer state, like Palestine. Everything else in that field is correct.
const OBSERVER_STATES = new Set(['VA', 'PS']);
const PARTIALLY_RECOGNISED = new Set(['TW', 'XK']);

function sovereigntyOf(country) {
  const code = country.cca2;
  if (OBSERVER_STATES.has(code)) return 'observer-state';
  if (PARTIALLY_RECOGNISED.has(code)) return 'partially-recognised';
  if (country.unMember) return 'un-member';
  return 'territory';
}

const countries = [];
const missing = [];

for (const c of worldCountries) {
  const code = c.cca2.toLowerCase();
  const svg = svgFor.get(code);
  if (!svg) {
    missing.push(c.cca2);
    continue;
  }
  const altNames = [
    c.name.official,
    ...(c.altSpellings ?? []),
    ...Object.values(c.translations ?? {}).map((t) => t?.common),
  ].filter((n) => n && n !== c.name.common && n !== c.cca2);

  countries.push({
    code,
    code3: c.cca3.toLowerCase(),
    name: c.name.common,
    officialName: c.name.official,
    altNames: [...new Set(altNames)],
    capital: c.capital?.[0] ?? null,
    region: c.region ?? null,
    subregion: c.subregion ?? null,
    sovereignty: sovereigntyOf(c),
    flag: `assets/flags/4x3/${code}.svg`,
  });
}

countries.sort((a, b) => a.name.localeCompare(b.name, 'en'));

/**
 * Some countries share a flag exactly.
 *
 * Every French overseas territory uses the French tricolour, Heard Island uses
 * Australia's, and Saint Helena uses the Union Jack - thirteen flags in three
 * groups. Shown one of them, a quiz has several equally correct answers, so
 * each country needs to know its doubles: they must all be accepted, and two
 * of them must never appear as options in the same question.
 *
 * The `id` attribute is the only difference between otherwise identical files,
 * so it is stripped before hashing.
 */
const byArt = new Map();
for (const country of countries) {
  const art = readFileSync(join(root, country.flag), 'utf8')
    .replace(/id="flag-icons-[a-z-]+"/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const key = createHash('sha1').update(art).digest('hex');
  if (!byArt.has(key)) byArt.set(key, []);
  byArt.get(key).push(country.code);
}
for (const country of countries) {
  const group = [...byArt.values()].find((g) => g.includes(country.code));
  country.sameFlagAs = group.filter((code) => code !== country.code);
}
const shared = [...byArt.values()].filter((g) => g.length > 1);

/**
 * How prominent each country is, used to cut the quiz down to better-known
 * flags. Reads the snapshot in data/fame.json; see scripts/build-fame.mjs.
 *
 * Two signals, because neither works alone. Wikipedia traffic on its own
 * measures how often a country is looked up, which tourism and news drive more
 * than familiarity does - it put Mauritius and Monaco above Belgium and
 * Greece. Population on its own puts Burkina Faso above Denmark. Weighted 70/30
 * towards traffic, the pair behaves much more like prominence than either does
 * by itself.
 *
 * Both are logged first: India has 200 times the population of Iceland, but
 * its flag is not 200 times better known.
 */
const VIEW_WEIGHT = 0.7;

const famePath = join(root, 'data', 'fame.json');
let fame = null;
try {
  fame = JSON.parse(readFileSync(famePath, 'utf8'));
} catch {
  console.warn('No data/fame.json - countries will have no prominence ranking.');
}

if (fame) {
  const scored = countries.filter((c) => fame.views[c.code] != null);
  const log = (n) => Math.log10(Math.max(n ?? 1, 1));
  const viewLogs = scored.map((c) => log(fame.views[c.code]));
  const popLogs = scored
    .filter((c) => fame.population[c.code] != null)
    .map((c) => log(fame.population[c.code]));
  const vMin = Math.min(...viewLogs);
  const vMax = Math.max(...viewLogs);
  const pMin = Math.min(...popLogs);
  const pMax = Math.max(...popLogs);

  for (const country of countries) {
    const views = fame.views[country.code];
    if (views == null) {
      country.prominence = null;
      continue;
    }
    const v = (log(views) - vMin) / (vMax - vMin);
    // With no population figure, traffic stands alone rather than dragging the
    // country to the bottom of the table.
    const pop = fame.population[country.code];
    const p = pop == null ? v : (log(pop) - pMin) / (pMax - pMin);
    country.prominence = Number((VIEW_WEIGHT * v + (1 - VIEW_WEIGHT) * p).toFixed(4));
  }

  // Rank runs over UN members only: the tiers are cut from that list, and
  // mixing territories in would push real countries down the table.
  const ranked = countries
    .filter((c) => c.sovereignty === 'un-member' && c.prominence != null)
    .sort((a, b) => b.prominence - a.prominence);
  ranked.forEach((country, i) => {
    country.fameRank = i + 1;
  });
  for (const country of countries) country.fameRank ??= null;
}

// Copy the SVGs fresh each run so removed upstream entries do not linger.
const outDir = join(root, 'assets', 'flags', '4x3');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const c of countries) {
  copyFileSync(join(modules, 'flag-icons', 'flags', '4x3', `${c.code}.svg`), join(outDir, `${c.code}.svg`));
}

const sources = {
  generatedBy: 'scripts/build-flags.mjs',
  flags: {
    package: 'flag-icons',
    version: flagIconsPkg.version,
    license: flagIconsPkg.license,
    homepage: 'https://github.com/lipis/flag-icons',
  },
  metadata: {
    package: 'world-countries',
    version: worldCountriesPkg.version,
    // Not declared in its package.json; stated in the upstream LICENSE file.
    license: worldCountriesPkg.license ?? 'ODbL-1.0',
    homepage: 'https://github.com/mledoze/countries',
  },
};

mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(join(root, 'data', 'countries.json'), JSON.stringify(countries, null, 2) + '\n');
writeFileSync(join(root, 'data', 'sources.json'), JSON.stringify(sources, null, 2) + '\n');

const byTier = countries.reduce((acc, c) => ({ ...acc, [c.sovereignty]: (acc[c.sovereignty] ?? 0) + 1 }), {});
console.log(`Wrote ${readdirSync(outDir).length} flags to assets/flags/4x3/`);
console.log(`Wrote ${countries.length} countries to data/countries.json`);
console.log('By sovereignty:', byTier);
console.log(
  `Identical flags: ${shared.length} group(s) covering ${shared.reduce((n, g) => n + g.length, 0)} countries`
);
if (fame) {
  const ranked = countries.filter((c) => c.fameRank).sort((a, b) => a.fameRank - b.fameRank);
  console.log(`Ranked ${ranked.length} UN members by prominence`);
  console.log('  most:', ranked.slice(0, 6).map((c) => c.name).join(', '));
  console.log('  at 60:', ranked[59]?.name, '| at 130:', ranked[129]?.name);
  console.log('  least:', ranked.slice(-4).map((c) => c.name).join(', '));
}
if (missing.length) console.warn('No flag found for:', missing.join(', '));
