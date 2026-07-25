/**
 * Krea AI image generation.
 *
 * Server-side only. KREA_API_KEY has no NEXT_PUBLIC_ variant and must never
 * reach the browser: it bills a real account, so a leaked key is someone
 * else's GPU bill, exactly like ANTHROPIC_API_KEY next door.
 *
 * The API is asynchronous — a generate call returns a job id and the image
 * appears later at GET /jobs/{id} — so everything here is written around
 * polling rather than a single request.
 */

const KREA_API = 'https://api.krea.ai';

/** Model paths Krea exposes. Allowlisted: the caller never picks a raw path. */
const MODELS: Record<string, string> = {
  'krea-2': '/generate/image/krea/krea-2/medium',
};
export const DEFAULT_KREA_MODEL = 'krea-2';

/** Aspect ratios the API accepts, and the only ones we offer. */
export const ASPECT_RATIOS = ['1:1', '4:5', '3:2', '2:3', '16:9', '9:16'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export interface KreaJob {
  id: string;
  status: string;
  /** finished image URLs, when status is completed */
  urls: string[];
  error?: string;
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function keyOrThrow(): string {
  const key = process.env.KREA_API_KEY;
  if (!key) {
    throw new Error('image generation is not configured on this deployment');
  }
  return key;
}

async function call(path: string, init: RequestInit): Promise<any> {
  const r = await fetch(`${KREA_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${keyOrThrow()}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) {
    // Never surface the upstream body wholesale — it can echo the request,
    // headers included. Log server-side, return a short reason.
    console.error('krea error', r.status, text.slice(0, 400));
    throw new Error(`image generation failed (${r.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('image generation returned an unreadable response');
  }
}

/** Pull the job id out of whichever field the API used. */
function jobIdOf(payload: any): string {
  const id = payload?.job_id ?? payload?.id ?? payload?.job?.id;
  if (!id) throw new Error('image generation did not return a job id');
  return String(id);
}

/** Normalise a job payload — result.urls is where finished images land. */
function toJob(id: string, payload: any): KreaJob {
  const result = payload?.result || {};
  const raw = result.urls ?? result.url ?? payload?.urls ?? [];
  const urls = (Array.isArray(raw) ? raw : [raw])
    .map((u: any) => (typeof u === 'string' ? u : u?.url))
    .filter((u: any): u is string => typeof u === 'string' && /^https:\/\//.test(u));
  return {
    id,
    status: String(payload?.status || 'unknown'),
    urls,
    error: result.error ? String(result.error).slice(0, 200) : undefined,
  };
}

export interface GenerateOptions {
  prompt: string;
  aspectRatio?: AspectRatio;
  model?: string;
  /** how long to wait for the image before handing back a pending job */
  timeoutMs?: number;
}

/**
 * Generate an image and wait for it.
 *
 * Resolves as soon as the job reaches a terminal state, or when the timeout
 * elapses — in which case the caller gets a still-pending job with its id and
 * can poll `getJob` rather than the request hanging.
 */
export async function generateImage(opts: GenerateOptions): Promise<KreaJob> {
  const prompt = String(opts.prompt || '').trim().slice(0, 1000);
  if (!prompt) throw new Error('a prompt is required');

  const path = MODELS[opts.model || DEFAULT_KREA_MODEL];
  if (!path) throw new Error(`unknown image model "${opts.model}"`);

  const started = await call(path, {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      aspect_ratio: opts.aspectRatio || '1:1',
      resolution: '1K',
      creativity: 'medium',
    }),
  });

  const id = jobIdOf(started);
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  let job = toJob(id, started);

  // Krea asks for a 2-5s poll interval; 2.5s keeps a typical generation to a
  // handful of requests without hammering them.
  while (!TERMINAL.has(job.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    job = await getJob(id);
  }
  return job;
}

export async function getJob(id: string): Promise<KreaJob> {
  const safe = encodeURIComponent(String(id));
  return toJob(id, await call(`/jobs/${safe}`, { method: 'GET' }));
}
