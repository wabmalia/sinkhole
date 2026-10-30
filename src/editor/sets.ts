import type { Hole } from '../holes/types';
import { parseSet, setToJson, type HoleSet } from '../sets/format';

// The SETS tab: put holes in order, name the set and save it. Like holes,
// sets save into src/sets/ on the dev server and download on the site. Any
// hole file that follows the rules can go in; the canvas previews the one
// clicked.

const LOCAL = import.meta.env.DEV;
const BUILT = import.meta.glob<unknown>('../sets/*.json', { eager: true, import: 'default' });
const builtId = (path: string) => path.slice('../sets/'.length, -'.json'.length);
const STATE_KEY = 'sinkhole-editor-set';

interface SetDraft extends HoleSet {
  id: string;
}

export interface SetsHost {
  // Every hole that follows the rules, by id, read fresh.
  holes(): Promise<Map<string, Hole>>;
  preview(hole: Hole | null): void;
  edit(id: string): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupSets(host: SetsHost) {
  const el = {
    load: $<HTMLSelectElement>('set-load'),
    fresh: $<HTMLButtonElement>('set-new'),
    id: $<HTMLInputElement>('set-id'),
    name: $<HTMLInputElement>('set-name'),
    list: $('set-holes'),
    add: $<HTMLSelectElement>('set-add'),
    total: $('set-total'),
    rules: $('set-rules'),
    save: $<HTMLButtonElement>('set-save'),
    copy: $<HTMLButtonElement>('set-copy'),
    status: $('set-status'),
  };

  const blank = (): SetDraft => ({ id: 'new-set', name: 'New set', holes: [] });
  const kept = restore();
  let draft: SetDraft = kept?.draft ?? blank();
  let holes = new Map<string, Hole>();
  let shown = -1; // the row previewed

  function keep() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ draft, status: el.status.textContent ?? '' }));
    } catch {
      // Private mode or storage off: the set just isn't kept.
    }
  }

  // The set and the status line survive a reload (Vite reloads the page
  // whenever a set is saved).
  function restore(): { draft: SetDraft; status: string } | null {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      return raw ? (JSON.parse(raw) as { draft: SetDraft; status: string }) : null;
    } catch {
      return null;
    }
  }

  const status = (text: string) => {
    el.status.textContent = text;
    keep();
  };
  const checked = () => parseSet({ name: draft.name, holes: draft.holes }, holes.keys());

  function show(i: number) {
    shown = i;
    host.preview(holes.get(draft.holes[i] ?? '') ?? null);
    render();
  }

  function changed() {
    keep();
    if (shown >= draft.holes.length) shown = draft.holes.length - 1;
    show(shown);
  }

  function render() {
    if (document.activeElement !== el.id) el.id.value = draft.id;
    if (document.activeElement !== el.name) el.name.value = draft.name;

    el.list.replaceChildren(
      ...draft.holes.map((id, i) => {
        const hole = holes.get(id);
        const li = document.createElement('li');
        li.classList.toggle('on', i === shown);
        li.classList.toggle('bad', !hole);
        const pick = button(`${i + 1}  ${hole?.name ?? id}`, 'set-hole', () => show(i));
        const par = document.createElement('span');
        par.className = 'set-par';
        par.textContent = hole ? `PAR ${hole.par}` : '?';
        const move = (by: number) => () => {
          const j = i + by;
          if (j < 0 || j >= draft.holes.length) return;
          [draft.holes[i], draft.holes[j]] = [draft.holes[j]!, draft.holes[i]!];
          shown = j;
          changed();
        };
        const up = button('↑', 'icon', move(-1), 'Move up');
        const down = button('↓', 'icon', move(1), 'Move down');
        up.disabled = i === 0;
        down.disabled = i === draft.holes.length - 1;
        const edit = button('✎', 'icon', () => host.edit(id), `Edit ${id}`);
        edit.disabled = !hole;
        const drop = button('✕', 'icon', () => {
          draft.holes.splice(i, 1);
          changed();
        }, 'Remove');
        li.append(pick, par, up, down, edit, drop);
        return li;
      }),
    );

    const par = draft.holes.reduce((sum, id) => sum + (holes.get(id)?.par ?? 0), 0);
    const n = draft.holes.length;
    el.total.textContent = `${n} ${n === 1 ? 'HOLE' : 'HOLES'} · PAR ${par}`;

    const { errors } = checked();
    const idOk = /^[a-z0-9][a-z0-9-]{0,31}$/.test(draft.id);
    const problems = [...(idOk ? [] : ['file: lowercase letters, digits and dashes']), ...errors];
    el.rules.replaceChildren(
      ...(problems.length
        ? problems.map(p => Object.assign(document.createElement('li'), { textContent: p }))
        : [Object.assign(document.createElement('li'), { textContent: '✓ Follows the rules', className: 'ok' })]),
    );
    el.save.disabled = problems.length > 0;
  }

  async function listSets() {
    const ids = LOCAL ? ((await (await fetch('/__sets/')).json()) as string[]) : Object.keys(BUILT).map(builtId).sort();
    el.load.replaceChildren(new Option('Open a set…', ''), ...ids.map(id => new Option(id, id)));
  }

  function listHoles() {
    el.add.replaceChildren(
      new Option('Add a hole…', ''),
      ...[...holes].map(([id, h]) => new Option(`${h.name} (${id}) · par ${h.par}`, id)),
    );
  }

  el.load.addEventListener('change', async () => {
    const id = el.load.value;
    el.load.value = '';
    if (!id) return;
    let data: unknown;
    if (LOCAL) {
      const res = await fetch(`/__sets/${id}`);
      if (!res.ok) return status(`Couldn't open ${id}.`);
      data = await res.json();
    } else {
      data = Object.entries(BUILT).find(([path]) => builtId(path) === id)?.[1];
    }
    const raw = (data ?? {}) as Partial<HoleSet>;
    draft = {
      id,
      name: typeof raw.name === 'string' ? raw.name : id,
      holes: Array.isArray(raw.holes) ? raw.holes.filter((h): h is string => typeof h === 'string') : [],
    };
    shown = 0;
    changed();
    status(LOCAL ? `Opened src/sets/${id}.json` : `Opened ${id}.`);
  });

  el.fresh.addEventListener('click', () => {
    draft = blank();
    shown = -1;
    changed();
    status('');
  });

  el.id.addEventListener('input', () => {
    draft.id = el.id.value.trim();
    keep();
    render();
  });
  el.name.addEventListener('input', () => {
    draft.name = el.name.value;
    keep();
    render();
  });

  el.add.addEventListener('change', () => {
    const id = el.add.value;
    el.add.value = '';
    if (!id) return;
    draft.holes.push(id);
    shown = draft.holes.length - 1;
    changed();
  });

  el.save.addEventListener('click', async () => {
    const { set } = checked();
    if (!set) return;
    if (!LOCAL) return download(set);
    const res = await fetch(`/__sets/${draft.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(set),
    });
    const body = (await res.json()) as { saved?: string; errors?: string[] };
    if (!res.ok) return status(`Not saved: ${(body.errors ?? [String(res.status)]).join('; ')}`);
    status(`Saved to ${body.saved}. The lobby lists it from there.`);
    void listSets();
  });

  // On the site: the set as a file, to put in src/sets/.
  function download(set: HoleSet) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([setToJson(set)], { type: 'application/json' }));
    link.download = `${draft.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    status(`Downloaded ${draft.id}.json. It goes in src/sets/ to be part of the game.`);
  }

  el.copy.addEventListener('click', async () => {
    const { set } = checked();
    await navigator.clipboard.writeText(set ? setToJson(set) : JSON.stringify({ name: draft.name, holes: draft.holes }, null, 2));
    status('Copied.');
  });

  if (!LOCAL) el.save.textContent = 'DOWNLOAD';
  el.status.textContent = kept?.status ?? '';

  return {
    // Called when the tab opens: the holes may have changed since.
    async open() {
      holes = await host.holes();
      listHoles();
      await listSets();
      show(shown < 0 && draft.holes.length ? 0 : shown);
    },
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
