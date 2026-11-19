import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { walkthruMediaApi } from './src/media/server/media-api';
import { walkthruUnderstandApi } from './src/understand/server/plugin';
import { walkthruPhotoApi } from './src/photo/server/plugin';
import { walkthruInventoryApi } from './src/inventory/server/plugin';
import { scanScenes, writeSceneIndex } from './scripts/make-scene-index';

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

/**
 * Link previews (Open Graph, Twitter) want the picture's full address. A Vercel build knows the site's host: VERCEL_PROJECT_PRODUCTION_URL
 * (set at build time on every deployment, previews too; the shortest production domain, no `https://`), else VERCEL_URL (this deployment's
 * own address). Both need "Enable access to System Environment Variables" in the project settings.
 * `SITE_ORIGIN` (with the scheme) overrides both. Anywhere else the token is dropped and the address stays relative.
 */
export function siteOrigin(env: Record<string, string | undefined>): string {
  const host = (env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || '').replace(/^https?:\/\//, '');
  return (env.SITE_ORIGIN || (host ? `https://${host}` : '')).trim().replace(/\/+$/, '');
}
function walkthruSiteOrigin(): Plugin {
  const origin = siteOrigin(process.env);
  return { name: 'walkthru-site-origin', transformIndexHtml: (html) => html.replaceAll('__SITE_ORIGIN__', origin) };
}

/**
 * The start page's list of homes (public/scenes/index.json). Dev: answered fresh from the folders on every request, so a new
 * scene folder shows up without a restart. Build: written into public/scenes before the public folder is copied, so a plain
 * `vite build` has it too (`npm run make:room` writes the same file).
 */
function walkthruSceneIndex(): Plugin {
  return {
    name: 'walkthru-scene-index',
    configResolved(config) {
      if (config.command === 'build') writeSceneIndex(SCENES_DIR);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/scenes/index.json') return next();
        res.setHeader('cache-control', 'no-cache');
        send(res, 200, scanScenes(SCENES_DIR));
      });
    },
  };
}

/**
 * The browser reader (src/upload/reader.worker.ts) runs the same pipeline as Node. One file on its path, src/understand/pixels/image.ts, imports
 * `node:zlib` for the PNG helpers the picture readers use; the vector path never calls them (it reaches that file only for `newGray`). In the worker
 * bundle that import is answered by a stub that throws if it is ever called, so the chunk imports no Node built-in and the file itself stays untouched.
 */
function browserShims(): Plugin {
  const ID = '\0walkthru-zlib-shim';
  return {
    name: 'walkthru-browser-shims',
    enforce: 'pre',
    resolveId(id) { return id === 'node:zlib' ? ID : null; },
    load(id) {
      return id === ID ? "const no = () => { throw new Error('PNG compression is not available in the browser reader.'); };\nexport const deflateSync = no;\nexport const inflateSync = no;\n" : null;
    },
  };
}

/** Dev only: the VR page is served at /vr (a rewrite in vercel.json does the same in production). */
function walkthruVrRoute(): Plugin {
  return {
    name: 'walkthru-vr-route',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const u = new URL(req.url ?? '/', 'http://localhost');
        if (u.pathname === '/vr') req.url = `/vr.html${u.search}`;
        next();
      });
    },
  };
}

/** Dev only: the admin page for a building's inventory is served at /admin (a rewrite in vercel.json does the same in production). */
function walkthruAdminRoute(): Plugin {
  return {
    name: 'walkthru-admin-route',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const u = new URL(req.url ?? '/', 'http://localhost');
        if (u.pathname === '/admin') req.url = `/admin.html${u.search}`;
        next();
      });
    },
  };
}

export default defineConfig({
  // media API first: the scene API answers 404 for /api/scenes/... routes it does not know
  plugins: [walkthruVrRoute(), walkthruAdminRoute(), walkthruSiteOrigin(), walkthruSceneIndex(), walkthruMediaApi(), walkthruUnderstandApi(), walkthruPhotoApi(), walkthruInventoryApi(), walkthruDevApi()],
  // the plan reader runs in a module Web Worker that loads pdf.js lazily (src/upload/reader.worker.ts); es format allows its code splitting
  worker: { format: 'es', plugins: () => [browserShims()] },
  build: {
    // three + Spark are one big chunk; that is expected for this prototype
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        index: path.resolve(import.meta.dirname, 'index.html'),
        editor: path.resolve(import.meta.dirname, 'editor.html'),
        // the VR front end for a headset (SPEC 21): its own page and entry, sharing engine and scene code by import only
        vr: path.resolve(import.meta.dirname, 'vr.html'),
        // the owner's page for a building's inventory (SPEC 22.3), served at /admin
        admin: path.resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
});
