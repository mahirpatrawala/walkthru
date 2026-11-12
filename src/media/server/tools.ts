// Owned by C9. SPEC 14.6 tools: discovery and a spawn helper. Node only.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ToolName = 'ffmpeg' | 'ffprobe' | 'colmap' | 'brush';

const ENV: Record<ToolName, string> = {
  ffmpeg: 'WALKTHRU_FFMPEG', ffprobe: 'WALKTHRU_FFPROBE', colmap: 'WALKTHRU_COLMAP', brush: 'WALKTHRU_BRUSH',
};

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The absolute path of a tool, or null. Env override first, then PATH plus /opt/homebrew/bin (Brush: its default folder). */
export function findTool(name: ToolName, env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env[ENV[name]];
  if (override) return isExecutable(override) ? override : null;
  if (name === 'brush') {
    const p = path.join(os.homedir(), 'walkthru-tools/brush/brush-app-aarch64-apple-darwin/brush_app');
    return isExecutable(p) ? p : null;
  }
  const dirs = [...(env.PATH ?? '').split(path.delimiter), '/opt/homebrew/bin'].filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, name);
    if (isExecutable(p)) return p;
  }
  return null;
}

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** called for each stdout and stderr line (carriage-return progress counts as a line too) */
  onLine?(line: string, stream: 'stdout' | 'stderr'): void;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** bytes of stdout to keep in `stdout`; 0 (default) keeps none */
  captureStdout?: number;
  /** gets the child's pid right after spawn */
  onSpawn?(pid: number): void;
}
export interface RunResult {
  /** null when the process was killed by a signal or never started */
  code: number | null;
  timedOut: boolean;
  aborted: boolean;
  pid: number | null;
  /** set when the process could not be started (e.g. ENOENT) */
  spawnError?: string;
  stdout: Buffer;
}

/** True when a process with this pid exists and is not a zombie. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
  try {
    const state = String(execFileSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' })).trim();
    return state !== '' && !state.startsWith('Z');
  } catch {
    return false; // ps exits non-zero when the pid is gone
  }
}

function killGroup(pid: number): void {
  try { process.kill(-pid, 'SIGKILL'); } catch { /* group already gone */ }
  try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
}

/**
 * Spawns without a shell in its own process group, streams stdout and stderr line by line, and kills the group on
 * timeout or abort. Never throws for a non-zero exit.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    if (opts.signal?.aborted) {
      resolve({ code: null, timedOut: false, aborted: true, pid: null, stdout: Buffer.alloc(0) });
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: null, timedOut: false, aborted: false, pid: null, spawnError: String(e), stdout: Buffer.alloc(0) });
      return;
    }
    let timedOut = false;
    let aborted = false;
    let done = false;
    const keep: Buffer[] = [];
    let kept = 0;
    const cap = opts.captureStdout ?? 0;
    const pid = child.pid ?? null;
    if (pid !== null) opts.onSpawn?.(pid);

    const finish = (r: Omit<RunResult, 'stdout' | 'timedOut' | 'aborted' | 'pid'>): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ ...r, timedOut, aborted, pid, stdout: Buffer.concat(keep) });
    };

    const lineSplitter = (stream: 'stdout' | 'stderr') => {
      let buf = '';
      return (chunk: Buffer): void => {
        if (stream === 'stdout' && cap > 0 && kept < cap) {
          const take = chunk.subarray(0, cap - kept);
          keep.push(take);
          kept += take.length;
        }
        if (!opts.onLine) return;
        buf += chunk.toString('utf8');
        const parts = buf.split(/\r\n|\n|\r/);
        buf = parts.pop() ?? '';
        for (const l of parts) if (l) opts.onLine(l, stream);
      };
    };
    child.stdout?.on('data', lineSplitter('stdout'));
    child.stderr?.on('data', lineSplitter('stderr'));

    const onAbort = (): void => { aborted = true; if (pid) killGroup(pid); };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = opts.timeoutMs && opts.timeoutMs > 0
      ? setTimeout(() => { timedOut = true; if (pid) killGroup(pid); }, opts.timeoutMs)
      : null;

    child.on('error', (e) => finish({ code: null, spawnError: String(e) }));
    // 'close' fires after stdio is drained
    child.on('close', (code) => finish({ code }));
  });
}
