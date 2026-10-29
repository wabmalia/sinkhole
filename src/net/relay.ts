// TURN relay credentials from the turn-relay Worker, so players who can't
// connect directly (phones on mobile data, strict Wi-Fi) still can. If the
// Worker can't be reached in time, rooms fall back to direct connections only.

export const RELAY_URL = 'https://turn-relay.wabmalia.workers.dev/';

const WAIT_MS = 3000;
// The Worker's credentials last 12 hours; refresh well before that.
const REUSE_MS = 6 * 60 * 60 * 1000;

let cached: { servers: RTCIceServer[]; at: number } | null = null;

export async function iceServers(): Promise<RTCIceServer[] | undefined> {
  if (cached && Date.now() - cached.at < REUSE_MS) return cached.servers;
  try {
    const res = await fetch(RELAY_URL, { signal: AbortSignal.timeout(WAIT_MS) });
    if (!res.ok) throw new Error(`relay ${res.status}`);
    const { iceServers: servers } = (await res.json()) as { iceServers: RTCIceServer[] };
    cached = { servers, at: Date.now() };
    return servers;
  } catch (e) {
    console.info('[sinkhole] no relay, direct connections only', e);
    return undefined;
  }
}
