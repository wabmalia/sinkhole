import type { Game } from '../engine/game';
import type { Shot } from '../engine/shot';
import type { Vec } from '../engine/vec';

export const PEER_PREFIX = 'sinkhole-v1-';
export const NAME_MAX = 16;

export interface MemberView {
  id: string;
  name: string;
  connected: boolean;
}

export interface RoomView {
  code: string;
  hostId: string;
  members: MemberView[];
  game: Game | null;
}

// Where the current player is aiming, so everyone can watch them line up.
export interface Aim {
  angle: number;
  power: number;
  at: Vec;         // ball position (moves while placing on the tee)
}

export type ToHost =
  | { t: 'hello'; id: string; name: string }
  | { t: 'aim'; aim: Aim }
  | { t: 'shot'; shot: Shot; at?: Vec };

export type ToClient =
  | { t: 'room'; room: RoomView }
  // Sent just before the room update the shot leads to, so screens can
  // animate it from the state they already have.
  | { t: 'shot'; by: string; shot: Shot; at?: Vec }
  | { t: 'aim'; by: string; aim: Aim }
  | { t: 'error'; msg: string }
  | { t: 'rejected'; reason: string };

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  const buf = new Uint32Array(5);
  crypto.getRandomValues(buf);
  return Array.from(buf, x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/[\p{C}]/gu, '')
    .trim()
    .slice(0, NAME_MAX);
  return name || 'Player';
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown): v is Vec => !!v && typeof v === 'object' && num((v as Vec).x) && num((v as Vec).y);

// Messages come from other browsers, so check the shapes we rely on.
export function validShot(s: unknown): s is Shot {
  const shot = s as Shot;
  return !!shot && typeof shot === 'object' && num(shot.angle) && num(shot.power);
}

export function validAim(a: unknown): a is Aim {
  const aim = a as Aim;
  return !!aim && typeof aim === 'object' && num(aim.angle) && num(aim.power) && isVec(aim.at);
}

export const validAt = (v: unknown): v is Vec | undefined => v === undefined || isVec(v);
