/**
 * Player settings, shared by the hub and the play screen.
 *
 * Both screens need to read and write the same choices, so they live here
 * rather than inside either one.
 */
import { SCOPES, DEFAULT_SCOPE } from './data.js';

export const SCOPE_KEY = 'flag-quiz:scope';
export const ANSWER_KEY = 'flag-quiz:answer-mode';

/** Typing is the default: it is the real test, and the reason altNames exists. */
export const ANSWER_MODES = {
  type: { id: 'type', label: 'Type it' },
  choose: { id: 'choose', label: 'Multiple choice' },
};
export const DEFAULT_ANSWER_MODE = 'type';

function read(key, valid, fallback) {
  try {
    const saved = localStorage.getItem(key);
    if (saved && valid(saved)) return saved;
  } catch {
    /* blocked storage - fall through to the default */
  }
  return fallback;
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the choice just will not persist */
  }
}

export const readScope = () => read(SCOPE_KEY, (v) => v in SCOPES, DEFAULT_SCOPE);
export const writeScope = (value) => write(SCOPE_KEY, value);

export const readAnswerMode = () =>
  read(ANSWER_KEY, (v) => v in ANSWER_MODES, DEFAULT_ANSWER_MODE);
export const writeAnswerMode = (value) => write(ANSWER_KEY, value);

export const writeSetting = (key, value) => write(key, value);
