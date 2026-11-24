// Exact fraction arithmetic on BigInt, so long chains never lose precision.
// Works as a browser global (window.Fraction) and as a CommonJS module for tests.
(function (root) {
  'use strict';

  const abs = (x) => (x < 0n ? -x : x);

  function gcd(a, b) {
    a = abs(a);
    b = abs(b);
    while (b) [a, b] = [b, a % b];
    return a;
  }

  // Build a fraction in lowest terms with a positive denominator.
  function make(n, d = 1n) {
    n = BigInt(n);
    d = BigInt(d);
    if (d === 0n) throw new RangeError('DIV_ZERO');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || 1n;
    return { n: n / g, d: d / g };
  }

  const neg = (f) => ({ n: -f.n, d: f.d });
  const add = (a, b) => make(a.n * b.d + b.n * a.d, a.d * b.d);
  const sub = (a, b) => make(a.n * b.d - b.n * a.d, a.d * b.d);
  const mul = (a, b) => make(a.n * b.n, a.d * b.d);
  const div = (a, b) => {
    if (b.n === 0n) throw new RangeError('DIV_ZERO');
    return make(a.n * b.d, a.d * b.n);
  };
  const OPS = { '+': add, '-': sub, '*': mul, '/': div };
  const apply = (op, a, b) => OPS[op](a, b);

  // Split into sign, whole part and proper remainder: -7/4 -> { neg, whole 1, num 3, den 4 }.
  function mixed(f) {
    const a = abs(f.n);
    return { neg: f.n < 0n, whole: a / f.d, num: a % f.d, den: f.d };
  }

  const MINUS = '−';

  function toText(f, improper = false) {
    const sign = f.n < 0n ? MINUS : '';
    if (f.d === 1n) return sign + abs(f.n);
    if (improper) return sign + abs(f.n) + '/' + f.d;
    const m = mixed(f);
    return sign + (m.whole ? m.whole + ' ' : '') + m.num + '/' + m.den;
  }

  // Long division that spots repeating digits: 1/6 -> int "0", fixed "1", repeat "6".
  function decimal(f, maxDigits = 12) {
    const a = abs(f.n);
    let r = a % f.d;
    const digits = [];
    const seen = new Map();
    let repeatAt = -1;
    while (r !== 0n) {
      if (seen.has(r)) {
        repeatAt = seen.get(r);
        break;
      }
      if (digits.length >= maxDigits) break;
      seen.set(r, digits.length);
      r *= 10n;
      digits.push(String(r / f.d));
      r %= f.d;
    }
    const cut = repeatAt < 0 ? digits.length : repeatAt;
    return {
      neg: f.n < 0n,
      int: String(a / f.d),
      fixed: digits.slice(0, cut).join(''),
      repeat: repeatAt < 0 ? '' : digits.slice(repeatAt).join(''),
      exact: r === 0n || repeatAt >= 0,
    };
  }

  // Plain-text decimal, repeats in parentheses: 2/3 -> "0.(6)".
  function decimalText(f, maxDigits) {
    const x = decimal(f, maxDigits);
    let s = (x.neg ? MINUS : '') + x.int;
    if (x.fixed || x.repeat) s += '.' + x.fixed + (x.repeat ? '(' + x.repeat + ')' : '');
    if (!x.exact) s += '…';
    return s;
  }

  const api = { make, neg, add, sub, mul, div, apply, mixed, toText, decimal, decimalText, gcd, MINUS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Fraction = api;
})(this);
