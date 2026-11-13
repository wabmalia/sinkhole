// Every number worth tweaking lives here. Distances are in course units (the
// test hole is 360 wide), speeds in units per second.
export const CONFIG = {
  ball: {
    radius: 7,
  },

  physics: {
    step: 1 / 240,        // fixed simulation step, seconds
    maxSpeed: 1500,       // speed of a 100% shot
    minSpeed: 90,         // speed of a 0% shot, so a tap still moves
    rolling: 140,         // constant slow-down while rolling, units/s²
    drag: 0.55,           // extra slow-down proportional to speed, 1/s
    stopSpeed: 6,         // below this the ball is at rest
    wallBounce: 0.78,     // share of speed kept off a wall, along the normal
    wallScrub: 0.96,      // share of speed kept along the wall on impact
    ballBounce: 0.9,      // ball-on-ball restitution
    wallGrip: 0.3,        // a ball pressed into a wall rubs along it: this share of the push into the wall slows it along the wall
    restPress: 2,         // a ball meeting a wall or ball no faster than stopSpeed plus this many steps of its ramp or well push rests against it, no bounce
  },

  cup: {
    radius: 12,
    pull: 1200,           // slope of the cup lip pulling the ball in, units/s²
    pullReach: 4,         // the slope starts this far before the ball touches the cup, fading in
    captureSpeed: 420,    // at or below this, a ball over the cup's edge drops in
    captureCentre: 1.5,   // and up to this many times faster over its middle
    captureSlack: 2,      // a ball this far past the cup's edge still counts as over it
  },

  // Hole elements. Limits on what the editor (and a hole file) may set are in
  // holes/format.ts.
  features: {
    portalRadius: 14,     // a ball whose centre gets this close goes through
    coreRadius: 10,       // a black hole swallows a ball this close to its centre
    riverDrag: 3000,      // extra slow-down in a river, units/s²: hard shots get across narrow ones
    riverResist: 12,      // and more the faster the ball goes, 1/s: getting across costs a fast ball more
    riverSink: 30,        // a ball this slow in a river has sunk: back where the shot started
    mudDrag: 1600,        // extra slow-down in mud, units/s²: like a river, but a ball stops in it and stays
    mudResist: 7,         // and more the faster the ball goes, 1/s
  },

  aim: {
    dragFull: 170,        // screen px of pull-back for a 100% shot
    minPower: 0.05,
    keyTurn: 0.6,         // degrees per frame with arrow keys (shift = fine)
    keyPower: 0.01,       // power per frame with up/down
    previewMin: 30,       // aim line length at 0% and 100% (course units)
    previewMax: 190,
  },

  // Aim sway: the drag sets direction and power exactly, but the aim swings
  // a little either side, faster on harder shots, and SHOOT fires wherever it
  // points at that moment.
  sway: {
    degrees: 3,           // how far the aim swings either side
    cycleAtMin: 2.0,      // seconds per full swing at 0% and 100% power
    cycleAtMax: 0.7,
  },

  rules: {
    maxStrokes: 8,        // picked up after this many, scoring maxStrokes + 1
    hourglassAfter: 5,    // seconds of rolling before an hourglass shows the shot is running long
    shotTimeout: 15,      // seconds of rolling before the shot is called off: moving balls go back, the shooter's +1
  },

  look: {
    bloom: true,
    trailSeconds: 1.4,    // how long a light trail takes to fade once laid
  },
} as const;

// Shared palette with squared and turn7, plus Tron neon for the course.
export const COLORS = {
  bg: 0x12152a,
  floor: 0x1d2140,
  grid: 0x272c52,
  gridBright: 0x353b66,
  wall: 0x5ce1ff,
  wallCore: 0xd8f8ff,
  mat: 0x3b6cf6,
  cup: 0xf2b134,
  hole: 0x05060f,
  fg: 0xeef0fa,
  muted: 0xc0c4dc,
  ramp: 0x7fb2ff,
  river: 0x3df2c0,
  mud: 0xc98a4b,
  blackHole: 0xa07cff,
  whiteHole: 0xeef0fa,
} as const;

export const PORTAL_TINT = { pink: 0xff5ad1, lime: 0x9dff5c, orange: 0xff8a3d, red: 0xff4f6d } as const;

// One per seat, up to 8. Cyan is left to the walls.
export const PLAYER_COLORS = [
  0xf2b134, 0xff5ad1, 0x5cff9d, 0xe2553f, 0xa07cff, 0xff8a3d, 0xeef0fa, 0x7fb2ff,
] as const;
