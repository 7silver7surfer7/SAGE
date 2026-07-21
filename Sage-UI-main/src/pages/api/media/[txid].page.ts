import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { once } from 'events';
import { s3MirrorUrl } from '@/utilities/s3Mirror';

/**
 * Range-capable transcoding proxy for Arweave media.
 *
 * Two jobs:
 *  1. Range support. The arweave.net gateway answers ranged requests with 200 +
 *     full body (no Accept-Ranges/Content-Range), and Safari refuses to play
 *     <video> without 206. We cache the (immutable, content-addressed) file and
 *     serve proper 206s from it. Also shields playback from transient gateway
 *     routing failures (edge nodes returning HTML error pages).
 *  2. iOS compatibility. iOS Safari's hardware H.264 decoder rejects oversized
 *     videos (>~4K / level >5.0), so a master that plays on desktop fails on
 *     mobile. Rather than storing a second copy on Arweave, we transcode an
 *     iOS-safe rendition ON DEMAND (once, then cached) and serve THAT to
 *     everyone. Only the master ever lives on Arweave. Curated drops pre-warm
 *     this (see ?prewarm) at approval time so viewers never wait.
 */

// Cache location + size are host-dependent, so both are env-overridable:
//  - Cloud Run: os.tmpdir() is an in-memory tmpfs, so cached files count
//    against the instance's RAM — the default 512MB cap protects RAM.
//  - Raspberry Pi / bare Linux: /tmp is ON DISK, so the RAM assumption is
//    wrong two ways: no RAM pressure, but SD-card write wear. Point
//    MEDIA_CACHE_DIR at NVMe (or a mounted tmpfs) and raise
//    MEDIA_CACHE_LIMIT_MB to taste.
const CACHE_DIR =
  process.env.MEDIA_CACHE_DIR || path.join(os.tmpdir(), 'arweave-media-cache');
const TXID_RE = /^[A-Za-z0-9_-]{43}$/; // base64url tx id — also SSRF guard
const MAX_BYTES = 200 * 1024 * 1024;
// Cloud Run caps non-chunked (Content-Length) responses at 32MB; responses at
// or above this threshold are streamed with chunked transfer-encoding instead
const RESPONSE_LENGTH_DECLARE_MAX = 31 * 1024 * 1024;
// LRU cap for the cache dir; evicts least-recently-used entries so a burst of
// distinct large videos can't grow the cache until the host OOMs (tmpfs) or
// fills the disk.
const CACHE_LIMIT_BYTES =
  (parseInt(process.env.MEDIA_CACHE_LIMIT_MB || '', 10) || 512) * 1024 * 1024;
const GATEWAY = 'https://arweave.net';

// iOS-safe H.264 threshold: transcode when either dimension exceeds this or the
// encoded level is above 5.0. Renditions we produce (1920 long side, level 5.0)
// sit under this, so they're served as-is and never re-transcoded.
const IOS_MAX_DIM = 2048;
const IOS_MAX_LEVEL = 50; // ffprobe integer level (50 = 5.0, 51 = 5.1, 60 = 6.0)

interface Entry {
  file: string;
  type: string;
  size: number;
  // set only on the request that actually performed a downscale this call —
  // surfaced by ?prewarm so the dashboard log can report it
  transcode?: { from: string; to: string };
}

// LRU keyed by cache filename ("<txid>" for a master, "<txid>.ios" for a
// rendition). The files on disk are the source of truth; eviction just deletes.
const lru = new Map<string, { size: number; atime: number }>();
// dedupe concurrent work for the same tx (a <video> fires several ranges at once)
const inFlight = new Map<string, Promise<Entry>>();
// dedupe poster-frame extraction the same way (many tiles ask at once)
const posterInFlight = new Map<string, Promise<Entry>>();
// serialize ffmpeg runs — decoding a huge frame is memory-heavy; one at a time
// protects the instance from OOM when several oversized videos warm together
let transcodeGate: Promise<unknown> = Promise.resolve();

