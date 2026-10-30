import { readdir, readFile, writeFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { holeToJson, parseHole } from './src/holes/format';

// The hole editor (editor/) reads and saves holes through this, on the dev
// server only:
//   GET  /__holes/       the hole ids
//   GET  /__holes/<id>   src/holes/<id>.json as it is on disk
//   POST /__holes/<id>   writes it, once the hole follows the rules
// Vite reloads every open page when a hole file appears, the editor too; the
// editor keeps its state across that.
const HOLES_DIR = new URL('./src/holes/', import.meta.url);

function holeSaver(): Plugin {
  return {
    name: 'sinkhole-hole-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__holes/', async (req, res) => {
        const id = (req.url ?? '').replace(/^\//, '');
        const reply = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method === 'GET' && !id) {
          const names = await readdir(HOLES_DIR);
          return reply(200, names.filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)).sort());
        }
        if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) return reply(400, { errors: ['id: lowercase letters, digits and dashes'] });
        const file = new URL(`${id}.json`, HOLES_DIR);
        if (req.method === 'GET') {
          try {
            return reply(200, JSON.parse(await readFile(file, 'utf8')));
          } catch {
            return reply(404, { errors: ['no such hole'] });
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
        const { hole, errors } = parseHole(data);
        if (!hole) return reply(422, { errors });
        await writeFile(file, holeToJson(hole));
        reply(200, { saved: `src/holes/${id}.json` });
      });
    },
  };
}

// Relative base so the build works under any GitHub Pages path. The editor is
// built too, as an unlisted page at editor/; there it can download holes but
// not save them into the repo.
export default defineConfig({
  base: './',
  plugins: [holeSaver()],
  build: {
    rolldownOptions: {
      input: { game: 'index.html', editor: 'editor/index.html' },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
