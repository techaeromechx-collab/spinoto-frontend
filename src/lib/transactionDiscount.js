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
 * There are two, chosen by the document's created_at — see lib/discountBasis.js
 * and, for the full reasoning, the server copy.
 *
 * 'inclusive' (documents from the cutover onwards)
 *
 *     The discount comes off the price the customer was quoted, GST included,
 *     and the taxable value is read back out of what is left:
 *
 *         payable = inc-GST − discount
 *         taxable = payable ÷ (1 + rate/100)
 *         gst     = payable − taxable
 *
 *     ₹100 off a ₹1,100 service means the customer pays ₹1,000.
 *
 * 'ex_gst' (documents raised before it — unchanged, for ever)
 *
 *         taxable     = ex-GST − discount
 *         gst         = taxable × the line's own rate
 *         grand total = taxable + gst
 *
 *     The same ₹100 means the customer pays ₹982.
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
  /* The line's INCLUSIVE value. Read rather than derived where the caller has
     it: deriving round-trips through a rounded ex-GST figure and loses a paisa,
     which reached the face of the document as a ₹2,000 bill discounted to zero
     printing a ₹2,000.01 discount. Falls back to the derivation when absent.
     IF YOU OVERRIDE exGstOf, OVERRIDE THIS TOO — see the server copy. */
  incOf   = it => Number(it.total_inc_gst || 0),
  // Defaults to the legacy rule so an un-updated caller changes nothing.
  basis   = 'ex_gst',
}) {
  const inclusive = basis === 'inclusive';

  const rows = (items || []).map(it => {
    const exGst = Number(exGstOf(it)) || 0;
    const rate  = Number(rateOf(it))  || 0;
    return {
      item: it, exGst, rate,
      inc: Number(incOf(it)) || round2(exGst * (1 + rate / 100)),
    };
  });

  const grossExGst  = rows.reduce((s, r) => s + r.exGst, 0);
  const grossIncGst = round2(rows.reduce((s, r) => s + r.inc, 0));
  // What the discount is a percentage OF, and is capped BY.
  const base = inclusive ? grossIncGst : grossExGst;

  /* On the inclusive basis "10%" is 10% of the price on the board, so it prints
     as a number the customer can verify. On the legacy basis it was 10% of the
     ex-GST value and printed as 10% of nothing visible. */
  let discountAmount = 0;
  if (discountValue > 0) {
    if (discountType === 'percent')   discountAmount = round2(base * discountValue / 100);
    else if (discountType === 'flat') discountAmount = Math.min(discountValue, base);
  }
  // Capped, so an oversized discount cannot produce negative tax.
  discountAmount = Math.min(Math.max(discountAmount, 0), base);

  let allocated = 0;
  const lines = rows.map((r, i) => {
    const isLast = i === rows.length - 1;
    const weight = inclusive ? r.inc : r.exGst;
    const share = isLast
      ? round2(discountAmount - allocated)
      : (base > 0 ? round2(discountAmount * weight / base) : 0);
    allocated += share;

    if (inclusive) {
      // The share is inclusive, so it comes off the inclusive line and the
      // taxable value is read back out of what remains.
      const total   = round2(Math.max(0, r.inc - share));
      const taxable = r.rate > 0 ? round2(total / (1 + r.rate / 100)) : total;
      // total − taxable, never taxable × rate: only this form guarantees the
      // three printed figures on the row add up to each other.
      return { item: r.item, rate: r.rate, share, taxable, gst: round2(total - taxable), total };
    }

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
    // The "Items (incl. GST)" row: this minus the discount is the grand total.
    grossIncGst,
    basis,
    lines,
  };
}
