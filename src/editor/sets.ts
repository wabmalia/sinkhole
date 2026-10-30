import type { HoleFile } from '../holes/format';
import { browserSets, deleteBrowserSet, saveBrowserSet } from '../sets/browser';
import { DEFAULT_SET, parseSet, setToJson, validSetId, type HoleSet } from '../sets/format';
import { parseHole } from '../holes/format';

// The set being made: its name, file name and holes, in order. The canvas
// edits one hole at a time (editor.ts); this side keeps the set together and
// saves it. SAVE keeps it in this browser, where PLAY SOLO finds it;
// DOWNLOAD gives the file to share or commit; on the dev server TO REPO
// writes it into src/sets/ (see vite.config.ts). The work in progress, saved
// or not, survives a reload.

const LOCAL = import.meta.env.DEV;
const BUILT = import.meta.glob<unknown>('../sets/*.json', { eager: true, import: 'default' });
const builtId = (path: string) => path.slice('../sets/'.length, -'.json'.length);
const STATE_KEY = 'sinkhole-editor';

type HoleDraft = Partial<HoleFile>;
type Source = 'game' | 'browser';

interface SetDraft {
  id: string;
  name: string;
  holes: HoleDraft[];
  // Where it was opened from or last saved to: what DELETE removes.
  origin: { from: Source; id: string } | null;
}

interface Kept {
  set: SetDraft;
  at: number;
  status: string;
  dirty: boolean;
}

