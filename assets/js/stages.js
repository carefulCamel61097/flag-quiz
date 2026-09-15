/**
 * What each quiz does to the flag before you see it.
 *
 * The play screen used to branch on `mode.stage` in six different places - the
 * data it loads, the markup it renders, the elements it looks up, how it draws
 * a question, how it undoes that on the reveal, and what it says afterwards.
 * Adding a mode meant six edits in six functions, and with twenty-one modes
 * planned that was heading somewhere unpleasant.
 *
 * A stage now answers all six questions in one object, so a new mode is one
 * entry here and one entry in the registry. The play screen knows only the
 * shape below and never what a pie chart is.
 *
 *   needs         data files to fetch first, by key
 *   markup        HTML placed inside the figure, above the flag
 *   bind          the stage's own elements, looked up once per render
 *   prepare       decide per-flag details before the round, and drop flags the
 *                 mode cannot ask about; returns the pool to use
 *   prepareRound  the same, but for decisions that need the built round
 *   show          draw one question
 *   reveal        undo it, so the real flag is what remains on screen
 *   tell          one line of explanation after answering, or nothing
 *
 * Everything except `show` is optional.
 */
import { flagUrl } from './data.js';
import { recolourSvg } from './svg-colour.js';
import { shuffle } from './engine.js';
import { tellApart } from './tells.js';

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * Chooses one option per flag and drops the flags with none.
 *
 * Crops and mosaics both work this way: several are stored per flag, the
 * choice has to be made before the round is built because it decides which
 * other flags count as the same answer, and a flag with no usable option is
 * one the mode cannot ask about at all.
 */
function chooseOnePer(pool, choice, optionsFor) {
  for (const country of pool) {
    const options = optionsFor(country);
    if (options?.length) choice.set(country.code, pick(options));
  }
  return pool.filter((c) => choice.has(c.code));
}

// --------------------------------------------------------------- colour pie

/**
 * A pie as a single conic gradient: crisp at any size, no canvas, no library.
 * Starts at twelve o'clock, biggest slice first.
 */
export function pieGradient(colours) {
  let at = 0;
  const stops = colours.map((c) => {
    const from = at * 100;
    at += c.share;
    return `${c.hex} ${from.toFixed(3)}% ${(at * 100).toFixed(3)}%`;
  });
  return `conic-gradient(from -90deg, ${stops.join(', ')})`;
}

// ------------------------------------------------------------------- mosaic

/** One mosaic block per three characters; "..." is outside the flag (Nepal). */
export function mosaicBlocks(packed) {
  let html = '';
  for (let i = 0; i < packed.length; i += 3) {
    const code = packed.slice(i, i + 3);
    html += code === '...' ? '<i></i>' : `<i style="background:#${code}"></i>`;
  }
  return html;
}

