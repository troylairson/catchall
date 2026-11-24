// Keypad logic as a pure reducer: press(state, key) -> new state.
// Keys: '0'-'9', 'frac' (a b/c), '+', '-', '*', '/', '=', 'back', 'neg', 'C', 'dc' (mixed/improper),
// and 'recall:<i>' to pull a history answer into the current entry.
(function (root) {
  'use strict';

  const F = typeof require === 'function' && typeof module !== 'undefined' ? require('./fraction.js') : root.Fraction;

  const MAX_SEG = 6;
  const MAX_HISTORY = 30;
  const SYM = { '+': '+', '-': '−', '*': '×', '/': '÷' };

  function initial(over = {}) {
    return {
      acc: null, // running value on the left of the pending operation
      op: null, // pending operation
      segs: [''], // entry being typed: [whole] or [num, den] or [whole, num, den]
      neg: false, // entry sign
      result: null, // answer on screen after '='
      expr: '', // small line above the main display
      error: null,
      flash: null, // one-keypress hint, e.g. a missing denominator
      improper: false, // show answers as 7/4 instead of 1 3/4
      history: [], // newest first: { expr, n, d } with n, d as strings
      ...over,
    };
  }

  const keep = (s) => ({ improper: s.improper, history: s.history });
  const entryEmpty = (s) => s.segs.length === 1 && s.segs[0] === '';

  class Hint extends Error {}

  function entryValue(s) {
    if (entryEmpty(s)) return null;
    const [a, b, c] = s.segs;
    let f;
    if (s.segs.length === 1) {
      f = F.make(a);
    } else {
      const den = s.segs.length === 2 ? b : c;
      if (den === '') throw new Hint('Enter the bottom number');
      if (BigInt(den) === 0n) throw new Hint('The bottom number can’t be 0');
      f = s.segs.length === 2 ? F.make(a, b) : F.make(BigInt(a) * BigInt(c) + BigInt(b), c);
    }
    return s.neg ? F.neg(f) : f;
  }

  function entryText(s) {
    const body = s.segs.length === 3 ? `${s.segs[0]} ${s.segs[1]}/${s.segs[2]}` : s.segs.join('/');
    return (s.neg ? F.MINUS : '') + body;
  }

  // Put a known value into the entry, in the current display style.
  function toEntry(f, improper) {
    const m = F.mixed(f);
    let segs;
    if (m.den === 1n) segs = [String(m.whole)];
    else if (improper || m.whole === 0n) segs = [String(m.whole * m.den + m.num), String(m.den)];
    else segs = [String(m.whole), String(m.num), String(m.den)];
    return { segs, neg: m.neg };
  }

  function step(s, key) {
    if (/^[0-9]$/.test(key)) {
      if (s.result) Object.assign(s, { result: null, expr: '' });
      const i = s.segs.length - 1;
      if (s.segs[i].length >= MAX_SEG) return s;
      s.segs[i] = (s.segs[i] === '0' ? '' : s.segs[i]) + key;
      return s;
    }

    if (key === 'frac') {
      if (s.result) return s;
      const i = s.segs.length - 1;
      if (s.segs[i] === '') throw new Hint('Type a number first');
      if (s.segs.length < 3) s.segs.push('');
      return s;
    }

    if (key === 'back') {
      if (s.result) return s;
      const i = s.segs.length - 1;
      if (s.segs[i] === '' && i > 0) s.segs.pop();
      else if (s.segs[i] !== '') s.segs[i] = s.segs[i].slice(0, -1);
      else if (s.neg) s.neg = false;
      return s;
    }

    if (key === 'neg') {
      if (s.result) s.result = F.neg(s.result);
      else s.neg = !s.neg;
      return s;
    }

    if (key === 'C') return initial(keep(s));

    if (key === 'dc') {
      s.improper = !s.improper;
      return s;
    }

    if (key in SYM) {
      const v = s.result || entryValue(s);
      if (v) s.acc = s.op && !s.result ? F.apply(s.op, s.acc, v) : v;
      else if (!s.acc) return s;
      s.op = key;
      s.expr = `${F.toText(s.acc, s.improper)} ${SYM[key]}`;
      Object.assign(s, { result: null, segs: [''], neg: false });
      return s;
    }

    if (key === '=') {
      const v = entryValue(s);
      if (!v) return s;
      const r = s.op ? F.apply(s.op, s.acc, v) : v;
      const expr = s.op ? `${s.expr} ${entryText(s)} =` : `${entryText(s)} =`;
      const item = { expr, n: String(r.n), d: String(r.d) };
      return Object.assign(s, {
        result: r,
        expr,
        acc: null,
        op: null,
        segs: [''],
        neg: false,
        history: [item, ...s.history].slice(0, MAX_HISTORY),
      });
    }

    if (key.startsWith('recall:')) {
      const h = s.history[Number(key.slice(7))];
      if (!h) return s;
      if (s.result) Object.assign(s, { result: null, expr: '' });
      return Object.assign(s, toEntry(F.make(h.n, h.d), s.improper));
    }

    return s;
  }

  function press(state, key) {
    if (key === 'clearHistory') return { ...state, history: [], flash: null };
    // Any key after an error starts over, and C or backspace just clears it.
    let s = state.error ? initial(keep(state)) : { ...state, segs: [...state.segs], flash: null };
    if (state.error && (key === 'C' || key === 'back')) return s;
    const before = { ...s, segs: [...s.segs] };
    try {
      return step(s, key);
    } catch (e) {
      if (e instanceof Hint) return { ...before, flash: e.message };
      if (e instanceof RangeError) return { ...initial(keep(s)), error: 'Can’t divide by 0' };
      throw e;
    }
  }

  const api = { initial, press, entryValue, entryText, SYM };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
