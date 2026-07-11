import { ethers } from 'ethers';

/** Hard cap on allowlist size per drop — keeps saves and on-chain sync sane. */
export const ALLOWLIST_MAX_ADDRESSES = 5000;
/** Addresses per addAddresses() transaction (~6.9M gas at 300 — fits a block). */
export const ALLOWLIST_CHUNK_SIZE = 300;

export interface ParsedAddressList {
  /** checksummed-then-lowercased, deduped, in first-seen order */
  valid: string[];
  /** raw tokens that aren't valid 0x addresses (ENS names land here too) */
  invalid: string[];
  duplicates: number;
}

/**
 * Parses free-form allowlist input (textarea paste or an imported CSV/TXT):
 * addresses separated by whitespace, commas or semicolons. Validates each with
 * ethers, lowercases (the DB + contract comparisons are case-insensitive; we
 * store one canonical form) and dedupes. ENS names are rejected as invalid —
 * resolution is a possible follow-up, not silently ignored.
 */
export function parseAddressList(text: string): ParsedAddressList {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const raw of (text || '').split(/[\s,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    if (!ethers.utils.isAddress(token)) {
      invalid.push(token);
      continue;
    }
    const addr = token.toLowerCase();
    if (seen.has(addr)) {
      duplicates++;
      continue;
    }
    seen.add(addr);
    valid.push(addr);
  }
  return { valid, invalid, duplicates };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
