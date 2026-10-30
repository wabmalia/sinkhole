import { describe, expect, it } from 'vitest';
import { CONFIG, PLAYER_COLORS } from '../config';
import { holeOf } from '../sets';
import { createGame, forfeit, type Game } from './game';
import { createMatch, lastHole, matchOver, nextHole, recordHole, standings, toParLabel } from './match';

const members = [
  { id: 'a', name: 'Ana' },
  { id: 'b', name: 'Bo' },
  { id: 'c', name: 'Cy' },
];
const HOLES = ['full-course/0', 'full-course/3', 'full-course/2'];

// Finish the hole with these strokes per player id.
function finish(g: Game, strokes: Record<string, number>): Game {
  const next = structuredClone(g);
  for (const p of next.players) {
    p.strokes = strokes[p.id]!;
    p.holed = true;
  }
  next.phase = 'over';
  return next;
}

describe('createGame', () => {
  it('plays in the given order, colours by seat', () => {
    const g = createGame('full-course/0', members, { order: ['c', 'a'] });
    expect(g.players.map(p => p.id)).toEqual(['c', 'a', 'b']);
    expect(g.players.map(p => p.color)).toEqual([PLAYER_COLORS[2], PLAYER_COLORS[0], PLAYER_COLORS[1]]);
    expect(g.turn).toBe(0);
  });

  it('starts anyone away picked up, and skips them', () => {
    const g = createGame('full-course/0', members, { away: new Set(['a']) });
    expect(g.players[0]!.pickedUp).toBe(true);
    expect(g.players[0]!.strokes).toBe(CONFIG.rules.maxStrokes + 1);
    expect(g.turn).toBe(1);
    expect(g.players[1]!.ball).not.toBeNull();
  });

  it('is over at once if everyone is away', () => {
    expect(createGame('full-course/0', members, { away: new Set(['a', 'b', 'c']) }).phase).toBe('over');
  });
});

describe('match', () => {
  it('starts on the first hole with empty cards', () => {
    const { match, game } = createMatch('x', HOLES, members);
    expect(game.holeId).toBe('full-course/0');
    expect(match.cards).toEqual({ a: [], b: [], c: [] });
    expect(lastHole(match)).toBe(false);
  });

  it('records a hole once, and only when it is over', () => {
    const { match, game } = createMatch('x', HOLES, members);
    expect(recordHole(match, game)).toBe(match);
    const done = finish(game, { a: 3, b: 2, c: 4 });
    const m1 = recordHole(match, done);
    expect(m1.cards).toEqual({ a: [3], b: [2], c: [4] });
    expect(recordHole(m1, done).cards).toEqual(m1.cards);
  });

  it('gives the next hole the honour: best first, ties in playing order', () => {
    const { match, game } = createMatch('x', HOLES, members);
    const done = finish(game, { a: 3, b: 2, c: 2 });
    const { match: m2, game: g2 } = nextHole(recordHole(match, done), done, members);
    expect(m2.index).toBe(1);
    expect(g2.holeId).toBe('full-course/3');
    expect(g2.players.map(p => p.id)).toEqual(['b', 'c', 'a']);
    expect(g2.players.find(p => p.id === 'a')!.color).toBe(PLAYER_COLORS[0]);
  });

  it('ranks by total, ties sharing a place, with strokes against par', () => {
    let { match, game } = createMatch('x', HOLES, members);
    let done = finish(game, { a: 2, b: 3, c: 2 });
    match = recordHole(match, done);
    ({ match, game } = nextHole(match, done, members));
    const rows = standings(match, game);
    expect(rows.map(r => [r.id, r.place, r.total, r.toPar])).toEqual([
      ['a', 1, 2, 2 - holeOf('full-course/0').par],
      ['c', 1, 2, 2 - holeOf('full-course/0').par],
      ['b', 3, 3, 3 - holeOf('full-course/0').par],
    ]);
    expect(rows[0]!.strokes).toEqual([2, null, null]);
    done = finish(game, { a: 5, b: 1, c: 3 });
    match = recordHole(match, done);
    expect(standings(match, done).map(r => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('is over once every hole is on the cards', () => {
    let { match, game } = createMatch('x', ['full-course/0', 'full-course/3'], members);
    for (let i = 0; i < 2; i++) {
      expect(matchOver(match)).toBe(false);
      const done = finish(game, { a: 2, b: 2, c: 2 });
      match = recordHole(match, done);
      if (!lastHole(match)) ({ match, game } = nextHole(match, done, members));
    }
    expect(matchOver(match)).toBe(true);
  });

  it('scores a pick-up as max strokes + 1', () => {
    const { match, game } = createMatch('x', HOLES, [members[0]!]);
    const done = forfeit(game);
    expect(recordHole(match, done).cards.a).toEqual([CONFIG.rules.maxStrokes + 1]);
  });

  it('labels strokes against par', () => {
    expect([toParLabel(0), toParLabel(2), toParLabel(-1)]).toEqual(['E', '+2', '-1']);
  });
});
