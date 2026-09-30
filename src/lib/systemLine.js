/**
 * systemLine.js — the words for "Ana added Ben".
 *
 * ══ WHY THIS IS A FILE AND NOT TWO TEMPLATE STRINGS ════════════════════════
 *
 * Two places render a system event: the line in the thread, and the preview on
 * the conversation row in the list. They must say the same thing about the same
 * row. Written twice they would drift — one of them would say "Ana added Ben"
 * while the other said "Ben was added", and whichever was wrong would only be
 * noticed by somebody reading both at once.
 *
 * The backend deliberately stores the EVENT and the ids, never a sentence, so
 * that a person who changes their name does not leave old lines quoting the old
 * one. This is the other half of that decision: the sentence is built here, from
 * names resolved on this request.
 *
 * ── "You", not your own name ──
 * A thread that says "Ana Shah added Ben Patel" to Ana is stilted. Both ends are
 * checked, so "You added Ben", "Ana added you", and — when somebody adds
 * themselves back, which the API permits — "You added yourself".
 */

/**
 * @param {object} e
 * @param {string}  e.event      one of added|removed|left|renamed|archived|restored
 * @param {string}  e.actor      who did it (sender_name)
 * @param {boolean} e.mine       the actor is the reader
 * @param {string}  e.target     who it was done to, if anybody (system_target)
 * @param {boolean} e.targetIsMe the target is the reader
 * @param {string}  e.title      the new name, for a rename
 * @returns {string|null} null for an event this version does not know, so an
 *   older bundle meeting a newer event renders nothing rather than "undefined".
 */
export function systemLine({ event, actor, mine, target, targetIsMe, title } = {}) {
  const who = mine ? 'You' : (actor || 'Somebody');
  const whom = targetIsMe ? 'you' : (target || 'somebody');

  switch (event) {
    case 'added':
      if (mine && targetIsMe) return 'You added yourself';
      return `${who} added ${whom}`;
    case 'removed':
      if (mine && targetIsMe) return 'You left';
      return `${who} removed ${whom}`;
    case 'left':
      /* The target and the actor are the same person here, so the target is what
         reads correctly: a group sees "Ben left", Ben sees "You left". */
      return targetIsMe ? 'You left' : `${target || actor || 'Somebody'} left`;
    case 'renamed':
      return title ? `${who} renamed this to “${title}”` : `${who} renamed this`;
    case 'archived':
      return `${who} archived this conversation`;
    case 'restored':
      return `${who} restored this conversation`;
    default:
      return null;
  }
}

/**
 * The same sentence, for a conversation row's preview line.
 *
 * `preview` is the row summary's truncated body, which for a rename IS the new
 * title — the one event whose text is stored rather than assembled, because the
 * name on the day it changed is history.
 */
export function systemPreview(lastMessage, meId) {
  if (!lastMessage?.system_event) return null;
  return systemLine({
    event: lastMessage.system_event,
    actor: lastMessage.sender_name,
    mine: !!lastMessage.mine,
    target: lastMessage.system_target,
    targetIsMe: meId != null && lastMessage.system_target_id === meId,
    title: lastMessage.preview || null,
  });
}

export default systemLine;
