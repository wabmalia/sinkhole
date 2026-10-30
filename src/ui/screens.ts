import { PLAYER_COLORS } from '../config';
import { scoreLabel, type Game } from '../engine/game';
import { lastHole, standings } from '../engine/match';
import { holeOf } from '../holes';
import { normalizeCode } from '../net/protocol';
import { session } from '../net/session';
import { parOf, setIds, setOf, SETS } from '../sets';
import { css, showGame, toast } from './hud';
import { podium, scorecard } from './scorecard';

// Home (nickname, join, host, solo), lobby with the set to play, the scores
// sheet and the end of each hole and of the set. All plain DOM over the
// canvas, driven by the session.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  home: $('home'),
  name: $<HTMLInputElement>('name'),
  actions: $('home-actions'),
  joinForm: $<HTMLFormElement>('join-form'),
  code: $<HTMLInputElement>('code'),
  join: $<HTMLButtonElement>('join'),
  or: $('or'),
  create: $<HTMLButtonElement>('create'),
  solo: $<HTMLButtonElement>('solo'),
  connecting: $('connecting'),
  connectingText: $('connecting-text'),
  cancel: $('cancel'),
  error: $('error'),
  lobby: $('lobby'),
  roomInfo: $('room-info'),
  soloTitle: $('solo-title'),
  roomCode: $('room-code'),
  copy: $<HTMLButtonElement>('copy'),
  members: $('members'),
  sets: $('sets'),
  start: $<HTMLButtonElement>('start'),
  waiting: $('waiting'),
  leave: $('leave'),
  leaveGame: $('leave-game'),
  boardOpen: $<HTMLButtonElement>('board-open'),
  board: $('board'),
  boardClose: $('board-close'),
  boardSet: $('board-set'),
  boardCard: $('board-card'),
  end: $('end'),
  endTitle: $('end-title'),
  endHole: $('end-hole'),
  podium: $('podium'),
  results: $('results'),
  endCard: $('end-card'),
  next: $<HTMLButtonElement>('next'),
  again: $<HTMLButtonElement>('again'),
  toLobby: $('to-lobby'),
  endWaiting: $('end-waiting'),
  offline: $('offline'),
};

// An invite link (#/join/CODE) fills in the code and hides "host a room".
const linkCode = location.hash.startsWith('#/join/') ? normalizeCode(location.hash.slice(7)) : '';

export function setupScreens() {
  el.name.value = session.name;
  el.code.value = linkCode;

  const valid = () => {
    const named = el.name.value.trim().length > 0;
    el.create.disabled = !named;
    el.join.disabled = !named || normalizeCode(el.code.value).length !== 5;
  };
  el.name.addEventListener('input', valid);
  el.code.addEventListener('input', () => {
    el.code.value = normalizeCode(el.code.value);
    valid();
  });
  valid();

  el.joinForm.addEventListener('submit', e => {
    e.preventDefault();
    session.setName(el.name.value);
    session.joinRoom(normalizeCode(el.code.value));
  });
  el.create.addEventListener('click', () => {
    session.setName(el.name.value);
    session.hostRoom();
  });
  el.solo.addEventListener('click', () => {
    if (el.name.value.trim()) session.setName(el.name.value);
    session.playSolo();
  });
  el.cancel.addEventListener('click', () => session.leave());
  el.leave.addEventListener('click', () => session.leave());
  el.leaveGame.addEventListener('click', () => {
    const msg = session.solo ? 'Leave this game?' : session.isHost ? 'Leave? This closes the room for everyone.' : 'Leave the room?';
    if (confirm(msg)) session.leave();
  });
  el.start.addEventListener('click', () => session.start());
  el.again.addEventListener('click', () => session.start());
  el.next.addEventListener('click', () => session.nextHole());
  el.boardOpen.addEventListener('click', () => showBoard(true));
  el.boardClose.addEventListener('click', () => showBoard(false));
  // A tap outside the card closes it too, and so does Esc.
  el.board.addEventListener('pointerdown', e => {
    if (e.target === el.board) showBoard(false);
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.board.hidden) showBoard(false);
  });
  el.toLobby.addEventListener('click', () => session.backToLobby());
  el.copy.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#/join/${session.code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied');
    } catch {
      toast(url);
    }
  });

  session.listen({ change: render, toast });
  render();
}

// Which screen shows follows the session; the end screen waits for the scene
// to finish animating the last shot (see showEnd).
let endShown = false;

