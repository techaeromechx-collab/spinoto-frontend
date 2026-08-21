/**
 * WhatsApp's text formatting, read the way WhatsApp reads it.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 *
 * WhatsApp formatting is not a format. `*bold*` is an asterisk, the word, an
 * asterisk — plain characters that travel untouched and are styled by the app
 * on the customer's phone. Sending already works and always did.
 *
 * What did not work is OUR side of the glass. The CRM showed the raw markers,
 * so an advisor read `*Spinoto Premium Car Service Menu*` while the customer
 * read it in bold — and a misplaced asterisk showed up as an asterisk rather
 * than as an obvious mistake. Nobody could tell whether a quick reply was
 * right until a customer had already received it.
 *
 * ── THIS IS A READER, NEVER A WRITER ────────────────────────────────────────
 *
 * It does not touch what is stored or what is sent. The markers ARE the
 * formatting: strip them on the way out and the customer gets plain text. So
 * this parses for DISPLAY only, and every caller renders the result as text
 * nodes — never as HTML, because an inbound customer message is attacker text
 * and `<script>` in a WhatsApp message must stay four harmless characters.
 *
 * ── WHY THE ADJACENCY RULES ARE COPIED EXACTLY ──────────────────────────────
 *
 * WhatsApp is fussier than it looks: `*bold*` styles, `* bold *` does not, a
 * lone asterisk stays an asterisk, and `follow_up_date` is not italic. A
 * renderer that is more eager than WhatsApp is worse than none — it shows an
 * advisor bold text that will reach the customer as literal asterisks, which
 * is the exact confusion it was built to remove. So the rules here are
 * deliberately strict, and every one of them has a test.
 */

const MARKS = { '*': 'bold', '_': 'italic', '~': 'strike' };

/* A marker may only OPEN at the start of the string or after a non-word
   character, which is what keeps snake_case out of italics: the '_' in
   follow_up_date is preceded by 'w', so it never opens. Digits count as word
   characters for the same reason. */
const isWord  = (c) => c !== undefined && /[A-Za-z0-9]/.test(c);
const isSpace = (c) => c === undefined || /\s/.test(c);

/**
 * parseWaFormat('*hi* there')
 *   → [{ text: 'hi', bold: true }, { text: ' there' }]
 *
 * Returns a flat list of runs. Styles nest, so a run can carry more than one:
 * '*_both_*' yields a single run with bold and italic both true.
 *
 * Anything that is not valid formatting comes back as literal text, markers
 * included — which is the whole contract. Unmatched, spaced or mid-word
 * markers are characters the customer will see, so they must be characters the
 * advisor sees too.
 */
export function parseWaFormat(text) {
  if (typeof text !== 'string' || text === '') return [];
  return walk(text, {});
}

function walk(s, styles) {
  const out = [];
  let plain = '';
  let i = 0;

  const flush = () => {
    if (plain) { out.push({ text: plain, ...styles }); plain = ''; }
  };

  while (i < s.length) {
    /* Monospace first, and pushed as ONE run that is never re-walked. That is
       the whole mechanism that makes it terminal: WhatsApp parses nothing
       inside ```…```, so ```*x*``` is code showing an asterisk.

       There is deliberately no `styles.mono` guard on the marker branch below.
       One was there and could never fire — walk() is only ever called without
       mono — and a guard that cannot fire reads as protection while protecting
       nothing, which is worse than the plain version it replaced. */
    if (s.startsWith('```', i)) {
      const end = s.indexOf('```', i + 3);
      if (end > i + 3) {
        flush();
        out.push({ text: s.slice(i + 3, end), ...styles, mono: true });
        i = end + 3;
        continue;
      }
    }

    const name = MARKS[s[i]];
    // `!styles[name]` stops '*a*b*' from re-opening bold inside bold, which
    // would swallow the rest of the line into a style nobody asked for.
    if (name && !styles[name]) {
      const close = findClose(s, i);
      if (close > i) {
        flush();
        out.push(...walk(s.slice(i + 1, close), { ...styles, [name]: true }));
        i = close + 1;
        continue;
      }
    }

    plain += s[i];
    i += 1;
  }

  flush();
  return out;
}

/**
 * Where the marker opened at `i` closes, or -1 if it never validly does.
 *
 * Four conditions, and each one is a real WhatsApp behaviour rather than a
 * tidy-looking guess:
 *
 *   opening not mid-word     '*'  in 'a*b' is a literal asterisk
 *   opening hugs its text    '* bold *' is not bold on WhatsApp either
 *   closing hugs its text    'bold *' does not close
 *   closing not mid-word     '*bold*s' does not style
 */
function findClose(s, i) {
  const c = s[i];

  if (isWord(s[i - 1])) return -1;
  const next = s[i + 1];
  if (next === undefined || isSpace(next) || next === c) return -1;

  for (let j = i + 1; j < s.length; j += 1) {
    if (s[j] !== c) continue;
    if (isSpace(s[j - 1])) continue;
    if (isWord(s[j + 1])) continue;
    return j;
  }
  return -1;
}

/**
 * The B / I / S buttons: wrap a selection, or unwrap it if it is already
 * wrapped.
 *
 * Toggling matters more than it sounds. Without it, pressing B twice gives
 * '**bold**', which WhatsApp renders as a literal asterisk either side of
 * bold text — a mistake that looks like a double-click and reaches the
 * customer looking like a typo.
 *
 * With nothing selected it inserts the pair and reports where the caret
 * should sit: between them, ready to type.
 *
 * Returns { value, start, end } — the caller owns the state and the DOM, which
 * is what keeps this testable without a browser.
 */
export function toggleMark(value, start, end, mark) {
  const s = String(value ?? '');
  const a = Math.max(0, Math.min(start, s.length));
  const b = Math.max(a, Math.min(end, s.length));
  const sel = s.slice(a, b);

  // Already wrapped INSIDE the selection: '*bold*' selected whole.
  if (sel.length > 2 * mark.length
      && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(mark.length, sel.length - mark.length);
    return { value: s.slice(0, a) + inner + s.slice(b), start: a, end: a + inner.length };
  }

  // Already wrapped AROUND the selection: 'bold' selected, markers either
  // side. Pressing B on the word you just emboldened means "undo that", and
  // whether the markers happen to be inside the highlight is not something
  // anybody is tracking.
  if (s.slice(a - mark.length, a) === mark && s.slice(b, b + mark.length) === mark) {
    return {
      value: s.slice(0, a - mark.length) + sel + s.slice(b + mark.length),
      start: a - mark.length,
      end:   b - mark.length,
    };
  }

  return {
    value: s.slice(0, a) + mark + sel + mark + s.slice(b),
    // Caret between the markers when nothing was selected; around the text
    // when something was, so the next press toggles it back off.
    start: a + mark.length,
    end:   a + mark.length + sel.length,
  };
}
