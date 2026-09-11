/**
 * The hub. Renders entirely from the mode registry, so it can never list a
 * mode that does not exist or miss one that does.
 */
import { CATEGORIES, MODES, modesInCategory, liveModes } from '../registry.js';
import { loadCountries, flagUrl } from '../data.js';

const PREVIEW_CODES = ['br', 'jp', 'za', 'in', 'ca', 'gr', 'ke', 'kr', 'mx', 'se'];

function modeCard(mode) {
  const live = mode.status === 'live';
  const tag = live
    ? '<span class="tag tag--live">Playable</span>'
    : '<span class="tag tag--soon">Soon</span>';

  const preview = mode.filter
    ? `<div class="card__preview" style="--mode-filter:${mode.filter}"><img alt="" aria-hidden="true" data-preview></div>`
    : '<div class="card__preview card__preview--empty" aria-hidden="true"><span>?</span></div>';

  const inner = `
    ${preview}
    <div class="card__body">
      <div class="card__head">
        <h3 class="card__title">${mode.name}</h3>
        ${tag}
      </div>
      <p class="card__blurb">${mode.blurb}</p>
      <p class="card__meta">${mode.difficulty}</p>
    </div>`;

  return live
    ? `<a class="card card--live" href="#/play/${mode.id}">${inner}</a>`
    : `<div class="card card--soon" aria-disabled="true">${inner}</div>`;
}

function categorySection(category) {
  const modes = modesInCategory(category.id);
  if (!modes.length) return '';
  const playable = modes.filter((m) => m.status === 'live').length;

  return `
    <section class="category" id="${category.id}">
      <div class="category__head">
        <h2 class="category__title">${category.name}</h2>
        <p class="category__tagline">${category.tagline}</p>
        <p class="category__count">${playable} of ${modes.length} playable</p>
      </div>
      <div class="grid">${modes.map(modeCard).join('')}</div>
    </section>`;
}

export function renderHome(root) {
  const live = liveModes();
  const featured = live[0];

  root.innerHTML = `
    <section class="hero">
      <p class="hero__eyebrow">${MODES.length} quizzes planned &middot; ${live.length} playable now</p>
      <h1 class="hero__title">Do you actually know the flags?</h1>
      <p class="hero__lede">
        Every quiz here takes the same 250 country flags and hides them in a
        different way. Invert the colours, crop them, blur them, reduce them to
        nothing but a pie chart of their palette. Then you name the country.
      </p>
      ${
        featured
          ? `<a class="btn btn--primary btn--lg" href="#/play/${featured.id}">Play ${featured.name}</a>`
          : ''
      }
    </section>

    <nav class="jump" aria-label="Quiz categories">
      ${CATEGORIES.map((c) => `<a class="jump__link" href="#${c.id}">${c.name}</a>`).join('')}
    </nav>

    ${CATEGORIES.map(categorySection).join('')}
  `;

  fillPreviews(root);
}

/** Card previews use real flags, so each card demonstrates its own transform. */
async function fillPreviews(root) {
  const slots = [...root.querySelectorAll('[data-preview]')];
  if (!slots.length) return;

  const countries = await loadCountries();
  const byCode = new Map(countries.map((c) => [c.code, c]));

  slots.forEach((img, i) => {
    const country = byCode.get(PREVIEW_CODES[i % PREVIEW_CODES.length]);
    if (country) img.src = flagUrl(country);
  });
}
