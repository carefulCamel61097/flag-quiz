/**
 * The play screen. Mode-agnostic: it asks the mode only for how to present
 * the flag, so every future mode reuses this whole screen.
 */
import { MODE_BY_ID } from '../registry.js';
import {
  countriesInScope,
  loadCountries,
  flagUrl,
  loadColours,
  loadCrops,
  scopeCounts,
  SCOPES,
} from '../data.js';
import {
  SCOPE_KEY,
  ANSWER_KEY,
  ANSWER_MODES,
  readScope,
  readAnswerMode,
  writeSetting,
} from '../settings.js';
import { buildRound, Round, verdictFor } from '../engine.js';
import { buildIndex, suggest, judge, MIN_SUGGEST_CHARS } from '../matching.js';
import { tellApart } from '../tells.js';

/**
 * A pie as a single conic gradient: crisp at any size, no canvas, no library.
 * Starts at twelve o'clock, biggest slice first.
 */
function pieGradient(colours) {
  let at = 0;
  const stops = colours.map((c) => {
    const from = at * 100;
    at += c.share;
    return `${c.hex} ${from.toFixed(3)}% ${(at * 100).toFixed(3)}%`;
  });
  return `conic-gradient(from -90deg, ${stops.join(', ')})`;
}

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

export async function renderQuiz(root, modeId) {
  const mode = MODE_BY_ID.get(modeId);
  if (!mode || mode.status !== 'live') {
    root.innerHTML = `
      <section class="panel panel--centred">
        <h1 class="panel__title">Not playable yet</h1>
        <p class="panel__text">That quiz is still on the roadmap.</p>
        <a class="btn btn--primary" href="#/">Back to the quizzes</a>
      </section>`;
    return;
  }

  const scopeId = readScope();
  const answerMode = readAnswerMode();
  const counts = await scopeCounts();

  let pool;
  try {
    pool = await countriesInScope(scopeId);
  } catch (err) {
    root.innerHTML = `
      <section class="panel panel--centred">
        <h1 class="panel__title">Could not load the flags</h1>
        <p class="panel__text">${escapeHtml(err.message)}</p>
      </section>`;
    return;
  }

  const needsColours = mode.stage === 'pie' || mode.ambiguity === 'palette';
  const needsCrops = mode.stage === 'crop' || mode.ambiguity === 'crop';
  let colourData = null;
  let cropData = null;
  try {
    if (needsColours) colourData = await loadColours();
    if (needsCrops) cropData = await loadCrops();
  } catch (err) {
    root.innerHTML = `
      <section class="panel panel--centred">
        <h1 class="panel__title">Could not load the quiz data</h1>
        <p class="panel__text">${escapeHtml(err.message)}</p>
      </section>`;
    return;
  }

  /**
   * One crop per flag, drawn before the round is built because the crop is
   * what decides which other flags count as the same answer.
   *
   * Two flags have no usable crop at all: Indonesia and Poland are plain
   * bicolours, and every region of them looks like a region of half a dozen
   * other flags. They drop out of this mode rather than being asked as a
   * question with no answer.
   */
  const crops = new Map();
  if (needsCrops) {
    for (const country of pool) {
      const list = cropData.crops[country.code];
      if (list?.length) crops.set(country.code, list[Math.floor(Math.random() * list.length)]);
    }
    pool = pool.filter((c) => crops.has(c.code));
  }

  /**
   * Which other countries count as the same answer here.
   *
   * In a colour mode that is every flag with the same palette; everywhere else
   * it is only the flags that are literally identical, like France and its
   * overseas territories.
   */
  const equivalentsOf = (country) => {
    if (mode.ambiguity === 'palette') return colourData.twins[country.code] ?? [];
    // A crop's equivalents are the flags that same region could belong to,
    // which differs crop by crop rather than flag by flag.
    if (mode.ambiguity === 'crop') return crops.get(country.code)?.with ?? [];
    return country.sameFlagAs ?? [];
  };

  /**
   * Two indexes, deliberately.
   *
   * Suggestions only offer flags the round can actually ask for. Grading runs
   * against every country, because an answer can be right without being in
   * scope: in the 130-flag selection, Indonesia's pie is also Monaco's pie, and
   * Monaco is not in the pool. It reads better when a wrong guess is wrong too
   * - "That is Kiribati" rather than "not a country we recognised".
   */
  const suggestIndex = buildIndex(pool);
  const gradeIndex = buildIndex(await loadCountries());

  const round = new Round(buildRound(pool, { equivalentsOf }));
  let locked = false;

  const settings = (key, current, options) => `
    <label class="setting">
      <span class="sr-only">${key === SCOPE_KEY ? 'Which flags to include' : 'How to answer'}</span>
      <select data-setting="${key}">
        ${options
          .map(
            (o) =>
              `<option value="${o.id}" ${o.id === current ? 'selected' : ''}>${
                o.label
              }${counts[o.id] ? ` · ${counts[o.id]}` : ''}</option>`
          )
          .join('')}
      </select>
    </label>`;

  root.innerHTML = `
    <div class="quiz">
      <header class="quiz__bar">
        <a class="quiz__back" href="#/" aria-label="Back to all quizzes">&larr;</a>
        <span class="quiz__mode">${mode.name}</span>
        <div class="quiz__score">
          <span data-progress></span>
          <span class="quiz__streak" data-streak hidden></span>
        </div>
      </header>

      <div class="quiz__track"><div class="quiz__track-fill" data-track></div></div>

      <div class="stage">
        <figure class="stage__figure" style="--mode-filter:${mode.filter ?? 'none'}">
          <div class="stage__pie" data-pie hidden>
            <div class="stage__disc" data-disc role="img"
                 aria-label="A pie chart of the flag's colours"></div>
          </div>
          <div class="stage__crop" data-crop hidden>
            <div class="stage__crop-window">
              <img class="stage__crop-img" data-crop-img alt="A zoomed-in part of a flag">
            </div>
          </div>
          <img class="stage__flag" data-flag alt="The flag to identify">
          <figcaption class="stage__reveal" data-reveal hidden>
            <img class="stage__reveal-flag" data-reveal-flag alt="">
            <span data-reveal-name></span>
          </figcaption>
        </figure>
      </div>

      <div class="answer" data-answer></div>
      <p class="tell" data-tell hidden></p>

      <div class="quiz__foot">
        <div class="quiz__settings">
          ${settings(SCOPE_KEY, scopeId, Object.values(SCOPES))}
          ${settings(ANSWER_KEY, answerMode, Object.values(ANSWER_MODES))}
        </div>
        <button class="btn btn--primary" data-next hidden>Next</button>
      </div>
    </div>`;

  const el = {
    flag: root.querySelector('[data-flag]'),
    answer: root.querySelector('[data-answer]'),
    progress: root.querySelector('[data-progress]'),
    streak: root.querySelector('[data-streak]'),
    track: root.querySelector('[data-track]'),
    next: root.querySelector('[data-next]'),
    reveal: root.querySelector('[data-reveal]'),
    revealFlag: root.querySelector('[data-reveal-flag]'),
    revealName: root.querySelector('[data-reveal-name]'),
    pie: root.querySelector('[data-pie]'),
    disc: root.querySelector('[data-disc]'),
    tell: root.querySelector('[data-tell]'),
    crop: root.querySelector('[data-crop]'),
    cropImg: root.querySelector('[data-crop-img]'),
    figure: root.querySelector('.stage__figure'),
  };

  /**
   * Shows one region of a flag, blown up to fill a square window.
   *
   * The flag stays an SVG in an oversized <img>, offset so the wanted region
   * lands in the window. No canvas, and the zoom is vector-crisp at any scale.
   *
   * Crop coordinates are fractions: x and size of the flag's width, y of its
   * height. The region is square on screen, so its height is size * 4/3 of the
   * flag's height.
   */
  function showCrop(crop, src) {
    if (!crop) return;
    const zoom = 100 / crop.size; // image width, as a % of the window
    el.cropImg.src = src;
    el.cropImg.style.width = `${zoom}%`;
    el.cropImg.style.left = `${-crop.x * zoom}%`;
    // `top` is a percentage of the square window's height, and the image is
    // 4:3, so its own height is three quarters of its width.
    el.cropImg.style.top = `${-crop.y * zoom * 0.75}%`;
  }

  function paintMeters() {
    el.progress.textContent = `${round.results.length} / ${round.total}`;
    el.streak.hidden = round.streak < 2;
    el.streak.textContent = `${round.streak} in a row`;
    el.track.style.width = `${(round.results.length / round.total) * 100}%`;
  }

  /**
   * In a colour mode a wrong answer is usually a near miss, and "wrong" on its
   * own teaches nothing. If the two palettes are close, say which slice gave it
   * away: that is the only thing that makes the near-identical pairs learnable.
   */
  function showTell(correct, named) {
    el.tell.hidden = true;
    if (correct || !named || mode.ambiguity !== 'palette' || !colourData) return;

    const answer = round.question.answer;
    const line = tellApart(
      colourData.flags[answer.code],
      colourData.flags[named.code],
      answer.name,
      named.name
    );
    if (!line) return;
    el.tell.textContent = line;
    el.tell.hidden = false;
  }

  /** Shared ending for both answer modes. */
  function settle({ correct, named }) {
    const answer = round.question.answer;

    // In pie mode the flag has been hidden all along; the reveal is the moment
    // the chart turns back into the thing it was measured from.
    if (mode.stage === 'pie') {
      el.pie.hidden = true;
      el.flag.hidden = false;
    }
    if (mode.stage === 'crop') {
      el.crop.hidden = true;
      el.flag.hidden = false;
    }
    el.figure.classList.add('is-revealed');
    el.figure.classList.toggle('was-wrong', !correct);
    el.revealFlag.src = flagUrl(answer);
    el.revealName.textContent = answer.name;
    el.reveal.hidden = false;

    showTell(correct, named);
    paintMeters();
    el.next.hidden = false;
    el.next.textContent = round.finished ? 'See results' : 'Next';
    el.next.focus();

    return named;
  }

  // ------------------------------------------------------------- choose mode

  function paintChoices() {
    el.answer.innerHTML = `
      <div class="options" data-options role="group" aria-label="Pick the country">
        ${round.question.options
          .map(
            (c) =>
              `<button class="option" type="button" data-code="${c.code}">${escapeHtml(c.name)}</button>`
          )
          .join('')}
      </div>`;

    el.answer.querySelector('[data-options]').addEventListener('click', (e) => {
      const button = e.target.closest('.option');
      if (!button || locked) return;
      locked = true;

      const answer = round.question.answer;
      const accept = new Set([answer.code, ...round.question.equivalents]);
      const chosen = round.question.options.find((c) => c.code === button.dataset.code);
      const { correct } = round.answer(chosen, { correct: accept.has(chosen.code) });

      for (const b of el.answer.querySelectorAll('.option')) {
        b.disabled = true;
        if (accept.has(b.dataset.code)) b.classList.add('option--correct');
        else if (b === button) b.classList.add('option--wrong');
      }
      settle({ correct, named: chosen });
    });
  }

  // --------------------------------------------------------------- type mode

  function paintInput() {
    el.answer.innerHTML = `
      <form class="typer" data-typer autocomplete="off">
        <div class="typer__field">
          <input
            class="typer__input"
            data-input
            type="text"
            name="country"
            placeholder="Name the country"
            aria-label="Name the country"
            role="combobox"
            aria-expanded="false"
            aria-controls="suggestions"
            aria-autocomplete="list"
            autocapitalize="words"
            autocorrect="off"
            spellcheck="false"
            enterkeyhint="go"
          >
          <ul class="typer__list" id="suggestions" data-list role="listbox" hidden></ul>
        </div>
        <button class="btn btn--primary typer__submit" type="submit">Answer</button>
        <button class="btn btn--ghost typer__skip" type="button" data-skip>Skip</button>
      </form>
      <p class="typer__feedback" data-feedback hidden></p>`;

    const form = el.answer.querySelector('[data-typer]');
    const input = el.answer.querySelector('[data-input]');
    const list = el.answer.querySelector('[data-list]');
    const feedback = el.answer.querySelector('[data-feedback]');
    let items = [];
    let active = -1;

    const closeList = () => {
      list.hidden = true;
      list.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      items = [];
      active = -1;
    };

    const paintList = () => {
      if (!items.length) return closeList();
      list.innerHTML = items
        .map(
          (c, i) =>
            `<li class="typer__option ${i === active ? 'is-active' : ''}" id="sugg-${i}"
                 role="option" aria-selected="${i === active}" data-code="${c.code}">${escapeHtml(c.name)}</li>`
        )
        .join('');
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (active >= 0) input.setAttribute('aria-activedescendant', `sugg-${active}`);
      else input.removeAttribute('aria-activedescendant');
    };

    const submit = (text) => {
      if (locked) return;
      const value = text.trim();
      if (!value) return;
      locked = true;
      closeList();

      const answer = round.question.answer;
      const accept = new Set([answer.code, ...round.question.equivalents]);
      const verdict = judge(gradeIndex, value, answer);

      // Naming a twin is a fair answer to this question, not a near miss.
      const viaTwin =
        !verdict.correct && verdict.named != null && accept.has(verdict.named.code);
      const correct = verdict.correct || viaTwin;
      round.answer(verdict.named, { correct, typed: value });

      input.disabled = true;
      input.value = correct ? (verdict.named ?? answer).name : value;
      input.classList.add(correct ? 'is-correct' : 'is-wrong');
      // Hidden rather than disabled: a greyed-out "Answer" next to a live
      // "Next" reads as two competing actions.
      form.querySelector('[data-skip]').hidden = true;
      form.querySelector('.typer__submit').hidden = true;

      if (viaTwin) {
        feedback.textContent = `Also accepted - ${verdict.named.name} makes the same pie as ${answer.name}.`;
        feedback.className = 'typer__feedback typer__feedback--ok';
        feedback.hidden = false;
      } else if (!correct) {
        feedback.textContent = verdict.named
          ? `That is ${verdict.named.name}.`
          : 'Not a country we recognised.';
        feedback.className = 'typer__feedback';
        feedback.hidden = false;
      }
      settle({ correct, named: verdict.named });
    };

    input.addEventListener('input', () => {
      items = suggest(suggestIndex, input.value);
      active = -1;
      paintList();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        active =
          e.key === 'ArrowDown'
            ? (active + 1) % items.length
            : (active - 1 + items.length) % items.length;
        paintList();
      } else if (e.key === 'Escape') {
        closeList();
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        submit(items[active].name);
      }
    });

    // Pointer, not click: click fires after the input blurs and the list is
    // already gone on some mobile browsers.
    list.addEventListener('pointerdown', (e) => {
      const option = e.target.closest('.typer__option');
      if (!option) return;
      e.preventDefault();
      const country = items.find((c) => c.code === option.dataset.code);
      if (country) submit(country.name);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(input.value);
    });

    form.querySelector('[data-skip]').addEventListener('click', () => {
      if (locked) return;
      locked = true;
      closeList();
      input.disabled = true;
      input.value = '';
      input.placeholder = 'Skipped';
      form.querySelector('.typer__submit').hidden = true;
      form.querySelector('[data-skip]').hidden = true;
      round.answer(null, { correct: false, typed: null });
      settle({ correct: false, named: null });
    });

    input.focus({ preventScroll: true });
  }

  function paintQuestion() {
    locked = false;
    el.figure.classList.remove('is-revealed', 'was-wrong');
    el.reveal.hidden = true;
    el.tell.hidden = true;
    el.next.hidden = true;
    el.flag.src = flagUrl(round.question.answer);

    if (mode.stage === 'pie') {
      el.disc.style.background = pieGradient(colourData.flags[round.question.answer.code]);
      el.pie.hidden = false;
      el.flag.hidden = true;
    }

    if (mode.stage === 'crop') {
      showCrop(crops.get(round.question.answer.code), flagUrl(round.question.answer));
      el.crop.hidden = false;
      el.flag.hidden = true;
    }

    paintMeters();
    if (answerMode === 'type') paintInput();
    else paintChoices();
  }

  for (const select of root.querySelectorAll('[data-setting]')) {
    select.addEventListener('change', (e) => {
      writeSetting(e.target.dataset.setting, e.target.value);
      renderQuiz(root, mode.id);
    });
  }

  el.next.addEventListener('click', () => {
    if (round.finished) renderResults(root, mode, round, scopeId);
    else {
      round.advance();
      paintQuestion();
    }
  });

  paintQuestion();
}

