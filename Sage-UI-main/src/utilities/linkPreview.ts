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

/** SSRF guard: only public-looking http(s) hosts — never loopback/private. */
function isSafeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  // IPv4 literals in private/reserved ranges (incl. cloud metadata 169.254.*)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0 || (a === 192 && b === 168)) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  if (host === '::1' || host.startsWith('[')) return false;
  return true;
}

async function fetchWithLimit(url: string, accept: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // a browsery UA — many sites hide OG tags from unknown bots
        'user-agent':
          'Mozilla/5.0 (compatible; SAGESocialBot/1.0; +https://sageart.xyz) facebookexternalhit/1.1',
        accept,
      },
    });
    if (!res.ok) return null;
    // cap the read at 512KB — we only need the <head>
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
        if (total > 512 * 1024) {
          ctrl.abort();
          break;
        }
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  if (!isSafeUrl(url)) return null;
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
