import { Link } from 'react-router-dom';
import { CircleSlash, ExternalLink, Lock } from 'lucide-react';
import '../../styles/chatShared.css';

/**
 * ChatRefChip — a shared CRM record, as seen by THIS reader.
 *
 * ══ THREE STATES, AND THEY MUST LOOK DIFFERENT ═════════════════════════════
 *
 *   resolved     the record, named, and a link to it
 *   not allowed  "You don't have access" — NO name, NO code, NO number
 *   gone         "This <noun> no longer exists"
 *
 * The component never decides which. It renders what
 * POST /api/chat/refs/resolve returned, and that endpoint answered per viewer
 * against the same permission list the record's own GET route uses
 * (services/chatRefs.service.js). Receiving a pointer is not permission to open
 * it, and this is where that becomes visible.
 *
 * ── Why there is nothing to hide here ──
 * When the answer is "not allowed" the response carries no label and no href at
 * all — not a truncated one, not a code. So there is no branch in this file that
 * has the name and chooses not to draw it, which is the kind of branch somebody
 * later reads as a bug and "fixes".
 *
 * ── WHY IT IS A CARD AND NOT A LINE ──
 * It was one line: kind, label, sub, arrow. That is a link with extra steps —
 * you cannot tell a Fortuner from a Creta without opening it, which is the whole
 * reason somebody shared it into a conversation instead of pasting a URL.
 * The card renders the SAME fields; `sub` is already a ' · '-joined string built
 * by the resolver, so it is split back into lines here rather than the resolver
 * growing a second shape for one renderer to consume.
 *
 * There is still NO PHONE NUMBER, and that is not an omission to fill in later:
 * utils/maskMobile.js cannot mask a number inside a label string, which is why
 * chatRefs.service.js keeps them out of every chip. A richer card is a better
 * place to put one, and that is exactly why the rule is restated here.
 *
 * ── Pending ──
 * While the batch is in flight the chip says what KIND of record it is, from
 * ref_type, which the message row does carry. That is not a leak: the reader was
 * sent this pointer, so they already know a job card was shared. What they do not
 * get before the answer arrives is which one.
 */

const PRETTY = {
  lead: 'lead',
  appointment: 'appointment',
  job_card: 'job card',
  estimate: 'estimate',
  customer_invoice: 'customer invoice',
  purchase_invoice: 'purchase invoice',
};

export default function ChatRefChip({ refType, refId, resolved }) {
  const noun = resolved?.noun || PRETTY[refType] || 'record';

  // Still waiting on the batch.
  if (!resolved) {
    return (
      <span className="ch-ref ch-ref--pending" aria-busy="true">
        Shared a {noun}…
      </span>
    );
  }

  if (resolved.allowed === false) {
    return (
      <span className="ch-ref ch-ref--locked" title="Ask whoever shared it, or an administrator">
        <Lock size={11} />
        <span>You don’t have access to this record</span>
      </span>
    );
  }

  if (resolved.exists === false) {
    return (
      <span className="ch-ref ch-ref--gone">
        <CircleSlash size={11} />
        <span>This {noun} no longer exists</span>
      </span>
    );
  }

  /* The resolver joins its detail fields with ' · '. Splitting them back apart
     is the renderer's job: the string is what the composer's attachment strip
     and the record picker both want, and giving the resolver a second array
     shape purely for this file would be two representations of one fact. */
  const lines = String(resolved.sub || '').split('·').map((x) => x.trim()).filter(Boolean);

  const body = (
    <>
      <span className="ch-ref-head">
        <span className="ch-ref-kind">{noun}</span>
        <span className="ch-ref-label">{resolved.label}</span>
        {resolved.href && <ExternalLink size={11} className="ch-ref-go" />}
      </span>
      {(lines.length > 0 || resolved.pill) && (
        <span className="ch-ref-body">
          {lines.map((l, i) => <span key={i} className="ch-ref-line">{l}</span>)}
          {resolved.pill && (
            <span className={`ch-ref-pill${resolved.pill.tone === 'warn' ? ' ch-ref-pill--warn' : ''}`}>
              {resolved.pill.text}
            </span>
          )}
        </span>
      )}
    </>
  );

  /* Allowed, exists, but there is nowhere to send them: a record whose public
     token has not been generated yet. Named, not clickable. Better than a link
     that 404s, and much better than hiding a record the reader is entitled to
     see because a URL could not be built for it. */
  if (!resolved.href) {
    return (
      <span className="ch-ref ch-ref--card ch-ref--flat" title="This record has no shareable link yet">
        {body}
      </span>
    );
  }

  /* A real link, not an onClick — so middle-click and "open in new tab" work,
     which is most of what somebody wants from a record shared in a message.
     The href is the record's PUBLIC TOKEN, because that is what these routes are
     mounted on (see chatRefs.service.js); an id-based URL 404s. The route's own
     RequirePermission is still what lets them in — this is a shortcut to a door,
     never a key. */
  return (
    <Link className="ch-ref ch-ref--card ch-ref--open" to={resolved.href}
          title={`Open this ${noun}`}>
      {body}
    </Link>
  );
}
