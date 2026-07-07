export const ROUNDING_THRESHOLD_DATE = new Date('2026-07-07T10:00:00Z');

export function roundHalfUp(val, decimals = 2) {
  const multiplier = Math.pow(10, decimals);
  return Math.round((Number(val || 0) + Number.EPSILON) * multiplier) / multiplier;
}

export function roundLegacy(val, decimals = 2) {
  return parseFloat(Number(val || 0).toFixed(decimals));
}

export function getRoundingFunction(createdAtDate) {
  if (createdAtDate && new Date(createdAtDate) < ROUNDING_THRESHOLD_DATE) {
    return roundLegacy;
  }
  return roundHalfUp;
}