function renderResults(root, mode, round, scopeId) {
  const misses = round.results.filter((r) => !r.correct);

  const said = (r) => {
    if (r.chosen) return `you said ${escapeHtml(r.chosen.name)}`;
    if (r.typed) return `you typed &ldquo;${escapeHtml(r.typed)}&rdquo;`;
    return 'skipped';
  };

  root.innerHTML = `
    <section class="results">
      <p class="results__eyebrow">${mode.name} &middot; ${SCOPES[scopeId].label}</p>
      <p class="results__score"><strong>${round.correctCount}</strong> / ${round.total}</p>
      <p class="results__verdict">${verdictFor(round.correctCount, round.total)}</p>
      <p class="results__streak">Best streak: ${round.bestStreak}</p>

      <div class="results__actions">
        <a class="btn btn--primary" href="#/play/${mode.id}" data-again>Play again</a>
        <a class="btn btn--ghost" href="#/">All quizzes</a>
      </div>

      ${
        misses.length
          ? `<div class="results__misses">
               <h2 class="results__misses-title">The ones that got away</h2>
               <ul class="miss-list">
                 ${misses
                   .map(
                     (r) => `
                   <li class="miss">
                     <img class="miss__flag" src="${flagUrl(r.question.answer)}" alt="">
                     <span class="miss__name">${escapeHtml(r.question.answer.name)}</span>
                     <span class="miss__chosen">${said(r)}</span>
                   </li>`
                   )
                   .join('')}
               </ul>
             </div>`
          : ''
      }
    </section>`;

  // The hash is already #/play/<mode>, so a plain link would not re-navigate.
  root.querySelector('[data-again]')?.addEventListener('click', (e) => {
    e.preventDefault();
    renderQuiz(root, mode.id);
  });
}
