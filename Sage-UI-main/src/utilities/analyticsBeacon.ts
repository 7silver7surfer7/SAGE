/**
 * First-party pageview beacon (client side of /api/track).
 *
 * Privacy model: visitorId is a random first-party id in localStorage (no
 * fingerprinting), sessionId rotates after 30 minutes of inactivity, and the
 * whole thing is skipped when the browser asks not to be tracked. Sending
 * uses navigator.sendBeacon so navigation is never blocked; failures are
 * silently ignored — analytics must never affect the user.
 */
const VISITOR_KEY = 'sage-vid';
const SESSION_KEY = 'sage-sid';
const SESSION_TTL_MS = 30 * 60 * 1000;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function visitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return uuid(); // storage blocked → per-load id (still counted, just noisier)
  }
}

function sessionId(): string {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const { id, at } = JSON.parse(raw);
      if (Date.now() - at < SESSION_TTL_MS) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, at: Date.now() }));
        return id;
      }
    }
    const id = uuid();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, at: Date.now() }));
    return id;
  } catch {
    return uuid();
  }
}

export function trackPageview(path: string) {
  try {
    if (typeof window === 'undefined') return;
    if (navigator.doNotTrack === '1' || (window as any).doNotTrack === '1') return;
    const body = JSON.stringify({
      visitorId: visitorId(),
      sessionId: sessionId(),
      path,
      referrer: document.referrer || null,
    });
    const url = '/api/track/';
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // never let analytics throw into the app
  }
}
