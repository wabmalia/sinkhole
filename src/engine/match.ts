import { holeOf } from '../sets';
import { createGame, type Game, type Member } from './game';

// A set played hole after hole. The current hole is an ordinary Game; the
// match keeps everyone's card. Plain JSON, sent with the room like the game.

export interface Match {
  setId: string;
  holes: string[];                  // hole keys ("<set id>/<n>"), in playing order
  index: number;                    // the hole being played
  cards: Record<string, number[]>;  // strokes on each finished hole, by player id
}

export interface Standing {
  id: string;
  name: string;
  color: number;
  strokes: (number | null)[];       // per hole; null for holes not finished yet
  total: number;                    // over the finished holes
  toPar: number;
  place: number;                    // 1 is leading; ties share a place
}

type Start = { order?: string[]; away?: ReadonlySet<string> };

export function createMatch(setId: string, holes: string[], members: Member[], away?: ReadonlySet<string>) {
  const match: Match = { setId, holes: [...holes], index: 0, cards: Object.fromEntries(members.map(m => [m.id, []])) };
  return { match, game: createGame(holes[0]!, members, { away }) };
}

export const lastHole = (m: Match) => m.index >= m.holes.length - 1;

// Done once every hole has a score on the cards.
export const matchOver = (m: Match) => Object.values(m.cards).every(c => c.length >= m.holes.length);

// Put a finished hole on the cards (once).
export function recordHole(m: Match, g: Game): Match {
  if (g.phase !== 'over') return m;
  const next = structuredClone(m);
  for (const p of g.players) {
    const card = (next.cards[p.id] ??= []);
    if (card.length === m.index) card.push(p.strokes);
  }
  return next;
}

// On to the next hole. Whoever did best on the last one goes first ("the
// honour"); ties keep the order they played in.
export function nextHole(m: Match, last: Game, members: Member[], away?: ReadonlySet<string>) {
  const match = { ...m, index: m.index + 1 };
  const order = [...last.players].sort((a, b) => a.strokes - b.strokes).map(p => p.id);
  const start: Start = { order, away };
  return { match, game: createGame(match.holes[match.index]!, members, start) };
}

// The scorecard: everyone in the current game, best total first.
export function standings(m: Match, g: Game): Standing[] {
  const rows = g.players.map(p => {
    const card = m.cards[p.id] ?? [];
    const strokes = m.holes.map((_, i) => card[i] ?? null);
    const total = card.reduce((sum, n) => sum + n, 0);
    const par = card.reduce((sum, _, i) => sum + holeOf(m.holes[i]!).par, 0);
    return { id: p.id, name: p.name, color: p.color, strokes, total, toPar: total - par, place: 0 };
  });
  rows.sort((a, b) => a.total - b.total);
  rows.forEach((r, i) => (r.place = i > 0 && r.total === rows[i - 1]!.total ? rows[i - 1]!.place : i + 1));
  return rows;
}

// Against par: E for level, else +n or -n.
export const toParLabel = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);
