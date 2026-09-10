/**
 * discountBasis.js — the browser mirror of backend/src/utils/discountBasis.js.
 *
 * A DELIBERATE duplicate, for the same reason transactionDiscount.js is one:
 * there is no shared package between the two halves of this repo, and a screen
 * that shows a total the server then disagrees with is worse than a copy.
 *
 * THE DATE BELOW MUST MATCH THE SERVER'S EXACTLY. If the two drift, an invoice
 * raised in the gap is computed one way as it is typed and another way when it
 * is saved — the editor says ₹9,250 and the stored document says ₹9,160, with
 * nothing on screen to explain it. Change one, change both.
 *
 * What the two bases mean, and why an issued document keeps its own, is
 * documented in full in the server copy. In short:
 *
 *   ex_gst     ₹100 off a ₹1,100 inclusive price → customer pays ₹982
 *   inclusive  ₹100 off a ₹1,100 inclusive price → customer pays ₹1,000
 */

export const INCLUSIVE_DISCOUNT_FROM = new Date('2026-09-07T18:30:00Z'); // 2026-09-08 00:00 IST

/**
 * @param {Date|string|null} createdAt  the DOCUMENT's created_at
 * @returns {'ex_gst'|'inclusive'}
 *
 * A missing date means a document being composed right now — the New Estimate
 * modal has no row yet — so it takes the current rule. Defaulting the other way
 * would quietly show every new estimate the legacy figures.
 */
export function getDiscountBasis(createdAt) {
  if (!createdAt) return 'inclusive';
  return new Date(createdAt) < INCLUSIVE_DISCOUNT_FROM ? 'ex_gst' : 'inclusive';
}