export interface SetsHost {
  // Show this hole on the canvas, to edit.
  load(hole: HoleDraft): void;
  // A fresh hole to add.
  blank(): HoleDraft;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupSets(host: SetsHost) {
  const el = {
    open: $<HTMLSelectElement>('open'),
    fresh: $<HTMLButtonElement>('new'),
    file: $<HTMLInputElement>('file'),
    id: $<HTMLInputElement>('set-id'),
    name: $<HTMLInputElement>('set-name'),
    list: $('set-holes'),
    add: $<HTMLButtonElement>('add-hole'),
    total: $('set-total'),
    title: $('hole-title'),
    rules: $('set-rules'),
    save: $<HTMLButtonElement>('save'),
    download: $<HTMLButtonElement>('download'),
    repo: $<HTMLButtonElement>('to-repo'),
    remove: $<HTMLButtonElement>('delete'),
    status: $('status'),
  };

  const newSet = (): SetDraft => ({ id: 'new-set', name: 'New set', holes: [host.blank()], origin: null });
  const kept = restore();
  let set = kept?.set ?? newSet();
  let at = Math.min(kept?.at ?? 0, set.holes.length - 1);
  let dirty = kept?.dirty ?? false;
  let repoIds: string[] = [];

  function keep() {
    try {
      const k: Kept = { set, at, status: el.status.textContent ?? '', dirty };
      localStorage.setItem(STATE_KEY, JSON.stringify(k));
    } catch {
      // Private mode or storage off: the work just isn't kept.
    }
  }

  function restore(): Kept | null {
    try {
      const k = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as Kept | null;
      // Whatever's stored there may not be a set being made.
      return Array.isArray(k?.set?.holes) && k.set.holes.length ? k : null;
    } catch {
      return null;
    }
  }

  function status(text: string) {
    el.status.textContent = text;
    keep();
  }

  const file = () => ({ name: set.name, holes: set.holes });
  const checked = () => parseSet(file());

  // Set-level problems: the file name, the name, how many holes, and which
  // holes break their rules (the hole's own list says how).
  function problems(): string[] {
    const out = validSetId(set.id) ? [] : ['file: lowercase letters, digits and dashes'];
    const { errors } = checked();
    out.push(...errors.filter(e => !e.startsWith('hole ')));
    const bad = set.holes.flatMap((h, i) => (parseHole(h).hole ? [] : [i + 1]));
    if (bad.length) out.push(`${bad.length === 1 ? 'hole' : 'holes'} ${bad.join(', ')}: fix the rules`);
    return out;
  }

  function show(i: number) {
    at = Math.max(0, Math.min(i, set.holes.length - 1));
    keep();
    host.load(set.holes[at]!);
    render();
  }

  function changed() {
    dirty = true;
    keep();
    render();
  }

  // Start over on another set, once anything unsaved is let go.
  function replace(next: SetDraft, note: string): boolean {
    if (dirty && !confirm('Leave this set? Changes not saved or downloaded are lost.')) return false;
    set = next;
    dirty = false;
    show(0);
    status(note);
    return true;
  }

  function render() {
    if (document.activeElement !== el.id) el.id.value = set.id;
    if (document.activeElement !== el.name) el.name.value = set.name;
    el.title.textContent = `HOLE ${at + 1}`;

    el.list.replaceChildren(
      ...set.holes.map((h, i) => {
        const li = document.createElement('li');
        li.classList.toggle('on', i === at);
        li.classList.toggle('bad', !parseHole(h).hole);
        const pick = button(`${i + 1}  ${h.name || 'Untitled'}`, 'set-hole', () => show(i));
        const par = document.createElement('span');
        par.className = 'set-par';
        par.textContent = `PAR ${h.par ?? '?'}`;
        const move = (by: number) => () => {
          const j = i + by;
          [set.holes[i], set.holes[j]] = [set.holes[j]!, set.holes[i]!];
          if (at === i) at = j;
          else if (at === j) at = i;
          changed();
        };
        const up = button('↑', 'icon', move(-1), 'Move up');
        const down = button('↓', 'icon', move(1), 'Move down');
        up.disabled = i === 0;
        down.disabled = i === set.holes.length - 1;
        const copy = button('⧉', 'icon', () => {
          set.holes.splice(i + 1, 0, structuredClone(h));
          changed();
          show(i + 1);
        }, 'Duplicate');
        const drop = button('✕', 'icon', () => {
          if (!confirm(`Delete hole ${i + 1}, ${h.name || 'Untitled'}?`)) return;
          set.holes.splice(i, 1);
          changed();
          show(at > i ? at - 1 : at);
        }, 'Delete');
        drop.disabled = set.holes.length === 1;
        li.append(pick, par, up, down, copy, drop);
        return li;
      }),
    );

    const n = set.holes.length;
    const par = set.holes.reduce((sum, h) => sum + (h.par ?? 0), 0);
    el.total.textContent = `${n} ${n === 1 ? 'HOLE' : 'HOLES'} · PAR ${par}`;
    el.add.disabled = n >= 18;

    const list = problems();
    el.rules.replaceChildren(
      ...(list.length
        ? list.map(p => Object.assign(document.createElement('li'), { textContent: p }))
        : [Object.assign(document.createElement('li'), { textContent: '✓ Ready to save', className: 'ok' })]),
    );
    el.save.disabled = el.download.disabled = el.repo.disabled = list.length > 0;
    const o = set.origin;
    el.remove.disabled = !o || (o.from === 'game' && (!LOCAL || o.id === DEFAULT_SET));
  }

  // --- Opening ---------------------------------------------------------------

  async function listSets() {
    repoIds = LOCAL ? ((await (await fetch('/__sets/')).json()) as string[]) : Object.keys(BUILT).map(builtId).sort();
    const mine = Object.keys(browserSets()).sort();
    const group = (label: string, from: Source, ids: string[]) => {
      const g = document.createElement('optgroup');
      g.label = label;
      g.append(...ids.map(id => new Option(id, `${from}:${id}`)));
      return g;
    };
    el.open.replaceChildren(
      new Option('Open a set…', ''),
      group('In the game', 'game', repoIds),
      ...(mine.length ? [group('In this browser', 'browser', mine)] : []),
      new Option('From a file…', 'file'),
    );
  }

  // Lenient, so a set that breaks the rules can still be opened and fixed.
  function fromData(id: string, data: unknown, origin: SetDraft['origin']): SetDraft {
    const raw = (data && typeof data === 'object' ? data : {}) as Partial<Record<keyof HoleSet, unknown>>;
    const holes = Array.isArray(raw.holes) ? raw.holes.filter((h): h is HoleDraft => !!h && typeof h === 'object') : [];
    return {
      id,
      name: typeof raw.name === 'string' ? raw.name : id,
      holes: holes.length ? holes.slice(0, 18) : [host.blank()],
      origin,
    };
  }

  el.open.addEventListener('change', async () => {
    const value = el.open.value;
    el.open.value = '';
    if (value === 'file') return el.file.click();
    const [from, id] = value.split(':') as [Source, string];
    if (!id) return;
    let data: unknown;
    if (from === 'browser') data = browserSets()[id];
    else if (LOCAL) {
      const res = await fetch(`/__sets/${id}`);
      data = res.ok ? await res.json() : undefined;
    } else data = Object.entries(BUILT).find(([path]) => builtId(path) === id)?.[1];
    if (data === undefined) return status(`Couldn't open ${id}.`);
    const where = from === 'browser' ? 'this browser' : LOCAL ? `src/sets/${id}.json` : 'the game';
    replace(fromData(id, data, { from, id }), `Opened ${id} from ${where}.`);
  });

  el.file.addEventListener('change', async () => {
    const f = el.file.files?.[0];
    el.file.value = '';
    if (!f) return;
    let data: unknown;
    try {
      data = JSON.parse(await f.text());
    } catch {
      return status(`${f.name} isn't a set file.`);
    }
    const id = f.name.replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '').slice(0, 32) || 'new-set';
    replace(fromData(id, data, null), `Opened ${f.name}. SAVE keeps it in this browser.`);
  });

