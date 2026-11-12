// Owned by C5. Saving, loading and the dev scene API (SPEC 2.2 E1, E8, 8.2). `prepareSave` and the proposal readers are
// pure so the headless tests can run them; the fetch helpers only touch `fetch`.
import { CHARACTER_RADIUS_M } from '../types';
import type { FurnitureItem, Grid, PropertyFile, RoomTag, Opening, Finishes } from '../types';
import { circleFree } from '../core/grid-query';
import { validateLayout, validateProperty } from '../core/layout-validate';
import type { EditorContext } from './context';

export const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/;
export const SCENE_ID_HINT = 'Use lowercase letters, digits and dashes, up to 40 characters.';
export function sceneIdValid(id: string): boolean {
  return SCENE_ID_RE.test(id);
}

// ---------------------------------------------------------------- prepare a save

export interface SavePlan {
  /** blocking */
  errors: string[];
  warnings: string[];
  /** set when there are no errors: the validated, JSON-clean property */
  property: PropertyFile | null;
  /** the exact text the dev API receives and the download contains */
  body: string | null;
}

/** Spawn message the editor uses everywhere (the same words as C6's spawn step). */
export const SPAWN_MESSAGE = 'Pick a spot on the floor, away from walls.';

/**
 * Everything Save checks (2.2 E8): at least one room, no layout errors (5.5), a spawn point on a walkable cell.
 * On success `body` is `JSON.stringify(validateProperty(draft clone))`, so the file the buyer reads is exactly the
 * round trip of the draft (clockwise rooms normalised, defaults filled), with `updatedAt` set to `now`.
 */
export function prepareSave(draft: PropertyFile, grid: Grid, now: Date = new Date()): SavePlan {
  const errors: string[] = [];
  const { errors: layoutErrors, warnings } = validateLayout(draft.layout);
  errors.push(...layoutErrors);
  if (draft.layout.rooms.length === 0) errors.push('Draw at least one room before saving.');
  if (!sceneIdValid(draft.id)) errors.push(`Scene id "${draft.id}" is not valid. ${SCENE_ID_HINT}`);
  // SPEC-GAP: 2.2 E8 requires a spawn on a walkable cell but createEmptyProperty puts it at (0, 0), so a fresh draft cannot save until E8 (C6) sets one.
  if (draft.layout.rooms.length > 0 && !circleFree(grid, draft.spawn.x, draft.spawn.z, CHARACTER_RADIUS_M)) {
    errors.push(`The spawn point is not on a walkable spot. ${SPAWN_MESSAGE}`);
  }
  if (errors.length > 0) return { errors, warnings, property: null, body: null };
  let property: PropertyFile;
  try {
    const clone = JSON.parse(JSON.stringify({ ...draft, updatedAt: now.toISOString() })) as unknown;
    property = validateProperty(clone);
  } catch (err) {
    return { errors: [err instanceof Error ? err.message : String(err)], warnings, property: null, body: null };
  }
  return { errors, warnings, property, body: JSON.stringify(property, null, 2) + '\n' };
}

// ---------------------------------------------------------------- proposals (Phase 2 plug and C8, SPEC 3.3 and 13.4)

export interface ProposalPatch {
  rooms: RoomTag[];
  openings: Opening[];
  wallHeightM?: number;
  finishes?: Partial<Finishes>;
  /** from proposal-extras.json, already validated; empty when absent or unreadable */
  furniture: FurnitureItem[];
  spawn: { x: number; z: number; yawDeg: number } | null;
  /** proposal.json notes plus proposal-extras.json warnings, as plain text */
  notes: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0) : []);

/** The warning lines of a proposal-extras.json, defensively: anything that is not a list of strings is ignored. */
export function extrasWarnings(extras: unknown): string[] {
  return isObj(extras) ? strings(extras.warnings) : [];
}

/**
 * Reads a `LayoutProposal` (and, when given, its `proposal-extras.json` sidecar). The structural checks, clockwise
 * normalisation and opening remapping are the ones `validateProperty` does, so a proposal can never put the editor
 * in a state a saved file could not. Throws an Error with a readable message when the proposal is unusable.
 * Unknown fields are ignored; unreadable furniture or spawn in the extras are dropped, not fatal.
 */
