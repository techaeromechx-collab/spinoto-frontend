/**
 * transactionDiscount.js — the browser mirror of the server's rule.
 *
 * ── Why a second copy exists ────────────────────────────────────────────────
 *
 * This is a deliberate duplicate of backend/src/utils/transactionDiscount.js.
 * There is no shared package between the two halves of this repo, and the
 * alternative — the editor showing a total the server then disagrees with —
 * is worse than a copy. The two files must be changed together; each says so.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 * A whole-bill discount reduces the TAXABLE value, and the tax follows it
 * down:
 *
 *     taxable      = ex-GST − discount
 *     gst          = taxable × the line's own rate
 *     grand total  = taxable + gst
 *
 * It used to come off the grand total alone, leaving the taxable value and the
 * tax at their pre-discount figures — so the document printed three numbers
 * that did not add up, and declared tax on a sale that no longer carried it.
 *
 * Apportioned per line rather than applied to the total, because a bill mixing
 * an 18% service with a 28% part has no single rate to charge; the last line
 * absorbs the rounding so the shares sum to the discount exactly.
 */

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * @param {Array}  items          lines carrying an ex-GST amount and a rate
 * @param {string} discountType   'percent' | 'flat' | null
 * @param {number} discountValue
 * @param {function} exGstOf      item → ex-GST amount
 * @param {function} rateOf       item → GST percentage
 */
export function applyTransactionDiscount({
  items,
  discountType = null,
  discountValue = 0,
  exGstOf = it => Number(it.amount || 0),
  rateOf  = it => Number(it.gst_percent || 0),
}) {
  const rows = (items || []).map(it => ({
    item:  it,
    exGst: Number(exGstOf(it)) || 0,
    rate:  Number(rateOf(it))  || 0,
  }));

  const grossExGst = rows.reduce((s, r) => s + r.exGst, 0);

  // Percentage is of the EX-GST value, matching the server.
  let discountAmount = 0;
  if (discountValue > 0) {
    if (discountType === 'percent')   discountAmount = round2(grossExGst * discountValue / 100);
    else if (discountType === 'flat') discountAmount = Math.min(discountValue, grossExGst);
  }
  // Capped, so an oversized discount cannot produce negative tax.
  discountAmount = Math.min(Math.max(discountAmount, 0), grossExGst);

  let allocated = 0;
  const lines = rows.map((r, i) => {
    const isLast = i === rows.length - 1;
    const share = isLast
      ? round2(discountAmount - allocated)
      : (grossExGst > 0 ? round2(discountAmount * r.exGst / grossExGst) : 0);
    allocated += share;

    const taxable = round2(r.exGst - share);
    const gst     = round2(taxable * r.rate / 100);
    return { item: r.item, rate: r.rate, share, taxable, gst, total: round2(taxable + gst) };
  });

  return {
    discountAmount: round2(discountAmount),
    subtotalExGst:  round2(lines.reduce((s, l) => s + l.taxable, 0)),
    totalGst:       round2(lines.reduce((s, l) => s + l.gst, 0)),
    grandTotal:     round2(lines.reduce((s, l) => s + l.total, 0)),
    grossExGst:     round2(grossExGst),
    lines,
  };
}
