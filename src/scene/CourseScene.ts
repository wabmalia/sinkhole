import Phaser from 'phaser';
import { COLORS, CONFIG } from '../config';
import { balls, canPlace, current, launch, teeSpot, type Game } from '../engine/game';
import { atRest, step, type PhysicsEvent } from '../engine/physics';
import { meterAt, resolveShot, type Shot } from '../engine/shot';
import { clamp, dist, fromAngle, lerp, type Vec } from '../engine/vec';
import { courseOf, holeOf } from '../holes';
import { bounds } from '../holes/types';
import type { Aim } from '../net/protocol';
import { session } from '../net/session';
import * as ui from '../ui/hud';
import { showEnd } from '../ui/screens';
import { drawCourse } from './draw';

interface Trail {
  points: Vec[];
  color: number;
  done: boolean;    // ball stopped (or sunk), so the trail starts fading
  laidAt: number;   // scene time it was done
}

interface Ring {
  at: Vec;
  color: number;
  born: number;
  life: number;     // ms
  from: number;     // radius
  to: number;
}

type Drag = { kind: 'place' | 'aim'; start: Vec } | null;

const AIM_SEND_MS = 80;

// Draws whatever the session says the game is, animates shots as they come
// in, and handles aiming when it's this player's turn.
export class CourseScene extends Phaser.Scene {
  private shown: Game | null = null;    // what's on screen
  private pending: Game | null | undefined; // room update held back while a shot rolls
  private rolling = false;
  private sent = false;                 // shot sent, waiting for the host
  private drawnHole = '';
  private course!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private aim = { angle: -Math.PI / 2, power: 0.4 };
  private remoteAim: Aim | null = null;
  private lastAimSent = 0;
  private aimDirty = false;
  private meter: { since: number } | null = null;
  private drag: Drag = null;
  private accumulator = 0;
  private trails = new Map<number, Trail>();
  private rings: Ring[] = [];
  private tags = new Map<string, Phaser.GameObjects.Text>(); // name over each ball
  private keys!: Phaser.Types.Input.Keyboard.CursorKeys;
  private shift!: Phaser.Input.Keyboard.Key;

  constructor() {
    super('course');
  }

  create() {
    this.course = this.add.graphics();
    this.fx = this.add.graphics();
    this.drawHole('straight');

    if (CONFIG.look.bloom) {
      Phaser.Actions.AddEffectBloom(this.cameras.main, {
        threshold: 0.5,
        blurRadius: 2,
        blurSteps: 4,
        blendAmount: 0.9,
      });
    }

    this.fit();
    this.scale.on('resize', () => this.fit());

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointerMove(p));
    this.input.on('pointerup', () => (this.drag = null));
    this.input.on('pointerupoutside', () => (this.drag = null));

    const kb = this.input.keyboard!;
    this.keys = kb.createCursorKeys();
    this.shift = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    // Space belongs to the shoot action, not page scrolling.
    kb.removeCapture(Phaser.Input.Keyboard.KeyCodes.SPACE);
    window.addEventListener('keydown', e => {
      if (e.code !== 'Space' || e.repeat || !this.myTurn()) return;
      if (e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      this.press();
    });

    ui.onShoot(() => this.press());
    session.listen({
      change: () => this.roomChanged(),
      shot: (by, shot, at) => this.animateShot(by, shot, at),
      aim: (by, aim) => this.watchAim(by, aim),
      // The host turned the shot down (out of sync): let them try again.
      toast: () => {
        if (this.sent && !this.rolling) { this.sent = false; this.refresh(); }
      },
    });
    this.roomChanged();
    // Rejoin or resume hosting after a refresh, now that we are listening.
    session.restore();
  }

  private drawHole(id: string) {
    if (id === this.drawnHole) return;
    this.drawnHole = id;
    this.course.clear();
    drawCourse(this.course, holeOf(id));
    this.fit();
  }

