import { createRelay } from '@wabmalia/courier';

// TURN relay credentials from the turn-relay Worker (see courier's README),
// so players who can't connect directly (phones on mobile data, strict
// Wi-Fi) still can. Only on the deployed site; anywhere else, or if anything
// fails, rooms go direct only.

export const relay = createRelay({
  url: 'https://turn-relay.wabmalia.workers.dev/',
  // Public: identifies the Turnstile widget. Its secret lives in the Worker.
  sitekey: '0x4AAAAAAFrTw_Fxf9TFG5GL',
  site: 'arcade.wabmalia.eu',
  // The store apps solve Turnstile on the site's token page instead.
  appOrigins: ['capacitor://localhost'],
  tokenPage: 'https://arcade.wabmalia.eu/relay-token.html',
  tag: 'sinkhole',
});

export const iceServers = (wait?: number) => relay.iceServers(wait);
