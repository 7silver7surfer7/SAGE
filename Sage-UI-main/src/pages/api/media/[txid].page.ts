import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

/**
 * Range-capable proxy for Arweave media.
 *
 * The arweave.net gateway answers ranged requests with 200 + full body (no
 * Accept-Ranges/Content-Range), and Safari refuses to play <video> from
 * servers without 206 support — "media unsupported". No public gateway we
 * tested does ranges either, so we serve video bytes ourselves: download the
 * file from the gateway once (content-addressed, hence immutable), cache it
 * on local disk, and answer range requests properly from the cache.
 *
 * Also shields playback from transient gateway routing failures (random edge
 * nodes returning HTML error pages — seen repeatedly in production).
 */

const CACHE_DIR = path.join(os.tmpdir(), 'arweave-media-cache');
const TXID_RE = /^[A-Za-z0-9_-]{43}$/; // base64url tx id — also SSRF guard
const MAX_BYTES = 200 * 1024 * 1024;
// Cloud Run caps non-chunked (Content-Length) responses at 32MB; responses at
// or above this threshold are streamed with chunked transfer-encoding instead
const RESPONSE_LENGTH_DECLARE_MAX = 31 * 1024 * 1024;
// On Cloud Run, os.tmpdir() is an in-memory tmpfs — cached files count against
// the instance's RAM limit, NOT disk. Cap the on-tmpfs cache and evict the
// least-recently-used entries so a burst of distinct large videos can't grow
// the cache until the instance OOMs. Keep this well under the memory limit to
// leave headroom for the Node runtime + concurrent request buffers.
const CACHE_LIMIT_BYTES = 512 * 1024 * 1024;
const GATEWAY = 'https://arweave.net';

// LRU bookkeeping: txid -> { size, atime }. Rebuilt lazily; the source of
// truth is always the files on disk (an eviction just deletes them).
const lru = new Map<string, { size: number; atime: number }>();

// dedupe concurrent downloads of the same tx (a video element fires several
// range requests at once on first load)
const inFlight = new Map<string, Promise<{ file: string; type: string; size: number }>>();

function touch(txid: string, size: number) {
  lru.set(txid, { size, atime: Date.now() });
}

/** evict least-recently-used cache entries until we're under the byte budget */
function evictToFit(incomingBytes: number) {
  let total = incomingBytes;
  Array.from(lru.values()).forEach((v) => (total += v.size));
  if (total <= CACHE_LIMIT_BYTES) return;
  const byAge = Array.from(lru.entries()).sort((a, b) => a[1].atime - b[1].atime);
  for (const [txid, meta] of byAge) {
    if (total <= CACHE_LIMIT_BYTES) break;
    if (inFlight.has(txid)) continue; // don't evict a file being written
    const file = path.join(CACHE_DIR, txid);
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.meta.json`, { force: true });
    lru.delete(txid);
    total -= meta.size;
  }
}

async function fetchToCache(txid: string) {
  const file = path.join(CACHE_DIR, txid);
  const metaFile = `${file}.meta.json`;
  if (fs.existsSync(file) && fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    touch(txid, meta.size);
    return { file, type: meta.type as string, size: meta.size as number };
  }
  const res = await fetch(`${GATEWAY}/${txid}`);
  if (!res.ok || !res.body) throw new Error(`gateway responded ${res.status}`);
  const type = res.headers.get('content-type') || 'application/octet-stream';
  if (type.startsWith('text/html')) {
    // unhealthy edge node serving an error page instead of the content
    throw new Error('gateway returned an error page instead of media');
  }
  // stream to disk — buffering whole files in memory (Buffer.from(arrayBuffer))
  // doubled peak RAM per file and OOM-pressured the instance when several
  // large videos were fetched cold at once (exactly what a fresh drop does)
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    // Readable.fromWeb exists since Node 16.5; this repo's @types/node predates it
    await pipeline((Readable as any).fromWeb(res.body), fs.createWriteStream(tmp));
    const size = fs.statSync(tmp).size;
    if (!size) throw new Error('gateway returned an empty body');
    if (size > MAX_BYTES) throw new Error('file exceeds proxy size limit');
    evictToFit(size); // make room before committing this file into the cache
    fs.renameSync(tmp, file); // atomic — no partial reads by other requests
    fs.writeFileSync(metaFile, JSON.stringify({ type, size }));
    touch(txid, size);
    return { file, type, size };
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function getCached(txid: string) {
  let promise = inFlight.get(txid);
  if (!promise) {
    promise = fetchToCache(txid).finally(() => inFlight.delete(txid));
    inFlight.set(txid, promise);
  }
  return promise;
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
  try {
    const { file, type, size } = await getCached(txid);
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
        // suffix range: last N bytes
        start = Math.max(0, size - parseInt(m[2], 10));
        end = size - 1;
      }
      end = Math.min(end, size - 1);
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      // Cloud Run's edge rejects non-chunked responses over 32MB with an
      // opaque 500 — declare a length only for segments safely under that,
      // and let Node's chunked transfer-encoding handle anything bigger
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