  // Fit the whole hole into the space the HUD leaves for it.
  private fit() {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const area = ui.courseArea();
    const pad = 6;
    const b = bounds(holeOf(this.drawnHole).outline);
    const zoom = Math.max(0.1, Math.min((area.w - pad * 2) / b.w, (area.h - pad * 2) / b.h));
    cam.setZoom(zoom);
    const mid = { x: area.x + area.w / 2, y: area.y + area.h / 2 };
    cam.centerOn(b.x + b.w / 2 - (mid.x - width / 2) / zoom, b.y + b.h / 2 - (mid.y - height / 2) / zoom);
  }

  // --- Following the room --------------------------------------------------

  private roomChanged() {
    const game = session.status === 'room' ? (session.room?.game ?? null) : null;
    if (this.rolling) {
      this.pending = game;
      return;
    }
    this.adopt(game);
  }

  private adopt(game: Game | null) {
    const before = this.shown;
    this.shown = game;
    this.pending = undefined;
    if (!game) {
      this.reset();
      return;
    }
    this.drawHole(game.holeId);
    const fresh = !before || game.shots < before.shots || (game.shots === 0 && before.phase === 'over');
    if (fresh) this.reset();
    if (fresh || game.shots !== before?.shots) this.beginTurn(game);
    this.refresh();
    this.fit();
    if (game.phase === 'over') this.time.delayedCall(700, () => this.shown === game && showEnd(game));
  }

  private reset() {
    this.trails.clear();
    this.rings = [];
    this.meter = null;
    this.drag = null;
    this.remoteAim = null;
    this.sent = false;
  }

  private beginTurn(g: Game) {
    this.meter = null;
    this.sent = false;
    this.remoteAim = null;
    if (g.phase !== 'aim') return;
    const p = current(g);
    const ball = p.ball!;
    this.aim.angle = Math.atan2(holeOf(g.holeId).cup.y - ball.pos.y, holeOf(g.holeId).cup.x - ball.pos.x);
    if (p.id === session.me) {
      if (g.players.length > 1) ui.flash('YOUR TURN', p.color);
      this.aimDirty = true;
    }
  }

  private myTurn(): boolean {
    const g = this.shown;
    return !!g && g.phase === 'aim' && !this.rolling && !this.sent && current(g).id === session.me;
  }

  private refresh() {
    const g = this.shown;
    if (!g) return;
    ui.renderPlayers(g, session.room?.members ?? []);
    const mine = this.myTurn();
    const state: ui.ControlState = !mine ? 'watch' : this.meter ? 'meter' : 'aim';
    const who = g.phase === 'aim' ? current(g).name : '';
    const hint =
      this.rolling ? ''
      : !mine ? (this.sent ? '' : this.remoteAim?.meter ? `${who} is shooting…` : `${who} is lining up`)
      : this.meter ? 'Stop the bar on the gold line'
      : canPlace(g) ? 'Drag your ball on the mat. Drag elsewhere to aim.'
      : 'Drag anywhere to pull back and aim';
    const power = mine || !this.remoteAim ? this.aim.power : this.remoteAim.power;
    ui.renderControls(state, power, hint);
    if (!this.meter) ui.setMeter(0);
  }

  // Someone else lining up: mirror their aim (and tee position).
  private watchAim(by: string, aim: Aim) {
    const g = this.shown;
    if (!g || this.rolling || g.phase !== 'aim' || current(g).id !== by || by === session.me) return;
    this.remoteAim = aim;
    if (canPlace(g)) current(g).ball!.pos = teeSpot(g, aim.at);
    this.refresh();
  }

  // --- Shooting ------------------------------------------------------------

  private press() {
    const g = this.shown;
    if (!g || !this.myTurn()) return;
    if (!this.meter) {
      this.meter = { since: this.time.now };
      this.drag = null;
      this.aimDirty = true;
    } else {
      const stopped = meterAt((this.time.now - this.meter.since) / 1000, this.aim.power);
      this.meter = null;
      const shot = resolveShot(this.aim.angle, this.aim.power, stopped);
      ui.flash(ui.shotText(shot), shot.grade === 'perfect' ? COLORS.cup : COLORS.wall);
      ui.setMeter(stopped);
      this.sent = true;
      session.shoot(shot, canPlace(g) ? { ...current(g).ball!.pos } : undefined);
    }
    this.refresh();
  }

