import WaText from '../WaText.jsx';

/**
 * ChatLinkText — message text with URLs made clickable.
 *
 * Wraps WaText rather than replacing it: that component turns *bold* / _italic_
 * into real React elements and deliberately never touches dangerouslySetInnerHTML,
 * which is the property worth keeping for text a colleague typed. This splits on
 * URLs first and hands each non-URL run to it, so both work at once.
 *
 * ── Only http and https ──
 * Not a general scheme match. `javascript:` is the obvious reason, but `data:`
 * and `file:` are the ones people forget — an anchor is a place somebody clicks
 * without reading, and the set of schemes worth honouring here is two.
 *
 * ── rel="noreferrer noopener" ──
 * target=_blank without it hands the opened page a handle on this one.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>()[\]{}"']+[^\s<>()[\]{}"'.,;:!?]/gi;

export default function ChatLinkText({ text }) {
  if (!text) return null;

  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(URL_RE)) {
    if (m.index > last) {
      out.push(<WaText key={`t${last}`} text={text.slice(last, m.index)} />);
    }
    out.push(
      <a key={`u${m.index}`} href={m[0]} className="ch-link"
         target="_blank" rel="noreferrer noopener">{m[0]}</a>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<WaText key={`t${last}`} text={text.slice(last)} />);
  return <>{out}</>;
}
