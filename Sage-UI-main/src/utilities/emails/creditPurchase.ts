/**
 * "Compute credits purchased" — the admin notification, in the SAGE Agent
 * design language.
 *
 * WHY THIS LOOKS NOTHING LIKE THE APP'S JSX
 * -----------------------------------------
 * Email clients are not browsers. Gmail strips <style> blocks in some views,
 * Outlook renders through Word, and neither flexbox nor grid can be relied on.
 * So the agent's tokens are re-expressed under email constraints:
 *
 *  - TABLES for layout, never flex/grid.
 *  - Every style INLINE; no stylesheet, no classes.
 *  - SOLID hex instead of the design's rgba() hairlines — alpha compositing is
 *    inconsistent, so rgba(255,255,255,0.08) over the canvas is precomputed as
 *    #212725 and over the panel as #252A29.
 *  - The design's Space Grotesk / JetBrains Mono cannot load, so the mono stack
 *    falls back to system monospace. That is the identity-carrying face here —
 *    the micro-labels and figures are what make it read as SAGE.
 *
 * The palette itself is the agent's, unchanged: see components/Agent/tokens.ts,
 * which now takes its ground and trim from SAGE Social.
 */

const C = {
  bg: '#0E1412',
  panel: '#121816',
  raised: '#17211C',
  /** rgba(255,255,255,0.08) precomputed over bg / panel */
  lineOnBg: '#212725',
  lineOnPanel: '#252A29',
  ink: '#ECEAE5',
  ink2: '#7C7C78',
  ink3: '#55554F',
  accent: '#D4FC52',
};

const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

export interface CreditPurchaseFacts {
  /** paying wallet, checksummed */
  address: string;
  /** e.g. "Curator" */
  tierTitle: string;
  tierId: string;
  creditsAdded: number;
  /** the account's balance AFTER this purchase */
  newBalance: number;
  paidUsd: number;
  paidEth: string;
  txHash: string;
  explorerUrl: string;
  /** linked X handle, when the payer has one */
  xHandle?: string | null;
  /** ISO timestamp of the claim */
  at: string;
}

const nf = (n: number) => n.toLocaleString('en-US');

/** One key/value row of the design's signature hairline stack. */
function row(k: string, v: string, opts: { accent?: boolean; small?: boolean } = {}): string {
  return `
    <tr>
      <td style="padding:13px 20px;border-top:1px solid ${C.lineOnPanel};font-family:${MONO};font-size:9.5px;letter-spacing:0.2em;color:${C.ink3};text-transform:uppercase;white-space:nowrap;vertical-align:top;">${k}</td>
      <td align="right" style="padding:13px 20px;border-top:1px solid ${C.lineOnPanel};font-family:${MONO};font-size:${opts.small ? '10.5' : '12'}px;color:${opts.accent ? C.accent : C.ink};word-break:break-all;vertical-align:top;">${v}</td>
    </tr>`;
}

export function creditPurchaseEmail(f: CreditPurchaseFacts): {
  subject: string;
  html: string;
  text: string;
} {
  const short = `${f.address.slice(0, 6)}…${f.address.slice(-4)}`;
  const subject = `SAGE · ${nf(f.creditsAdded)} credits purchased by ${short} ($${f.paidUsd.toFixed(2)})`;

  const when = new Date(f.at).toUTCString();

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<!-- preheader: the line clients show next to the subject, hidden in the body -->
<div style="display:none;font-size:1px;color:${C.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${f.tierTitle} tier · ${nf(f.creditsAdded)} CR · $${f.paidUsd.toFixed(2)} · balance now ${nf(f.newBalance)} CR</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.panel};border:1px solid ${C.lineOnBg};">

        <!-- masthead -->
        <tr>
          <td style="padding:18px 20px;border-bottom:1px solid ${C.lineOnPanel};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:${MONO};font-size:12px;letter-spacing:0.26em;color:${C.ink};font-weight:700;">SAGE</td>
                <td align="right" style="font-family:${MONO};font-size:9px;letter-spacing:0.2em;color:${C.ink3};text-transform:uppercase;">Agent &middot; Robinhood Chain</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- the headline figure -->
        <tr>
          <td style="padding:34px 20px 30px 20px;">
            <div style="font-family:${MONO};font-size:9.5px;letter-spacing:0.2em;color:${C.ink3};text-transform:uppercase;padding-bottom:18px;">Compute credits purchased</div>
            <div style="font-family:${MONO};font-size:44px;line-height:1;color:${C.accent};font-weight:700;letter-spacing:-0.01em;">+${nf(f.creditsAdded)}<span style="font-size:16px;letter-spacing:0.2em;font-weight:400;">&nbsp;CR</span></div>
            <div style="font-family:${MONO};font-size:11px;letter-spacing:0.16em;color:${C.ink2};text-transform:uppercase;padding-top:14px;">${f.tierTitle} tier &middot; $${f.paidUsd.toFixed(2)} settled</div>
          </td>
        </tr>

        <!-- the facts -->
        <tr>
          <td style="padding:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${row('Wallet', f.address, { small: true })}
              ${f.xHandle ? row('X account', `@${f.xHandle}`) : ''}
              ${row('Paid', `${f.paidEth} ETH`)}
              ${row('Balance now', `${nf(f.newBalance)} CR`, { accent: true })}
              ${row('Transaction', `${f.txHash.slice(0, 10)}…${f.txHash.slice(-8)}`, { small: true })}
              ${row('Settled', when, { small: true })}
            </table>
          </td>
        </tr>

        <!-- action -->
        <tr>
          <td style="padding:24px 20px 28px 20px;border-top:1px solid ${C.lineOnPanel};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${C.accent}" style="background:${C.accent};">
                  <a href="${f.explorerUrl}" style="display:inline-block;padding:12px 22px;font-family:${MONO};font-size:10.5px;letter-spacing:0.2em;text-transform:uppercase;font-weight:700;color:${C.bg};text-decoration:none;">View transaction</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>

      <div style="font-family:${MONO};font-size:9px;letter-spacing:0.18em;color:${C.ink3};text-transform:uppercase;padding-top:18px;">SAGE&trade; &mdash; accelerating web3</div>

    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    `SAGE — COMPUTE CREDITS PURCHASED`,
    ``,
    `+${nf(f.creditsAdded)} CR — ${f.tierTitle} tier — $${f.paidUsd.toFixed(2)} settled`,
    ``,
    `Wallet       ${f.address}`,
    ...(f.xHandle ? [`X account    @${f.xHandle}`] : []),
    `Paid         ${f.paidEth} ETH`,
    `Balance now  ${nf(f.newBalance)} CR`,
    `Transaction  ${f.txHash}`,
    `Settled      ${when}`,
    ``,
    f.explorerUrl,
  ].join('\n');

  return { subject, html, text };
}
