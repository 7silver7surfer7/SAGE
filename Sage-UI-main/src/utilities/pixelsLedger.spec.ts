import { expect } from 'chai';
import { streamWithDust, CAP_SAGE, RATE_SCALED, RATE_DIVISOR } from './pixelsLedger';
import { PIXELS_MIGRATION_ENDS_AT } from '../constants/config';

/**
 * Accrual arithmetic. `streamWithDust` is the only place a pixel is created,
 * so it is the one function in the ledger worth pinning with a test: every
 * over- and under-credit the audit found downstream is this function being
 * asked the wrong question, and the two bugs that cost real users money were
 * both invisible in review and obvious in arithmetic.
 */

const DAY_SECONDS = 86400;
const at = (unix: number) => new Date(unix * 1000);
const boundary = Math.floor(PIXELS_MIGRATION_ENDS_AT.getTime() / 1000);

/** Pixels a balance earns over `seconds`, by the documented rate, no cap. */
function expected(whole: bigint, seconds: number): bigint {
  return (whole * RATE_SCALED * BigInt(seconds)) / (RATE_DIVISOR * BigInt(DAY_SECONDS));
}

describe('pixelsLedger :: streamWithDust', () => {
  const CAP = CAP_SAGE;
  const ZERO = BigInt(0);

  describe('the documented rate', () => {
    it('pays 0.001 pixels per whole token per day', () => {
      const from = boundary - 100 * DAY_SECONDS;
      const { stream } = streamWithDust(
        BigInt(1_000_000),
        BigInt(1_000_000),
        at(from),
        (from + DAY_SECONDS) * 1000,
        ZERO
      );
      // 1,000,000 * 0.001 = 1,000 pixels/day
      expect(stream.toString()).to.equal('1000');
    });

    it('caps a whale at 25,000 pixels/day', () => {
      const from = boundary - 100 * DAY_SECONDS;
      const { stream } = streamWithDust(
        CAP * BigInt(222), // 222x over the cap, as in the confirmed case
        CAP * BigInt(222),
        at(from),
        (from + DAY_SECONDS) * 1000,
        ZERO
      );
      expect(stream.toString()).to.equal('25000');
    });

    it('carries the sub-pixel remainder instead of truncating it away', () => {
      const from = boundary - 100 * DAY_SECONDS;
      // one second at a small balance floors to zero pixels but must not vanish
      const { stream, dust } = streamWithDust(
        BigInt(1000),
        BigInt(1000),
        at(from),
        (from + 1) * 1000,
        ZERO
      );
      expect(stream.toString()).to.equal('0');
      expect(dust > ZERO, 'the remainder is carried, not destroyed').to.equal(true);
    });
  });

  describe('the migration boundary (the 2026-08-08 cliff)', () => {
    // A legacy-only holder at the cap, last banked 19 days before the window
    // closes, read one hour after it closed. `liveWhole` is 0 because
    // liveSageWhole stops counting legacy the instant the window shuts — no
    // token moved.
    const days = 19;
    const from = boundary - days * DAY_SECONDS;
    const now = (boundary + 3600) * 1000;

    it('pays the pre-boundary slice at the checkpoint rather than zeroing it', () => {
      const { stream } = streamWithDust(ZERO, CAP, at(from), now, ZERO);
      // 19 days at the cap, and nothing for the hour after the window closed
      expect(stream.toString()).to.equal(expected(CAP, days * DAY_SECONDS).toString());
      expect(stream.toString()).to.equal('475000');
    });

    it('is CONTINUOUS across the instant — no cliff, and no jump either', () => {
      // The read one second BEFORE the window shuts still sees the legacy
      // balance (liveSageWhole only stops counting it at the boundary), so
      // live is the capped balance; the read one second AFTER sees 0. Those
      // two reads must agree about what the holder earned up to now — the
      // whole bug was that they differed by the entire interval.
      const justBefore = streamWithDust(CAP, CAP, at(from), (boundary - 1) * 1000, ZERO);
      const justAfter = streamWithDust(ZERO, CAP, at(from), (boundary + 1) * 1000, ZERO);
      const gap = justAfter.stream - justBefore.stream;
      expect(gap >= ZERO && gap < BigInt(2), `entitlement jumped by ${gap}`).to.equal(true);

      // and a month later it is still that same figure — legacy stopped
      // earning at the boundary, it did not start earning backwards
      const wellAfter = streamWithDust(ZERO, CAP, at(from), (boundary + 30 * DAY_SECONDS) * 1000, ZERO);
      expect(wellAfter.stream.toString()).to.equal(justAfter.stream.toString());
    });

    it('leaves an interval wholly BEFORE the boundary byte-identical', () => {
      const a = boundary - 10 * DAY_SECONDS;
      const { stream } = streamWithDust(CAP, CAP, at(a), (a + DAY_SECONDS) * 1000, ZERO);
      expect(stream.toString()).to.equal('25000');
    });

    it('leaves an interval wholly AFTER the boundary byte-identical', () => {
      const a = boundary + 10 * DAY_SECONDS;
      const { stream } = streamWithDust(CAP, CAP, at(a), (a + DAY_SECONDS) * 1000, ZERO);
      expect(stream.toString()).to.equal('25000');
    });

    it('does NOT let the boundary pay a holder who never had a balance', () => {
      // checkpoint 0 means the ledger never observed tokens — the boundary
      // must not conjure an entitlement out of the split
      const { stream } = streamWithDust(ZERO, ZERO, at(from), now, ZERO);
      expect(stream.toString()).to.equal('0');
    });

    it('still honours the flash-farm rule across the boundary for a real sale', () => {
      // sold everything BEFORE the boundary: the pre-boundary slice pays the
      // checkpoint (deliberately generous — see FIX FAMILY A), the post slice
      // pays the sold-down balance of zero
      const sold = streamWithDust(ZERO, CAP, at(from), now, ZERO);
      const held = streamWithDust(CAP, CAP, at(from), now, ZERO);
      expect(held.stream > sold.stream, 'holding through the boundary beats selling').to.equal(
        true
      );
    });
  });

  describe('the sustained-balance rule', () => {
    it('prices the interval at the LOWER of live and checkpoint', () => {
      const from = boundary - 100 * DAY_SECONDS;
      const now = (from + DAY_SECONDS) * 1000;
      const sold = streamWithDust(BigInt(0), BigInt(1_000_000), at(from), now, ZERO);
      const bought = streamWithDust(BigInt(1_000_000), BigInt(0), at(from), now, ZERO);
      expect(sold.stream.toString()).to.equal('0');
      expect(bought.stream.toString()).to.equal('0');
    });

    it('never returns a negative stream for a clock that went backwards', () => {
      const from = boundary - 100 * DAY_SECONDS;
      const { stream } = streamWithDust(CAP, CAP, at(from), (from - 3600) * 1000, ZERO);
      expect(stream >= ZERO).to.equal(true);
    });
  });
});
