import { supabase } from '../data.js';
import { downloadBackup, exportExcel, restoreBackup } from '../backup.js';
import { esc } from '../format.js';

let message = null; // { ok: boolean, text } shown after an action

// Data from a local file can be viewed but not saved.
const readOnly = (league) => league.source !== 'Supabase';

export function render(el, league, { reload }) {
  const gamesPlayed = new Map();
  for (const g of league.games) {
    for (const p of g.players) if (p.player_id !== null) gamesPlayed.set(p.player_id, (gamesPlayed.get(p.player_id) ?? 0) + 1);
  }
  const players = [...league.players].sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
  const disabled = readOnly(league) ? 'disabled' : '';
  const shown = message;
  message = null; // show each message once

  el.innerHTML = `
    ${shown ? `<p class="${shown.ok ? 'notice' : 'error'}" role="status">${esc(shown.text)}</p>` : ''}
    ${readOnly(league) ? `<p class="notice">Viewing ${esc(league.source)}: changes can’t be saved here.</p>` : ''}

    <section class="panel">
      <h3>Players</h3>
      <p class="muted">Inactive players keep their history but can’t be picked for new games and are listed unranked.
        Adding a player whose name matches a named guest moves those guest games to the new player.</p>
      <form id="add-player" class="inline-form">
        <input name="name" placeholder="New player name" required maxlength="40" autocomplete="off" ${disabled}>
        <button type="submit" class="primary" ${disabled}>Add player</button>
      </form>
      <div class="table-wrap">
        <table class="stats players-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Active</th><th scope="col">Games</th><th scope="col"></th></tr></thead>
          <tbody>
            ${players.map((p) => `<tr data-id="${p.id}">
              <th scope="row"><input class="rename" value="${esc(p.name)}" aria-label="Name" maxlength="40" ${disabled}></th>
              <td><input type="checkbox" class="active" ${p.active ? 'checked' : ''} aria-label="${esc(p.name)} active" ${disabled}></td>
              <td>${gamesPlayed.get(p.id) ?? 0}</td>
              <td>${gamesPlayed.get(p.id) ? '' : `<button type="button" class="delete" ${disabled}>Delete</button>`}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h3>League settings</h3>
      <label class="inline-form">Guests allowed per game
        <input type="number" id="max-guests" min="0" max="3" value="${league.settings?.max_guests_per_game ?? 1}" ${disabled}>
      </label>
    </section>

    <section class="panel">
      <h3>Backup</h3>
      <p class="muted">Download a backup regularly. The backup file can be restored here; the Excel file is for reading.</p>
      <div class="inline-form">
        <button type="button" id="download-backup">Download backup</button>
        <button type="button" id="export-excel">Export to Excel</button>
      </div>
      <details class="danger-zone">
        <summary>Restore from a backup…</summary>
        <p>This replaces <strong>all</strong> league data with the backup’s contents. The current data is saved in the
          database’s change log first, so it can be recovered.</p>
        <input type="file" id="restore-file" accept="application/json,.json" ${disabled}>
      </details>
    </section>`;

  // fn does the save and returns the success message.
  const act = async (fn) => {
    try {
      message = { ok: true, text: await fn() };
      await reload();
    } catch (err) {
      message = { ok: false, text: err.message };
      render(el, league, { reload });
    }
  };
  const check = ({ error }) => {
    if (error) throw new Error(friendly(error));
  };

  el.querySelector('#add-player').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    act(async () => {
      check(await supabase.from('players').insert({ name }));
      return `Added ${name}.`;
    });
  });
  for (const tr of el.querySelectorAll('tr[data-id]')) {
    const id = Number(tr.dataset.id);
    const player = league.playerById.get(id);
    tr.querySelector('.rename').addEventListener('change', (e) => {
      const name = e.target.value.trim();
      act(async () => {
        check(await supabase.from('players').update({ name }).eq('id', id));
        return `Renamed ${player.name} to ${name}.`;
      });
    });
    tr.querySelector('.active').addEventListener('change', (e) => {
      const active = e.target.checked;
      act(async () => {
        check(await supabase.from('players').update({ active }).eq('id', id));
        return `${player.name} is now ${active ? 'active' : 'inactive'}.`;
      });
    });
    tr.querySelector('.delete')?.addEventListener('click', () => {
      if (!confirm(`Delete ${player.name}? They have no games.`)) return;
      act(async () => {
        check(await supabase.from('players').delete().eq('id', id));
        return `Deleted ${player.name}.`;
      });
    });
  }
  el.querySelector('#max-guests').addEventListener('change', (e) => {
    const value = Number(e.target.value);
    act(async () => {
      check(await supabase.from('settings').update({ max_guests_per_game: value }).eq('id', true));
      return `Guests allowed per game: ${value}.`;
    });
  });
  el.querySelector('#download-backup').addEventListener('click', () => downloadBackup(league));
  el.querySelector('#export-excel').addEventListener('click', () =>
    exportExcel(league).catch((err) => {
      message = { ok: false, text: `Excel export failed: ${err.message}` };
      render(el, league, { reload });
    })
  );
  el.querySelector('#restore-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !confirm(`Replace ALL league data with ${file.name}?`)) {
      e.target.value = '';
      return;
    }
    act(async () => {
      const counts = await restoreBackup(file);
      return `Restored ${counts.players} players and ${counts.games} games.`;
    });
  });
}

// Turn database rule violations into plain language.
function friendly(error) {
  const m = error.message;
  if (m.includes('players_name_key')) return 'There’s already a player with that name.';
  if (m.includes('players_name_check')) return 'Names can’t be blank or “Guest”.';
  if (m.includes('game_players_player_id_fkey')) return 'That player has games, so they can’t be deleted. Mark them inactive instead.';
  if (m.includes('max_guests_per_game')) return 'Guests per game must be between 0 and 3.';
  return m;
}
