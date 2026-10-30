import { readdir, readFile, writeFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { holeToJson, parseHole } from './src/holes/format';
import { parseSet, setToJson } from './src/sets/format';

// The hole editor (editor/) reads and saves holes and sets through these, on
// the dev server only:
//   GET  /__holes/       the hole ids          (and /__sets/ the same for sets)
//   GET  /__holes/<id>   src/holes/<id>.json as it is on disk
//   POST /__holes/<id>   writes it, once it follows the rules
// Vite reloads every open page when a file appears, the editor too; the
// editor keeps its state across that.
const HOLES_DIR = new URL('./src/holes/', import.meta.url);
const SETS_DIR = new URL('./src/sets/', import.meta.url);

const idsIn = async (dir: URL) =>
  (await readdir(dir)).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)).sort();

// What to write for a file, or why not.
type Check = (data: unknown) => Promise<{ json: string } | { errors: string[] }>;

const checkHole: Check = async data => {
  const { hole, errors } = parseHole(data);
  return hole ? { json: holeToJson(hole) } : { errors };
};

// A set may use any hole file that follows the rules.
const checkSet: Check = async data => {
  const ids: string[] = [];
  for (const id of await idsIn(HOLES_DIR)) {
    if (parseHole(JSON.parse(await readFile(new URL(`${id}.json`, HOLES_DIR), 'utf8'))).hole) ids.push(id);
  }
  const { set, errors } = parseSet(data, ids);
  return set ? { json: setToJson(set) } : { errors };
};

function saver(route: string, dir: URL, check: Check): Plugin {
  const folder = `src/${route.replace(/_|\//g, '')}`;
  return {
    name: `sinkhole-saver${route.replace(/\//g, '-')}`,
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(route, async (req, res) => {
        const id = (req.url ?? '').replace(/^\//, '');
        const reply = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method === 'GET' && !id) return reply(200, await idsIn(dir));
        if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) return reply(400, { errors: ['id: lowercase letters, digits and dashes'] });
        const file = new URL(`${id}.json`, dir);
        if (req.method === 'GET') {
          try {
            return reply(200, JSON.parse(await readFile(file, 'utf8')));
          } catch {
            return reply(404, { errors: [`no such file`] });
          }
        }
        if (req.method !== 'POST') return reply(405, { errors: ['GET or POST'] });
        let body = '';
        for await (const chunk of req) body += chunk;
        let data: unknown;
        try {
          data = JSON.parse(body);
        } catch {
          return reply(400, { errors: ['not JSON'] });
        }
        const out = await check(data);
        if ('errors' in out) return reply(422, out);
        await writeFile(file, out.json);
        reply(200, { saved: `${folder}/${id}.json` });
      });
    },
  };
}

// Relative base so the build works under any GitHub Pages path. The editor is
// built too, as an unlisted page at editor/; there it can download holes and
// sets but not save them into the repo.
export default defineConfig({
  base: './',
  plugins: [saver('/__holes/', HOLES_DIR, checkHole), saver('/__sets/', SETS_DIR, checkSet)],
  build: {
    rolldownOptions: {
      input: { game: 'index.html', editor: 'editor/index.html' },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
