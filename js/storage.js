'use strict';

const Store = (() => {
  const SAVE = 'spider.save.v1', STATS = 'spider.stats.v1';
  const SAVED_HISTORY = 200;

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  }

  const saveGame = state => write(SAVE, { ...state, history: state.history.slice(-SAVED_HISTORY) });
  function loadGame() {
    const s = read(SAVE);
    return s && Array.isArray(s.tableau) ? s : null;
  }
  function clearGame() {
    try { localStorage.removeItem(SAVE); } catch { /* ignore */ }
  }

  const stats = () => read(STATS) || {};
  function modeStats(all, mode) {
    return all[mode] || (all[mode] = { played: 0, won: 0, bestScore: null, bestTime: null });
  }
  function recordStart(mode) {
    const all = stats();
    modeStats(all, mode).played++;
    write(STATS, all);
  }
  function recordWin(state) {
    const all = stats();
    const m = modeStats(all, state.mode);
    m.won++;
    m.bestScore = Math.max(m.bestScore ?? -Infinity, state.score);
    m.bestTime = Math.min(m.bestTime ?? Infinity, state.time);
    write(STATS, all);
  }

  return { saveGame, loadGame, clearGame, stats, recordStart, recordWin };
})();
