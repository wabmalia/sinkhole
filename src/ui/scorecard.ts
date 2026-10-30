import type { Game } from '../engine/game';
import { standings, toParLabel, type Match, type Standing } from '../engine/match';
import { holeOf } from '../holes';
import { css } from './hud';

// The scorecard (the podium button in game, and the end of each hole) and
// the podium at the end of a set.

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
};

// Players down the side, best first; a column per hole with par on top.
// While a hole is being played, its column shows the strokes so far, dimmed.
export function scorecard(m: Match, g: Game): HTMLTableElement {
  const rows = standings(m, g);
  const playing = g.phase === 'aim';
  const live = new Map(g.players.map(p => [p.id, p]));
  const pars = m.holes.map(id => holeOf(id).par);

  const table = make('table', 'card');
  const head = make('thead');
  const top = make('tr');
  top.append(make('th', 'place', '#'), make('th', 'name', 'PLAYER'));
  m.holes.forEach((_, i) => top.append(make('th', i === m.index ? 'now' : '', String(i + 1))));
  top.append(make('th', 'tot', 'TOT'), make('th', 'par-diff', '±'));
  const par = make('tr', 'par');
  par.append(make('th', 'place'), make('th', 'name', 'PAR'));
  pars.forEach((p, i) => par.append(make('td', i === m.index ? 'now' : '', String(p))));
  par.append(make('td', 'tot', String(pars.reduce((a, b) => a + b, 0))), make('td', 'par-diff'));
  head.append(top, par);

  const body = make('tbody');
  for (const r of rows) {
    const tr = make('tr');
    tr.style.setProperty('--c', css(r.color));
    const name = make('th', 'name');
    name.scope = 'row';
    const inner = make('span', 'name-in');
    inner.append(make('span', 'dot'), make('span', 'who', r.name));
    name.append(inner);
    tr.append(make('td', `place p${r.place}`, String(r.place)), name);
    r.strokes.forEach((n, i) => {
      const p = live.get(r.id);
      if (n === null && playing && i === m.index && p) {
        tr.append(make('td', 'now live', p.strokes ? String(p.strokes) : '·'));
      } else {
        const cell = make('td', i === m.index ? 'now' : '', n === null ? '·' : String(n));
        if (n !== null && n < pars[i]!) cell.classList.add('under');
        tr.append(cell);
      }
    });
    tr.append(make('td', 'tot', String(r.total)), make('td', 'par-diff', toParLabel(r.toPar)));
    body.append(tr);
  }
  table.append(head, body);
  return table;
}

// The top three on steps, first in the middle.
export function podium(rows: Standing[]): HTMLElement[] {
  const top = rows.slice(0, 3);
  const order = top.length === 3 ? [top[1]!, top[0]!, top[2]!] : top.length === 2 ? [top[1]!, top[0]!] : top;
  return order.map(r => {
    const li = make('li', `step p${r.place}`);
    li.style.setProperty('--c', css(r.color));
    const who = make('span', 'who', r.name);
    const score = make('span', 'score', `${r.total} · ${toParLabel(r.toPar)}`);
    const block = make('span', 'block', String(r.place));
    li.append(who, score, block);
    return li;
  });
}