  el.fresh.addEventListener('click', () => replace(newSet(), ''));

  // --- Editing -----------------------------------------------------------------

  el.id.addEventListener('input', () => {
    set.id = el.id.value.trim().toLowerCase();
    changed();
  });
  el.name.addEventListener('input', () => {
    set.name = el.name.value;
    changed();
  });
  el.add.addEventListener('click', () => {
    set.holes.push(host.blank());
    changed();
    show(set.holes.length - 1);
  });

  // --- Saving ------------------------------------------------------------------

  const same = (from: Source) => set.origin?.from === from && set.origin.id === set.id;

  el.save.addEventListener('click', () => {
    const { set: done } = checked();
    if (!done) return;
    if (!same('browser') && set.id in browserSets() && !confirm(`Replace ${set.id}, already saved in this browser?`)) return;
    if (!saveBrowserSet(set.id, done)) return status('Not saved: this browser has storage off or full.');
    set.origin = { from: 'browser', id: set.id };
    dirty = false;
    status(`Saved in this browser as ${set.id}. PLAY SOLO lists it.`);
    render();
    void listSets();
  });

  el.download.addEventListener('click', () => {
    const { set: done } = checked();
    if (!done) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([setToJson(done)], { type: 'application/json' }));
    link.download = `${set.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    dirty = false;
    status(`Downloaded ${set.id}.json. In src/sets/ it's part of the game.`);
  });

  el.repo.hidden = !LOCAL;
  el.repo.addEventListener('click', async () => {
    const { set: done } = checked();
    if (!done) return;
    if (!same('game') && repoIds.includes(set.id) && !confirm(`Replace src/sets/${set.id}.json?`)) return;
    const res = await fetch(`/__sets/${set.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: setToJson(done),
    });
    const body = (await res.json()) as { saved?: string; errors?: string[] };
    if (!res.ok) return status(`Not saved: ${(body.errors ?? [String(res.status)]).join('; ')}`);
    set.origin = { from: 'game', id: set.id };
    dirty = false;
    status(`Saved to ${body.saved}. The game and the tests pick it up from there.`);
    render();
    void listSets();
  });

  el.remove.addEventListener('click', async () => {
    const o = set.origin;
    if (!o) return;
    const where = o.from === 'browser' ? 'this browser' : `the repo (src/sets/${o.id}.json)`;
    if (!confirm(`Delete ${o.id} from ${where}? It stays open here until you start another.`)) return;
    if (o.from === 'browser') {
      if (!deleteBrowserSet(o.id)) return status('Not deleted: this browser has storage off.');
    } else {
      const res = await fetch(`/__sets/${o.id}`, { method: 'DELETE' });
      const body = (await res.json()) as { errors?: string[] };
      if (!res.ok) return status(`Not deleted: ${(body.errors ?? [String(res.status)]).join('; ')}`);
    }
    set.origin = null;
    dirty = true;
    status(`Deleted ${o.id} from ${where}.`);
    render();
    void listSets();
  });

  el.status.textContent = kept?.status ?? '';
  void listSets();
  // Vite reloads the page when a set file changes; the work carries on.
  show(at);

  return {
    // The hole on the canvas changed.
    update(hole: HoleDraft) {
      // Picking something calls this too; only a real change needs saving.
      if (JSON.stringify(hole) !== JSON.stringify(set.holes[at])) dirty = true;
      set.holes[at] = hole;
      keep();
      render();
    },
    status,
  };
}

function button(text: string, className: string, click: () => void, label?: string) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', click);
  return b;
}
