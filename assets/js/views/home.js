/**
 * The hub. Renders entirely from the mode registry, so it can never list a
 * mode that does not exist or miss one that does.
 */
import { CATEGORIES, MODES, modesInCategory, liveModes } from '../registry.js';
import { loadCountries, loadColours, flagUrl, SCOPES, scopeCounts } from '../data.js';
import { readScope, writeScope } from '../settings.js';

const FALLBACK_PREVIEW = 'br';

function modeCard(mode) {
  const code = mode.preview ?? FALLBACK_PREVIEW;
  // A card shows what its quiz actually looks like, so the pie mode previews a
  // pie rather than a flag.
  const preview =
    mode.stage === 'pie'
      ? `<div class="card__preview card__preview--pie"><div class="pie" data-pie-preview="${code}"></div></div>`
      : `<div class="card__preview" style="--mode-filter:${mode.filter ?? 'none'}">
           <img alt="" aria-hidden="true" data-preview="${code}">
         </div>`;

  return `
    <a class="card" href="#/play/${mode.id}">
      ${preview}
      <div class="card__body">
        <h3 class="card__title">${mode.name}</h3>
        <p class="card__blurb">${mode.blurb}</p>
      </div>
    </a>`;
}

/**
 * Unbuilt modes are listed as compact rows, not as cards.
 *
 * Giving them the same card as a playable mode filled the page with empty
 * placeholder tiles, so the site read as broken rather than as one with a
 * roadmap. A dense list says "planned" without competing for attention.
 */
function upcomingRow(mode) {
  return `
    <li class="upcoming__item">
      <span class="upcoming__name">${mode.name}</span>
      <span class="upcoming__blurb">${mode.blurb}</span>
    </li>`;
}

function categorySection(category) {
  const modes = modesInCategory(category.id);
  if (!modes.length) return '';

  const live = modes.filter((m) => m.status === 'live');
  const soon = modes.filter((m) => m.status !== 'live');

  return `
    <section class="category" id="${category.id}">
      <div class="category__head">
        <h2 class="category__title">${category.name}</h2>
        <p class="category__tagline">${category.tagline}</p>
      </div>

      ${live.length ? `<div class="grid">${live.map(modeCard).join('')}</div>` : ''}

      ${
        soon.length
          ? `<div class="upcoming">
               <h3 class="upcoming__title">Planned</h3>
               <ul class="upcoming__list">${soon.map(upcomingRow).join('')}</ul>
             </div>`
          : ''
      }
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
    </section>

    <!-- The selection used to live only inside the quiz, where nobody saw it:
         the flag on screen takes all the attention. Choosing before you start
         is both more visible and the more natural order. -->
    <!-- The bar is a direct child of the page, not of a short wrapper: a
         sticky element only sticks inside its own parent's box, so nesting it
         in the intro block would unpin it as soon as the intro scrolled by. -->
    <div class="picker__sentinel" data-sentinel aria-hidden="true"></div>
    <div class="picker__bar" data-picker-root>
      <h2 class="picker__title">Which flags?</h2>
      <div class="picker__options" role="radiogroup" aria-label="Which flags to include" data-picker>
        ${Object.values(SCOPES)
          .map(
            (s) => `
          <button class="picker__option" type="button" role="radio"
                  aria-checked="false" data-scope="${s.id}">
            <span class="picker__label">${s.label}</span>
            <span class="picker__count" data-count="${s.id}"></span>
          </button>`
          )
          .join('')}
      </div>
      <p class="picker__applies">Applies to every quiz</p>
    </div>

    <div class="picker__tail">
      <p class="picker__note" data-scope-note></p>
      ${
        featured
          ? `<a class="btn btn--primary btn--lg" href="#/play/${featured.id}">Play ${featured.name}</a>`
          : ''
      }
    </div>

    <nav class="jump" aria-label="Quiz categories">
      ${CATEGORIES.map((c) => `<a class="jump__link" href="#${c.id}">${c.name}</a>`).join('')}
    </nav>

    ${CATEGORIES.map(categorySection).join('')}
  `;

  fillPreviews(root);
  wirePicker(root);
}

/** The flag selection, shared with the play screen through localStorage. */
async function wirePicker(root) {
  const picker = root.querySelector('[data-picker]');
  if (!picker) return;
  const note = root.querySelector('[data-scope-note]');

  const paint = (id) => {
    for (const button of picker.querySelectorAll('.picker__option')) {
      const on = button.dataset.scope === id;
      button.classList.toggle('is-selected', on);
      button.setAttribute('aria-checked', String(on));
    }
    note.textContent = SCOPES[id].note;
  };

  paint(readScope());

  picker.addEventListener('click', (e) => {
    const button = e.target.closest('.picker__option');
    if (!button) return;
    writeScope(button.dataset.scope);
    paint(button.dataset.scope);
  });

  stickWhenScrolled(root);

  const counts = await scopeCounts();
  for (const [id, n] of Object.entries(counts)) {
    const slot = root.querySelector(`[data-count="${id}"]`);
    if (slot) slot.textContent = `${n} flags`;
  }
}

/**
 * The selection sticks under the masthead once you scroll past it, so it stays
 * obvious that it is one setting governing every quiz below rather than part
 * of the intro.
 *
 * A sentinel above it decides when: once that scrolls out of view the bar is
 * pinned, and it compresses so it costs little height.
 */
function stickWhenScrolled(root) {
  const sentinel = root.querySelector('[data-sentinel]');
  const picker = root.querySelector('[data-picker-root]');
  if (!sentinel || !picker || typeof IntersectionObserver !== 'function') return;

  new IntersectionObserver(
    ([entry]) => picker.classList.toggle('is-stuck', !entry.isIntersecting),
    { threshold: 0 }
  ).observe(sentinel);
}

/** Card previews use real data, so each card demonstrates its own transform. */
async function fillPreviews(root) {
  const flagSlots = [...root.querySelectorAll('[data-preview]')];
  const pieSlots = [...root.querySelectorAll('[data-pie-preview]')];

  if (flagSlots.length) {
    const byCode = new Map((await loadCountries()).map((c) => [c.code, c]));
    for (const img of flagSlots) {
      const country = byCode.get(img.dataset.preview);
      if (country) img.src = flagUrl(country);
    }
  }

  if (pieSlots.length) {
    const { flags } = await loadColours();
    for (const slot of pieSlots) {
      const colours = flags[slot.dataset.piePreview];
      if (!colours) continue;
      let at = 0;
      const stops = colours.map((c) => {
        const from = at * 100;
        at += c.share;
        return `${c.hex} ${from.toFixed(3)}% ${(at * 100).toFixed(3)}%`;
      });
      slot.style.background = `conic-gradient(from -90deg, ${stops.join(', ')})`;
    }
  }
}
