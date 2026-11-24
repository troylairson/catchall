// Wires the keypad, keyboard, screen and history to the Calc reducer.
(function () {
  'use strict';

  const F = window.Fraction;
  const C = window.Calc;
  const $ = (id) => document.getElementById(id);
  const STORE = 'fraction-pocket:v1';

  // ---------- state ----------
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (saved && Array.isArray(saved.history)) return { history: saved.history.slice(0, 30), improper: !!saved.improper };
    } catch (e) { /* storage blocked or corrupt: start empty */ }
    return { history: [], improper: false };
  }
  function save(s) {
    try { localStorage.setItem(STORE, JSON.stringify({ history: s.history, improper: s.improper })); } catch (e) { /* ignore */ }
  }

  const saved = load();
  let state = C.initial(saved);
  // Open on a worked example so the screen shows what the calculator does,
  // without adding it to the person's history.
  if (!saved.history.length) {
    for (const k of ['1', 'frac', '3', 'frac', '4', '+', '2', 'frac', '3', '=']) state = C.press(state, k);
    state.history = [];
  }

  // ---------- rendering ----------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function fracHTML(f, improper) {
    const m = F.mixed(f);
    const sign = m.neg ? F.MINUS : '';
    if (m.den === 1n) return `<span class="sf"><span class="w">${sign}${m.whole}</span></span>`;
    const num = improper ? m.whole * m.den + m.num : m.num;
    const whole = !improper && m.whole ? String(m.whole) : '';
    return `<span class="sf">${sign || whole ? `<span class="w">${sign}${whole}</span>` : ''}` +
      `<span class="fr"><span>${num}</span><i></i><span>${m.den}</span></span></span>`;
  }

  function entryHTML(s) {
    const last = s.segs.length - 1;
    const seg = (i) => {
      const v = s.segs[i];
      const cls = (i === last ? 'cur ' : '') + (v === '' ? 'blank' : '');
      return `<span class="${cls}">${v === '' ? (i === 0 ? '0' : ' ') : esc(v)}</span>`;
    };
    const sign = s.neg ? F.MINUS : '';
    if (s.segs.length === 1) return `<span class="sf"><span class="w">${sign}${seg(0)}</span></span>`;
    const w = s.segs.length === 3 ? seg(0) : '';
    const [n, d] = s.segs.length === 3 ? [seg(1), seg(2)] : [seg(0), seg(1)];
    return `<span class="sf">${sign || w ? `<span class="w">${sign}${w}</span>` : ''}<span class="fr">${n}<i></i>${d}</span></span>`;
  }

  function decimalHTML(f) {
    const x = F.decimal(f, 10);
    let s = (x.neg ? F.MINUS : '') + x.int;
    if (x.fixed || x.repeat) s += '.' + x.fixed + (x.repeat ? `<span class="rep">${x.repeat}</span>` : '');
    return (x.exact ? '= ' : '≈ ') + s + (x.exact ? '' : '…');
  }

  function sizeFor(text) {
    const n = text.replace(/\s/g, '').length;
    return n > 22 ? 'xs' : n > 14 ? 's' : n > 9 ? 'm' : '';
  }

  const opKeys = [...document.querySelectorAll('.keys .op')];

  function render() {
    const s = state;
    const main = $('main');
    const sub = $('sub');

    $('expr').textContent = s.expr;
    $('ann-mode').textContent = s.improper ? 'd/c' : 'a b/c';
    $('ann-mode').classList.add('on');
    $('ann-err').classList.toggle('on', !!s.error);
    $('ann-op').textContent = s.op ? C.SYM[s.op] : '';
    $('ann-op').classList.toggle('on', !!s.op);
    opKeys.forEach((b) => b.classList.toggle('pending', s.op === b.dataset.k && !s.result));

    if (s.error) {
      main.innerHTML = `<span class="msg">${esc(s.error)}</span>`;
      main.dataset.size = '';
      sub.textContent = 'Press any key to start again';
    } else if (s.result) {
      main.innerHTML = fracHTML(s.result, s.improper);
      main.dataset.size = sizeFor(F.toText(s.result, s.improper));
      sub.innerHTML = decimalHTML(s.result);
    } else {
      main.innerHTML = entryHTML(s);
      main.dataset.size = sizeFor(s.segs.join(''));
      sub.textContent = '';
    }
    sub.classList.toggle('flash', !!s.flash);
    if (s.flash) sub.textContent = s.flash;

    renderHistory();
  }

  let historyDrawn = null;
  function renderHistory() {
    if (historyDrawn === state.history && historyImproper === state.improper) return;
    historyDrawn = state.history;
    historyImproper = state.improper;
    const list = $('history');
    $('hist-empty').hidden = state.history.length > 0;
    $('clear-history').hidden = state.history.length === 0;
    list.innerHTML = state.history.map((h, i) => {
      const f = F.make(h.n, h.d);
      return `<li><button type="button" data-recall="${i}" aria-label="Use ${esc(F.toText(f, state.improper))}">` +
        `<span class="q">${esc(h.expr)}</span><span class="a">${fracHTML(f, state.improper)}</span></button></li>`;
    }).join('');
  }
  let historyImproper = null;

  // ---------- input ----------
  function press(key) {
    const before = state;
    state = C.press(state, key);
    if (state.history !== before.history || state.improper !== before.improper) save(state);
    render();
  }

  $('keys').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (b) press(b.dataset.k);
  });

  $('history').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-recall]');
    if (b) press('recall:' + b.dataset.recall);
  });

  // Two taps to clear, since browsers here can't show a confirm dialog.
  let armTimer = 0;
  $('clear-history').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (b.classList.contains('armed')) {
      clearTimeout(armTimer);
      b.classList.remove('armed');
      b.textContent = 'Clear';
      press('clearHistory');
      return;
    }
    b.classList.add('armed');
    b.textContent = 'Tap again to clear';
    armTimer = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Clear'; }, 3000);
  });

  const KEYMAP = {
    Enter: '=', '=': '=', Backspace: 'back', Escape: 'C', Delete: 'C',
    ' ': 'frac', _: 'frac', '|': 'frac', '\\': 'frac',
    '+': '+', '-': '-', '*': '*', x: '*', X: '*', '/': '/',
    n: 'neg', N: 'neg', d: 'dc', D: 'dc',
  };

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = /^[0-9]$/.test(e.key) ? e.key : KEYMAP[e.key];
    if (!key) return;
    // Let Enter and Space still activate a focused history or clear button.
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('.side button')) return;
    e.preventDefault();
    press(key);
    const btn = document.querySelector(`.keys [data-k="${CSS.escape(key)}"]`);
    if (btn) {
      btn.classList.add('down');
      setTimeout(() => btn.classList.remove('down'), 90);
    }
  });

  render();
})();
