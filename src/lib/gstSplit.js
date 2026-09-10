/**
 * gstSplit.js — splitting each line's GST into CGST and SGST on screen.
 *
 * ══ TWO BUGS THIS FIXES ════════════════════════════════════════════════════
 *
 * Three screens each did `gstAmount / 2` inline in the cell. On a line whose
 * tax is an odd number of paise that prints a THIRD decimal:
 *
 *     CGST ₹37.835    SGST ₹37.835      on a line carrying ₹75.67 of tax
 *
 * There is no such coin, and a tax document showing one is not a tax document.
 *
 * Rounding each half on its own is not the fix. 37.835 rounds to 37.84 twice
 * and the halves then sum to ₹75.68 — a paisa MORE tax than the line carries.
 *
 * Nor is splitting each line independently with the server's ceil rule. That
 * fixes the decimals and the per-line sum, but four lines of ₹37.84 add to
 * ₹151.36 in the CGST column while the summary block underneath declares
 * ₹151.34. A reader who totals the column gets a different answer from the one
 * on the invoice, and cannot tell which is wrong.
 *
 * ══ WHAT THIS DOES INSTEAD ═════════════════════════════════════════════════
 *
 * The odd paisa is allocated ACROSS the invoice rather than on every line. Each
 * line's CGST is whatever makes the RUNNING TOTAL equal half the running tax,
 * so the last line closes the column on exactly the figure the summary
 * declares:
 *
 *     line   GST      CGST     SGST        running CGST
 *       1   75.67    37.84    37.83             37.84
 *       2   75.67    37.83    37.84             75.67
 *       3   75.67    37.84    37.83            113.51
 *       4   75.67    37.83    37.84            151.34   ← equals the header
 *
 * Three properties hold at once, and all three matter:
 *   · every figure is 2 decimals
 *   · each line's CGST + SGST = that line's tax
 *   · the CGST column and the SGST column each sum to the declared total
 *
 * ══ WHY THE PRINTED INVOICE DOES NOT NEED THIS ═════════════════════════════
 *
 * It never splits per line into rupees: docShared's tax_split columns print the
 * RATE ("9.0%") and put the whole line's tax in one Tax Amount column. Only the
 * screens show rupees per head, which is why only the screens had the problem.
 *
 * The running-total rule reduces to the server's own splitGst
 * (backend/src/utils/gstStates.js) for a single line, and reaches the same
 * header figures for many — so the screen, the print and the return agree.
 */

/** Ceil-to-CGST half, matching gstStates.splitGst exactly. */
function ceilHalf(amount) {
  return Math.ceil(Number(amount || 0) * 100 / 2) / 100;
}

/**
 * @param {number[]} gstAmounts each line's total GST, in invoice order
 * @returns {{cgst:number,sgst:number}[]} one entry per line, same order
 *
 * ── Why the arithmetic is in integer PAISE ────────────────────────────────
 * A running total of rupee floats drifts. Six lines summing to ₹3,254.56 came
 * out a hair under it, the ceiling then fired on a total that needed no
 * rounding, and the column closed on ₹1,627.29 against a declared ₹1,627.28 —
 * one paisa, on the one figure this function exists to make agree.
 *
 * Paise are whole numbers, so nothing to drift. The conversion back to rupees
 * happens once, at the end, on a value that is already exact.
 */
export function splitGstLines(gstAmounts) {
  const paise = (gstAmounts || []).map(v => Math.round(Number(v || 0) * 100));
  let runGst = 0, runCgst = 0;
  return paise.map((p) => {
    runGst += p;
    // Half of the tax SO FAR, rounded the server's way. The difference from
    // what has already been shown is this line's share, so the rounding never
    // accumulates — it lands on whichever line needs it and settles there.
    const target = Math.ceil(runGst / 2);
    const cgst = target - runCgst;
    runCgst = target;
    return { cgst: cgst / 100, sgst: (p - cgst) / 100 };
  });
}

/**
 * One line on its own — for a caller that has no list to allocate across.
 * Identical to the server's splitGst.
 */
export function halfGst(gstAmount) {
  const amt = Number(gstAmount || 0);
  if (!amt) return { cgst: 0, sgst: 0 };
  const cgst = ceilHalf(amt);
  return { cgst, sgst: Number((amt - cgst).toFixed(2)) };
}