  // Every screen plays the shot out from the state it has; the host's result
  // replaces it once the balls stop.
  private animateShot(by: string, shot: Shot, at?: Vec) {
    const g = this.shown;
    if (!g || g.phase !== 'aim' || current(g).id !== by) return;
    const sim = structuredClone(g);
    launch(sim, shot, at);
    this.shown = sim;
    this.rolling = true;
    this.accumulator = 0;
    this.remoteAim = null;
    const p = current(sim);
    if (by !== session.me) ui.flash(ui.shotText(shot), shot.grade === 'perfect' ? COLORS.cup : COLORS.wall);
    this.trails.set(p.ball!.id, { points: [{ ...p.ball!.pos }], color: p.color, laidAt: 0, done: false });
    this.refresh();
  }

  // --- Input ---------------------------------------------------------------

  private pointerDown(p: Phaser.Input.Pointer) {
    const g = this.shown;
    if (!g || !this.myTurn()) return;
    if (this.meter) {
      this.press();
      return;
    }
    const world = { x: p.worldX, y: p.worldY };
    const ball = current(g).ball!;
    const grab = Math.max(CONFIG.ball.radius * 3, 28 / this.cameras.main.zoom);
    const kind = canPlace(g) && dist(world, ball.pos) < grab ? 'place' : 'aim';
    this.drag = { kind, start: { x: p.x, y: p.y } };
  }

  private pointerMove(p: Phaser.Input.Pointer) {
    const g = this.shown;
    if (!g || !this.drag || !p.isDown || !this.myTurn() || this.meter) return;
    if (this.drag.kind === 'place') {
      current(g).ball!.pos = teeSpot(g, { x: p.worldX, y: p.worldY });
      this.aimDirty = true;
      return;
    }
    // Pull back like a slingshot: the shot goes opposite the drag.
    const dx = this.drag.start.x - p.x;
    const dy = this.drag.start.y - p.y;
    const l = Math.hypot(dx, dy);
    if (l < 8) return;
    this.aim.angle = Math.atan2(dy, dx);
    this.aim.power = clamp(l / CONFIG.aim.dragFull, CONFIG.aim.minPower, 1);
    this.aimDirty = true;
    this.refresh();
  }

  private keyboardAim() {
    if (!this.myTurn() || this.meter) return;
    const fine = this.shift.isDown ? 0.2 : 1;
    const turn = (CONFIG.aim.keyTurn * fine * Math.PI) / 180;
    let changed = false;
    if (this.keys.left.isDown) { this.aim.angle -= turn; changed = true; }
    if (this.keys.right.isDown) { this.aim.angle += turn; changed = true; }
    if (this.keys.up.isDown || this.keys.down.isDown) {
      const d = (this.keys.up.isDown ? 1 : -1) * CONFIG.aim.keyPower * fine;
      this.aim.power = clamp(this.aim.power + d, CONFIG.aim.minPower, 1);
      changed = true;
    }
    if (changed) {
      this.aimDirty = true;
      this.refresh();
    }
  }

  // Let the others see the aim, a few times a second at most.
  private sendAim(time: number) {
    if (!this.aimDirty || time - this.lastAimSent < AIM_SEND_MS || !this.myTurn()) return;
    this.aimDirty = false;
    this.lastAimSent = time;
    session.aim({ ...this.aim, at: { ...current(this.shown!).ball!.pos }, meter: !!this.meter });
  }

  // --- Loop ----------------------------------------------------------------

  update(time: number, delta: number) {
    const g = this.shown;
    if (g) {
      this.keyboardAim();
      this.sendAim(time);
      if (this.meter) ui.setMeter(meterAt((time - this.meter.since) / 1000, this.aim.power));
      if (this.rolling) this.roll(g, time, delta);
    }
    this.draw(time);
  }