function touch(key: string, size: number) {
  lru.set(key, { size, atime: Date.now() });
}

function evictToFit(incomingBytes: number, protectKeys: Set<string>) {
  let total = incomingBytes;
  Array.from(lru.values()).forEach((v) => (total += v.size));
  if (total <= CACHE_LIMIT_BYTES) return;
  const byAge = Array.from(lru.entries()).sort((a, b) => a[1].atime - b[1].atime);
  for (const [key, meta] of byAge) {
    if (total <= CACHE_LIMIT_BYTES) break;
    if (inFlight.has(key) || protectKeys.has(key)) continue;
    const file = path.join(CACHE_DIR, key);
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.meta.json`, { force: true });
    lru.delete(key);
    total -= meta.size;
  }
}

function readCached(key: string): Entry | null {
  const file = path.join(CACHE_DIR, key);
  const metaFile = `${file}.meta.json`;
  if (fs.existsSync(file) && fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    touch(key, meta.size);
    return { file, type: meta.type as string, size: meta.size as number };
  }
  return null;
}

function commit(key: string, tmp: string, type: string, protectKeys: Set<string>): Entry {
  const size = fs.statSync(tmp).size;
  if (!size) throw new Error('empty output');
  if (size > MAX_BYTES) throw new Error('file exceeds proxy size limit');
  evictToFit(size, protectKeys);
  const file = path.join(CACHE_DIR, key);
  fs.renameSync(tmp, file);
  fs.writeFileSync(`${file}.meta.json`, JSON.stringify({ type, size }));
  touch(key, size);
  return { file, type, size };
}

/** Public S3 mirror GET; null when the object doesn't exist / S3 hiccups. */
async function fetchFromS3Mirror(txid: string): Promise<Response | null> {
  try {
    const s3res = await fetch(s3MirrorUrl(txid));
    if (s3res.ok && s3res.body) return s3res;
  } catch {
    /* mirror unreachable — caller falls back to Arweave handling */
  }
  return null;
}

async function fetchFromGateway(txid: string): Promise<Response> {
  // The gateway load-balances across edge nodes; an unhealthy one can 404 or
  // serve an HTML error page for content that IS available elsewhere. Retry a
  // few times before giving up (genuinely-missing data won't heal, but this
  // rides out transient routing).
  let last = '';
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`${GATEWAY}/${txid}`);
      const type = res.headers.get('content-type') || '';
      if (res.ok && res.body && !type.startsWith('text/html')) return res;
      last = type.startsWith('text/html') ? 'gateway error page' : `status ${res.status}`;
    } catch (e: any) {
      last = e?.message || 'fetch failed';
    }
    // FIRST failure: try the S3 mirror IMMEDIATELY. Fresh uploads routinely
    // lag Arweave gateway propagation, and the old order (full retry ladder
    // with backoff — ~30s worst case — before ever touching S3) outlasted
    // browser <video> elements' patience, so viewers saw "media could not be
    // loaded" while a perfectly good mirror copy sat unused. Content that was
    // never mirrored (NFT metadata) just misses here and keeps the ladder.
    if (i === 0) {
      const s3res = await fetchFromS3Mirror(txid);
      if (s3res) {
        console.log(`media proxy [${txid}]: gateway miss (${last}), served from S3 mirror`);
        return s3res;
      }
    }
    if (i < 3) {
      console.warn(`media proxy [${txid}]: gateway attempt ${i + 1} failed (${last}), retrying…`);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  // Ladder exhausted — one last mirror look (covers an S3 blip on the early try).
  const s3res = await fetchFromS3Mirror(txid);
  if (s3res) {
    console.log(`media proxy [${txid}]: Arweave gateway exhausted, served from S3 mirror`);
    return s3res;
  }
  throw new Error(`gateway did not serve data after retries (${last})`);
}

async function downloadMaster(txid: string): Promise<Entry> {
  const cached = readCached(txid);
  if (cached) return cached;
  const res = await fetchFromGateway(txid);
  const type = res.headers.get('content-type') || 'application/octet-stream';
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = path.join(CACHE_DIR, `${txid}.dl-${process.pid}-${Date.now()}`);
  try {
    await pipeline((Readable as any).fromWeb(res.body), fs.createWriteStream(tmp));
    return commit(txid, tmp, type, new Set([txid]));
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`))
    );
  });
}

