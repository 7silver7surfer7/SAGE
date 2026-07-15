/**
 * Converts a JS number into a plain decimal string safe for
 * ethers.utils.parseEther/parseUnits, which reject scientific notation
 * outright ("invalid decimal value"). Number.prototype.toString() switches
 * to exponential notation below 1e-6 or at/above 1e21 — bare `String(n)`
 * or template-literal interpolation hits this for any sub-cent ETH/SAGE
 * amount (e.g. 0.0000001 -> "1e-7"). Strings pass through unchanged (a
 * user-typed input is already a valid decimal string; round-tripping it
 * through Number() would reintroduce the same bug).
 */
export function toDecimalString(value: number | string): string {
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  const str = value.toString();
  if (!/e/i.test(str)) return str;
  const fixed = value.toFixed(20);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}