// ------------------------------------------------------------- real or fake

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
const svgSource = new Map();
async function recolouredFlag(country, swap) {
  if (!svgSource.has(country.code)) {
    const res = await fetch(flagUrl(country));
    if (!res.ok) throw new Error(`Could not load ${country.name}'s flag`);
    svgSource.set(country.code, await res.text());
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    recolourSvg(svgSource.get(country.code), swap)
  )}`;
}

// ------------------------------------------------------------- blur reveal

/**
 * How long Blur Reveal takes to come fully into focus, and what a question is
 * worth at either end of that.
 *
 * The flag always sharpens all the way, so every question is answerable in the
 * end. What decays is the reward, which is what makes the mode a race against
 * your own certainty rather than a staring contest.
 */
const REVEAL_MS = 14000;
export const WORTH_MAX = 100;
const WORTH_MIN = 10;

/** Starting blur, as a fraction of the flag's width, so phones match desktops. */
const BLUR_SHARE = 0.055;

export const worthAt = (elapsedMs) =>
  Math.max(
    WORTH_MIN,
    Math.round(
      WORTH_MAX - (Math.min(elapsedMs, REVEAL_MS) / REVEAL_MS) * (WORTH_MAX - WORTH_MIN)
    )
  );

/**
 * Why a near miss was a near miss, for the modes that show nothing but the
 * palette.
 *
 * A wrong answer there is usually close, and "wrong" on its own teaches
 * nothing. Saying which slice gave it away - a deeper blue, a wider stripe -
 * is what makes the near-identical pairs learnable at all.
 */
const paletteTell = ({ data, question, correct, named }) => {
  if (correct || !named) return null;
  return tellApart(
    data.colours.flags[question.answer.code],
    data.colours.flags[named.code],
    question.answer.name,
    named.name
  );
};

// ------------------------------------------------------------------- stages

export const STAGES = {
  /** The flag itself, filtered or not. Classic, Inverted, Greyscale, Hue Shift. */
  plain: {
    show() {},
  },

  pie: {
    needs: ['colours'],
    markup: `
      <div class="stage__pie" data-pie hidden>
        <div class="stage__disc" data-disc role="img"
             aria-label="A pie chart of the flag's colours"></div>
      </div>`,
    bind: (root) => ({
      pie: root.querySelector('[data-pie]'),
      disc: root.querySelector('[data-disc]'),
    }),
    show({ own, el, data, question }) {
      own.disc.style.background = pieGradient(data.colours.flags[question.answer.code]);
      own.pie.hidden = false;
      el.flag.hidden = true;
    },
    // The flag has been hidden all along; the reveal is the moment the chart
    // turns back into the thing it was measured from.
    reveal({ own, el }) {
      own.pie.hidden = true;
      el.flag.hidden = false;
    },
    tell: paletteTell,
  },

  /**
   * The same measured palette as the pie, as one stacked bar.
   *
   * Two things make it a different question rather than the same one drawn
   * differently. A bar is linear, so the proportions can actually be compared
   * by eye instead of estimated as angles. And the segments are shuffled,
   * where the pie always runs biggest-first from twelve o'clock - so position
   * tells you nothing and only width is left to go on.
   */
  bar: {
    needs: ['colours'],
    markup: `
      <div class="stage__bar" data-bar hidden>
        <div class="bar" data-bar-track role="img"
             aria-label="The flag's colours as a stacked bar"></div>
      </div>`,
    bind: (root) => ({
      bar: root.querySelector('[data-bar]'),
      track: root.querySelector('[data-bar-track]'),
    }),
    show({ own, el, data, question }) {
      const colours = shuffle(data.colours.flags[question.answer.code]);
      own.track.innerHTML = colours
        .map((c) => `<i style="background:${c.hex};flex-grow:${c.share.toFixed(5)}"></i>`)
        .join('');
      own.bar.hidden = false;
      el.flag.hidden = true;
    },
    reveal({ own, el }) {
      own.bar.hidden = true;
      el.flag.hidden = false;
    },
    tell: paletteTell,
  },

  crop: {
    needs: ['crops'],
    markup: `
      <div class="stage__crop" data-crop hidden>
        <div class="stage__crop-window">
          <img class="stage__crop-img" data-crop-img alt="A zoomed-in part of a flag">
        </div>
      </div>`,
    bind: (root) => ({
      crop: root.querySelector('[data-crop]'),
      cropImg: root.querySelector('[data-crop-img]'),
    }),
    /**
     * Two flags have no usable crop at all: Indonesia and Poland are plain
     * bicolours, and every region of them looks like a region of half a dozen
     * other flags. They drop out rather than being asked with no answer.
     */
    prepare: ({ data, pool, choice }) =>
      chooseOnePer(pool, choice, (c) => data.crops.crops[c.code]),
    /**
     * Shows one region of a flag, blown up to fill a square window.
     *
     * The flag stays an SVG in an oversized <img>, offset so the wanted region
     * lands in the window. No canvas, and the zoom is vector-crisp at any
     * scale. Crop coordinates are fractions: x and size of the flag's width,
     * y of its height.
     */
    show({ own, el, choice, question }) {
      const crop = choice.get(question.answer.code);
      if (!crop) return;
      const zoom = 100 / crop.size; // image width, as a % of the window
      own.cropImg.src = flagUrl(question.answer);
      own.cropImg.style.width = `${zoom}%`;
      own.cropImg.style.left = `${-crop.x * zoom}%`;
      // `top` is a percentage of the square window's height, and the image is
      // 4:3, so its own height is three quarters of its width.
      own.cropImg.style.top = `${-crop.y * zoom * 0.75}%`;
      own.crop.hidden = false;
      el.flag.hidden = true;
    },
    reveal({ own, el }) {
      own.crop.hidden = true;
      el.flag.hidden = false;
    },
  },

  mosaic: {
    needs: ['mosaics'],
    markup: `
      <div class="stage__mosaic" data-mosaic hidden>
        <div class="mosaic" data-blocks role="img"
             aria-label="A flag reduced to coloured blocks"></div>
      </div>`,
    bind: (root) => ({
      mosaic: root.querySelector('[data-mosaic]'),
      blocks: root.querySelector('[data-blocks]'),
    }),
    /**
     * Two are stored per flag, a coarse grid and a finer one, so the same flag
     * is not the same question twice. Morocco and Somalia have neither.
     */
    prepare: ({ data, pool, choice }) =>
      chooseOnePer(pool, choice, (c) => data.mosaics.mosaics[c.code]),
    show({ own, el, choice, question }) {
      const grid = choice.get(question.answer.code);
      own.blocks.style.setProperty('--gx', grid.gx);
      own.blocks.style.setProperty('--gy', grid.gy);
      own.blocks.innerHTML = mosaicBlocks(grid.cells);
      own.mosaic.hidden = false;
      el.flag.hidden = true;
    },
    reveal({ own, el }) {
      own.mosaic.hidden = true;
      el.flag.hidden = false;
    },
  },

  altered: {
    needs: ['fakes'],
    /**
     * Half the round is altered, near enough.
     *
     * Not exactly half, and never announced: a player who knows the split can
     * count what they have seen and answer the last few without looking. Nine
     * flags have no usable alteration at all - China, Poland and Somalia among
     * them - so those are only ever shown genuine.
     */
    async prepareRound({ data, round }) {
      const target = Math.round(round.total / 2);
      const alterable = shuffle(round.questions.filter((q) => data.fakes.fakes[q.answer.code]));
      for (const question of alterable.slice(0, target)) {
        const fake = { ...pick(data.fakes.fakes[question.answer.code]) };
        if (fake.kind === 'swap') {
          // Fetched now rather than when the question appears, so the genuine
          // flag never flashes up before the altered one replaces it.
          try {
            fake.src = await recolouredFlag(question.answer, fake.swap);
          } catch {
            continue; // shown genuine instead; a missing file is not a question
          }
        }
        question.fake = fake;
      }
    },
    show({ el, question }) {
      const fake = question.fake;
      // A reorientation is a CSS transform on the same file; a colour swap is
      // a rewritten copy of the SVG, prepared when the round was built.
      el.flag.style.transform = fake ? (REORIENT[fake.kind] ?? '') : '';
      if (fake?.src) el.flag.src = fake.src;
    },
    // A flag un-flipping in place says what was wrong with it better than any
    // sentence can.
    reveal({ el, question }) {
      el.flag.style.transform = '';
      el.flag.src = flagUrl(question.answer);
    },
    /**
     * The alteration is always spelled out, whether the player got it or not:
     * guessing "fake" correctly and not knowing what was wrong with it teaches
     * nothing, and on a genuine flag the silence is the point.
     */
    tell: ({ question }) => question.fake?.says ?? null,
  },

  /**
   * Two flags that get mistaken for each other, and the question of which is
   * which. The only mode with more than one flag on screen, so it is the only
   * one where the figure is replaced rather than filled.
   */
  pair: {
    needs: ['lookalikes'],
    replacesFigure: true,
    markup: `
      <p class="pair__ask" data-ask></p>
      <div class="pair" data-pair>
        ${[0, 1]
          .map(
            (side) => `
        <button class="pair__option" type="button" data-side="${side}">
          <img class="pair__flag" data-pair-flag="${side}" alt="One of two similar flags">
          <span class="pair__name" data-pair-name="${side}"></span>
        </button>`
          )
          .join('')}
      </div>`,
    bind: (root) => ({
      ask: root.querySelector('[data-ask]'),
      buttons: [...root.querySelectorAll('.pair__option')],
      flags: [...root.querySelectorAll('[data-pair-flag]')],
      names: [...root.querySelectorAll('[data-pair-name]')],
    }),
    /** Only flags that anybody actually confuses with something can be asked. */
    prepare: ({ data, pool }) => pool.filter((c) => data.lookalikes.pairs[c.code]?.length),
    /**
     * The partner and the side are settled before the round rather than at
     * paint time, so that what is graded and what is drawn cannot disagree.
     */
    prepareRound({ data, round, byCode }) {
      for (const question of round.questions) {
        const options = data.lookalikes.pairs[question.answer.code];
        const other = byCode.get(pick(options).code);
        question.pair = { other, answerFirst: Math.random() < 0.5 };
      }
    },
    show({ own, el, question }) {
      const { other, answerFirst } = question.pair;
      const order = answerFirst ? [question.answer, other] : [other, question.answer];
      own.ask.textContent = `Which one is ${question.answer.name}?`;
      order.forEach((country, i) => {
        own.flags[i].src = flagUrl(country);
        own.names[i].textContent = '';
        own.buttons[i].disabled = false;
        own.buttons[i].classList.remove('pair__option--correct', 'pair__option--wrong');
      });
      el.flag.hidden = true;
    },
    /**
     * Both names go up, not just the right one. Half of what makes these pairs
     * hard is that the other flag is also a flag you half-know, and a reveal
     * that names only one of them leaves the confusion exactly where it was.
     */
    reveal({ own, question }) {
      const { other, answerFirst } = question.pair;
      const order = answerFirst ? [question.answer, other] : [other, question.answer];
      order.forEach((country, i) => {
        own.names[i].textContent = country.name;
        own.buttons[i].disabled = true;
        own.buttons[i].classList.add(
          country.code === question.answer.code ? 'pair__option--correct' : 'pair__option--wrong'
        );
      });
    },
  },

  reveal: {
    bind: (root) => ({ ticker: null }),
    /**
     * Two clocks run off one start time so they cannot drift: the flag
     * sharpening, which is a single CSS transition, and the counter showing
     * what the question is still worth.
     */
    show({ own, el }) {
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
        if (!el.worth.isConnected) return clearInterval(own.ticker);
        el.worth.textContent = `worth ${worthAt(performance.now() - started)}`;
      };
      el.worth.hidden = false;
      el.worth.classList.remove('is-scored');
      paint();
      clearInterval(own.ticker);
      own.ticker = setInterval(paint, 200);
    },
    // Answering stops the clock: the flag snaps sharp and the counter freezes
    // at what the answer was actually worth.
    reveal({ own, el, correct, round }) {
      clearInterval(own.ticker);
      el.flag.style.transition = '';
      el.flag.style.filter = '';
      el.worth.textContent = correct ? `+${worthAt(round.results.at(-1).elapsedMs)}` : 'missed';
      el.worth.classList.toggle('is-scored', correct);
    },
  },
};

export const stageFor = (mode) => STAGES[mode.stage ?? 'plain'] ?? STAGES.plain;
