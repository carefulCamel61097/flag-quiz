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
import { buildRound, Round, shuffle, verdictFor } from '../engine.js';
import { buildIndex, suggest, judge, MIN_SUGGEST_CHARS } from '../matching.js';
import { tellApart } from '../tells.js';
import { recolourSvg } from '../svg-colour.js';

/** How an alteration that is only a reorientation is drawn. */
const REORIENT = {
  mirror: 'scaleX(-1)',
  flip: 'scaleY(-1)',
  rot180: 'scale(-1)',
};

/**
 * A recoloured flag, as a URL an <img> can use.
 *
 * The alteration is a handful of colour substitutions, so the SVG is fetched
 * once and rewritten in memory rather than a second altered copy of all 250
 * flags being generated and shipped.
 */
/**
 * How long Blur Reveal takes to come fully into focus, and what a question is
 * worth at either end of that.
 *
 * The flag always sharpens all the way, so every question is answerable in the
 * end. What decays is the reward, which is what makes the mode a race against
 * your own certainty rather than a staring contest.
 */
const REVEAL_MS = 14000;
const WORTH_MAX = 100;
const WORTH_MIN = 10;

/** Starting blur, as a fraction of the flag's width, so phones match desktops. */
const BLUR_SHARE = 0.055;

const worthAt = (elapsedMs) =>
  Math.max(
    WORTH_MIN,
    Math.round(WORTH_MAX - (Math.min(elapsedMs, REVEAL_MS) / REVEAL_MS) * (WORTH_MAX - WORTH_MIN))
  );

/**
 * Why a second country counts as a right answer here.
 *
 * Every mode hides something different, so every mode makes a different pair
 * of flags identical. Saying "makes the same pie" in Classic - where the two
 * are simply the same flag - was both wrong and confusing, since no pie has
 * been anywhere near the screen.
 */
const SHARED_BECAUSE = {
  palette: (named, answer) => `${named} makes the same pie as ${answer}.`,
  crop: (named, answer) => `that patch of ${answer} looks the same on ${named}.`,
  mosaic: (named, answer) => `${named} blocks down to the same mosaic as ${answer}.`,
  same: (named, answer) => `${named} flies the same flag as ${answer}.`,
};

/** One mosaic block per three characters; "..." is outside the flag (Nepal). */
function mosaicBlocks(packed) {
  let html = '';
  for (let i = 0; i < packed.length; i += 3) {
    const code = packed.slice(i, i + 3);
    html += code === '...' ? '<i></i>' : `<i style="background:#${code}"></i>`;
  }
  return html;
}

