/**
 * Loads the gateway's checkout script and opens it.
 *
 * WHY THIS IS A MODULE AND NOT A COPY-PASTE
 * ─────────────────────────────────────────
 * Three things here are easy to get wrong once per call site:
 *   - the script must be loaded exactly once, and concurrent callers must share
 *     one load rather than each injecting a tag
 *   - "the modal closed" and "the payment failed" are different outcomes, and
 *     a customer who changed their mind must not be shown an error
 *   - nothing here may ever receive a secret; the key id arrives from the
 *     backend per order and is the public one
 *
 * The script tag stays in the page after the first load, which is why the
 * promise is cached: injecting a second tag re-registers the global and
 * produces a checkout that fires its handler twice.
 */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loadPromise = null;

/**
 * Spinoto's brand colour, passed to the gateway's own checkout window.
 *
 * Worth setting rather than leaving default: the customer taps a teal button on
 * our page and the payment window opens on top of it. If that window is the
 * gateway's stock blue, the moment they hand over card details is the moment
 * the page stops looking like the business they are paying — which is exactly
 * when people abandon a payment.
 *
 * A literal, not var(--primary): this runs on the public pay page, which mounts
 * outside the authenticated shell that defines the CSS variables. Keep it in
 * step with BRAND in pages/PublicPayPage.jsx and --primary in the stylesheet.
 */
const BRAND_COLOR = '#16b994';

export function loadCheckout() {
  if (window.Razorpay) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    // Someone else may have added the tag (a second tab of the same SPA, a
    // stale HMR module). Reuse it rather than adding another.
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    const el = existing || document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => resolve(true);
    el.onerror = () => {
      // Let a retry work: a failed load that stays cached means one flaky
      // network moment disables payments for the rest of the session.
      loadPromise = null;
      reject(new Error('Could not load the payment window. Check your internet connection and try again.'));
    };
    if (!existing) document.body.appendChild(el);
  });
  return loadPromise;
}

/**
 * Opens checkout for an order the BACKEND created.
 *
 * @param order    exactly what POST /api/payments/order returned
 * @param customer { name, mobile } — prefill only; the gateway never decides
 *                 who the payment belongs to, our txn_ref does
 * @param onDone   ({ gateway_order_id, gateway_payment_id, signature }) => void
 * @param onClose  () => void — the customer dismissed the window. NOT a failure.
 * @param onError  (message) => void
 */
export async function openCheckout({ order, customer = {}, company = {}, onDone, onClose, onError }) {
  // The mock path exists so the whole flow is walkable before a merchant
  // account is live. It short-circuits here rather than in the caller, so the
  // calling component has one code path and cannot drift from the real one.
  if (order.mock || order.key_id === 'rzp_test_mock') {
    onDone?.({
      gateway_order_id: order.order_id,
      gateway_payment_id: `pay_mock_${Date.now().toString(36)}`,
      signature: 'mock',
    });
    return;
  }

  await loadCheckout();

  const rzp = new window.Razorpay({
    key: order.key_id,                 // PUBLIC key, issued per order
    order_id: order.order_id,
    amount: Math.round(order.amount * 100),
    currency: order.currency || 'INR',
    name: company.name || 'Spinoto',
    description: company.description || 'Invoice payment',
    image: company.logo || undefined,
    prefill: {
      name: customer.name || '',
      contact: customer.mobile || '',
    },
    theme: { color: BRAND_COLOR },
    handler: (resp) => onDone?.({
      gateway_order_id: resp.razorpay_order_id,
      gateway_payment_id: resp.razorpay_payment_id,
      signature: resp.razorpay_signature,
    }),
    modal: {
      // Dismissing the window is a decision, not an error. Showing "payment
      // failed" here is the single most common way this integration lies to a
      // customer — nothing was attempted, let alone charged.
      ondismiss: () => onClose?.(),
      escape: true,
      backdropclose: false,           // no accidental dismissal mid-payment
    },
  });

  // A declined card, an expired session — the gateway reports these separately
  // from the success handler, and without this listener they are silent.
  rzp.on('payment.failed', (resp) => {
    const d = resp?.error || {};
    onError?.(d.description || 'That payment did not go through. Nothing has been charged.');
  });

  rzp.open();
}
