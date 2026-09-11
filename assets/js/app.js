/**
 * Shell and router. Hash routing keeps the site a pile of static files, which
 * is all GitHub Pages needs to serve it.
 */
import { renderHome } from './views/home.js';
import { renderQuiz } from './views/quiz.js';

const root = document.getElementById('app');

/**
 * Routes are hashes beginning with a slash (#/play/inverted). Bare hashes
 * (#colour) are the home page's own category anchors and must not trigger a
 * re-render, or jumping to a category would rebuild the page and lose the
 * scroll position.
 */
function parseRoute() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.startsWith('/')) return { view: 'home', key: 'home' };

  const play = hash.match(/^\/play\/([\w-]+)$/);
  if (play) return { view: 'play', modeId: play[1], key: `play:${play[1]}` };

  return { view: 'home', key: 'home' };
}

let renderedKey = null;

async function route() {
  const { view, modeId, key } = parseRoute();
  if (key === renderedKey) return;
  renderedKey = key;

  document.body.dataset.view = view;

  if (view === 'play') {
    document.title = 'Playing - Flag Quiz';
    window.scrollTo(0, 0);
    await renderQuiz(root, modeId);
  } else {
    document.title = 'Flag Quiz';
    renderHome(root);
  }
}

window.addEventListener('hashchange', route);
route();
