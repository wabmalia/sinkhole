# Sinkhole

Turn-based mini golf on a neon grid, for up to 8 players. One browser hosts
the room over PeerJS (same model as turn7) and everyone else joins with the
5-letter code or an invite link.

Phaser 4 + TypeScript + Vite. The game logic in `src/engine` is plain TS with
Vitest tests; Phaser only draws the course and the DOM handles the UI.

```sh
npm install
npm run dev      # local server
npm test         # engine and host tests
npm run check    # type check
```

## Playing

Drag anywhere to pull back and aim (or arrow keys, shift for fine steps).
Before your first shot you can drag your ball around the tee mat. Hit SHOOT
(or space) and stop the bar on the gold line. Softer shots get a slower bar and
a tighter zone. Stopping past the zone adds power and hooks the shot clockwise,
stopping short loses power and pulls it anticlockwise.

## Tuning

Every number lives in `src/config.ts`: ball physics, the cup, aiming, the power
bar, stroke limit and colours.

## Deploying

GitHub Actions builds and deploys to GitHub Pages on every push to `main`.
Settings → Pages → Source: "GitHub Actions".
