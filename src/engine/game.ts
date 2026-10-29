import { CONFIG, PLAYER_COLORS } from '../config';
import { courseOf, holeOf } from '../holes';
import { settle, shotVelocity, type Ball, type PhysicsEvent } from './physics';
import type { Shot } from './shot';
import { clamp, type Vec } from './vec';

// Turn-based play on one hole. Plain JSON state, so the host can send it to
// everyone. The host resolves each shot instantly with play(); every screen
// then animates the same shot with launch() and the physics step.

export const MAX_PLAYERS = 8;

export class EngineError extends Error {}

export interface Member {
  id: string;
  name: string;
}

export interface Player {
  id: string;
  name: string;
  color: number;
  strokes: number;
  ball: Ball | null;   // null until their turn first comes round
  teedOff: boolean;    // first shot taken, so no more moving the ball by hand
  holed: boolean;
  pickedUp: boolean;   // ran out of strokes, or left
}

export interface Game {
  holeId: string;
  players: Player[];
  turn: number;        // index into players
  phase: 'aim' | 'over';
  shots: number;       // shots played so far, to tell updates apart
}

export function createGame(holeId: string, members: Member[]): Game {
  const players = members.map((m, i): Player => ({
    id: m.id,
    name: m.name,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length]!,
    strokes: 0,
    ball: null,
    teedOff: false,
    holed: false,
    pickedUp: false,
  }));
  const game: Game = { holeId, players, turn: 0, phase: 'aim', shots: 0 };
  startTurn(game);
  return game;
}

export const current = (g: Game): Player => g.players[g.turn]!;

export function balls(g: Game): Ball[] {
  return g.players.flatMap(p => (p.ball && !p.ball.sunk ? [p.ball] : []));
}

export const canPlace = (g: Game): boolean => g.phase === 'aim' && !current(g).teedOff;

// Before the first shot the ball can go anywhere on the tee mat.
export function teeSpot(g: Game, at: Vec): Vec {
  const r = CONFIG.ball.radius;
  const t = holeOf(g.holeId).tee;
  return { x: clamp(at.x, t.x + r, t.x + t.w - r), y: clamp(at.y, t.y + r, t.y + t.h - r) };
}

// Put the shot on the ball. Mutates g; the balls are then ready to step.
export function launch(g: Game, shot: Shot, at?: Vec) {
  const p = current(g);
  if (!p.ball) return;
  if (at && canPlace(g)) p.ball.pos = teeSpot(g, at);
  p.ball.vel = shotVelocity(shot.angle, clamp(shot.power, 0, 1));
}

// The host's move: check it's this player's turn, run the shot to rest and
// move on to the next turn. Returns the new state and what happened.
export function play(g: Game, playerId: string, shot: Shot, at?: Vec): { game: Game; events: PhysicsEvent[] } {
  if (g.phase !== 'aim') throw new EngineError('The hole is over');
  if (current(g).id !== playerId) throw new EngineError('Not your turn');
  if (!Number.isFinite(shot.angle) || !Number.isFinite(shot.power)) throw new EngineError('Bad shot');
  const next = structuredClone(g);
  launch(next, shot, at);
  const events = settle(courseOf(next.holeId), balls(next));
  const p = current(next);
  p.strokes++;
  p.teedOff = true;
  next.shots++;
  endShot(next);
  return { game: next, events };
}

// The current player leaves the hole (they left the room, or timed out).
export function forfeit(g: Game): Game {
  const next = structuredClone(g);
  pickUp(current(next));
  next.shots++;
  nextTurn(next);
  return next;
}

function endShot(g: Game) {
  for (const p of g.players) {
    if (p.ball?.sunk) p.holed = true;
  }
  const p = current(g);
  if (!p.holed && p.strokes >= CONFIG.rules.maxStrokes) pickUp(p);
  nextTurn(g);
}

function pickUp(p: Player) {
  p.pickedUp = true;
  p.strokes = CONFIG.rules.maxStrokes + 1;
  p.ball = null;
}

const finished = (p: Player) => p.holed || p.pickedUp;

function nextTurn(g: Game) {
  for (let i = 1; i <= g.players.length; i++) {
    const idx = (g.turn + i) % g.players.length;
    if (!finished(g.players[idx]!)) {
      g.turn = idx;
      startTurn(g);
      return;
    }
  }
  g.phase = 'over';
}

// A player without a ball yet gets one in the middle of the tee mat.
function startTurn(g: Game) {
  const p = current(g);
  if (p.ball) return;
  const t = holeOf(g.holeId).tee;
  p.ball = { id: g.turn, pos: { x: t.x + t.w / 2, y: t.y + t.h / 2 }, vel: { x: 0, y: 0 }, sunk: false };
}

export function scoreLabel(strokes: number, par: number): string {
  const d = strokes - par;
  if (strokes === 1) return 'ACE';
  if (d === 0) return 'PAR';
  return d > 0 ? `+${d}` : `${d}`;
}