const svgSource = new Map();
async function recolouredFlag(country, swap) {
  if (!svgSource.has(country.code)) {
    const res = await fetch(flagUrl(country));
    if (!res.ok) throw new Error(`Could not load ${country.name}'s flag`);
    svgSource.set(country.code, await res.text());
  }
  const svg = recolourSvg(svgSource.get(country.code), swap);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

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
  const needsFakes = mode.stage === 'altered';
  const needsMosaics = mode.stage === 'mosaic' || mode.ambiguity === 'mosaic';
  let colourData = null;
  let cropData = null;
  let fakeData = null;
  let mosaicData = null;
  try {
    if (needsColours) colourData = await loadColours();
    if (needsCrops) cropData = await loadCrops();
    if (needsFakes) fakeData = await loadFakes();
    if (needsMosaics) mosaicData = await loadMosaics();
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
  /**
   * One mosaic per flag, drawn before the round like the crops and for the
   * same reason: the grid decides which other flags count as the same answer.
   * Two are stored per flag, a coarse one and a finer one, so the same flag is
   * not the same question twice.
   */
  const mosaics = new Map();
  if (needsMosaics) {
    for (const country of pool) {
      const list = mosaicData.mosaics[country.code];
      if (list?.length) mosaics.set(country.code, list[Math.floor(Math.random() * list.length)]);
    }
    pool = pool.filter((c) => mosaics.has(c.code));
  }

  const equivalentsOf = (country) => {
    if (mode.ambiguity === 'palette') return colourData.twins[country.code] ?? [];
    // Whatever is indistinguishable at the grid this flag is being shown at.
    if (mode.ambiguity === 'mosaic') return mosaics.get(country.code)?.with ?? [];
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

  /**
   * Half the round is altered, near enough.
   *
   * Not exactly half, and never announced: a player who knows the split can
   * count what they have seen and answer the last few without looking. Nine
   * flags have no usable alteration at all - China, Poland and Somalia among
   * them - so those are only ever shown genuine.
   */
  if (needsFakes) {
    const target = Math.round(round.total / 2);
    const alterable = shuffle(round.questions.filter((q) => fakeData.fakes[q.answer.code]));
    for (const question of alterable.slice(0, target)) {
      const list = fakeData.fakes[question.answer.code];
      const fake = { ...list[Math.floor(Math.random() * list.length)] };
      if (fake.kind === 'swap') {
        // Fetched now rather than at the moment the question appears, so the
        // genuine flag never flashes up before the altered one replaces it.
        try {
          fake.src = await recolouredFlag(question.answer, fake.swap);
        } catch {
          continue; // shown genuine instead; a missing file is not a question
        }
      }
      question.fake = fake;
    }
  }

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
          <div class="stage__pie" data-pie hidden>
            <div class="stage__disc" data-disc role="img"
                 aria-label="A pie chart of the flag's colours"></div>
          </div>
          <div class="stage__crop" data-crop hidden>
            <div class="stage__crop-window">
              <img class="stage__crop-img" data-crop-img alt="A zoomed-in part of a flag">
            </div>
          </div>
          <div class="stage__mosaic" data-mosaic hidden>
            <div class="mosaic" data-blocks role="img"
                 aria-label="A flag reduced to coloured blocks"></div>
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
    pie: root.querySelector('[data-pie]'),
    disc: root.querySelector('[data-disc]'),
    tell: root.querySelector('[data-tell]'),
    crop: root.querySelector('[data-crop]'),
    cropImg: root.querySelector('[data-crop-img]'),
    mosaic: root.querySelector('[data-mosaic]'),
    blocks: root.querySelector('[data-blocks]'),
    worth: root.querySelector('[data-worth]'),
    figure: root.querySelector('.stage__figure'),
  };

  /**
   * Blur Reveal's clock. Two things run off it: the flag sharpening, which is
   * a single CSS transition, and the counter showing what the question is
   * still worth. Both are read from the same start time so they cannot drift.
   */
  let ticker = null;
  const stopTicker = () => {
    clearInterval(ticker);
    ticker = null;
  };

  function startReveal() {
    const width = el.figure.getBoundingClientRect().width || 640;
    el.flag.style.transition = 'none';
    el.flag.style.filter = `blur(${(width * BLUR_SHARE).toFixed(1)}px)`;
    // Without reading back a layout value the browser coalesces both writes
    // into one and the flag simply appears sharp.
    void el.flag.offsetWidth;
    el.flag.style.transition = `filter ${REVEAL_MS}ms linear`;
    el.flag.style.filter = 'blur(0px)';

    const started = performance.now();
    const paint = () => {
      // The view is rebuilt whenever a setting changes, orphaning this node.
      if (!el.worth.isConnected) return stopTicker();
      el.worth.textContent = `worth ${worthAt(performance.now() - started)}`;
    };
    el.worth.hidden = false;
    paint();
    stopTicker();
    ticker = setInterval(paint, 200);
  }

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

    /**
     * In Real or Fake the alteration is always spelled out, whether the player
     * got it or not: guessing "fake" correctly and not knowing what was wrong
     * with it teaches nothing, and on a genuine flag the silence is the point.
     */
    if (mode.stage === 'altered') {
      const fake = round.question.fake;
      if (!fake) return;
      el.tell.textContent = fake.says;
      el.tell.hidden = false;
      return;
    }

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

  /** Shared ending for every answer mode. */
  function settle({ correct, named }) {
    const answer = round.question.answer;
    const fake = round.question.fake;

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
    if (mode.stage === 'mosaic') {
      el.mosaic.hidden = true;
      el.flag.hidden = false;
    }
    // Answering stops the clock: the flag snaps sharp and the counter freezes
    // at what the answer was actually worth.
    if (mode.stage === 'reveal') {
      stopTicker();
      el.flag.style.transition = '';
      el.flag.style.filter = '';
      const last = round.results.at(-1);
      el.worth.textContent = correct ? `+${worthAt(last.elapsedMs)}` : 'missed';
      el.worth.classList.toggle('is-scored', correct);
    }
    // The alteration comes off on the reveal. A flag un-flipping in place says
    // what was wrong with it better than any sentence can.
    if (mode.stage === 'altered') {
      el.flag.style.transform = '';
      el.flag.src = flagUrl(answer);
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
        const because = SHARED_BECAUSE[mode.ambiguity ?? 'same'] ?? SHARED_BECAUSE.same;
        feedback.textContent = `Also accepted - ${because(verdict.named.name, answer.name)}`;
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

    if (mode.stage === 'altered') {
      const fake = round.question.fake;
      // A reorientation is a CSS transform on the same file; a colour swap is
      // a rewritten copy of the SVG, prepared when the round was built.
      el.flag.style.transform = fake ? (REORIENT[fake.kind] ?? '') : '';
      if (fake?.src) el.flag.src = fake.src;
    }

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

    if (mode.stage === 'mosaic') {
      const grid = mosaics.get(round.question.answer.code);
      el.blocks.style.setProperty('--gx', grid.gx);
      el.blocks.style.setProperty('--gy', grid.gy);
      el.blocks.innerHTML = mosaicBlocks(grid.cells);
      el.mosaic.hidden = false;
      el.flag.hidden = true;
    }

    if (mode.stage === 'reveal') {
      el.worth.classList.remove('is-scored');
      startReveal();
    }

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