/** returns { width, height, level } or null if not a decodable video stream */
async function probeVideo(file: string) {
  try {
    const out = await run('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,level',
      '-of', 'csv=p=0', file,
    ]);
    const [w, h, level] = out.trim().split(',').map(Number);
    if (!w || !h) return null;
    return { width: w, height: h, level: level || 0 };
  } catch {
    return null;
  }
}

async function transcodeIosSafe(srcFile: string, outFile: string) {
  await run('ffmpeg', [
    '-nostdin', '-y', '-loglevel', 'error', '-i', srcFile,
    // longest side -> 1920, even dimensions
    '-vf', "scale='if(gt(iw,ih),1920,-2)':'if(gt(iw,ih),-2,1920)':flags=lanczos",
    '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '5.0',
    '-pix_fmt', 'yuv420p', '-crf', '23', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    // the cache temp file has no extension — tell ffmpeg the container
    '-f', 'mp4', outFile,
  ]);
}

/**
 * Returns the file to serve for `txid`: a cached iOS rendition if one exists or
 * is needed, otherwise the master. Downloads + probes + transcodes as required,
 * caching each step. Deduped per-txid; transcodes are serialized.
 */
async function ensureServable(txid: string): Promise<Entry> {
  const iosKey = `${txid}.ios`;
  const iosCached = readCached(iosKey);
  if (iosCached) return iosCached;

  const master = await downloadMaster(txid);
  if (!master.type.startsWith('video/')) return master; // images/other pass through

  const info = await probeVideo(master.file);
  const oversized =
    info && (Math.max(info.width, info.height) > IOS_MAX_DIM || info.level > IOS_MAX_LEVEL);
  if (!oversized) return master; // already iOS-safe

  // transcode (serialized), then drop the big master from tmpfs to reclaim RAM
  const outTmp = path.join(CACHE_DIR, `${iosKey}.tc-${process.pid}-${Date.now()}`);
  const prev = transcodeGate;
  let release: (value?: unknown) => void = () => {};
  transcodeGate = new Promise((r) => (release = r));
  try {
    await prev.catch(() => {});
    console.log(`media proxy [${txid}]: transcoding ${info!.width}x${info!.height} L${info!.level} -> iOS-safe`);
    await transcodeIosSafe(master.file, outTmp);
    const entry = commit(iosKey, outTmp, 'video/mp4', new Set([iosKey]));
    // free the oversized master — the rendition is what we serve now
    fs.rmSync(master.file, { force: true });
    fs.rmSync(`${master.file}.meta.json`, { force: true });
    lru.delete(txid);
    // output dims mirror the ffmpeg scale (longest side -> 1920, even)
    const longest = Math.max(info!.width, info!.height);
    const s = 1920 / longest;
    const outW = Math.round((info!.width * s) / 2) * 2;
    const outH = Math.round((info!.height * s) / 2) * 2;
    entry.transcode = { from: `${info!.width}x${info!.height}`, to: `${outW}x${outH}` };
    return entry;
  } catch (e) {
    fs.rmSync(outTmp, { force: true });
    throw e;
  } finally {
    release!();
  }
}

/** Extract a single downscaled JPEG still (first frame) for a video poster. */
async function extractPoster(srcFile: string, outFile: string) {
  await run('ffmpeg', [
    '-nostdin', '-y', '-loglevel', 'error', '-i', srcFile,
    '-frames:v', '1',
    // long side -> 640px: a tile-sized still, tiny to transfer and fast to draw
    '-vf', "scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)':flags=lanczos",
    '-q:v', '3', '-f', 'image2', '-c:v', 'mjpeg', outFile,
  ]);
}

