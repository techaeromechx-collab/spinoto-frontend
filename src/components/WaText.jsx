import { Fragment } from 'react';
import { parseWaFormat } from '../utils/waFormat.js';

/**
 * WhatsApp text, shown the way the customer will see it.
 *
 * ── WHY THIS IS A COMPONENT AND NOT A STRING HELPER ─────────────────────────
 *
 * The obvious implementation returns an HTML string and drops it in with
 * dangerouslySetInnerHTML. That would work, and it would also mean an inbound
 * customer message is HTML this CRM executes — a WhatsApp message reading
 * `<img src=x onerror=…>` becomes script running in an advisor's session,
 * against a token that can read every lead in the business.
 *
 * So every run is rendered as a React text node inside a real element. React
 * escapes text nodes, so the four characters `<b>` in a customer's message
 * stay four characters, and there is no path where they do not.
 *
 * ── LINE BREAKS ARE THE CALLER'S JOB ────────────────────────────────────────
 *
 * The runs carry '\n' through untouched; whether it renders as a break depends
 * on white-space on the element around it. Every caller here already sets
 * pre-wrap for that reason, except the one-line previews, which deliberately
 * flatten.
 */
export default function WaText({ text }) {
  const runs = parseWaFormat(text);
  if (!runs.length) return null;

  return runs.map((run, i) => {
    // Monospace is terminal — WhatsApp parses nothing inside it, so neither
    // does the parser, and there is never another style to apply here.
    if (run.mono) {
      return <code className="wa-fmt-mono" key={i}>{run.text}</code>;
    }

    let node = run.text;
    // Innermost first, so the tags nest the way the styles do.
    if (run.strike) node = <s>{node}</s>;
    if (run.italic) node = <em>{node}</em>;
    if (run.bold)   node = <strong>{node}</strong>;

    return <Fragment key={i}>{node}</Fragment>;
  });
}
