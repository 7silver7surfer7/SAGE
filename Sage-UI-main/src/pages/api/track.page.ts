import { NextApiRequest, NextApiResponse } from 'next';
import { createHash } from 'crypto';
import { getToken } from 'next-auth/jwt';
import prisma from '@/prisma/client';

/**
 * First-party pageview beacon (see _app's route-change hook). Fire-and-forget:
 * always answers 204 fast; failures are swallowed — analytics must never take
 * the site down. Privacy: no raw IPs (salted hash only, same pattern as the
 * mint gate), referrer reduced to its host, respects the client-side DNT skip.
 */
const RETENTION_DAYS = 90;

function clientIp(req: NextApiRequest): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',').pop()!.trim();
  return req.socket.remoteAddress || '';
}

function deviceClass(ua: string): string {
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { visitorId, sessionId, path, referrer } = req.body || {};
    if (!UUID_RE.test(visitorId || '') || !UUID_RE.test(sessionId || ''))
      return res.status(204).end();
    // normalize the path: strip query/hash, clamp, only site-local paths
    const cleanPath = String(path || '/')
      .split(/[?#]/)[0]
      .slice(0, 120);
    if (!cleanPath.startsWith('/')) return res.status(204).end();
    // referrer → host only (never full URLs, never our own host)
    let refHost: string | null = null;
    try {
      if (referrer) {
        const h = new URL(String(referrer)).host.slice(0, 120);
        const own = (process.env.NEXTAUTH_URL || '').includes(h);
        refHost = h && !own ? h : null;
      }
    } catch {
      refHost = null;
    }
    // wallet link when signed in (JWT only — unspoofable, never from body)
    const token = await getToken({ req, secret: process.env.JWT_SECRET }).catch(() => null);
    const walletAddress = token?.sub || null;

    const ip = clientIp(req);
    const ipHash = ip
      ? createHash('sha256').update(`${process.env.NEXTAUTH_SECRET || 'salt'}${ip}`).digest('hex')
      : null;
    const country =
      typeof req.headers['cf-ipcountry'] === 'string'
        ? (req.headers['cf-ipcountry'] as string).slice(0, 2).toUpperCase()
        : null;

    await prisma.siteVisit.create({
      data: {
        visitorId,
        sessionId,
        walletAddress,
        path: cleanPath,
        referrer: refHost,
        country: country && country !== 'XX' ? country : null,
        device: deviceClass(String(req.headers['user-agent'] || '')),
        ipHash,
      },
    });

    // opportunistic retention prune: ~1% of beacons clear expired rows, so no
    // dedicated cron is needed at this volume
    if (Math.random() < 0.01) {
      await prisma.siteVisit
        .deleteMany({
          where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 864e5) } },
        })
        .catch(() => {});
    }
  } catch (e) {
    console.error('track beacon failed', e);
  }
  res.status(204).end();
}
