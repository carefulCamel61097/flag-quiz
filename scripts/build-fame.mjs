/**
 * Snapshots how often each country is looked up on English Wikipedia, as a
 * stand-in for how well known it is.
 *
 * This is the least bad *computable* answer to "which flags should be in the
 * easy set". It is not the right answer - that is play data, once there is
 * anywhere to put it (see the README). Until then, hand-assigning 193
 * countries to tiers would be guesswork dressed as fact, and this at least
 * measures something real.
 *
 * Known biases, which are worth stating rather than hiding:
 *   - English Wikipedia skews anglophone.
 *   - A country in the news ranks higher than its general fame warrants, even
 *     averaged over a year.
 *   - Looking a country up is not the same as recognising its flag.
 *
 * This script only captures the raw signals. The metric that combines them
 * into a prominence score lives in build-flags.mjs, so it can be retuned
 * without refetching anything.
 *
 * The result is written to data/fame.json and committed, so ordinary builds
 * never touch the network. Pass --refresh to fetch again.
 *
 * Run with: npm run build:fame
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'data', 'fame.json');
const refresh = process.argv.includes('--refresh');

if (existsSync(out) && !refresh) {
  const existing = JSON.parse(readFileSync(out, 'utf8'));
  console.log(
    `data/fame.json already present (${Object.keys(existing.views).length} countries, ` +
      `captured ${existing.meta.capturedAt}). Pass --refresh to fetch again.`
  );
  process.exit(0);
}

const UA = 'flag-quiz/0.1 (https://github.com/carefulCamel61097/flag-quiz)';

/** Twelve whole months ending with last month. */
function window12() {
  const end = new Date();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() - 1);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 11);
  const stamp = (d) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}0100`;
  return { from: stamp(start), to: stamp(end) };
}

/**
 * Wikipedia article titles that do not match the dataset's country name.
 * Everything else resolves through the redirect lookup below.
 */
const TITLE_OVERRIDES = {
  cd: 'Democratic Republic of the Congo',
  cg: 'Republic of the Congo',
  kp: 'North Korea',
  kr: 'South Korea',
  vi: 'United States Virgin Islands',
  vg: 'British Virgin Islands',
  mf: 'Saint Martin (island)',
  sx: 'Sint Maarten',
  cw: 'Curaçao',
  bq: 'Caribbean Netherlands',
  um: 'United States Minor Outlying Islands',
  hm: 'Heard Island and McDonald Islands',
  gs: 'South Georgia and the South Sandwich Islands',
  sh: 'Saint Helena, Ascension and Tristan da Cunha',
  tf: 'French Southern and Antarctic Lands',
  bv: 'Bouvet Island',
  ax: 'Åland Islands',
  eh: 'Western Sahara',
  xk: 'Kosovo',
  // "Georgia" alone is a disambiguation page between the country and the US state.
  ge: 'Georgia (country)',
};

const countries = JSON.parse(
  readFileSync(join(root, 'node_modules', 'world-countries', 'countries.json'), 'utf8')
).map((c) => ({ code: c.cca2.toLowerCase(), code3: c.cca3, name: c.name.common }));
countries.push({ code: 'xk', code3: 'XKX', name: 'Kosovo' });

const wanted = countries.map((c) => ({
  ...c,
  title: TITLE_OVERRIDES[c.code] ?? c.name,
}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries on rate limiting and transient failures.
 *
 * The first version of this swallowed errors and returned zero views, which is
 * far worse than crashing: 73 countries silently scored 0 and the ranking
 * looked perfectly reasonable. Anything that cannot be fetched must be loud.
 */
const get = async (url, attempts = 5) => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    } catch (err) {
      if (attempt === attempts) throw err;
      await sleep(500 * attempt);
      continue;
    }
    if (res.ok) return res.json();
    // 404 means the article genuinely has no data; retrying will not help.
    if (res.status === 404) return null;
    if (attempt === attempts) throw new Error(`HTTP ${res.status} for ${url}`);
    await sleep((res.status === 429 ? 2000 : 500) * attempt);
  }
};

/**
 * Resolve redirects first.
 *
 * The pageviews API counts views on the exact title given, so asking for a
 * redirect like "Czechia" returns the handful of hits on the redirect page
 * rather than the article's real traffic.
 */
async function resolveTitles(items) {
  const resolved = new Map();
  for (let i = 0; i < items.length; i += 40) {
    const batch = items.slice(i, i + 40);
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=' +
      encodeURIComponent(batch.map((b) => b.title).join('|'));
    const data = await get(url);

    const redirects = new Map(
      (data.query?.redirects ?? []).map((r) => [r.from, r.to])
    );
    for (const item of batch) {
      resolved.set(item.code, redirects.get(item.title) ?? item.title);
    }
  }
  return resolved;
}

/**
 * The monthly series, kept rather than summed.
 *
 * Totals are worthless here. A single news month swamps a year of baseline
 * traffic: Cape Verde drew 3.8M views in one month against a 150k baseline,
 * which put it above the United Kingdom. The most recent month is also often
 * still being aggregated and comes back near zero. The median of the twelve
 * months is immune to both, and baseline traffic is what "well known" means.
 */
async function seriesFor(title, { from, to }) {
  const url =
    'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia' +
    `/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/${from}/${to}`;
  const data = await get(url);
  if (!data) return null; // genuinely no such article
  return (data.items ?? []).map((m) => m.views);
}

export function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * A title that resolves to a disambiguation page measures nothing.
 * "Georgia" is the obvious one; this catches the class rather than the case.
 */
async function findDisambiguations(titles) {
  const list = [...new Set(titles)];
  const bad = new Set();
  for (let i = 0; i < list.length; i += 40) {
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&titles=' +
      encodeURIComponent(list.slice(i, i + 40).join('|'));
    const data = await get(url);
    for (const page of Object.values(data?.query?.pages ?? {})) {
      if (page.pageprops && 'disambiguation' in page.pageprops) bad.add(page.title);
    }
  }
  return bad;
}

/** Small pool: Wikimedia asks for politeness, and this runs once. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

/**
 * Population, blended with pageviews below.
 *
 * Pageviews alone measure how often a country is looked up, which is driven by
 * tourism, migration and news rather than by how familiar its flag is: on views
 * alone Mauritius and Monaco outranked Belgium and Greece. Population is the
 * obvious corrective, and the two together behave much more like prominence.
 */
async function fetchPopulations() {
  const url =
    'https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL' +
    '?format=json&date=2019:2024&per_page=3000';
  const data = await get(url);
  const latest = new Map();
  for (const row of data?.[1] ?? []) {
    if (row.value == null || !row.countryiso3code) continue;
    const year = Number(row.date);
    const seen = latest.get(row.countryiso3code);
    if (!seen || year > seen.year) latest.set(row.countryiso3code, { year, value: row.value });
  }
  return latest;
}

const period = window12();
console.log(`Resolving ${wanted.length} article titles...`);
const titles = await resolveTitles(wanted);

console.log(`Fetching pageviews for ${period.from} to ${period.to}...`);
let done = 0;
const counts = await mapPool(wanted, 2, async (item) => {
  const n = await seriesFor(titles.get(item.code), period);
  if (++done % 50 === 0) process.stdout.write(`  ${done}/${wanted.length}
