import { promises as dns } from 'dns';
import http from 'http';
import https from 'https';

/**
 * Server-side link unfurling for SAGE Social — the first URL in a post is
 * resolved to a Twitter-style preview card (title / description / image) at
 * post time and frozen onto the row. Best-effort: any failure just means no
 * card, never a failed post.
 */

export interface LinkPreview {
  url: string;
  title: string | null;
  desc: string | null;
  image: string | null;
}

const URL_RE = /https?:\/\/[^\s<>"')]+/i;

export function extractFirstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  if (!m) return null;
  // strip common trailing punctuation people type after links
  return m[0].replace(/[.,;:!?]+$/, '');
}

/** Is this literal IP address in a private/loopback/reserved range? */
function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('::ffff:127.') || ip === '0.0.0.0') return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  const low = ip.toLowerCase();
  if (/^f[cd][0-9a-f]{2}:/.test(low) || /^fe[89ab][0-9a-f]:/.test(low)) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // incl. cloud metadata 169.254.169.254
  return false;
}

/**
 * SSRF guard + DNS PIN (audit M5). Validates the URL is a public http(s) host,
 * resolves it once, and returns the concrete public IP so the caller connects
 * to EXACTLY that address — never a second, unvalidated resolution. This closes
 * the DNS-rebinding TOCTOU: the previous code validated the resolved IP but
 * then let fetch() do its OWN independent lookup, which an attacker controlling
 * a ~0-TTL record could answer as public on the check and internal on connect.
 * Every resolved address must be public (a mixed answer is rejected outright).
 */
async function resolveSafe(
  raw: string
): Promise<{ url: URL; ip: string; family: number } | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  const bare = host.startsWith('[') ? host.slice(1, -1) : host; // unwrap [IPv6]
  if (isPrivateIp(bare)) return null;
  try {
    const addrs = await dns.lookup(bare, { all: true, verbatim: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return null;
    return { url: u, ip: addrs[0].address, family: addrs[0].family };
  } catch {
    return null; // unresolvable host — nothing safe to fetch anyway
  }
}

async function fetchWithLimit(url: string, accept: string): Promise<string | null> {
  // Manual redirect handling: an auto-followed redirect could 30x a safe,
  // public URL to an internal/metadata address. Re-validate AND re-pin every
  // hop (capped at 5) — each request connects only to the just-validated IP.
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const safe = await resolveSafe(current);
    if (!safe) return null;
    const { url: u, ip, family } = safe;
    const lib = u.protocol === 'https:' ? https : http;
    const result = await new Promise<{ status: number; location: string | null; body: string | null }>(
      (resolve) => {
        const req = lib.get(
          {
            protocol: u.protocol,
            hostname: u.hostname, // Host header + TLS SNI/cert use the real name…
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            // …but the socket connects to the exact IP we validated — no
            // re-resolution, so DNS can't rebind to an internal address here.
            // Node 22's Happy Eyeballs (autoSelectFamily) calls lookup with
            // {all:true} and expects an array, so handle both callback forms.
            lookup: (_h: string, opts: any, cb: any) =>
              opts && opts.all ? cb(null, [{ address: ip, family }]) : cb(null, ip, family),
            headers: {
              'user-agent':
                'Mozilla/5.0 (compatible; SAGESocialBot/1.0; +https://sageart.xyz) facebookexternalhit/1.1',
              accept,
            },
            timeout: 5000,
          },
          (res) => {
            const status = res.statusCode || 0;
            if (status >= 300 && status < 400) {
              res.resume();
              resolve({ status, location: res.headers.location || null, body: null });
              return;
            }
            if (status < 200 || status >= 300) {
              res.resume();
              resolve({ status, location: null, body: null });
              return;
            }
            const chunks: Buffer[] = [];
            let total = 0;
            res.on('data', (c: Buffer) => {
              chunks.push(c);
              total += c.length;
              if (total > 512 * 1024) {
                res.destroy();
                resolve({ status, location: null, body: Buffer.concat(chunks).toString('utf8') });
              }
            });
            res.on('end', () =>
              resolve({ status, location: null, body: Buffer.concat(chunks).toString('utf8') })
            );
            res.on('error', () => resolve({ status, location: null, body: null }));
          }
        );
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve({ status: 0, location: null, body: null }));
      }
    );
    if (result.status >= 300 && result.status < 400) {
      if (!result.location) return null;
      current = new URL(result.location, current).toString();
      continue; // re-validate + re-pin the new target
    }
    return result.body;
  }
  return null; // too many redirects
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    // property=... content=... in either attribute order
    const re1 = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
      'i'
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
      'i'
    );
    const m = html.match(re1) || html.match(re2);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x?27;|&#0*39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/** Tweets: publish.twitter.com/oembed works without auth and returns text. */
async function tweetPreview(url: string): Promise<LinkPreview | null> {
  const body = await fetchWithLimit(
    `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`,
    'application/json'
  );
  if (!body) return null;
  try {
    const j = JSON.parse(body);
    const text = String(j.html || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      url,
      title: j.author_name ? `${j.author_name} on X` : 'Post on X',
      desc: text.slice(0, 280) || null,
      image: null,
    };
  } catch {
    return null;
  }
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  if (!(await resolveSafe(url))) return null;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }

  if ((host === 'x.com' || host === 'twitter.com') && /\/status\/\d+/.test(url)) {
    const t = await tweetPreview(url);
    if (t) return t;
  }

  const html = await fetchWithLimit(url, 'text/html,application/xhtml+xml');
  if (!html) {
    // still show a minimal domain card so the link is at least tappable
    return { url, title: host, desc: null, image: null };
  }
  const title =
    metaContent(html, ['og:title', 'twitter:title']) ||
    decodeEntities((html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] || '').trim()) ||
    null;
  const desc = metaContent(html, ['og:description', 'twitter:description', 'description']);
  let image = metaContent(html, ['og:image', 'og:image:url', 'twitter:image']);
  if (image) {
    try {
      image = new URL(image, url).toString(); // resolve relative og:image
      if (!/^https?:\/\//.test(image)) image = null;
    } catch {
      image = null;
    }
  }
  if (!title && !desc && !image) return { url, title: host, desc: null, image: null };
  return {
    url,
    title: title?.slice(0, 200) || host,
    desc: desc?.slice(0, 300) || null,
    image,
  };
}
