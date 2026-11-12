import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { walkthruMediaApi } from './src/media/server/media-api';

const SCENES_DIR = path.resolve(import.meta.dirname, 'public/scenes');
const ID_RE = /^[a-z0-9-]{1,40}$/;
const FILE_RE = /^plan\.(png|jpe?g|webp|svg)$/;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Dev-only scene API for the editor (SPEC 8.2). Not part of the production build. */
function walkthruDevApi(): Plugin {
  return {
    name: 'walkthru-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();
        try {
          const parts = url.pathname.split('/').filter(Boolean); // ['api', 'scenes', ...]
          if (parts[1] !== 'scenes') return send(res, 404, { error: 'not found' });

          // GET /api/scenes
          if (parts.length === 2 && req.method === 'GET') {
            const names = fs.existsSync(SCENES_DIR)
              ? fs.readdirSync(SCENES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
              : [];
            return send(res, 200, names);
          }

          const id = parts[2];
          if (!id || !ID_RE.test(id)) return send(res, 400, { error: 'bad scene id' });
          const dir = path.join(SCENES_DIR, id);

          // GET /api/scenes/:id/files
          if (parts.length === 4 && parts[3] === 'files' && req.method === 'GET') {
            const files = fs.existsSync(dir)
              ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name)
              : [];
            return send(res, 200, files);
          }

          // PUT /api/scenes/:id/property
          if (parts.length === 4 && parts[3] === 'property' && req.method === 'PUT') {
            const body = await readBody(req);
            let json: unknown;
            try {
              json = JSON.parse(body.toString('utf8'));
            } catch {
              return send(res, 400, { error: 'body is not valid JSON' });
            }
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'property.json'), JSON.stringify(json, null, 2) + '\n');
            return send(res, 200, { ok: true });
          }

          // PUT /api/scenes/:id/file/:name
          if (parts.length === 5 && parts[3] === 'file' && req.method === 'PUT') {
            const name = decodeURIComponent(parts[4]);
            if (!FILE_RE.test(name)) return send(res, 400, { error: 'bad file name' });
            const body = await readBody(req);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, name), body);
            return send(res, 200, { ok: true });
          }

          return send(res, 404, { error: 'not found' });
        } catch (err) {
          return send(res, 500, { error: String(err) });
        }
      });
    },
  };
}

export default defineConfig({
  // media API first: the scene API answers 404 for /api/scenes/... routes it does not know
  plugins: [walkthruMediaApi(), walkthruDevApi()],
  build: {
    // three + Spark are one big chunk; that is expected for this prototype
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        index: path.resolve(import.meta.dirname, 'index.html'),
        editor: path.resolve(import.meta.dirname, 'editor.html'),
      },
    },
  },
});
