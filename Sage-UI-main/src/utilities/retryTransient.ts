/**
 * Retries a promise-returning call a few times with backoff, but only for
 * TRANSIENT failures (no response at all, or an HTTP 5xx) — never for a
 * validation error (4xx with a clear message), which retrying can't fix.
 *
 * Built for the "on-chain deploy succeeded, then the DB-recording call
 * failed" failure mode: by the time this runs, the expensive/risky part
 * (the mint transaction) is already done and paid for, so it's worth a
 * few extra seconds to avoid stranding it as an invisible, unrecorded
 * on-chain object that the user has to notice and manually recover.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  { attempts = 4, baseDelayMs = 1000 }: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.originalStatus;
      // 507 (Insufficient Storage) is social-upload's own signal for a
      // Filebase pin-quota wall — a HARD failure that stays broken until a
      // human frees space/upgrades the plan, not something retrying fixes.
      // Burning 4 retries (~15s) on it just delays the real error reaching
      // the user and muddies "was this transient or not" in the logs.
      const isAtCapacity = status === 507 || err?.code === 'STORAGE_AT_CAPACITY';
      const isTransient =
        !isAtCapacity &&
        (status === undefined ||
          status === 'FETCH_ERROR' ||
          status === 'TIMEOUT_ERROR' ||
          (typeof status === 'number' && status >= 500));
      if (!isTransient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastErr;
}