export function proposalToPatch(proposal: unknown, extras?: unknown): ProposalPatch {
  if (!isObj(proposal)) throw new Error('proposal.json must be a JSON object.');
  if (!Array.isArray(proposal.rooms)) throw new Error('proposal.json has no list of rooms.');
  const openings = Array.isArray(proposal.openings) ? proposal.openings : [];
  const baseLayout: Record<string, unknown> = { rooms: proposal.rooms, openings, scaleSource: 'plan-dimensions' };
  if (typeof proposal.wallHeightM === 'number') baseLayout.wallHeightM = proposal.wallHeightM;
  if (isObj(proposal.finishes)) baseLayout.finishes = proposal.finishes;
  const base = { version: 1, id: 'proposal', layout: baseLayout, spawn: { x: 0, z: 0, yawDeg: 0 } };
  let checked: PropertyFile;
  try {
    checked = validateProperty(base);
  } catch (err) {
    throw new Error(`proposal.json: ${(err instanceof Error ? err.message : String(err)).replace(/^property\.json: /, '')}`);
  }
  const notes = [...strings(proposal.notes), ...extrasWarnings(extras)];

  let furniture: FurnitureItem[] = [];
  let spawn: ProposalPatch['spawn'] = null;
  if (isObj(extras)) {
    if (Array.isArray(extras.furniture) && extras.furniture.length > 0) {
      try {
        furniture = validateProperty({ ...base, furniture: extras.furniture }).furniture;
      } catch {
        notes.push('The furniture in proposal-extras.json could not be read, so it was left out.');
      }
    }
    const sp = extras.spawn;
    if (isObj(sp) && typeof sp.x === 'number' && typeof sp.z === 'number') {
      spawn = { x: sp.x, z: sp.z, yawDeg: typeof sp.yawDeg === 'number' ? sp.yawDeg : 0 };
    }
  }
  return {
    rooms: checked.layout.rooms,
    openings: checked.layout.openings,
    wallHeightM: typeof proposal.wallHeightM === 'number' ? checked.layout.wallHeightM : undefined,
    finishes: isObj(proposal.finishes) ? (proposal.finishes as Partial<Finishes>) : undefined,
    furniture,
    spawn,
    notes,
  };
}

/**
 * Drops a proposal into the draft. Rooms and openings always replace what is there (the caller confirms first). Furniture
 * and spawn from the extras are taken only for a fresh draft (no rooms before), so a broker's own work is never overwritten.
 */
export function applyProposal(draft: PropertyFile, patch: ProposalPatch): void {
  const fresh = draft.layout.rooms.length === 0;
  draft.layout.rooms = patch.rooms;
  draft.layout.openings = patch.openings;
  if (patch.wallHeightM !== undefined) draft.layout.wallHeightM = patch.wallHeightM;
  if (patch.finishes) draft.layout.finishes = { ...draft.layout.finishes, ...patch.finishes };
  if (fresh) {
    if (patch.furniture.length > 0) draft.furniture = patch.furniture;
    if (patch.spawn) draft.spawn = patch.spawn;
  }
}

// ---------------------------------------------------------------- the dev API and static files

/** Replaces the draft's content in place, so anything holding `ctx.draft` keeps a live reference. */
export function replaceDraft(draft: PropertyFile, next: PropertyFile): void {
  for (const k of Object.keys(draft)) delete (draft as unknown as Record<string, unknown>)[k];
  Object.assign(draft, next);
}

/** GET a static scene file as JSON. Vite's dev server answers a missing file with index.html, so parse defensively. */
export async function fetchSceneJson(sceneId: string, name: string): Promise<unknown | null> {
  try {
    const res = await fetch(`/scenes/${sceneId}/${name}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trimStart().startsWith('{')) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function failText(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    return j.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

const NO_API = 'The dev API is not reachable. Saving into the scene folder needs `npm run dev`.';

/** The `ctx.api` of the contract (2.2, 7.1), against the Vite dev API of C0. */
export function createApi(getSceneId: () => string): EditorContext['api'] {
  const base = (): string => `/api/scenes/${getSceneId()}`;
  return {
    async saveProperty(p) {
      let res: Response;
      try {
        res = await fetch(`${base()}/property`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p, null, 2) + '\n' });
      } catch {
        throw new Error(NO_API);
      }
      if (!res.ok) throw new Error(`Saving property.json failed: ${await failText(res)}`);
    },
    async saveFile(name, data) {
      let res: Response;
      try {
        res = await fetch(`${base()}/file/${encodeURIComponent(name)}`, { method: 'PUT', body: data });
      } catch {
        throw new Error(NO_API);
      }
      if (!res.ok) throw new Error(`Saving ${name} failed: ${await failText(res)}`);
    },
    async exists(name) {
      try {
        const res = await fetch(`${base()}/files`, { cache: 'no-store' });
        if (!res.ok) return false;
        const list = (await res.json()) as unknown;
        return Array.isArray(list) && list.includes(name);
      } catch {
        return false;
      }
    },
  };
}

/** Hands a JSON text to the browser as a download (2.2 E8: Save also downloads the file). */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface SaveOutcome {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** set when the dev API write failed but the file was still downloaded */
  apiError?: string;
}

/** Validate, write through the dev API, and download. `download: false` is for automated checks. */
export async function saveDraft(
  draft: PropertyFile, grid: Grid, api: EditorContext['api'], opts?: { download?: boolean },
): Promise<SaveOutcome> {
  const plan = prepareSave(draft, grid);
  if (!plan.property || plan.body === null) return { ok: false, errors: plan.errors, warnings: plan.warnings };
  let apiError: string | undefined;
  try {
    await api.saveProperty(plan.property);
  } catch (err) {
    apiError = err instanceof Error ? err.message : String(err);
  }
  if (opts?.download !== false) downloadText('property.json', plan.body);
  if (!apiError) draft.updatedAt = plan.property.updatedAt;
  return { ok: !apiError, errors: [], warnings: plan.warnings, apiError };
}
