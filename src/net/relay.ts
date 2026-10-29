// TURN relay credentials from the turn-relay Worker, so players who can't
// connect directly (phones on mobile data, strict Wi-Fi) still can. The
// Worker wants an invisible Turnstile check first, and only answers the
// deployed site; anywhere else, or if anything fails, rooms fall back to
// direct connections only.

export const RELAY_URL = 'https://turn-relay.wabmalia.workers.dev/';
// Public: identifies the Turnstile widget. Its secret lives in the Worker.
const TURNSTILE_SITEKEY = '0x4AAAAAAFrTw_Fxf9TFG5GL';
const RELAY_SITE = 'wabmalia.github.io';

// How long the whole thing (Turnstile + Worker) may take in the background,
// and how long opening a room waits for it before going direct-only.
const FETCH_MS = 30_000;
const ROOM_WAIT_MS = 4000;
// The Worker's credentials last 12 hours; refresh well before that.
const REUSE_MS = 6 * 60 * 60 * 1000;
// After a failure, try again for the next room, but not more than once a minute.
const RETRY_MS = 60 * 1000;

let cached: { servers: RTCIceServer[] | undefined; at: number; ttl: number } | null = null;
let inflight: Promise<RTCIceServer[] | undefined> | null = null;

// Relay servers, or undefined for direct-only. Called on page load to get
// them ready; a room opening waits at most `wait` ms, while the fetch carries
// on in the background for the next room.
export function iceServers(wait = ROOM_WAIT_MS): Promise<RTCIceServer[] | undefined> {
  if (location.hostname !== RELAY_SITE) return Promise.resolve(undefined);
  if (cached && Date.now() - cached.at < cached.ttl) return Promise.resolve(cached.servers);
  inflight ??= fetchServers().finally(() => (inflight = null));
  return Promise.race([inflight, new Promise<undefined>(r => setTimeout(() => r(undefined), wait))]);
}

async function fetchServers(): Promise<RTCIceServer[] | undefined> {
  try {
    const token = await withTimeout(turnstileToken(), FETCH_MS);
    const res = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!res.ok) throw new Error(`relay answered ${res.status}`);
    const { iceServers: servers } = (await res.json()) as { iceServers: RTCIceServer[] };
    cached = { servers, at: Date.now(), ttl: REUSE_MS };
    console.info('[sinkhole] relay ready');
    return servers;
  } catch (e) {
    console.info('[sinkhole] no relay, direct connections only', e);
    cached = { servers: undefined, at: Date.now(), ttl: RETRY_MS };
    return undefined;
  }
}

// --- Turnstile ---------------------------------------------------------------

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let script: Promise<Turnstile> | null = null;
interface Widget {
  id: string;
  waiting: ((token: string | null, why?: string) => void) | null;
}
let widget: Widget | null = null;

function loadTurnstile(): Promise<Turnstile> {
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')));
    s.onerror = () => reject(new Error('turnstile failed to load'));
    document.head.append(s);
  });
  return script;
}

// A fresh single-use token. The widget stays invisible unless Cloudflare
// wants the visitor to tick a box.
async function turnstileToken(): Promise<string> {
  const ts = await loadTurnstile();
  return new Promise((resolve, reject) => {
    const done = (token: string | null, why = '') =>
      token ? resolve(token) : reject(new Error(`turnstile check failed ${why}`.trim()));
    if (widget) {
      widget.waiting = done;
      ts.reset(widget.id);
      return;
    }
    const box = document.createElement('div');
    box.className = 'turnstile';
    document.body.append(box);
    const w: Widget = { id: '', waiting: done };
    widget = w;
    const settle = (token: string | null, why?: string) => {
      const cb = w.waiting;
      w.waiting = null;
      cb?.(token, why);
    };
    w.id = ts.render(box, {
      sitekey: TURNSTILE_SITEKEY,
      appearance: 'interaction-only',
      theme: 'dark',
      callback: (token: string) => settle(token),
      // Turnstile's error codes: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/
      'error-callback': (code: string) => {
        settle(null, `(error ${code})`);
        return true; // handled, so Turnstile doesn't throw it as well
      },
      'expired-callback': () => settle(null, '(expired)'),
      'timeout-callback': () => settle(null, '(timed out waiting for the visitor)'),
    });
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}
