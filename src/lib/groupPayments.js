/**
 * Collapse the rows of one bulk payment into a single history entry.
 *
 * A bulk payment of ₹22,527.98 across three invoices is three rows in
 * hub_payments and has to stay that way — see migration 105. This turns them
 * back into the one payment the user actually made, for display only.
 *
 * Returns a flat list of entries, each either:
 *
 *   { kind: 'single', payment }                     — one payment, one invoice
 *   { kind: 'batch', batchId, payments, amount, … } — one payment, N invoices
 *
 * Order is preserved from the input (the server sends paid_at DESC), and a
 * batch takes the position of its FIRST row — so collapsing never reorders the
 * history around it.
 */
export function groupPaymentsByBatch(payments) {
  const out = [];
  const byBatch = new Map();

  for (const p of payments) {
    // No batch id means a single payment — every one-invoice payment, and every
    // row recorded before migration 105. Those are deliberately not grouped:
    // there is no reliable way to tell which historical rows belonged together,
    // and guessing would invent batches that never happened.
    if (!p.payment_batch_id) {
      out.push({ kind: 'single', key: `p${p.id}`, payment: p });
      continue;
    }

    const existing = byBatch.get(p.payment_batch_id);
    if (existing) {
      existing.payments.push(p);
      existing.amount += Number(p.amount || 0);
      continue;
    }

    const entry = {
      kind: 'batch',
      key: `b${p.payment_batch_id}`,
      batchId: p.payment_batch_id,
      payments: [p],
      amount: Number(p.amount || 0),
      // Taken from the first row: every row in a batch was written by one
      // INSERT loop with the same values, so any of them is authoritative.
      paid_at: p.paid_at,
      method: p.method,
      reference_no: p.reference_no,
      created_by_name: p.created_by_name,
      hub_name: p.hub_name,
    };
    byBatch.set(p.payment_batch_id, entry);
    out.push(entry);
  }

  // A "batch" with one surviving row is not a batch any more — it happens after
  // deleting the others individually. Showing it as an expandable group of one
  // would be noise, so it degrades back to a single.
  return out.map(e =>
    e.kind === 'batch' && e.payments.length === 1
      ? { kind: 'single', key: `p${e.payments[0].id}`, payment: e.payments[0] }
      : e
  );
}

/**
 * Rows a page of grouped entries covers.
 *
 * Pagination counts ENTRIES, not rows — a page of 10 shows 10 payments as the
 * user understands them, whether one of those is a batch of six or not. Paging
 * by raw rows would let a single bulk payment fill a page on its own.
 */
export function countPaymentRows(entries) {
  return entries.reduce((n, e) => n + (e.kind === 'batch' ? e.payments.length : 1), 0);
}