  private roll(g: Game, time: number, delta: number) {
    this.accumulator += Math.min(delta, 100) / 1000;
    const live = balls(g);
    const course = courseOf(g.holeId);
    while (this.accumulator >= CONFIG.physics.step) {
      this.accumulator -= CONFIG.physics.step;
      for (const e of step(course, live)) this.onEvent(g, e, time);
    }
    for (const b of live) {
      const t = this.trails.get(b.id);
      if (!t || t.done) continue;
      const last = t.points[t.points.length - 1]!;
      if (dist(last, b.pos) > 3) t.points.push({ ...b.pos });
    }
    if (atRest(live)) {
      this.rolling = false;
      for (const t of this.trails.values()) {
        if (!t.done) { t.done = true; t.laidAt = time; }
      }
      // Take the host's result (it may already be here).
      this.adopt(this.pending === undefined ? (session.room?.game ?? null) : this.pending);
    }
  }

  private onEvent(g: Game, e: PhysicsEvent, time: number) {
    const cup = holeOf(g.holeId).cup;
    if (e.type === 'wall' && e.speed > 120) {
      this.rings.push({ at: e.at, color: COLORS.wall, born: time, life: 380, from: 3, to: 10 + e.speed / 60 });
    } else if (e.type === 'ball') {
      this.rings.push({ at: e.at, color: COLORS.fg, born: time, life: 420, from: 4, to: 16 });
    } else if (e.type === 'sunk') {
      const p = g.players[e.ball]!;
      this.rings.push({ at: cup, color: p.color, born: time, life: 700, from: 8, to: 46 });
      this.rings.push({ at: cup, color: COLORS.cup, born: time + 120, life: 700, from: 8, to: 30 });
      const t = this.trails.get(e.ball);
      if (t) { t.points.push({ ...cup }); t.done = true; t.laidAt = time; }
      // The shooter's stroke isn't counted yet in the state being animated.
      const strokes = p.strokes + (p === current(g) ? 1 : 0);
      const name = p.id === session.me ? '' : `${p.name} `;
      ui.flash(strokes === 1 ? `${name}ACE!` : `${name}SUNK`, p.color);
    }
  }

  // --- Drawing (everything that moves) -------------------------------------

  private draw(time: number) {
    const fx = this.fx;
    fx.clear();
    const g = this.shown;
    const cup = holeOf(this.drawnHole).cup;

    // The cup breathes.
    const beat = (time % 1600) / 1600;
    fx.lineStyle(1.5, COLORS.cup, 0.5 * (1 - beat));
    fx.strokeCircle(cup.x, cup.y, CONFIG.cup.radius + 2 + beat * 14);

    for (const t of this.trails.values()) this.drawTrail(t, time);

    this.rings = this.rings.filter(r => time < r.born + r.life);
    for (const r of this.rings) {
      const k = (time - r.born) / r.life;
      if (k < 0) continue;
      fx.lineStyle(2, r.color, 1 - k);
      fx.strokeCircle(r.at.x, r.at.y, lerp(r.from, r.to, k));
    }

    this.drawTags(g);
    if (!g) return;

    if (g.phase === 'aim' && !this.rolling) this.drawAim(g, time);

    for (const p of g.players) {
      const b = p.ball;
      if (!b || b.sunk) continue;
      const R = CONFIG.ball.radius;
      fx.fillStyle(p.color, 0.18);
      fx.fillCircle(b.pos.x, b.pos.y, R * 2.2);
      fx.fillStyle(p.color, 1);
      fx.fillCircle(b.pos.x, b.pos.y, R);
      fx.fillStyle(0xffffff, 0.9);
      fx.fillCircle(b.pos.x - R * 0.3, b.pos.y - R * 0.3, R * 0.32);
    }
  }

