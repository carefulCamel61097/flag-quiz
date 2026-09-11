/**
 * Loads and caches the country dataset.
 *
 * Paths are resolved against document.baseURI rather than hard-coded from the
 * site root, so the site works both at a domain root and under a project path
 * like /flag-quiz/ on GitHub Pages.
 */

const url = (path) => new URL(path, document.baseURI).href;

/** Scopes a quiz can be played over. */
export const SCOPES = {
  un: {
    id: 'un',
    label: '193 UN members',
    note: 'The standard set. Every sovereign country.',
    match: (c) => c.sovereignty === 'un-member',
  },
  sovereign: {
    id: 'sovereign',
    label: '197 states',
    note: 'UN members, plus observer states and partially recognised ones.',
    match: (c) => c.sovereignty !== 'territory',
  },
  all: {
    id: 'all',
    label: 'All 250 flags',
    note: 'Includes territories: Greenland, Hong Kong, Puerto Rico and friends.',
    match: () => true,
  },
};

export const DEFAULT_SCOPE = 'un';

let cache = null;

export async function loadCountries() {
  if (!cache) {
    const res = await fetch(url('data/countries.json'));
    if (!res.ok) throw new Error(`Could not load country data (HTTP ${res.status})`);
    cache = await res.json();
  }
  return cache;
}

export async function countriesInScope(scopeId) {
  const scope = SCOPES[scopeId] ?? SCOPES[DEFAULT_SCOPE];
  return (await loadCountries()).filter(scope.match);
}

/** Absolute URL for a country's flag, usable as an <img> src. */
export const flagUrl = (country) => url(country.flag);
