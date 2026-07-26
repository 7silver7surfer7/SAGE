/**
 * The message an artist signs to publish a drop — spelled ONCE, for both sides.
 *
 * Client-safe on purpose: no prisma, no ethers, no server config. It lives here
 * rather than beside the server verifier because the client has to produce the
 * exact same bytes the server recovers from, and a message defined twice is a
 * message that eventually differs by a space and fails to verify with no clue
 * why. (It also cannot be imported from the server module at all — that pulls
 * prisma into the browser bundle.)
 */
export function publishMessage(dropId: number, issuedAt: string): string {
  return [
    'SAGE — publish drop',
    `Drop: #${dropId}`,
    `Issued: ${issuedAt}`,
    '',
    'Signing authorises SAGE to create this drop on Robinhood Chain on your behalf.',
    'This is a signature, not a transaction — it costs no gas and moves no funds.',
  ].join('\n');
}

/** Signatures older than this are refused, so one cannot be replayed later. */
export const PUBLISH_WINDOW_MS = 15 * 60 * 1000;