`);
  await sleep(60);
  return n;
});

const months = {};
const views = {};
const resolvedTitles = {};
wanted.forEach((item, i) => {
  months[item.code] = counts[i];
  views[item.code] = counts[i] ? median(counts[i]) : null;
  resolvedTitles[item.code] = titles.get(item.code);
});

console.log('Fetching populations...');
const populations = await fetchPopulations();
const population = {};
for (const item of wanted) {
  population[item.code] = populations.get(item.code3)?.value ?? null;
}

const ambiguous = await findDisambiguations([...titles.values()]);
if (ambiguous.size) {
  throw new Error(
    'These titles are disambiguation pages and measure nothing. Add them to ' +
      `TITLE_OVERRIDES: ${[...ambiguous].join(', ')}`
  );
}

const missing = wanted.filter((item) => views[item.code] == null);
if (missing.length > 5) {
  throw new Error(
    `${missing.length} countries returned no data - refusing to write a ranking ` +
      `built on holes. Missing: ${missing.map((m) => m.code).join(', ')}`
  );
}

writeFileSync(
  out,
  JSON.stringify(
    {
      meta: {
        generatedBy: 'scripts/build-fame.mjs',
        source: 'English Wikipedia pageviews (Wikimedia REST API)',
        period,
        capturedAt: new Date().toISOString().slice(0, 10),
        note: 'Median monthly views over twelve months, per country article. A proxy for how well known a country is, not for flag recognition.',
      },
      titles: resolvedTitles,
      // Median monthly views: the ranking signal.
      views,
      // The raw series, so the metric can be changed without refetching.
      months,
      population,
    },
    null,
    2
  ) + '\n'
);

const ranked = Object.entries(views)
  .filter(([, v]) => v != null)
  .sort((a, b) => b[1] - a[1]);
const noPop = wanted.filter((i) => population[i.code] == null);
console.log(`Wrote ${ranked.length} countries to data/fame.json`);
if (noPop.length) console.log(`No population for ${noPop.length}: ${noPop.map((i) => i.code).join(' ')}`);
console.log('Most looked up:', ranked.slice(0, 8).map(([c]) => c).join(' '));
console.log('Least looked up:', ranked.slice(-8).map(([c]) => c).join(' '));
if (missing.length) console.warn('No article data for:', missing.map((m) => m.code).join(', '));
