'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const board = $('#board');
  const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const COLLECT_DELAY = 280;

  let state = null;
  let L = null; // layout metrics
  let drag = null;
  let collectTimer = null;
  let hintIdx = 0;
  const els = new Map(); // card id -> element
  let where = new Map(); // card id -> { zone: 't' | 'k' | 'd', col, idx, x, y }

  const slots = Array.from({ length: 10 }, () => mk('slot'));
  const stockSlot = mk('slot slot-stock');
  const doneSlot = mk('slot slot-done');
  const badge = mk('badge');
  badge.hidden = true;

  function mk(cls) {
    const el = document.createElement('div');
    el.className = cls;
    board.appendChild(el);
    return el;
  }

  function cardEl(card) {
    let el = els.get(card.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'card s-' + card.s;
      el.dataset.id = card.id;
      const s = SUIT[card.s];
      el.innerHTML =
        `<div class="face"><span class="ix">${RANK[card.r]}<b>${s}</b></span><span class="pip">${s}</span></div>` +
        '<div class="back"></div>';
      board.appendChild(el);
      els.set(card.id, el);
    }
    return el;
  }

  // ---------- layout & render ----------

  function computeLayout() {
    const W = board.clientWidth, H = board.clientHeight;
    // Cards use the full width on phones; taller ratio than a real card to gain size.
    const pad = 4, gap = Math.max(2, Math.round(W * 0.006));
    const cw = Math.min(Math.floor((W - 2 * pad - 9 * gap) / 10), 100);
    const ch = Math.round(cw * 1.48);
    // Top row: completed runs (left) and stock (right); tableau fills the rest down to the bottom.
    L = { pad, gap, cw, ch, x0: Math.round((W - 10 * cw - 9 * gap) / 2), rowY: pad, top: pad + ch + 4 * gap, bottom: H - pad };
    board.style.setProperty('--cw', cw + 'px');
    board.style.setProperty('--ch', ch + 'px');
  }

  const colX = c => L.x0 + c * (L.cw + L.gap);
  const pos = (el, x, y) => { el.style.translate = `${x}px ${y}px`; };

  function render() {
    where = new Map();
    const place = (card, x, y, z, zone, col, idx) => {
      const el = cardEl(card);
      el.classList.toggle('down', !card.u);
      pos(el, x, y);
      el.style.zIndex = z;
      where.set(card.id, { zone, col, idx, x, y });
    };

    // Columns shrink their vertical spacing when they would run into the footer.
    const fd = L.ch * 0.16, fu = L.ch * 0.42;
    const avail = L.bottom - L.top - L.ch;
    state.tableau.forEach((col, c) => {
      const x = colX(c);
      pos(slots[c], x, L.top);
      let need = 0;
      for (let i = 0; i < col.length - 1; i++) need += col[i].u ? fu : fd;
      const k = need > avail ? avail / need : 1;
      let y = L.top;
      col.forEach((card, i) => {
        place(card, x, y, 10 + i, 't', c, i);
        y += (card.u ? fu : fd) * k;
      });
    });

    const sx = colX(9), groups = state.stock.length / 10;
    pos(stockSlot, sx, L.rowY);
    state.stock.forEach((card, i) =>
      place(card, sx - (groups - 1 - Math.floor(i / 10)) * L.cw * 0.25, L.rowY, 10 + i, 'k'));
    pos(badge, sx + L.cw - 25, L.rowY + L.ch - 25);
    badge.textContent = groups;
    badge.hidden = !groups;

    pos(doneSlot, colX(0), L.rowY);
    state.done.forEach((run, d) =>
      run.forEach((card, i) => place(card, colX(0) + d * L.cw * 0.32, L.rowY, 10 + d * 14 + (13 - i), 'd')));

    updateHud();
  }

  function renderInstant() {
    board.classList.add('instant');
    render();
    void board.offsetHeight;
    board.classList.remove('instant');
  }

  const fmtTime = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

  function updateHud() {
    $('#score').textContent = state.score;
    $('#moves').textContent = state.moves;
    $('#time').textContent = fmtTime(state.time);
    $('#undo-btn').disabled = !state.history.length || state.won;
  }

  // ---------- game flow ----------

  function startGame(mode, seed) {
    clearTimeout(collectTimer);
    collectTimer = null;
    for (const el of els.values()) el.remove();
    els.clear();
    state = Spider.newGame(mode, seed);
    Store.recordStart(mode);
    save();

    // Deal animation: every card starts on the stock, tableau cards fly out in deal order.
    computeLayout();
    board.classList.add('instant');
    for (const card of [...state.tableau.flat(), ...state.stock]) {
      const el = cardEl(card);
      el.classList.add('down');
      pos(el, colX(9), L.rowY);
    }
    void board.offsetHeight;
    board.classList.remove('instant');
    state.tableau.forEach((col, c) =>
      col.forEach((card, j) => { els.get(card.id).style.transitionDelay = (j * 10 + c) * 16 + 'ms'; }));
    render();
    setTimeout(() => { for (const el of els.values()) el.style.transitionDelay = ''; }, 1400);
  }

  const save = () => { if (state && !state.won) Store.saveGame(state); };

  function afterAction(delay = COLLECT_DELAY) {
    hintIdx = 0;
    render();
    save();
    clearTimeout(collectTimer);
    collectTimer = setTimeout(() => { collectTimer = null; runCollect(); }, delay);
  }

  // Completed runs cascade A→K to the foundation, then burst with "+100".
  function runCollect() {
    const before = state.done.length;
    if (!Spider.collect(state)) return;
    const runs = state.done.slice(before);
    const step = 35, flight = 12 * step + 550;
    for (const run of runs) {
      run.forEach((card, i) => {
        const el = els.get(card.id);
        el.style.transitionDelay = el.style.animationDelay = (12 - i) * step + 'ms';
        el.classList.add('collecting');
      });
    }
    render();
    runs.forEach((run, k) => setTimeout(() => burst(colX(0) + (before + k) * L.cw * 0.32, L.rowY), flight - 100));
    setTimeout(() => {
      for (const card of runs.flat()) {
        const el = els.get(card.id);
        if (!el) continue;
        el.classList.remove('collecting');
        el.style.transitionDelay = el.style.animationDelay = '';
      }
    }, flight);
    if (state.won) win();
    else save();
  }

  function burst(x, y) {
    const b = document.createElement('div');
    b.className = 'burst';
    pos(b, x, y);
    b.innerHTML = '<span>+100</span>';
    board.appendChild(b);
    setTimeout(() => b.remove(), 1200);
  }

  // Finish a pending collect right away so input acts on up-to-date indices.
  function settle() {
    if (!collectTimer) return;
    clearTimeout(collectTimer);
    collectTimer = null;
    runCollect();
  }

  function doMove(from, idx, to) {
    if (!Spider.move(state, from, idx, to)) return false;
    afterAction();
    return true;
  }

  function doDeal() {
    if (!state.stock.length) return toast('O monte está vazio');
    if (!Spider.canDeal(state)) return toast('Preencha as colunas vazias antes de distribuir');
    const dealt = state.stock.slice(-10).reverse();
    Spider.deal(state);
    dealt.forEach((c, i) => { els.get(c.id).style.transitionDelay = i * 30 + 'ms'; });
    afterAction(COLLECT_DELAY + 300);
    setTimeout(() => dealt.forEach(c => { const el = els.get(c.id); if (el) el.style.transitionDelay = ''; }), 700);
  }

  function doUndo() {
    settle();
    if (state.won || !Spider.undo(state)) return;
    hintIdx = 0;
    render();
    save();
  }

  function tap(from, idx) {
    const m = Spider.bestMove(state, from, idx);
    if (!m || !doMove(m.from, m.idx, m.to)) flash(state.tableau[from].slice(idx).map(c => els.get(c.id)), 'shake');
  }

  function showHint() {
    settle();
    if (state.won) return;
    const hs = Spider.hints(state);
    if (!hs.length) {
      if (Spider.canDeal(state)) flash(state.stock.slice(-10).map(c => els.get(c.id)).concat(stockSlot), 'hint');
      else toast(state.stock.length ? 'Preencha as colunas vazias e distribua' : 'Nenhum movimento disponível');
      return;
    }
    const h = hs[hintIdx++ % hs.length];
    flash(state.tableau[h.from].slice(h.idx).map(c => els.get(c.id)), 'hint');
    const dest = Spider.top(state.tableau[h.to]);
    setTimeout(() => flash([dest ? els.get(dest.id) : slots[h.to]], 'hint'), 350);
  }

  function win() {
    Store.recordWin(state);
    Store.clearGame();
    updateHud();
    $('#win-text').textContent = `${state.score} pontos · ${state.moves} jogadas · ${fmtTime(state.time)}`;
    setTimeout(() => $('#win').showModal(), 1400);
  }

  function flash(list, cls) {
    for (const el of list) {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), 900);
    }
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- input: tap to auto-move, drag to choose ----------

  board.addEventListener('pointerdown', e => {
    if (drag || !state || state.won) return;
    const el = e.target.closest('.card, .slot-stock');
    if (!el) return toggleBar();
    settle();
    if (el === stockSlot) return doDeal();
    const info = where.get(+el.dataset.id);
    if (!info || info.zone === 'd') return;
    if (info.zone === 'k') return doDeal();
    const col = state.tableau[info.col];
    if (!Spider.isRun(col, info.idx)) {
      if (col[info.idx].u) flash([el], 'shake');
      return;
    }
    const cards = col.slice(info.idx);
    drag = {
      from: info.col, idx: info.idx, x0: e.clientX, y0: e.clientY, pid: e.pointerId, moved: false,
      els: cards.map(c => els.get(c.id)),
      base: cards.map(c => where.get(c.id)),
    };
    board.setPointerCapture(e.pointerId);
  });

  board.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 8) return;
      drag.moved = true;
      drag.els.forEach((el, i) => { el.classList.add('dragging'); el.style.zIndex = 1000 + i; });
    }
    drag.els.forEach((el, i) => pos(el, drag.base[i].x + dx, drag.base[i].y + dy));
  });

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    d.els.forEach(el => el.classList.remove('dragging'));
    if (cancelled) return render();
    if (!d.moved) return tap(d.from, d.idx);

    // Drop on the nearest column (by card center) that accepts the run.
    const cx = d.base[0].x + (e.clientX - d.x0) + L.cw / 2;
    const dist = c => Math.abs(colX(c) + L.cw / 2 - cx);
    const card = state.tableau[d.from][d.idx];
    const to = [...Array(10).keys()]
      .filter(c => c !== d.from && dist(c) < L.cw + L.gap)
      .sort((a, b) => dist(a) - dist(b))
      .find(c => Spider.canDrop(state, card, c));
    if (to == null || !doMove(d.from, d.idx, to)) render();
  }
  board.addEventListener('pointerup', e => endDrag(e, false));
  board.addEventListener('pointercancel', e => endDrag(e, true));

  // ---------- menus ----------

  function openMenu() {
    $('#restart-btn').hidden = !state;
    $('#close-menu').hidden = !state;
    $('#menu').showModal();
  }

  function showStats() {
    const all = Store.stats();
    const rows = [1, 2, 4].map(m => {
      const s = all[m] || { played: 0, won: 0 };
      const pct = s.played ? Math.round((100 * s.won) / s.played) : 0;
      return `<tr><th>${m} naipe${m > 1 ? 's' : ''}</th><td>${s.played}</td><td>${s.won} <small>(${pct}%)</small></td>` +
        `<td>${s.bestScore ?? '–'}</td><td>${s.bestTime != null ? fmtTime(s.bestTime) : '–'}</td></tr>`;
    }).join('');
    $('#stats-body').innerHTML =
      `<table><tr><th></th><th>Jogos</th><th>Vitórias</th><th>Recorde</th><th>Tempo</th></tr>${rows}</table>`;
    $('#stats').showModal();
  }

  // Options bar: tapping the table (anywhere but a card) or the HUD shows/hides it.
  const toggleBar = () => $('#bar').classList.toggle('hidden');
  $('#hud').addEventListener('click', toggleBar);

  $('#menu-btn').onclick = openMenu;
  $('#undo-btn').onclick = doUndo;
  $('#hint-btn').onclick = () => state && showHint();
  document.querySelectorAll('[data-mode]').forEach(b => {
    b.onclick = () => { $('#menu').close(); startGame(+b.dataset.mode); };
  });
  $('#restart-btn').onclick = () => { $('#menu').close(); startGame(state.mode, state.seed); };
  $('#stats-btn').onclick = showStats;
  $('#close-menu').onclick = () => $('#menu').close();
  $('#menu').addEventListener('close', () => { if (!state) startGame(1); });
  $('#win-new').onclick = () => { $('#win').close(); startGame(state.mode); };
  document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });

  // ---------- lifecycle ----------

  setInterval(() => {
    if (!state || state.won || !state.moves || document.hidden || document.querySelector('dialog[open]')) return;
    state.time++;
    $('#time').textContent = fmtTime(state.time);
  }, 1000);

  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
  window.addEventListener('resize', () => { computeLayout(); if (state) renderInstant(); });

  computeLayout();
  const saved = Store.loadGame();
  if (saved && !saved.won) {
    state = saved;
    renderInstant();
  } else {
    openMenu();
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