/**
 * Returns a cached first-frame JPEG poster for a video tx. Tiles show this
 * instantly (a few KB) instead of waiting for the <video> to load metadata and
 * paint its first frame — and it renders even where iOS won't mount yet-another
 * concurrent decoder. Reuses an already-cached rendition/master frame when
 * present so a poster request never forces a fresh full download.
 */
async function getPoster(txid: string): Promise<Entry> {
  const posterKey = `${txid}.poster`;
  const cached = readCached(posterKey);
  if (cached) return cached;

  let promise = posterInFlight.get(txid);
  if (!promise) {
    promise = (async () => {
      const already = readCached(posterKey);
      if (already) return already;
      const srcEntry =
        readCached(`${txid}.ios`) || readCached(txid) || (await downloadMaster(txid));
      // non-video (a still image) is its own poster — serve it directly
      if (!srcEntry.type.startsWith('video/')) return srcEntry;

      const outTmp = path.join(CACHE_DIR, `${posterKey}.pf-${process.pid}-${Date.now()}`);
      const prev = transcodeGate; // share the ffmpeg gate — memory-heavy decode
      let release: (value?: unknown) => void = () => {};
      transcodeGate = new Promise((r) => (release = r));
      try {
        await prev.catch(() => {});
        await extractPoster(srcEntry.file, outTmp);
        return commit(posterKey, outTmp, 'image/jpeg', new Set([posterKey]));
      } catch (e) {
        fs.rmSync(outTmp, { force: true });
        throw e;
      } finally {
        release!();
      }
    })().finally(() => posterInFlight.delete(txid));
    posterInFlight.set(txid, promise);
  }
  return promise;
}

function getServable(txid: string) {
  let promise = inFlight.get(txid);
  if (!promise) {
    promise = ensureServable(txid).finally(() => inFlight.delete(txid));
    inFlight.set(txid, promise);
  }
  return promise;
}

/**
 * Lightweight existence check: is this tx's DATA actually seeded on Arweave?
 * A tiny ranged GET, retried several times server-side to ride out the
 * gateway's transient per-node 404s / HTML error pages (which otherwise
 * false-fail a good upload). Does NOT download or transcode the whole file.
 */
async function verifyRetrievable(
  txid: string
): Promise<{ retrievable: boolean; status: number; reason?: string }> {
  let lastStatus = 0;
  let lastReason = '';
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(`${GATEWAY}/${txid}`, { headers: { Range: 'bytes=0-0' } });
      lastStatus = res.status;
      const ct = res.headers.get('content-type') || '';
      res.body?.cancel?.().catch(() => {}); // don't buffer the body
      if ((res.status === 200 || res.status === 206) && !ct.startsWith('text/html')) {
        return { retrievable: true, status: res.status };
      }
      lastReason = ct.startsWith('text/html') ? 'gateway error page' : `HTTP ${res.status}`;
    } catch (e: any) {
      lastReason = e?.message || 'request failed';
    }
    // patient backoff: ~1.5s..8s, ~25s total across 6 attempts — a genuinely
    // unseeded upload stays 404 throughout; transient routing clears within it
    await new Promise((r) => setTimeout(r, Math.min(1500 + i * 1500, 8000)));
  }
  return { retrievable: false, status: lastStatus, reason: lastReason || 'not retrievable' };
}

// leading bytes buffered to probe iOS-safety before committing to a passthrough
const COLD_PROBE_BYTES = 4 * 1024 * 1024;

