import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { DEFAULT_SET, parseSet, setToJson, validSetId } from './src/sets/format';

// The editor (editor/) reads, saves and deletes the sets in the repo through
// this, on the dev server only:
//   GET    /__sets/       the set ids
//   GET    /__sets/<id>   src/sets/<id>.json as it is on disk
//   POST   /__sets/<id>   writes it, once it follows the rules
//   DELETE /__sets/<id>   removes it (not the default set)
// Vite reloads every open page when a file appears, the editor too; the
// editor keeps its state across that.
const SETS_DIR = new URL('./src/sets/', import.meta.url);

const setIds = async () =>
  (await readdir(SETS_DIR)).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)).sort();

const setSaver: Plugin = {
  name: 'sinkhole-sets',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__sets/', async (req, res) => {
      const id = (req.url ?? '').replace(/^\//, '');
      const reply = (status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && !id) return reply(200, await setIds());
      if (!validSetId(id)) return reply(400, { errors: ['id: lowercase letters, digits and dashes'] });
      const file = new URL(`${id}.json`, SETS_DIR);
      if (req.method === 'GET') {
        try {
          return reply(200, JSON.parse(await readFile(file, 'utf8')));
        } catch {
          return reply(404, { errors: [`no such file`] });
        }
      }
      if (req.method === 'DELETE') {
        if (id === DEFAULT_SET) return reply(403, { errors: ['the default set stays'] });
        await rm(file, { force: true });
        return reply(200, { deleted: `src/sets/${id}.json` });
      }
      if (req.method !== 'POST') return reply(405, { errors: ['GET, POST or DELETE'] });
      let body = '';
      for await (const chunk of req) body += chunk;
      let data: unknown;
      try {
        data = JSON.parse(body);
      } catch {
        return reply(400, { errors: ['not JSON'] });
      }
      const { set, errors } = parseSet(data);
      if (!set) return reply(422, { errors });
      await writeFile(file, setToJson(set));
      reply(200, { saved: `src/sets/${id}.json` });
    });
  },
};

// Relative base so the build works under any GitHub Pages path. The editor is
// built too, as an unlisted page at editor/; there it saves sets in the
// browser and downloads them, but can't write to the repo.
export default defineConfig({
  base: './',
  plugins: [setSaver],
  build: {
    rolldownOptions: {
      input: { game: 'index.html', editor: 'editor/index.html' },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
