/**
 * Mode-agnostic quiz engine: builds rounds, picks distractors, keeps score.
 *
 * Nothing in here knows what a flag looks like or how a mode renders it. A
 * round is a list of questions; a mode decides how to draw one.
 */

export const ROUND_LENGTH = 10;
export const OPTIONS_PER_QUESTION = 4;

const randomInt = (n) => Math.floor(Math.random() * n);

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Distractors are drawn from the answer's own region where possible.
 *
 * Fully random options make most questions trivially easy, because the four
 * flags rarely resemble each other at all. Region matching is a cheap stand-in
 * until palette-collision data exists, which will let us pick the flags that
 * actually look alike.
 */
function pickDistractors(answer, pool, count, excluded) {
  const others = pool.filter((c) => c.code !== answer.code && !excluded.has(c.code));
  const sameRegion = shuffle(others.filter((c) => c.region && c.region === answer.region));
  const chosen = sameRegion.slice(0, count);

  if (chosen.length < count) {
    const taken = new Set(chosen.map((c) => c.code));
    for (const c of shuffle(others)) {
      if (chosen.length >= count) break;
      if (!taken.has(c.code)) {
        chosen.push(c);
        taken.add(c.code);
      }
    }
  }
  return chosen;
}

/**
 * Builds a round of questions. Answers are distinct within a round, so the
 * same flag never comes up twice.
 */
export function buildRound(pool, { length = ROUND_LENGTH, equivalentsOf = () => [] } = {}) {
  if (pool.length < OPTIONS_PER_QUESTION) {
    throw new Error('Not enough countries in scope to build a round');
  }
  const answers = shuffle(pool).slice(0, Math.min(length, pool.length));

  return answers.map((answer, index) => {
    // Anything indistinguishable from the answer in this mode would be a
    // second correct option, so it can never be offered as a wrong one.
    const equivalents = new Set(equivalentsOf(answer));
    return {
      index,
      answer,
      equivalents,
      options: shuffle([
        answer,
        ...pickDistractors(answer, pool, OPTIONS_PER_QUESTION - 1, equivalents),
      ]),
    };
  });
}

/** Tracks progress and score across a round. */
export class Round {
  constructor(questions) {
    this.questions = questions;
    this.current = 0;
    this.results = [];
    this.streak = 0;
    this.bestStreak = 0;
    this.shownAt = performance.now();
  }

  get question() {
    return this.questions[this.current];
  }

  get total() {
    return this.questions.length;
  }

  get correctCount() {
    return this.results.filter((r) => r.correct).length;
  }

  get finished() {
    return this.results.length === this.questions.length;
  }

  /**
   * `chosen` is the country the player named, or null if they gave up or typed
   * something unrecognisable. `correct` is passed in because free-text answers
   * are graded by the matcher, which knows about spelling; multiple choice can
   * just compare codes.
   */
  answer(chosen, { correct = chosen?.code === this.question.answer.code, typed = null } = {}) {
    const question = this.question;

    this.streak = correct ? this.streak + 1 : 0;
    this.bestStreak = Math.max(this.bestStreak, this.streak);

    // Time to answer is recorded from the moment the flag appeared. Nothing
    // consumes it yet; it is the raw material for measuring real difficulty
    // per flag per mode, rather than guessing at labels.
    this.results.push({
      question,
      chosen,
      typed,
      correct,
      elapsedMs: Math.round(performance.now() - this.shownAt),
    });

    return { correct, answer: question.answer };
  }

  advance() {
    if (this.current < this.questions.length - 1) {
      this.current += 1;
      this.shownAt = performance.now();
      return true;
    }
    return false;
  }
}

/** A closing line that reflects how the round actually went. */
export function verdictFor(correct, total) {
  const share = correct / total;
  if (share === 1) return 'Flawless. Every single one.';
  if (share >= 0.8) return 'Strong round.';
  if (share >= 0.6) return 'Solid. A few got away.';
  if (share >= 0.4) return 'Halfway there.';
  if (share > 0) return 'Rough one. A few to go back over.';
  return 'Nothing landed that time.';
}
