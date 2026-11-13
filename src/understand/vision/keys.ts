// C12d. SPEC 17.8 "Keys". The only places a key may come from:
//   Gemini:    ~/walkthru-tools/.gemini-key, or on a server the env WALKTHRU_GEMINI_KEY or GEMINI_API_KEY
//   Anthropic: ~/walkthru-tools/.anthropic-key, or WALKTHRU_ANTHROPIC_KEY. The generic ANTHROPIC_API_KEY is NEVER used:
//              if it is the only key in sight the run refuses and says why.
// No other file or variable is read. A key is never logged, never put in a URL, never in an error message.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VisionError } from './provider';

export interface KeySource { key: string; /** where it came from, safe to print */ from: string }
export interface KeyEnv { home?: string; env?: Record<string, string | undefined>; readFile?: (p: string) => string | null }

export const TOOLS_DIR = (home = os.homedir()): string => path.join(home, 'walkthru-tools');
export const GEMINI_KEY_FILE = (home?: string): string => path.join(TOOLS_DIR(home), '.gemini-key');
export const ANTHROPIC_KEY_FILE = (home?: string): string => path.join(TOOLS_DIR(home), '.anthropic-key');

const defaultRead = (p: string): string | null => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const clean = (s: string | null | undefined): string | null => { const t = (s ?? '').trim(); return t && !/\s/.test(t) ? t : null; };

/** `allowEnv: false` makes a local run use the key file only, so a stray variable in a shell can never be picked up. */
export function resolveGeminiKey(opts: KeyEnv & { allowEnv?: boolean } = {}): KeySource | null {
  const read = opts.readFile ?? defaultRead;
  const file = GEMINI_KEY_FILE(opts.home);
  const f = clean(read(file));
  if (f) return { key: f, from: `file ${file}` };
  if (opts.allowEnv === false) return null;
  const env = opts.env ?? process.env;
  for (const name of ['WALKTHRU_GEMINI_KEY', 'GEMINI_API_KEY']) { const v = clean(env[name]); if (v) return { key: v, from: `env ${name}` }; }
  return null;
}

export function resolveAnthropicKey(opts: KeyEnv = {}): KeySource {
  const read = opts.readFile ?? defaultRead;
  const file = ANTHROPIC_KEY_FILE(opts.home);
  const f = clean(read(file));
  if (f) return { key: f, from: `file ${file}` };
  const env = opts.env ?? process.env;
  const w = clean(env.WALKTHRU_ANTHROPIC_KEY);
  if (w) return { key: w, from: 'env WALKTHRU_ANTHROPIC_KEY' };
  if (clean(env.ANTHROPIC_API_KEY)) {
    throw new VisionError('no-key', `Refusing to start: the only Anthropic key found is the generic ANTHROPIC_API_KEY, which belongs to other work. Put this project's own key in ${file} or set WALKTHRU_ANTHROPIC_KEY.`);
  }
  throw new VisionError('no-key', `No Anthropic key for the Claude provider. Put one in ${file} or set WALKTHRU_ANTHROPIC_KEY.`);
}

/** Remove a key from any text before it is shown or logged. */
export const redact = (text: string, key: string): string => (key ? text.split(key).join('[key]') : text);
