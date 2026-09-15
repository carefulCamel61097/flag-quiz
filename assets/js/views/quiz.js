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
  loadFakes,
  loadMosaics,
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
import { stageFor, worthAt, WORTH_MAX } from '../stages.js';

/** Where each data file comes from, so a stage can just name what it needs. */
const LOADERS = {
  colours: loadColours,
  crops: loadCrops,
  fakes: loadFakes,
  mosaics: loadMosaics,
};

/**
 * Which other countries count as the same answer, per mode.
 *
 * Kept apart from the stage because the two are not the same question. What
 * the player sees and what counts as right usually travel together, but
 * Greyscale is the plain flag with a filter over it and still needs its own
 * equivalences, because stripping the colour out merges flags that differ only
 * by it.
 *
 * `perFlag` means the answer depends on the exact crop or grid being shown,
 * which the stage chose, rather than on the flag alone.
 */
const AMBIGUITIES = {
  same: {
    of: ({ country }) => country.sameFlagAs ?? [],
    says: (named, answer) => `${named} flies the same flag as ${answer}.`,
  },
  palette: {
    needs: 'colours',
    of: ({ data, country }) => data.colours.twins[country.code] ?? [],
    says: (named, answer) => `${named} makes the same pie as ${answer}.`,
  },
  crop: {
    needs: 'crops',
    perFlag: true,
    of: ({ choice, country }) => choice.get(country.code)?.with ?? [],
    says: (named, answer) => `that patch of ${answer} looks the same on ${named}.`,
  },
  mosaic: {
    needs: 'mosaics',
    perFlag: true,
    of: ({ choice, country }) => choice.get(country.code)?.with ?? [],
    says: (named, answer) => `${named} blocks down to the same mosaic as ${answer}.`,
  },
};

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

  const stage = stageFor(mode);
  const ambiguity = AMBIGUITIES[mode.ambiguity ?? 'same'] ?? AMBIGUITIES.same;

  const data = {};
  try {
    const wanted = new Set([...(stage.needs ?? []), ambiguity.needs].filter(Boolean));
    await Promise.all(
      [...wanted].map(async (key) => {
        data[key] = await LOADERS[key]();
      })
    );
  } catch (err) {
    root.innerHTML = `
      <section class="panel panel--centred">
        <h1 class="panel__title">Could not load the quiz data</h1>
        <p class="panel__text">${escapeHtml(err.message)}</p>
      </section>`;
    return;
  }

  /**
   * Whatever the stage has to decide per flag before the round exists - which
   * crop, which grid - because that decision is what settles the equivalences.
   * A stage may also drop flags it cannot ask about at all.
   */
  const choice = new Map();
  if (stage.prepare) pool = stage.prepare({ data, pool, choice });

  const equivalentsOf = (country) => ambiguity.of({ data, choice, country });

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

  if (stage.prepareRound) await stage.prepareRound({ data, round, choice });

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
        <span class="quiz__worth" data-worth hidden></span>
        <div class="quiz__score">
          <span data-progress></span>
          <span class="quiz__streak" data-streak hidden></span>
        </div>
      </header>

      <div class="quiz__track"><div class="quiz__track-fill" data-track></div></div>

      <div class="stage">
        <figure class="stage__figure" style="--mode-filter:${mode.filter ?? 'none'}">
          ${stage.markup ?? ''}
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
          ${
            // Real or Fake asks about the flag, not about the country, so
            // "type it or pick it" is not a choice that exists here.
            mode.answer === 'binary'
              ? ''
              : settings(ANSWER_KEY, answerMode, Object.values(ANSWER_MODES))
          }
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
    tell: root.querySelector('[data-tell]'),
    worth: root.querySelector('[data-worth]'),
    figure: root.querySelector('.stage__figure'),
  };

  /** The stage's own elements, looked up once rather than on every question. */
  const own = stage.bind?.(root) ?? {};

  function paintMeters() {
    el.progress.textContent = `${round.results.length} / ${round.total}`;
    el.streak.hidden = round.streak < 2;
    el.streak.textContent = `${round.streak} in a row`;
    el.track.style.width = `${(round.results.length / round.total) * 100}%`;
  }

  /** Whatever this mode has to say after an answer, if anything. */
  function showTell(correct, named) {
    const line = stage.tell?.({ data, question: round.question, correct, named });
    el.tell.textContent = line ?? '';
    el.tell.hidden = !line;
  }

  /** Shared ending for every answer mode. */
  function settle({ correct, named }) {
    const answer = round.question.answer;

    // Whatever the mode did to the flag, undo it: the real flag is what should
    // be left on screen next to its name.
    stage.reveal?.({ own, el, data, choice, question: round.question, correct, round });

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

  // ------------------------------------------------------------- verdict mode

  /**
   * Real or Fake's answer: two buttons, no country involved.
   *
   * Deliberately not folded into paintChoices. That one is about naming a
   * country and grades by comparing codes; this one grades the flag on screen,
   * and the only thing the two share is the look of the buttons.
   */
  function paintVerdict() {
    el.answer.innerHTML = `
      <div class="options options--binary" data-options role="group"
           aria-label="Is this the real flag?">
        <button class="option" type="button" data-say="real">Real</button>
        <button class="option" type="button" data-say="fake">Fake</button>
      </div>`;

    el.answer.querySelector('[data-options]').addEventListener('click', (e) => {
      const button = e.target.closest('.option');
      if (!button || locked) return;
      locked = true;

      const altered = Boolean(round.question.fake);
      const said = button.dataset.say;
      const correct = (said === 'fake') === altered;
      round.answer(null, { correct, said: said === 'fake' ? 'Fake' : 'Real' });

      for (const b of el.answer.querySelectorAll('.option')) {
        b.disabled = true;
        if ((b.dataset.say === 'fake') === altered) b.classList.add('option--correct');
        else if (b === button) b.classList.add('option--wrong');
      }
      settle({ correct, named: null });
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
        feedback.textContent = `Also accepted - ${ambiguity.says(
          verdict.named.name,
          answer.name
        )}`;
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

    stage.show({ own, el, data, choice, question: round.question });

    paintMeters();
    if (mode.answer === 'binary') paintVerdict();
    else if (answerMode === 'type') paintInput();
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
  const points = round.results.reduce(
    (sum, r) => sum + (r.correct ? worthAt(r.elapsedMs) : 0),
    0
  );

  const said = (r) => {
    // Real or Fake: what they answered is only half of it. Without the second
    // half the list is ten flags and ten "you said Real"s, which says nothing.
    if (r.said) {
      return `you said ${r.said} &middot; ${
        r.question.fake ? escapeHtml(r.question.fake.says) : 'Genuine.'
      }`;
    }
    if (r.chosen) return `you said ${escapeHtml(r.chosen.name)}`;
    if (r.typed) return `you typed &ldquo;${escapeHtml(r.typed)}&rdquo;`;
    return 'skipped';
  };

  root.innerHTML = `
    <section class="results">
      <p class="results__eyebrow">${mode.name} &middot; ${SCOPES[scopeId].label}</p>
      <p class="results__score"><strong>${round.correctCount}</strong> / ${round.total}</p>
      <p class="results__verdict">${verdictFor(round.correctCount, round.total)}</p>
      ${
        // Blur Reveal is scored twice: how many you got, and how early. Naming
        // ten flags at the last moment and naming ten while they are still a
        // smear are not the same round, and one number cannot say which it was.
        mode.scoring === 'decay'
          ? `<p class="results__points">
               <strong>${points}</strong> points &middot; ${Math.round(
                 points / Math.max(1, round.correctCount)
               )} on average, out of ${WORTH_MAX}
             </p>`
          : ''
      }
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