  // When the players row has no room for names, they float over the balls,
  // the same size on screen whatever the zoom.
  private drawTags(g: Game | null) {
    const zoom = this.cameras.main.zoom;
    const live = new Set<string>();
    for (const p of (!ui.namesInRow() && g?.players) || []) {
      const b = p.ball;
      if (!b || b.sunk) continue;
      live.add(p.id);
      let tag = this.tags.get(p.id);
      if (!tag) {
        tag = this.add
          .text(0, 0, '', { fontFamily: 'Orbitron, sans-serif', fontSize: '10px', fontStyle: '700' })
          .setOrigin(0.5, 1)
          .setResolution(window.devicePixelRatio);
        this.tags.set(p.id, tag);
      }
      tag.setText(p.name).setColor(ui.css(p.color)).setAlpha(0.85).setScale(1 / zoom);
      tag.setPosition(b.pos.x, b.pos.y - CONFIG.ball.radius * 2.2 - 2 / zoom);
    }
    for (const [id, tag] of this.tags) {
      if (live.has(id)) continue;
      tag.destroy();
      this.tags.delete(id);
    }
  }

  // A light-cycle wall: bright at the head, fading along its length, and the
  // whole thing fading once the ball has stopped.
  private drawTrail(t: Trail, time: number) {
    const age = t.done ? (time - t.laidAt) / (CONFIG.look.trailSeconds * 1000) : 0;
    if (age >= 1 || t.points.length < 2) return;
    // Drawn as a few joined polylines rather than per segment, so the joints
    // stay smooth; each piece is a step brighter towards the head.
    const pieces = 10;
    const n = t.points.length;
    for (let k = 0; k < pieces; k++) {
      const from = Math.floor((k * (n - 1)) / pieces);
      const to = Math.floor(((k + 1) * (n - 1)) / pieces);
      if (to <= from) continue;
      const alpha = (0.15 + (0.85 * (k + 1)) / pieces) * (1 - age);
      this.fx.lineStyle(3, t.color, alpha);
      this.fx.strokePoints(t.points.slice(from, to + 1) as unknown as Phaser.Math.Vector2[], false, false);
    }
  }

  private drawAim(g: Game, time: number) {
    const p = current(g);
    const ball = p.ball!;
    const fx = this.fx;
    const R = CONFIG.ball.radius;
    const mine = p.id === session.me;

    // Pulse around whoever is up.
    const beat = (time % 1000) / 1000;
    fx.lineStyle(1.5, p.color, 0.8 * (1 - beat));
    fx.strokeCircle(ball.pos.x, ball.pos.y, R + 3 + beat * 10);

    if (mine && canPlace(g) && !this.sent) {
      const t = holeOf(g.holeId).tee;
      fx.lineStyle(1, COLORS.mat, 0.5 + 0.3 * Math.sin(time / 300));
      fx.strokeRect(t.x, t.y, t.w, t.h);
    }

    const aim = mine ? this.aim : this.remoteAim;
    if (!aim) return;

    // Dashed line along the aim, as long as the power; it doesn't show bounces.
    const length = lerp(CONFIG.aim.previewMin, CONFIG.aim.previewMax, aim.power);
    const dir = fromAngle(aim.angle);
    const dash = 8;
    const gap = 6;
    const offset = (time / 40) % (dash + gap);
    const alpha = mine ? 0.9 : 0.55;
    fx.lineStyle(2, p.color, alpha);
    for (let s = R + 4 - offset; s < length; s += dash + gap) {
      const s0 = Math.max(R + 4, s);
      const s1 = Math.min(length, s + dash);
      if (s1 <= s0) continue;
      fx.lineBetween(ball.pos.x + dir.x * s0, ball.pos.y + dir.y * s0, ball.pos.x + dir.x * s1, ball.pos.y + dir.y * s1);
    }
    const tip = { x: ball.pos.x + dir.x * length, y: ball.pos.y + dir.y * length };
    const back = fromAngle(aim.angle + Math.PI, 9);
    const side = fromAngle(aim.angle + Math.PI / 2, 6);
    fx.lineStyle(2.5, p.color, alpha);
    fx.lineBetween(tip.x, tip.y, tip.x + back.x + side.x, tip.y + back.y + side.y);
    fx.lineBetween(tip.x, tip.y, tip.x + back.x - side.x, tip.y + back.y - side.y);
  }
}
