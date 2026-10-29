import { PLAYER_COLORS } from '../config';
import { scoreLabel, type Game } from '../engine/game';
import { holeOf } from '../holes';
import { normalizeCode } from '../net/protocol';
import { session } from '../net/session';
import { css, showGame, toast } from './hud';

// Home (nickname, join, host), lobby and the end-of-hole results. All plain
// DOM over the canvas, driven by the session.

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
  connecting: $('connecting'),
  connectingText: $('connecting-text'),
  cancel: $('cancel'),
  error: $('error'),
  lobby: $('lobby'),
  roomCode: $('room-code'),
  copy: $<HTMLButtonElement>('copy'),
  members: $('members'),
  start: $<HTMLButtonElement>('start'),
  waiting: $('waiting'),
  leave: $('leave'),
  leaveGame: $('leave-game'),
  end: $('end'),
  results: $('results'),
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
  el.cancel.addEventListener('click', () => session.leave());
  el.leave.addEventListener('click', () => session.leave());
  el.leaveGame.addEventListener('click', () => {
    const msg = session.isHost ? 'Leave? This closes the room for everyone.' : 'Leave the room?';
    if (confirm(msg)) session.leave();
  });
  el.start.addEventListener('click', () => session.start());
  el.again.addEventListener('click', () => session.start());
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
  el.create.hidden = el.or.hidden = !!linkCode;

  el.lobby.hidden = !inRoom || !!game;
  if (!game || game.phase !== 'over') {
    el.end.hidden = true;
    endShown = false;
  }
  showGame(!!game && !endShown);
  el.offline.hidden = !inRoom || s.isHost || s.linked;
  if (!inRoom || game) return;

  el.roomCode.textContent = s.code;
  el.start.hidden = !s.isHost;
  el.waiting.hidden = s.isHost;
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

// Called by the scene once the final shot has finished rolling.
export function showEnd(g: Game) {
  if (endShown) return;
  endShown = true;
  const par = holeOf(g.holeId).par;
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
  el.again.hidden = el.toLobby.hidden = !session.isHost;
  el.endWaiting.hidden = session.isHost;
  showGame(false);
  el.end.hidden = false;
}
