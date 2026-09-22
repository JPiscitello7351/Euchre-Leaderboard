import { loadLeague } from './data.js';
import { esc } from './format.js';
import * as leaderboardView from './views/leaderboard.js';
import * as historyView from './views/history.js';
import * as manageView from './views/manage.js';
import * as synergyView from './views/synergy.js';
import * as profileView from './views/profile.js';
import * as inputView from './views/input.js';
import * as tournamentsView from './views/tournaments.js';
import * as tournamentModeView from './views/tournament-mode.js';

// Tabs are driven by the URL hash (e.g. #leaderboard) so each tab has a
// shareable link and the browser back button works on GitHub Pages.
// `admin` tabs (entering and managing data) sit at the far right of the menu.
const TABS = [
  { id: 'leaderboard', label: 'Leaderboard', view: leaderboardView },
  { id: 'history', label: 'Game History', view: historyView },
  { id: 'synergy', label: 'Synergy', view: synergyView },
  { id: 'players', label: 'Player Profile', view: profileView },
  { id: 'tournaments', label: 'Tournament Results', view: tournamentsView },
  { id: 'tournament-mode', label: 'Tournament Mode', view: tournamentModeView },
  { id: 'input', label: 'Game Input', view: inputView, admin: true },
  { id: 'manage', label: 'Player Management', view: manageView, admin: true },
];

const nav = document.querySelector('.tabs');
const view = document.getElementById('view');
let league = null;
let loadError = null;

nav.innerHTML = TABS.map(
  (t, i) => `<a role="tab" href="#${t.id}" data-tab="${t.id}"${t.admin && !TABS[i - 1]?.admin ? ' class="first-admin"' : ''}>${t.label}</a>`
).join('');

// The hash is "#tab" or "#tab?name=value" (e.g. #players?p=4).
export function hashParams() {
  return new URLSearchParams(location.hash.split('?')[1] ?? '');
}

function render() {
  const tabId = location.hash.slice(1).split('?')[0];
  const current = TABS.find((t) => t.id === tabId) ?? TABS[0];
  for (const link of nav.querySelectorAll('a')) {
    const active = link.dataset.tab === current.id;
    link.setAttribute('aria-selected', active);
    if (active) link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Tournament Mode's fullscreen only applies on its own tab.
  if (current.id !== 'tournament-mode') {
    document.body.classList.remove('tm-focus');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  const heading = `<h2>${current.label}</h2>`;
  if (loadError) {
    view.innerHTML = `${heading}<p class="error">Couldn’t load league data: ${esc(loadError.message)}</p>`;
  } else if (!league) {
    view.innerHTML = `${heading}<p class="placeholder">Loading…</p>`;
  } else if (!current.view) {
    view.innerHTML = `${heading}<p class="placeholder">Coming soon.</p>`;
  } else {
    view.innerHTML = `${heading}<div class="view-body"></div>`;
    current.view.render(view.querySelector('.view-body'), league, { reload });
  }
}

// Views call this after saving so every tab sees the new data.
async function reload() {
  try {
    league = await loadLeague();
    loadError = null;
  } catch (err) {
    loadError = err;
    console.error(err);
  }
  render();
}

window.addEventListener('hashchange', render);
render();
reload();
