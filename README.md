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

Drag anywhere to pull back and aim (or arrow keys, shift for fine steps); the
power shows by the arrow. Before your first shot you can drag your ball around
the tee mat. The aim sways a couple of degrees either side, faster on harder
shots, and SHOOT (the button by your ball, or space) fires wherever it points
at that moment.

Rooms play a set of holes in a row. The host picks the set in the lobby; the
podium button in game shows the scorecard, and after each hole everyone sees
the results and the card so far until the host goes on. Lowest total wins.
Whoever did best on a hole plays first on the next one, and anyone offline
when a hole starts begins it picked up. PLAY SOLO plays a set alone, with no
connection at all; on the dev server `?solo=<set id>` jumps straight in.

## Holes and sets

Holes are JSON files in `src/holes/`, sets (a name and hole ids in order) in
`src/sets/`; both are checked by the tests. The editor at `/editor/` draws
holes and puts them into sets (its HOLES and SETS tabs). On the dev server it
saves into those folders; on the site it downloads the file instead.

## Tuning

Every number lives in `src/config.ts`: ball physics, the cup, hole elements,
aiming and its sway, stroke limit and colours.

## Deploying

GitHub Actions builds and deploys to GitHub Pages on every push to `main`.
Settings → Pages → Source: "GitHub Actions".
