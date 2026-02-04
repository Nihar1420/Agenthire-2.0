// src/utils/delay.js — human-like gaussian delays.
// Values cluster at the range midpoint (stddev = range/6, so ~99.7% fall inside
// [min,max] before clamping). Never use Math.random() directly for timing.

/** Standard-normal sample via the Box-Muller transform. */
function gaussian() {
  let u = 0;
  let v = 0;
  // Avoid log(0).
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A single gaussian millisecond value within [min,max], centred on the midpoint. */
export function gaussianMs(min, max) {
  const mid = (min + max) / 2;
  const stddev = (max - min) / 6;
  const value = mid + gaussian() * stddev;
  return Math.round(Math.min(max, Math.max(min, value)));
}

/** Sleep for a gaussian-distributed duration between min and max milliseconds. */
export function humanDelay(min, max) {
  const ms = gaussianMs(min, max);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default humanDelay;