/**
 * Cold-start streaming. On a cache miss the buffered path downloads the WHOLE
 * file before sending a byte; for a large video that's a multi-second stall for
 * the first viewer. Instead, pull from the gateway, tee to the cache, and — once
 * a probe on the leading bytes confirms the video is already iOS-safe (needs no
 * transcode) — pass the bytes straight to the client as they arrive.
 *
 * Kept deliberately narrow for safety:
 *  - Only whole-file / open-ended `bytes=0-` GETs. Safari tests range support
 *    with `bytes=0-1` and refuses playback without a real 206, so its requests
 *    fall through to the buffered path (which serves proper 206s) — we never
 *    answer a Safari range probe with a 200 passthrough.
 *  - Oversized masters (which MUST be transcoded before an iOS device sees them)
 *    and anything we can't confirm iOS-safe fall back to the buffered path.
 *  - Client backpressure is honored so a slow consumer can't balloon memory.
 * Returns true if it fully handled the response.
 */
async function tryColdStream(
  txid: string,
  req: NextApiRequest,
  res: NextApiResponse
): Promise<boolean> {
  if (req.method !== 'GET') return false;
  const range = req.headers.range;
  if (range && !/^bytes=0-\s*$/.test(range)) return false; // not a whole-file ask
  if (readCached(`${txid}.ios`) || readCached(txid) || inFlight.has(txid)) return false;

  let gwRes: Response;
  try {
    gwRes = await fetchFromGateway(txid);
  } catch {
    return false; // let the buffered path surface the gateway error
  }
  const type = gwRes.headers.get('content-type') || 'application/octet-stream';
  if (!type.startsWith('video/') || !gwRes.body) {
    gwRes.body?.cancel?.().catch(() => {});
    return false; // images are small — the buffered path is already fast
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = path.join(CACHE_DIR, `${txid}.cs-${process.pid}-${Date.now()}`);
  const ws = fs.createWriteStream(tmp);
  const reader = (Readable as any).fromWeb(gwRes.body) as Readable;
  const writeCache = (buf: Buffer) => {
    if (!ws.write(buf)) return once(ws, 'drain');
    return undefined;
  };

  const prefix: Buffer[] = [];
  let prefixLen = 0;
  let streamEnded = true; // flips to false if we break out with bytes remaining
  try {
    for await (const chunk of reader) {
      const buf = chunk as Buffer;
      prefix.push(buf);
      prefixLen += buf.length;
      await writeCache(buf);
      if (prefixLen >= COLD_PROBE_BYTES) {
        streamEnded = false;
        break;
      }
    }
  } catch {
    try { ws.destroy(); } catch {}
    fs.rmSync(tmp, { force: true });
    return false;
  }

  const info = await probeVideo(tmp); // moov is at the front for faststart uploads
  const oversized =
    info && (Math.max(info.width, info.height) > IOS_MAX_DIM || info.level > IOS_MAX_LEVEL);

  if (!info || oversized) {
    // can't confirm iOS-safe (moov-at-end) or it's oversized and needs a
    // transcode — finish the download into the cache and hand off to the
    // buffered path, which will find the master already cached (no re-download).
    try {
      if (!streamEnded) for await (const chunk of reader) await writeCache(chunk as Buffer);
      await new Promise<void>((resolve, reject) => ws.end((e?: any) => (e ? reject(e) : resolve())));
      commit(txid, tmp, type, new Set([txid]));
    } catch {
      try { ws.destroy(); } catch {}
      fs.rmSync(tmp, { force: true });
    }
    return false;
  }

  // iOS-safe: pass through. Send what we buffered, then tee the rest to both the
  // client (with backpressure) and the cache; commit the master when complete.
  res.status(200);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Type', type);
  try {
    for (const buf of prefix) {
      if (!res.write(buf)) await once(res, 'drain');
    }
    if (!streamEnded) {
      for await (const chunk of reader) {
        const buf = chunk as Buffer;
        await writeCache(buf);
        if (!res.write(buf)) await once(res, 'drain');
      }
    }
    await new Promise<void>((resolve, reject) => ws.end((e?: any) => (e ? reject(e) : resolve())));
    res.end();
    try { commit(txid, tmp, type, new Set([txid])); } catch { fs.rmSync(tmp, { force: true }); }
  } catch {
    // client aborted or gateway hiccup mid-stream — drop the partial cache file
    try { ws.destroy(); } catch {}
    fs.rmSync(tmp, { force: true });
    try { res.end(); } catch {}
  }
  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).end();
    return;
  }
  const txid = String(req.query.txid || '');
  if (!TXID_RE.test(txid)) {
    res.status(400).json({ error: 'invalid transaction id' });
    return;
  }

  // Existence check for the pre-mint gate: resilient, lightweight, no download.
  if (req.query.verify) {
    const result = await verifyRetrievable(txid);
    res.status(200).json(result);
    return;
  }

  // Poster: a small cached first-frame JPEG for a video, so tiles frame
  // instantly instead of waiting on the <video> to load. Small — no ranges.
  if (req.query.poster) {
    try {
      const { file, type, size } = await getPoster(txid);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Type', type);
      if (size < RESPONSE_LENGTH_DECLARE_MAX) res.setHeader('Content-Length', size);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(file).pipe(res);
    } catch (e: any) {
      console.error(`media proxy poster [${txid}]:`, e.message);
      // This is a public, unauthenticated route — the raw exception can
      // include local filesystem paths (fs.createReadStream(file) errors)
      // or gateway internals. Full detail stays in the server log above;
      // the client only needs to know the fetch failed.
      res.status(502).json({ error: 'media unavailable' });
    }
    return;
  }

  // Pre-warm: do the download + (if needed) transcode and cache it, without
  // streaming a body. Called at drop-approval time so the first real viewer
  // gets a cache hit instead of waiting on the transcode.
  if (req.query.prewarm) {
    try {
      const { type, size, transcode } = await getServable(txid);
      // also warm the poster so the very first tile view frames instantly
      await getPoster(txid).catch((e) =>
        console.warn(`media proxy prewarm-poster [${txid}]: ${e.message}`)
      );
      res.status(200).json({
        warmed: true,
        type,
        size,
        // present only when THIS call downscaled the video (first warm of an
        // oversized master); the dashboard log reports it
        downscaled: !!transcode,
        from: transcode?.from,
        to: transcode?.to,
      });
    } catch (e: any) {
      console.error(`media proxy prewarm [${txid}]:`, e.message);
      res.status(502).json({ warmed: false, error: 'prewarm failed' });
    }
    return;
  }

  try {
    // Cold-start fast path: stream an iOS-safe video through as it downloads so
    // the first viewer doesn't wait for the whole file. Returns false (and
    // leaves the response untouched) for Safari range probes, oversized masters,
    // images, or anything unconfirmed — those take the buffered path below.
    if (await tryColdStream(txid, req, res)) return;

    const { file, type, size } = await getServable(txid);
    res.setHeader('Accept-Ranges', 'bytes');
    // content-addressed: the bytes for a tx id can never change
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', type);

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
      if (!m || isNaN(start) || start >= size || (m[1] === '' && m[2] === '')) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      if (m[1] === '') {
        start = Math.max(0, size - parseInt(m[2], 10)); // suffix range: last N bytes
        end = size - 1;
      }
      end = Math.min(end, size - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      // Cloud Run's edge rejects non-chunked responses over 32MB with an opaque
      // 500 — declare a length only for segments safely under that, else stream
      if (end - start + 1 < RESPONSE_LENGTH_DECLARE_MAX) {
        res.setHeader('Content-Length', end - start + 1);
      }
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }

    res.status(200);
    if (size < RESPONSE_LENGTH_DECLARE_MAX) {
      res.setHeader('Content-Length', size);
    }
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  } catch (e: any) {
    console.error(`media proxy [${txid}]:`, e.message);
    res.status(502).json({ error: e.message });
  }
}

export const config = {
  api: {
    // videos are far beyond Next's default 4MB API response cap
    responseLimit: false,
  },
};