function render() {
  const s = session;
  const room = s.room;
  const inRoom = s.status === 'room' && !!room;
  const game = inRoom ? room.game : null;

  el.home.hidden = inRoom;
  el.connecting.hidden = s.status !== 'connecting';
  el.connectingText.textContent = s.message;
  el.actions.hidden = s.status === 'connecting';
  el.error.hidden = s.status !== 'error';
  el.error.textContent = s.status === 'error' ? s.message : '';
  el.create.hidden = el.or.hidden = el.solo.hidden = !!linkCode;

  el.lobby.hidden = !inRoom || !!game;
  if (!game || game.phase !== 'over') {
    el.end.hidden = true;
    endShown = false;
  }
  showGame(!!game && !endShown);
  if (!game || endShown) el.board.hidden = true;
  if (!el.board.hidden) renderBoard();
  el.offline.hidden = !inRoom || s.isHost || s.linked;
  if (!inRoom || game) return;

  el.roomInfo.hidden = el.members.hidden = s.solo;
  el.soloTitle.hidden = !s.solo;
  el.roomCode.textContent = s.code;
  el.start.hidden = !s.isHost;
  el.waiting.hidden = s.isHost;
  renderSets(room.setId);
  el.members.replaceChildren(
    ...room.members.map((m, i) => {
      const li = document.createElement('li');
      li.classList.toggle('offline', !m.connected);
      li.style.setProperty('--c', css(PLAYER_COLORS[i % PLAYER_COLORS.length]!));
      const dot = document.createElement('span');
      dot.className = 'dot';
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = [m.id === room.hostId ? 'HOST' : '', m.id === s.me ? 'YOU' : '', m.connected ? '' : 'OFFLINE']
        .filter(Boolean)
        .join(' · ');
      li.append(dot, m.name, tag);
      if (s.isHost && m.id !== s.me) {
        const kick = document.createElement('button');
        kick.className = 'link-btn kick';
        kick.type = 'button';
        kick.textContent = '✕';
        kick.setAttribute('aria-label', `Remove ${m.name}`);
        kick.addEventListener('click', () => session.kick(m.id));
        li.append(kick);
      }
      return li;
    }),
  );
}

// The sets to play, shortest first. The host picks; everyone sees the pick.
function renderSets(chosen: string) {
  el.sets.replaceChildren(
    ...setIds().map(id => {
      const set = SETS[id]!;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'set';
      b.classList.toggle('on', id === chosen);
      b.disabled = !session.isHost;
      b.setAttribute('aria-pressed', String(id === chosen));
      const name = document.createElement('span');
      name.className = 'set-name';
      name.textContent = set.name.toUpperCase();
      const info = document.createElement('span');
      info.className = 'set-info';
      const n = set.holes.length;
      info.textContent = `${n} ${n === 1 ? 'HOLE' : 'HOLES'} · PAR ${parOf(set.holes)}`;
      b.append(name, info);
      b.addEventListener('click', () => session.chooseSet(id));
      li.append(b);
      return li;
    }),
  );
}

// The scores sheet, over the game; it follows the room while open.
function showBoard(on: boolean) {
  el.board.hidden = !on;
  if (on) renderBoard();
}

function renderBoard() {
  const room = session.room;
  if (!room?.match || !room.game) return;
  el.boardSet.textContent = setOf(room.match.setId).name.toUpperCase();
  el.boardCard.replaceChildren(scorecard(room.match, room.game));
}

// Called by the scene once the final shot has finished rolling: how this hole
// went, the card so far, and the way on (the next hole, or the podium once
// the set is done).
export function showEnd(g: Game) {
  if (endShown) return;
  endShown = true;
  const match = session.room?.match ?? null;
  const done = !match || lastHole(match);
  const hole = holeOf(g.holeId);
  el.endTitle.textContent = !match ? 'HOLE COMPLETE' : done ? 'FINAL' : `HOLE ${match.index + 1} COMPLETE`;
  // The hole just played; at the end, the set.
  el.endHole.textContent =
    match && done
      ? `${setOf(match.setId).name.toUpperCase()} · PAR ${parOf(match.holes)}`
      : `${hole.name.toUpperCase()} · PAR ${hole.par}`;

  el.podium.hidden = !match || !done;
  if (match && done) el.podium.replaceChildren(...podium(standings(match, g)));
  // At the end of the set the podium says it all; between holes, this hole.
  el.results.hidden = !!match && done;
  const par = hole.par;
  const ranked = [...g.players].sort((a, b) => a.strokes - b.strokes);
  el.results.replaceChildren(
    ...ranked.map(p => {
      const li = document.createElement('li');
      li.style.setProperty('--c', css(p.color));
      const dot = document.createElement('span');
      dot.className = 'dot';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = p.name;
      const score = document.createElement('span');
      score.className = 'score';
      const strokes = document.createElement('b');
      strokes.textContent = String(p.strokes);
      const label = document.createElement('span');
      label.textContent = p.pickedUp ? 'UP' : scoreLabel(p.strokes, par);
      score.append(strokes, label);
      li.append(dot, who, score);
      return li;
    }),
  );
  el.endCard.replaceChildren(...(match ? [scorecard(match, g)] : []));

  el.next.hidden = !session.isHost || done;
  el.again.hidden = !session.isHost || !done;
  el.toLobby.hidden = !session.isHost;
  el.endWaiting.hidden = session.isHost;
  showGame(false);
  el.board.hidden = true;
  el.end.hidden = false;
  el.end.scrollTop = 0;
}
