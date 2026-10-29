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
  },

  cup: {
    radius: 12,
    pull: 900,            // slope of the cup lip pulling the ball in, units/s²
    captureSpeed: 330,    // at or below this, a ball over the cup drops in
  },

  aim: {
    dragFull: 170,        // screen px of pull-back for a 100% shot
    minPower: 0.05,
    keyTurn: 0.6,         // degrees per frame with arrow keys (shift = fine)
    keyPower: 0.01,       // power per frame with up/down
    previewMin: 30,       // aim line length at 0% and 100% (course units)
    previewMax: 190,
  },

  meter: {
    // Seconds for the bar to go up and back down, at 0% and 100% target
    // power. Soft shots get a slow bar, big hits a fast one.
    cycleAtMin: 3.6,
    cycleAtMax: 1.8,
    // Half-width of the perfect zone around the target. Soft shots are
    // precise touches (slow bar, tight zone); big hits get more room to make
    // up for the faster bar.
    windowAtMin: 0.01,
    windowAtMax: 0.02,
    // Missing the window costs power (you get roughly what you stopped at)
    // and bends the shot: over = hook clockwise, under = pull anticlockwise.
    // Degrees of bend per 10% outside the window, at 0% and at 100% power.
    bendAtMin: 2,
    bendAtMax: 9,
  },

  rules: {
    maxStrokes: 8,        // picked up after this many, scoring maxStrokes + 1
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
} as const;

// One per seat, up to 8. Cyan is left to the walls.
export const PLAYER_COLORS = [
  0xf2b134, 0xff5ad1, 0x5cff9d, 0xe2553f, 0xa07cff, 0xff8a3d, 0xeef0fa, 0x7fb2ff,
] as const;
