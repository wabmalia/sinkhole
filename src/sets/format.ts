import { holeToJson, parseHole } from '../holes/format';
import type { Hole } from '../holes/types';

// What a set file holds, and the rules for one. A set is a run of holes
// played in order, and the file carries the holes themselves, so one file is
// everything needed to play, share or commit it:
//
//   {
//     "name": "Full course",
//     "holes": [
//       { "name": "Straight", "par": 2, "outline": [...], ... },
//       ...
//     ]
//   }
//
// Set files come from this repo, the editor, a browser or a download, so
// like holes they're checked before use.

export interface HoleSet {
  name: string;
  holes: Hole[];        // in playing order
}

export const SET_LIMITS = {
  name: 24,
  holes: [1, 18] as [number, number],
};

// The set the lobby starts on; it can't be deleted.
export const DEFAULT_SET = 'full-course';

// File names, for sets in the repo and in a browser alike.
export const validSetId = (id: string) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(id);

export interface ParsedSet {
  set: HoleSet | null;
  errors: string[];
}

export function parseSet(data: unknown): ParsedSet {
  const errors: string[] = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { set: null, errors: ['not a JSON object'] };
  const raw = data as Record<string, unknown>;

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > SET_LIMITS.name || /[\p{C}]/u.test(name)) {
    errors.push(`name: 1 to ${SET_LIMITS.name} plain characters`);
  }

  const [min, max] = SET_LIMITS.holes;
  const list = Array.isArray(raw.holes) ? raw.holes : null;
  if (!list || list.length < min || list.length > max) errors.push(`holes: ${min} to ${max}`);
  const holes: Hole[] = [];
  (list ?? []).forEach((h, i) => {
    const parsed = parseHole(h);
    if (parsed.hole) holes.push(parsed.hole);
    else errors.push(...parsed.errors.map(e => `hole ${i + 1}: ${e}`));
  });

  if (errors.length) return { set: null, errors };
  return { set: { name, holes }, errors };
}

// The file, as the editor saves it: each hole laid out as a hole file is.
export function setToJson(s: HoleSet): string {
  const indent = (text: string) => text.trimEnd().replace(/^/gm, '    ');
  return [
    '{',
    `  "name": ${JSON.stringify(s.name)},`,
    '  "holes": [',
    s.holes.map(h => indent(holeToJson(h))).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}
