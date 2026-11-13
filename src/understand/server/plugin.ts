// C12e. The one line vite.config.ts needs (SPEC 17.9: "registered beside the media plugin"). The implementation is loaded through the
// dev server's own module loader, not imported here, so the config depends on nothing but this file: editing the importer or the
// understand modules never restarts the dev server (a restart would kill a drawing job in progress), and every job runs the current code.
import type { Plugin } from 'vite';
import type { RunConfig as RunCfg } from './run';

export interface UnderstandPluginOptions {
  root?: string;
  /**
   * Dev and test only: a module id whose exports `provider()` and `available()` replace the Gemini key lookup (a recorded or simulated
   * model). Also read from the env WALKTHRU_UNDERSTAND_PROVIDER. Never set in normal use: with neither, only a real key switches vision on.
   */
  providerModule?: string;
}

/** Must come BEFORE the dev scene API in `plugins`, which answers 404 for /api/scenes/... routes it does not know. */
export function walkthruUnderstandApi(opts: UnderstandPluginOptions = {}): Plugin {
  return {
    name: 'walkthru-understand-api',
    apply: 'serve',
    configureServer(server) {
      let ready: Promise<(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: (e?: unknown) => void) => void | Promise<void>> | null = null;
      const build = async () => {
        const root = opts.root ?? server.config.root ?? process.cwd();
        const api = (await server.ssrLoadModule('/src/understand/server/understand-api.ts')) as typeof import('./understand-api');
        const store = (await server.ssrLoadModule('/src/understand/server/store.ts')) as typeof import('./store');
        const jobsMod = (await server.ssrLoadModule('/src/understand/server/jobs.ts')) as typeof import('./jobs');
        const run = (await server.ssrLoadModule('/src/understand/server/run.ts')) as typeof import('./run');
        const paths = store.makePaths(root);
        const injected = opts.providerModule ?? process.env.WALKTHRU_UNDERSTAND_PROVIDER;
        const inj = injected ? ((await server.ssrLoadModule(injected)) as { provider?: RunCfg['provider']; available?: RunCfg['visionAvailable'] }) : null;
        const cfg: RunCfg = inj ? { provider: inj.provider, visionAvailable: inj.available } : {};
        const jobs = new jobsMod.UnderstandJobs(paths, run.makeRunner(cfg));
        return api.createUnderstandMiddleware(jobs, paths, { visionAvailable: cfg.visionAvailable });
      };
      server.middlewares.use((req, res, next) => {
        if (!req.url || !/^\/api\/scenes\/[^/]+\/understand(\/|\?|$)/.test(req.url)) return next();
        ready ??= build();
        ready.then((mw) => mw(req, res, next), (err) => { res.statusCode = 500; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: String((err as Error).message ?? err) })); });
      });
    },
  };
}
