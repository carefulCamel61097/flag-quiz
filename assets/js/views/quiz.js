/**
 * The play screen. Mode-agnostic: it asks the mode only for how to present
 * the flag, so every future mode reuses this whole screen.
 */
import { MODE_BY_ID } from '../registry.js';
import { countriesInScope, flagUrl, SCOPES, DEFAULT_SCOPE } from '../data.js';
import { buildRound, Round, verdictFor } from '../engine.js';

const STORAGE_KEY = 'flag-quiz:scope';

function readScope() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SCOPES[saved]) return saved;
  } catch {
    /* private browsing, blocked storage - fall through to the default */
  }
  return DEFAULT_SCOPE;
}

function writeScope(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* nothing to do; the choice just will not persist */
  }
}

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

  let scopeId = readScope();
  let pool;
  try {
    pool = await countriesInScope(scopeId);
  } catch (err) {
    root.innerHTML = `
      <section class="panel panel--centred">
        <h1 class="panel__title">Could not load the flags</h1>
        <p class="panel__text">${err.message}</p>
      </section>`;
    return;
  }

  const round = new Round(buildRound(pool));
  let locked = false;

  root.innerHTML = `
    <div class="quiz">
      <header class="quiz__bar">
        <a class="quiz__back" href="#/" aria-label="Back to all quizzes">&larr;</a>
        <div class="quiz__id">
          <span class="quiz__mode">${mode.name}</span>
          <label class="quiz__scope">
            <span class="sr-only">Which flags to include</span>
            <select data-scope>
              ${Object.values(SCOPES)
                .map(
                  (s) =>
                    `<option value="${s.id}" ${s.id === scopeId ? 'selected' : ''}>${s.label}</option>`
                )
                .join('')}
            </select>
          </label>
        </div>
        <div class="quiz__score">
          <span data-progress></span>
          <span class="quiz__streak" data-streak hidden></span>
        </div>
      </header>

      <div class="quiz__track"><div class="quiz__track-fill" data-track></div></div>

      <div class="stage">
        <figure class="stage__figure" style="--mode-filter:${mode.filter ?? 'none'}">
          <img class="stage__flag" data-flag alt="A country flag with its colours inverted">
          <figcaption class="stage__reveal" data-reveal hidden>
            <img class="stage__reveal-flag" data-reveal-flag alt="">
            <span data-reveal-name></span>
          </figcaption>
        </figure>
      </div>

      <div class="options" data-options role="group" aria-label="Pick the country"></div>

      <div class="quiz__foot">
        <p class="quiz__hint">${mode.hint ?? ''}</p>
        <button class="btn btn--ghost" data-next hidden>Next</button>
      </div>
    </div>`;

  const el = {
    flag: root.querySelector('[data-flag]'),
    options: root.querySelector('[data-options]'),
    progress: root.querySelector('[data-progress]'),
    streak: root.querySelector('[data-streak]'),
    track: root.querySelector('[data-track]'),
    next: root.querySelector('[data-next]'),
    reveal: root.querySelector('[data-reveal]'),
    revealFlag: root.querySelector('[data-reveal-flag]'),
    revealName: root.querySelector('[data-reveal-name]'),
    figure: root.querySelector('.stage__figure'),
  };

  function paintQuestion() {
    locked = false;
    const q = round.question;

    el.figure.classList.remove('is-revealed');
    el.reveal.hidden = true;
    el.next.hidden = true;
    el.flag.src = flagUrl(q.answer);

    el.progress.textContent = `${round.results.length} / ${round.total}`;
    el.streak.hidden = round.streak < 2;
    el.streak.textContent = `${round.streak} in a row`;
    el.track.style.width = `${(round.results.length / round.total) * 100}%`;

    el.options.innerHTML = q.options
      .map(
        (c) =>
          `<button class="option" type="button" data-code="${c.code}">${c.name}</button>`
      )
      .join('');
  }

  function onAnswer(button) {
    if (locked) return;
    locked = true;

    const q = round.question;
    const chosen = q.options.find((c) => c.code === button.dataset.code);
    const { correct, answer } = round.answer(chosen);

    for (const b of el.options.querySelectorAll('.option')) {
      b.disabled = true;
      if (b.dataset.code === answer.code) b.classList.add('option--correct');
      else if (b === button) b.classList.add('option--wrong');
    }

    // Showing the flag as it really looks is the payoff moment: the inverted
    // image snaps back and you see what you were looking at all along.
    el.figure.classList.add('is-revealed');
    el.revealFlag.src = flagUrl(answer);
    el.revealName.textContent = answer.name;
    el.reveal.hidden = false;

    el.progress.textContent = `${round.results.length} / ${round.total}`;
    el.streak.hidden = round.streak < 2;
    el.streak.textContent = `${round.streak} in a row`;
    el.track.style.width = `${(round.results.length / round.total) * 100}%`;

    el.next.hidden = false;
    el.next.textContent = round.finished ? 'See results' : 'Next';
    el.next.focus();

    if (!correct) el.figure.classList.add('was-wrong');
    else el.figure.classList.remove('was-wrong');
  }

  el.options.addEventListener('click', (e) => {
    const button = e.target.closest('.option');
    if (button) onAnswer(button);
  });

  root.querySelector('[data-scope]').addEventListener('change', (e) => {
    writeScope(e.target.value);
    renderQuiz(root, mode.id);
  });

  el.next.addEventListener('click', () => {
    if (round.finished) renderResults(root, mode, round, scopeId);
    else {
      round.advance();
      paintQuestion();
    }
  });

  paintQuestion();
  writeScope(scopeId);
}

function renderResults(root, mode, round, scopeId) {
  const misses = round.results.filter((r) => !r.correct);

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
                     <span class="miss__name">${r.question.answer.name}</span>
                     <span class="miss__chosen">you said ${r.chosen.name}</span>
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
