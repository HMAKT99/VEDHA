/** Wilson score interval for a binomial proportion (95% by default). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx]!;
}

export const median = (xs: number[]): number =>
  percentile(
    [...xs].sort((a, b) => a - b),
    0.5,
  );
export const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** Exact two-sided sign test on discordant pairs (b vs c), H0: p = 0.5. */
export function signTest(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let p = 0;
  for (let i = 0; i <= k; i++) p += Math.exp(logChoose(n, i) - n * Math.log(2));
  return Math.min(1, 2 * p);
}

export const pct = (x: number): string => (Number.isNaN(x) ? "-" : `${(x * 100).toFixed(0)}%`);
export const ci = (k: number, n: number): string => {
  const [lo, hi] = wilson(k, n);
  return `${pct(k / n)} [${pct(lo)}-${pct(hi)}]`;
};
