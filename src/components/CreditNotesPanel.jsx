import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { FileMinus, AlertCircle } from 'lucide-react';

/**
 * Credit notes raised against one customer invoice.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The button to issue a credit note has been on the invoice screen for a
 * while. The notes themselves were never shown anywhere on it. Issue one and
 * the balance drops, with nothing on the page saying why — the only way to
 * find out was to open the customer's statement, which is a different screen
 * and a different mental model. An invoice that shows the EFFECT of a document
 * but not the document is the kind of thing somebody queries six months later
 * and nobody can answer.
 *
 * ── IT FETCHES ITS OWN LIST ────────────────────────────────────────────────
 *
 * Rather than being threaded through the invoice's load(). Two reasons: the
 * notes are not part of the invoice record, and a failure here must not be
 * able to take the invoice down with it. A failed fetch prints one line and
 * the rest of the page is untouched.
 *
 * ── AND IT RENDERS NOTHING WHEN THERE ARE NONE ─────────────────────────────
 *
 * Most invoices never have a credit note. An empty panel on every one of them
 * would be a permanent piece of furniture teaching people to ignore that
 * corner of the screen — which is exactly where the note appears when there
 * finally is one.
 */

const inr = n => Number(n || 0).toLocaleString('en-IN',
  { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = v => {
  const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const REASON = {
  goods_returned: 'Goods returned',
  rejection_after_payment: 'Rejected after payment',
  deficiency_in_service: 'Deficiency in service',
  price_correction: 'Price correction',
  post_sale_discount: 'Discount agreed after the sale',
  other: 'Other',
};

export default function CreditNotesPanel({ invoiceId, refreshKey = 0 }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!invoiceId) return;
    setError('');
    try {
      const r = await api(`/api/credit-notes?customer_invoice_id=${invoiceId}`);
      setNotes(r.items || []);
    } catch (e) {
      setError(e.message || 'Could not load credit notes');
      setNotes([]);
    }
  }, [invoiceId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (error) {
    return (
      <section className="ci-panel ci-internal">
        <div className="ci-panel-h"><span className="ci-doc-cap">Credit notes</span></div>
        <p className="cnp-error"><AlertCircle size={14} /> {error}</p>
      </section>
    );
  }
  if (!notes || !notes.length) return null;

  /* Cancelled notes are listed but do NOT count: a cancelled note reduces
     nothing, and a total that included it would disagree with the invoice's
     own balance by exactly its value. */
  const live = notes.filter(n => n.status === 'issued');
  const total = live.reduce((s, n) => s + Number(n.grand_total || 0), 0);

  return (
    <section className="ci-panel ci-internal">
      <div className="ci-panel-h">
        <span className="ci-doc-cap">Credit notes</span>
        <span className="cnp-total">
          &minus;{inr(total)} off this invoice
        </span>
      </div>

      <table className="cnp-table">
        <thead>
          <tr>
            <th>Note</th><th>Date</th><th>Reason</th>
            <th className="num">Taxable</th><th className="num">Tax</th><th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {notes.map(n => {
            const dead = n.status !== 'issued';
            return (
              <tr key={n.id} className={dead ? 'cnp-row--dead' : ''}>
                <td>
                  <span className="cnp-no"><FileMinus size={12} /> {n.note_no}</span>
                  {dead && <span className="cnp-tag">Cancelled</span>}
                </td>
                <td className="cnp-date">{dmy(n.note_date)}</td>
                <td className="cnp-reason">
                  {REASON[n.reason] || n.reason}
                  {n.reason_note ? <em> — {n.reason_note}</em> : null}
                </td>
                {/* subtotal_ex_gst / total_gst are what this table calls them —
                    there is no taxable_value column on credit_notes. */}
                <td className="num">{inr(n.subtotal_ex_gst)}</td>
                <td className="num">{inr(n.total_gst)}</td>
                <td className="num cnp-amt">{inr(n.grand_total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Where it goes on the return, because that is the question an
          accountant asks next and the answer depends on the customer. */}
      <p className="cnp-foot">
        On GSTR-1 a note to a customer with a GSTIN is listed in Table 9B.
        A note to anyone else is not listed separately — its value is
        subtracted inside Table 7, which is where it belongs.
      </p>
    </section>
  );
}
