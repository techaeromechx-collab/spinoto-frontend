import { Check, CheckCheck } from 'lucide-react';

/**
 * ChatTicks — has the other person got it, and have they looked at it.
 *
 * ══ THREE STATES, ALL OF THEM TRUE ═════════════════════════════════════════
 *
 *   one tick         the server has it
 *   two grey ticks   delivered — their browser has fetched it
 *   two teal ticks   read — a person was actually looking at the conversation
 *
 * The difference between the last two comes from a condition that already
 * existed rather than one invented to make a third tick: listMessages writes
 * `delivered_at` on every fetch and `read_at` only when
 * document.visibilityState is 'visible'. So a tab sitting behind another one
 * collects the message without claiming anybody read it.
 *
 * If there had been no honest way to tell those apart, this would show two
 * states. A "delivered" tick that actually meant "sent" is worse than no tick,
 * because people make decisions on it — they stop chasing.
 *
 * ══ IN A GROUP, TWO TICKS MEANS EVERYONE ═══════════════════════════════════
 *
 * The cursors arrive as a MIN across the other participants, so the bar is the
 * least-advanced person. Four people and three have read it is still one tick —
 * and the hover says who is missing, which is the thing you actually wanted to
 * know and more than WhatsApp tells you.
 *
 * Rendered only on your OWN messages. A tick on somebody else's message would be
 * telling them what they already know.
 */
export default function ChatTicks({ state, title }) {
  if (state === 'none') return null;

  if (state === 'read') {
    return (
      <span className="ch-tick ch-tick--read" title={title || 'Read'}>
        <CheckCheck size={13} />
      </span>
    );
  }
  if (state === 'delivered') {
    return (
      <span className="ch-tick" title={title || 'Delivered'}>
        <CheckCheck size={13} />
      </span>
    );
  }
  return (
    <span className="ch-tick" title={title || 'Sent'}>
      <Check size={13} />
    </span>
  );
}

/**
 * Which tick a message gets, from the two conversation-level cursors.
 *
 * Pure, exported, and tested directly — the arithmetic is the whole feature and
 * it is the kind that looks obviously right and is off by one boundary.
 *
 * `<=` not `<` on both comparisons: a cursor written in the same millisecond as
 * the message means that message was included in what they fetched. With `<`, the
 * newest message in a thread somebody is reading right now would sit on one tick
 * forever, which is precisely the case anybody looks at.
 */
export function tickState({ mine, createdAt, peerReadAt, peerDeliveredAt, peerCount }) {
  // Not your message, or nobody else is in the conversation to receive it.
  if (!mine) return 'none';
  if (!peerCount) return 'none';

  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return 'sent';

  /* A NULL cursor means at least one other participant has never opened the
     conversation — so it cannot be delivered to everybody. Not coalesced to
     anything: coalescing to epoch would give the same answer by accident, and to
     NOW() would claim they had all read it. */
  if (peerReadAt && t <= new Date(peerReadAt).getTime()) return 'read';
  if (peerDeliveredAt && t <= new Date(peerDeliveredAt).getTime()) return 'delivered';
  return 'sent';
}
