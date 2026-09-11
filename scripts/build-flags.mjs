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
if (missing.length) console.warn('No flag found for:', missing.join(', '));
