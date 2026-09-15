/**
 * The hub. Renders entirely from the mode registry, so it can never list a
 * mode that does not exist or miss one that does.
 */
import { CATEGORIES, MODES, modesInCategory, liveModes } from '../registry.js';
import {
  loadCountries,
  loadColours,
  loadMosaics,
  loadEmblems,
  flagUrl,
  SCOPES,
  scopeCounts,
} from '../data.js';
import { silhouetteUrl } from '../stages.js';
import { readScope, writeScope } from '../settings.js';

const FALLBACK_PREVIEW = 'br';

function modeCard(mode) {
  const code = mode.preview ?? FALLBACK_PREVIEW;
  // A card shows what its quiz actually looks like, so the pie mode previews a
  // pie rather than a flag.
  let preview;
  if (mode.stage === 'pie') {
    preview = `<div class="card__preview card__preview--pie">
                 <div class="pie" data-pie-preview="${code}"></div>
               </div>`;
  } else if (mode.stage === 'silhouette') {
    preview = `<div class="card__preview card__preview--emblem">
                 <img alt="" aria-hidden="true" data-emblem-preview="${code}">
               </div>`;
  } else if (mode.stage === 'bar') {
    preview = `<div class="card__preview card__preview--bar">
                 <div class="bar" data-bar-preview="${code}"></div>
               </div>`;
  } else if (mode.stage === 'mosaic') {
    preview = `<div class="card__preview card__preview--mosaic">
                 <div class="mosaic" data-mosaic-preview="${code}"></div>
               </div>`;
  } else {
    preview = `<div class="card__preview" style="--mode-filter:${mode.filter ?? 'none'}">
                 <img alt="" aria-hidden="true" data-preview="${code}"
                      ${mode.previewTransform ? `style="transform:${mode.previewTransform}"` : ''}>
               </div>`;
  }

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

/** The same four buttons, rendered into both the expanded and pinned copies. */
function pickerOptions() {
  return `
    <div class="picker__options" role="radiogroup" aria-label="Which flags to include">
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
    </div>`;
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
        nothing but a pie chart of their palette, or quietly alter one and see
        if you notice. Then you name the country.
      </p>
    </section>

    <!-- The selection used to live only inside the quiz, where nobody saw it:
         the flag on screen takes all the attention. Choosing before you start
         is both more visible and the more natural order. -->
    <section class="picker" data-picker-expanded>
      <h2 class="picker__title">Which flags?</h2>
      ${pickerOptions()}
      <p class="picker__note" data-scope-note></p>
      ${
        featured
          ? `<a class="btn btn--primary btn--lg" href="#/play/${featured.id}">Play ${featured.name}</a>`
          : ''
      }
    </section>

    <!-- A separate, fixed copy rather than making the one above sticky.
         Sticky kept it in the flow, so compressing it on pin moved everything
         below and the two states fought each other. Fixed is out of the flow
         entirely: nothing shifts, and there is no feedback loop to flicker. -->
    <div class="picker-pinned" data-picker-pinned aria-hidden="true">
      ${pickerOptions()}
      <p class="picker-pinned__note">Applies to every quiz</p>
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
  const expanded = root.querySelector('[data-picker-expanded]');
  const pinned = root.querySelector('[data-picker-pinned]');
  if (!expanded || !pinned) return;
  const note = root.querySelector('[data-scope-note]');

  const paint = (id) => {
    for (const button of root.querySelectorAll('.picker__option')) {
      const on = button.dataset.scope === id;
      button.classList.toggle('is-selected', on);
      button.setAttribute('aria-checked', String(on));
    }
    note.textContent = SCOPES[id].note;
  };

  paint(readScope());

  for (const host of [expanded, pinned]) {
    host.addEventListener('click', (e) => {
      const button = e.target.closest('.picker__option');
      if (!button) return;
      writeScope(button.dataset.scope);
      paint(button.dataset.scope);
    });
  }

  showPinnedWhenScrolledPast(expanded, pinned);

  const counts = await scopeCounts();
  for (const [id, n] of Object.entries(counts)) {
    for (const slot of root.querySelectorAll(`[data-count="${id}"]`)) {
      slot.textContent = `${n} flags`;
    }
  }
}

/**
 * The pinned copy appears exactly when the real one goes under the masthead.
 *
 * The margin matters: without it the observer waits until the picker clears
 * the top of the window, which is a whole masthead's worth of scrolling later,
 * and in between the page shows neither copy.
 */
function showPinnedWhenScrolledPast(expanded, pinned) {
  if (typeof IntersectionObserver !== 'function') return;

  const masthead = document.querySelector('.masthead');
  const top = Math.round(masthead?.getBoundingClientRect().height ?? 53);

  new IntersectionObserver(
    ([entry]) => {
      const show = !entry.isIntersecting && entry.boundingClientRect.top < top;
      pinned.classList.toggle('is-shown', show);
      pinned.setAttribute('aria-hidden', String(!show));
    },
    { rootMargin: `-${top}px 0px 0px 0px`, threshold: 0 }
  ).observe(expanded);
}

/** Card previews use real data, so each card demonstrates its own transform. */
async function fillPreviews(root) {
  const flagSlots = [...root.querySelectorAll('[data-preview]')];
  const pieSlots = [...root.querySelectorAll('[data-pie-preview]')];
  const barSlots = [...root.querySelectorAll('[data-bar-preview]')];
  const mosaicSlots = [...root.querySelectorAll('[data-mosaic-preview]')];
  const emblemSlots = [...root.querySelectorAll('[data-emblem-preview]')];

  if (flagSlots.length) {
    const byCode = new Map((await loadCountries()).map((c) => [c.code, c]));
    for (const img of flagSlots) {
      const country = byCode.get(img.dataset.preview);
      if (country) img.src = flagUrl(country);
    }
  }

  if (barSlots.length) {
    const { flags } = await loadColours();
    for (const slot of barSlots) {
      const colours = flags[slot.dataset.barPreview];
      if (!colours) continue;
      slot.innerHTML = colours
        .map((c) => `<i style="background:${c.hex};flex-grow:${c.share.toFixed(5)}"></i>`)
        .join('');
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

  if (emblemSlots.length) {
    const { emblems } = await loadEmblems();
    const byCode = new Map((await loadCountries()).map((c) => [c.code, c]));
    for (const img of emblemSlots) {
      const country = byCode.get(img.dataset.emblemPreview);
      const cut = emblems[img.dataset.emblemPreview];
      if (country && cut) img.src = await silhouetteUrl(country, cut);
    }
  }

  if (mosaicSlots.length) {
    const { mosaics } = await loadMosaics();
    for (const slot of mosaicSlots) {
      // The finer of the two stored grids: a card is small, and four by three
      // blocks at that size is an abstract painting rather than a flag.
      const grid = mosaics[slot.dataset.mosaicPreview]?.at(-1);
      if (!grid) continue;
      slot.style.setProperty('--gx', grid.gx);
      slot.style.setProperty('--gy', grid.gy);
      slot.innerHTML = [...grid.cells.matchAll(/.{3}/g)]
        .map(([code]) => (code === '...' ? '<i></i>' : `<i style="background:#${code}"></i>`))
        .join('');
    }
  }
}
