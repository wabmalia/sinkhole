// TURN relay credentials from the turn-relay Worker, so players who can't
// connect directly (phones on mobile data, strict Wi-Fi) still can. The
// Worker wants an invisible Turnstile check first, and only answers the
// deployed site; anywhere else, or if anything fails, rooms fall back to
// direct connections only.

export const RELAY_URL = 'https://turn-relay.wabmalia.workers.dev/';
// Public: identifies the Turnstile widget. Its secret lives in the Worker.
const TURNSTILE_SITEKEY = '0x4AAAAAAFrTw_Fxf9TFG5GL';
const RELAY_SITE = 'wabmalia.github.io';

const WAIT_MS = 8000;
// The Worker's credentials last 12 hours; refresh well before that.
const REUSE_MS = 6 * 60 * 60 * 1000;
// After a failure, don't hold up the next room by trying again straight away.
const RETRY_MS = 5 * 60 * 1000;

let cached: { servers: RTCIceServer[] | undefined; at: number; ttl: number } | null = null;
let inflight: Promise<RTCIceServer[] | undefined> | null = null;

// Relay servers, or undefined for direct-only. Safe to call early (e.g. on
// page load) to have them ready by the time a room opens.
export function iceServers(): Promise<RTCIceServer[] | undefined> {
  if (location.hostname !== RELAY_SITE) return Promise.resolve(undefined);
  if (cached && Date.now() - cached.at < cached.ttl) return Promise.resolve(cached.servers);
  inflight ??= fetchServers().finally(() => (inflight = null));
  return inflight;
}

async function fetchServers(): Promise<RTCIceServer[] | undefined> {
  try {
    const token = await withTimeout(turnstileToken(), WAIT_MS);
    const res = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(WAIT_MS),
    });
    if (!res.ok) throw new Error(`relay ${res.status}`);
    const { iceServers: servers } = (await res.json()) as { iceServers: RTCIceServer[] };
    cached = { servers, at: Date.now(), ttl: REUSE_MS };
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
  waiting: ((token: string | null) => void) | null;
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
    const done = (token: string | null) => (token ? resolve(token) : reject(new Error('turnstile check failed')));
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
    const settle = (token: string | null) => {
      const cb = w.waiting;
      w.waiting = null;
      cb?.(token);
    };
    w.id = ts.render(box, {
      sitekey: TURNSTILE_SITEKEY,
      appearance: 'interaction-only',
      theme: 'dark',
      callback: (token: string) => settle(token),
      'error-callback': () => settle(null),
      'expired-callback': () => settle(null),
    });
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))]);
}
