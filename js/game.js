'use strict';

// Pure Spider Solitaire rules. A card is { id, s: suit, r: rank 1..13, u: face up }.
const Spider = (() => {
  const SUITS_BY_MODE = { 1: ['S'], 2: ['S', 'H'], 4: ['S', 'H', 'D', 'C'] };
  const HISTORY_LIMIT = 500;

  // mulberry32: small seeded PRNG so a deal can be replayed.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newGame(mode, seed) {
    if (seed == null) seed = (Math.random() * 2 ** 32) >>> 0;
    const suits = SUITS_BY_MODE[mode];
    const copies = 8 / suits.length;
    const cards = [];
    let id = 0;
    for (const s of suits)
      for (let c = 0; c < copies; c++)
        for (let r = 1; r <= 13; r++) cards.push({ id: id++, s, r, u: false });

    const rand = rng(seed);
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }

    // 54 cards dealt round-robin: columns 0-3 get 6, columns 4-9 get 5.
    const tableau = Array.from({ length: 10 }, () => []);
    for (let i = 0; i < 54; i++) tableau[i % 10].push(cards.pop());
    for (const col of tableau) col[col.length - 1].u = true;

    return { mode, seed, tableau, stock: cards, done: [], score: 500, moves: 0, time: 0, history: [], won: false };
  }

  const top = col => col[col.length - 1];
  const isLink = (a, b) => a.u && b.u && a.s === b.s && a.r === b.r + 1;

  // True when col[idx..end] is a face-up, same-suit, descending run (i.e. movable).
  function isRun(col, idx) {
    if (idx < 0 || idx >= col.length || !col[idx].u) return false;
    for (let i = idx; i < col.length - 1; i++) if (!isLink(col[i], col[i + 1])) return false;
    return true;
  }

  function runStart(col) {
    if (!col.length) return -1;
    let i = col.length - 1;
    while (i > 0 && isLink(col[i - 1], col[i])) i--;
    return i;
  }

  function canDrop(state, card, to) {
    const t = top(state.tableau[to]);
    return !t || t.r === card.r + 1;
  }

  function snapshot(state) {
    state.history.push(JSON.stringify({ t: state.tableau, k: state.stock, d: state.done, sc: state.score }));
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
  }

  function flipTops(state) {
    for (const col of state.tableau) {
      const t = top(col);
      if (t && !t.u) t.u = true;
    }
  }

  function move(state, from, idx, to) {
    const src = state.tableau[from];
    if (from === to || !isRun(src, idx) || !canDrop(state, src[idx], to)) return false;
    snapshot(state);
    state.tableau[to].push(...src.splice(idx));
    flipTops(state);
    state.moves++;
    state.score--;
    return true;
  }

  const canDeal = state => state.stock.length > 0 && state.tableau.every(c => c.length > 0);

  function deal(state) {
    if (!canDeal(state)) return false;
    snapshot(state);
    for (const col of state.tableau) {
      const c = state.stock.pop();
      c.u = true;
      col.push(c);
    }
    state.moves++;
    state.score--;
    return true;
  }

  // Removes completed K→A same-suit runs. Not a separate undo step: undo of the
  // move that completed a run also restores the run.
  function collect(state) {
    let n = 0;
    for (const col of state.tableau) {
      const start = col.length - 13;
      if (start >= 0 && col[start].r === 13 && top(col).r === 1 && isRun(col, start)) {
        state.done.push(col.splice(start));
        state.score += 100;
        n++;
      }
    }
    if (n) flipTops(state);
    if (state.done.length === 8) state.won = true;
    return n;
  }

  function undo(state) {
    const snap = state.history.pop();
    if (!snap) return false;
    const s = JSON.parse(snap);
    state.tableau = s.t;
    state.stock = s.k;
    state.done = s.d;
    state.score = s.sc - 1;
    state.moves++;
    return true;
  }

  // Valid moves out of column `from` with a priority p. Moves that gain nothing get p < 0.
  function candidateMoves(state, from, onlyIdx) {
    const src = state.tableau[from];
    const start = runStart(src);
    if (start < 0) return [];
    const out = [];
    const first = onlyIdx ?? start, last = onlyIdx ?? src.length - 1;
    for (let idx = first; idx <= last; idx++) {
      if (!isRun(src, idx)) continue;
      const card = src[idx], below = src[idx - 1];
      let triedEmpty = false;
      for (let to = 0; to < 10; to++) {
        if (to === from || !canDrop(state, card, to)) continue;
        const dest = top(state.tableau[to]);
        if (!dest) {
          if (triedEmpty) continue;
          triedEmpty = true;
        }
        const sameSuit = dest && dest.s === card.s;
        let p = 0;
        if (sameSuit) p += 4;
        if (below && !below.u) p += 3;
        if (!below) p += 2;
        if (!dest) p -= 2;
        const pointless =
          (!below && !dest) ||
          (below && below.u && below.r === card.r + 1 && (below.s === card.s || !sameSuit));
        if (pointless) p -= 10;
        out.push({ from, idx, to, p });
      }
    }
    return out;
  }

  function hints(state) {
    const all = [];
    for (let f = 0; f < 10; f++) all.push(...candidateMoves(state, f));
    return all.filter(m => m.p > -5).sort((a, b) => b.p - a.p);
  }

  function bestMove(state, from, idx) {
    return candidateMoves(state, from, idx).sort((a, b) => b.p - a.p)[0] || null;
  }

  return { newGame, move, deal, canDeal, collect, undo, isRun, canDrop, hints, bestMove, top };
})();

if (typeof module !== 'undefined') module.exports = Spider;
