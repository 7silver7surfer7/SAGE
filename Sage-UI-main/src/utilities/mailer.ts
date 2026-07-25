/**
 * Outbound email, transport-agnostic.
 *
 * The project had no mailer, so rather than commit to one vendor this picks a
 * transport from whichever credentials are present:
 *
 *   RESEND_API_KEY                  -> Resend's HTTP API (pure fetch, no dep)
 *   SMTP_HOST + SMTP_USER + SMTP_PASS -> any SMTP provider, via nodemailer
 *
 * Resend is the default because its free tier sends to the ACCOUNT OWNER'S
 * address from `onboarding@resend.dev` with no domain verification — which is
 * exactly the shape of an admin notification — and because a fetch call needs
 * no new dependency, matching how xClient.ts and twitter.ts already talk to
 * APIs. nodemailer is imported lazily so it is only required if actually used.
 *
 * WITH NEITHER CONFIGURED THIS IS A NO-OP that logs once and returns false.
 * Notification is not worth failing a paid transaction over — see sendMail's
 * contract: it NEVER throws.
 */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Always send one: some clients prefer it, and
   *  spam filters treat html-only mail as a signal. */
  text: string;
}

let warnedNoTransport = false;

/** Who the notification is addressed to, and who it claims to be from. */
export function notifyAddress(): string | null {
  return process.env.NOTIFY_EMAIL || null;
}

function fromAddress(): string {
  // Resend's shared sender works without owning a domain, but ONLY to the
  // address that owns the Resend account. Override once a domain is verified.
  return process.env.MAIL_FROM || 'SAGE <onboarding@resend.dev>';
}

async function sendViaResend(msg: MailMessage, key: string): Promise<boolean> {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!r.ok) {
    // Resend states the actual reason (unverified domain, wrong recipient on
    // the shared sender); the status alone is not diagnostic.
    console.error('mail: resend rejected', r.status, (await r.text()).slice(0, 300));
    return false;
  }
  return true;
}

async function sendViaSmtp(msg: MailMessage): Promise<boolean> {
  let nodemailer: any;
  try {
    // Resolved through `eval('require')` on purpose: nodemailer is an OPTIONAL
    // peer, needed only by this branch. A static import would fail the
    // typecheck and get bundled for everyone; a bare dynamic import() would
    // make webpack try to resolve it at build time. This stays invisible to
    // both and is simply absent until someone installs it.
    // eslint-disable-next-line no-eval
    nodemailer = (eval('require') as NodeRequire)('nodemailer');
  } catch {
    console.error('mail: SMTP_* is set but nodemailer is not installed — run: npm i nodemailer');
    return false;
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this backwards
    // hangs the connection rather than erroring cleanly.
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({
    from: fromAddress(),
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  return true;
}

/**
 * Send one message. NEVER THROWS — returns whether it went out.
 *
 * Callers are notification paths hanging off real transactions; an unreachable
 * mail provider must not turn a settled payment into a 500. Every failure is
 * logged with enough detail to diagnose and swallowed.
 */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) return await sendViaResend(msg, resendKey);

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      return await sendViaSmtp(msg);
    }

    if (!warnedNoTransport) {
      warnedNoTransport = true;
      console.warn(
        'mail: no transport configured — set RESEND_API_KEY (or SMTP_HOST/USER/PASS) to enable notifications'
      );
    }
    return false;
  } catch (e: any) {
    console.error('mail: send failed', e?.message || e);
    return false;
  }
}
