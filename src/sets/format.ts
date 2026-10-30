// What a set file holds, and the rules for one. A set is a run of holes
// played in order, by hole id (the file names in src/holes). Set files come
// from this repo, the editor or a download, so like holes they're checked
// before use.

export interface HoleSet {
  name: string;
  holes: string[];      // hole ids, in playing order; a hole may repeat
}

export const SET_LIMITS = {
  name: 24,
  holes: [1, 18] as [number, number],
};

export interface ParsedSet {
  set: HoleSet | null;
  errors: string[];
}

// `known` is every hole id a set may use.
export function parseSet(data: unknown, known: Iterable<string>): ParsedSet {
  const errors: string[] = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { set: null, errors: ['not a JSON object'] };
  const raw = data as Record<string, unknown>;

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > SET_LIMITS.name || /[\p{C}]/u.test(name)) {
    errors.push(`name: 1 to ${SET_LIMITS.name} plain characters`);
  }

  const [min, max] = SET_LIMITS.holes;
  const holes = Array.isArray(raw.holes) ? raw.holes : null;
  if (!holes || holes.length < min || holes.length > max) errors.push(`holes: ${min} to ${max} hole ids`);
  const ids = new Set(known);
  (holes ?? []).forEach((h, i) => {
    if (typeof h !== 'string' || !ids.has(h)) errors.push(`hole ${i + 1}: ${typeof h === 'string' ? `no hole called "${h}"` : 'a hole id'}`);
  });

  if (errors.length) return { set: null, errors };
  return { set: { name, holes: holes as string[] }, errors };
}

// The file, as the editor saves it.
export function setToJson(s: HoleSet): string {
  return `${JSON.stringify({ name: s.name, holes: s.holes }, null, 2)}\n`;
}
