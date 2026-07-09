// Mirrors backend/src/utils/gst.js — keep both in sync if the algorithm changes.

export const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const CODE_POINTS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function charValue(ch) {
  return CODE_POINTS.indexOf(ch);
}

function computeCheckDigit(gstin14) {
  const factor = 2;
  let sum = 0;
  for (let i = 0; i < gstin14.length; i++) {
    const value = charValue(gstin14[i]);
    const mult = (i % 2 === 0) ? factor : 1;
    let product = value * mult;
    product = Math.floor(product / 36) + (product % 36);
    sum += product;
  }
  const checkValue = (36 - (sum % 36)) % 36;
  return CODE_POINTS[checkValue];
}

export function isValidGSTIN(str) {
  if (typeof str !== 'string') return false;
  const gstin = str.trim().toUpperCase();
  if (!GSTIN_FORMAT.test(gstin)) return false;
  const expected = computeCheckDigit(gstin.slice(0, 14));
  return expected === gstin[14];
}
