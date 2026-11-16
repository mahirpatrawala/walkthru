// Doors (buyer): a real leaf in every door opening. It starts shut (except the doors of the room the walker starts in), swings or
// slides when the walker presses E / taps the pill, and is a solid thing: a shut leaf closes the doorway on the walk grid, an open
// one frees the doorway and blocks the floor the panel covers, and the leaf never moves through the walker, a wall, furniture or
// another door, in any state. See core/doors.ts for the geometry and the data (`Opening.leaf`).
//
// Collision: the leaves are temporary obstacles of the furniture store under the key 'doors' (the same mechanism as an open wardrobe's
// shutters and the chairs): thin boxes stamped over the cached layout grid, so only the stamp is redone, never the layout raster.
// Each frame a moving leaf advances in steps of at most 1.5 degrees; before each step the new panel is checked against the walls and
// furniture (a grid without this door's own stamp), the other doors' panels and the walker. If anything is in the way the leaf stays
// where it is and the buyer is told. The walker's distance to the panel never falls under the body radius + half the stamped strip,
// so the walk grid and the leaf never overlap.
import * as THREE from 'three';
import { CHARACTER_RADIUS_M, GRID_TALL_CM } from '../types';
import type { Box, CheckCard, Grid, Layout, Tone, Vec2 } from '../types';
import {
  DOOR_OPEN_RAD, DOOR_STANDARD_HEIGHT_M, DOOR_SWING_SECONDS, DOOR_THICKNESS_M, DOOR_SWING_ASSUMED_NOTE, DOOR_WALKER_MARGIN_M,
  distanceToLeaf, doorBlockSentence, freePos, leafHitsGrid, leafObstacle, leavesTouch, resolveDoors,
} from '../core/doors';
import type { Door } from '../core/doors';
import { roomAt } from '../core/layout-geom';
import { distanceToSegment } from '../core/geometry';
import { cellValue } from '../core/grid-codec';
import { circleFree, nearestFree } from '../core/grid-query';
import type { BuyerContext } from './context';
import { setDoorPrompts } from './door-hooks';
import { buildDoorModel } from './doors-model';
import type { DoorModel } from './doors-model';
import type { DoorStyle } from '../building/space-host';
import { setDoorSwingProvider } from './wardrobe-hooks';
import type { FurnitureStoreImpl } from './store';

const DEG = Math.PI / 180;
/** The pill shows within this distance of the doorway, metres. */
export const DOOR_REACH_M = 1.15;
/** The detail card stays this long after a door is used, ms. */
const CARD_MS = 6000;
/** Longest single step of a moving leaf: radians for a hinged one, metres for a sliding one. */
const STEP_HINGED = 1.5 * DEG;
const STEP_SLIDING = 0.03;
const TOAST_GAP_S = 1.6;

export const MSG_IN_THE_WAY = 'Something is in the way of this door.';
export const MSG_STEP_BACK = 'Something is in the way of this door. Step back.';
export const MSG_NO_SPACE = 'This door opens onto space the drawing does not show.';
export const STANDARD_DOOR_NOTE = `Height (${DOOR_STANDARD_HEIGHT_M.toFixed(2)} m) and thickness (${Math.round(DOOR_THICKNESS_M * 1000)} mm) are standard assumptions. The drawing does not give them.`;

export type DoorState = 'shut' | 'opening' | 'open' | 'closing' | 'ajar';
export type StopReason = 'walker' | 'furniture' | 'door' | 'wall' | 'void' | null;

export interface DoorReading {
  id: string;
  roomLabel: string;
  kind: Door['kind'];
  hinge: Door['hinge'];
  swing: Door['swing'];
  assumed: boolean;
  /** radians for a hinged door, metres slid for a sliding one */
  pos: number;
  maxPos: number;
  state: DoorState;
  stopReason: StopReason;
  prompt: string;
}

export interface Doors {
  /** the pill text for the door nearest `p`, or null */
  prompt(p: Vec2): string | null;
  update(dt: number): void;
  debug: {
    ids(): string[];
    door(id: string): Door | null;
    read(id: string): DoorReading | null;
    /** swing it open; resolves when the leaf stands still (open as far as it can go, or stopped) */
    open(id: string): Promise<DoorReading | null>;
    close(id: string): Promise<DoorReading | null>;
    card(id: string): CheckCard | null;
    noteFor(box: Box): string | null;
    /** the leaf's obstacle boxes right now, for tests and screenshots */
    obstacles(): { id: string; box: Box; heightM: number }[];
  };
  /** the active style's door finish (a colour), or null for the default teak laminate */
  setPanelColour(hex: string | null): void;
  /** the style's door finish (colour and grain) and hardware colour (SPEC 16.18) */
  setPanelFinish(f: { colour: string; grain: boolean } | null): void;
  setHandleColour(hex: string | null): void;
  dispose(): void;
}

interface Rec {
  door: Door;
  model: DoorModel;
  pos: number;
  target: number;
  /** what the walker last asked for */
  intent: 'open' | 'close';
  stuck: boolean;
  stopReason: StopReason;
  waiters: (() => void)[];
}

const cm = (m: number): number => Math.round(m * 100);

/** The card for a door: the facts, and what the drawing did not give. */
export function doorCard(d: Door, state: DoorState, stopReason: StopReason, swingRoomLabel: string | null): CheckCard {
  const lines: string[] = [];
  lines.push(`${cm(d.widthM)} cm wide opening.`);
  if (d.kind === 'sliding') lines.push(`A sliding leaf, parked along the wall on the ${d.swing === 'in' ? d.roomLabel : 'other'} side.`);
  else lines.push(swingRoomLabel ? `Swings into ${swingRoomLabel}.` : 'Swings outward, onto space the drawing does not show.');
  if (d.assumed) lines.push(`${DOOR_SWING_ASSUMED_NOTE}.`);
  else lines.push(d.kind === 'sliding' ? 'Sliding door from the drawing.' : 'Swing side and hinge from the drawing’s door arc.');
  lines.push(d.heightFrom === 'drawing'
    ? `Height ${d.headM.toFixed(2)} m from the drawing. Thickness (${Math.round(DOOR_THICKNESS_M * 1000)} mm) is a standard assumption. The drawing does not give it.`
    : STANDARD_DOOR_NOTE);
  let headline: string;
  let tone: Tone = 'good';
  if (stopReason && (state === 'ajar')) {
    tone = 'warn';
    headline = stopReason === 'void' ? 'This door cannot open here.' : 'This door is stopped.';
    lines.unshift(stopReason === 'walker' ? MSG_STEP_BACK : stopReason === 'void' ? MSG_NO_SPACE : MSG_IN_THE_WAY);
  } else if (state === 'open' || state === 'opening') headline = d.kind === 'sliding' ? 'Door slid open.' : 'Door open.';
  else if (state === 'ajar') headline = 'Door part open.';
  else headline = 'Door shut.';
  return { title: `${d.roomLabel} door`, tone, headline, lines, footer: 'Door style is illustrative. Width is from the drawing.' };
}

export function createDoors(deps: { ctx: BuyerContext; store: FurnitureStoreImpl; layout: Layout; parent: THREE.Object3D; frameColor?: string; /** false: every door starts shut (tests) */ startOpen?: boolean; /** a building's doors: opening id -> how the leaf looks */ looks?: ReadonlyMap<string, DoorStyle> }): Doors {
  const { ctx, store, layout, parent } = deps;
  const frameColor = deps.frameColor ?? layout.finishes.frameColor;
  const KEY = 'doors';
  const recs = new Map<string, Rec>();
  const label = (id: string | null): string | null => (id ? layout.rooms.find((r) => r.id === id)?.label ?? id : null);

  for (const door of resolveDoors(layout)) {
    const model = buildDoorModel(door, frameColor, deps.looks?.get(door.id));
    parent.add(model.group);
    recs.set(door.id, { door, model, pos: 0, target: 0, intent: 'close', stuck: false, stopReason: null, waiters: [] });
  }

  // ---------------------------------------------------------------- the walk grid

  let selfChange = 0;
  let staticGrid: Grid | null = null;
  let layoutGrid: Grid | null = null;
  const offChange = store.onChange(() => { if (selfChange === 0) staticGrid = null; });
  /** walls + furniture + chairs + wardrobe shutters, without any door leaf */
  const statics = (): Grid => (staticGrid ??= store.gridExcludingTemporary([KEY]));
  /** walls only (nothing the buyer or the drawing put in the rooms) */
  const walls = (): Grid => (layoutGrid ??= store.gridWithout(store.all().map((i) => i.id), false));

  function stamp(): void {
    const list = [...recs.values()].map((r) => leafObstacle(r.door, r.pos));
    selfChange++;
    try { store.setTemporary(KEY, list); } finally { selfChange--; }
    // a walker standing where a leaf now is would be stuck inside it: step out to the nearest free spot
    const p = ctx.character.position;
    const g = store.grid();
    if (!circleFree(g, p.x, p.z, CHARACTER_RADIUS_M)) {
      const free = nearestFree(g, p.x, p.z, CHARACTER_RADIUS_M, 2);
      if (free) ctx.character.position = free;
    }
  }
  stamp();

  // ---------------------------------------------------------------- moving a leaf

  const speedOf = (d: Door): number => (d.kind === 'sliding' ? Math.max(0.5, d.maxPos) : DOOR_OPEN_RAD) / DOOR_SWING_SECONDS;
  const stepOf = (d: Door): number => (d.kind === 'sliding' ? STEP_SLIDING : STEP_HINGED);
  const stateOf = (r: Rec): DoorState => {
    const moving = Math.abs(r.target - r.pos) > 1e-6;
    if (r.stuck) return r.pos > 1e-6 ? 'ajar' : 'shut';
    if (moving) return r.target > r.pos ? 'opening' : 'closing';
    if (r.pos <= 1e-6) return 'shut';
    return r.pos >= r.door.maxPos - 1e-6 || r.intent === 'open' ? 'open' : 'ajar';
  };

  function readingOf(r: Rec): DoorReading {
    return {
      id: r.door.id, roomLabel: r.door.roomLabel, kind: r.door.kind, hinge: r.door.hinge, swing: r.door.swing, assumed: r.door.assumed,
      pos: r.pos, maxPos: r.door.maxPos, state: stateOf(r), stopReason: r.stopReason, prompt: promptOf(r),
    };
  }
  function promptOf(r: Rec): string {
    if (r.stuck) return r.stopReason !== null && r.intent === 'open' ? 'Open door' : 'Close door';
    return r.target > 1e-6 ? 'Close door' : 'Open door';
  }

  /** What stops the leaf from going to `next`, or null. The walker only stops a leaf that is getting nearer to it. */
  function blocker(r: Rec, next: number): StopReason {
    const d = r.door;
    const hit = leafHitsGrid(statics(), d, next);
    if (hit === 'void') return 'void';
    if (hit === 'obstacle') {
      // the same leaf against the bare walls: if it is clear there, furniture (or a wardrobe's shutter, a chair) is what stops it
      return leafHitsGrid(walls(), d, next) === 'free' ? 'furniture' : 'wall';
    }
    for (const o of recs.values()) if (o !== r && leavesTouch(d, next, o.door, o.pos)) return 'door';
    const w = ctx.character.position;
    const dNext = distanceToLeaf(d, next, w);
    if (dNext < DOOR_WALKER_MARGIN_M && dNext <= distanceToLeaf(d, r.pos, w) + 1e-6) return 'walker';
    return null;
  }

  let toastClock = 0;
  function say(text: string): void {
    if (toastClock > 0) return;
    toastClock = TOAST_GAP_S;
    ctx.hud.toast(text);
  }
  const messageFor = (why: StopReason): string => (why === 'walker' ? MSG_STEP_BACK : why === 'void' ? MSG_NO_SPACE : MSG_IN_THE_WAY);

  function settle(r: Rec): void {
    for (const w of r.waiters.splice(0)) w();
  }

  let cardFor: string | null = null;
  let cardTimer: ReturnType<typeof setTimeout> | null = null;
  function showCard(r: Rec): void {
    const swingRoom = label(r.door.swingRoomId);
    ctx.hud.showCard(doorCard(r.door, stateOf(r), r.stopReason, swingRoom));
    cardFor = r.door.id;
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = setTimeout(hideCard, CARD_MS);
  }
  function hideCard(): void {
    if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }
    if (cardFor !== null) { cardFor = null; ctx.hud.hideCard(); }
  }

  function advance(r: Rec, dt: number): boolean {
    if (Math.abs(r.target - r.pos) < 1e-9) { if (r.waiters.length) settle(r); return false; }
    const dir = Math.sign(r.target - r.pos);
    let budget = speedOf(r.door) * dt;
    const sub = stepOf(r.door);
    let moved = false;
    while (budget > 1e-9 && Math.abs(r.target - r.pos) > 1e-9) {
      const inc = Math.min(budget, sub, Math.abs(r.target - r.pos));
      const next = r.pos + dir * inc;
      const why = blocker(r, next);
      if (why) {
        r.target = r.pos;
        r.stuck = true;
        r.stopReason = why;
        say(messageFor(why));
        if (cardFor === r.door.id) showCard(r);
        break;
      }
      r.pos = next;
      budget -= inc;
      moved = true;
    }
    if (Math.abs(r.target - r.pos) < 1e-9) {
      if (!r.stuck && r.target > 0) r.pos = r.target;
      if (Math.abs(r.pos) < 1e-9) r.pos = 0;
      settle(r);
    }
    if (moved) r.model.setPos(r.pos);
    return moved;
  }

  /** Swing a door open as far as the walls and furniture allow (the walker is dealt with while it moves). */
  function open(r: Rec): void {
    r.intent = 'open';
    r.stuck = false;
    r.stopReason = null;
    if (r.pos >= r.door.maxPos - 1e-9) { r.target = r.pos; return; }
    const all = freePos(statics(), r.door, r.pos);
    const bare = freePos(walls(), r.door, r.pos);
    r.target = all.pos;
    if (all.pos <= r.pos + 1e-9) {
      // it cannot move at all: say what is in the way
      r.stopReason = all.hit === 'void' || bare.hit === 'void' ? 'void' : bare.pos > all.pos + 1e-9 ? 'furniture' : 'wall';
      r.stuck = true;
      r.target = r.pos;
      say(messageFor(r.stopReason));
    } else if (all.pos < bare.pos - STEP_HINGED - 1e-9 && r.door.kind === 'hinged') {
      // it opens, but furniture stops it short of where the walls would: say so, then it rests there
      say(MSG_IN_THE_WAY);
    }
  }

  function close(r: Rec): void {
    r.intent = 'close';
    r.stuck = false;
    r.stopReason = null;
    r.target = 0;
  }

  /** E / tap: do what the pill says. */
  function toggle(r: Rec): void {
    if (promptOf(r) === 'Close door') close(r); else open(r);
    showCard(r);
  }

  /** the doorway's centre line (the mid-plane of the wall, jamb to jamb) */
  const doorway = (r: Rec): { a: Vec2; b: Vec2 } => {
    const d = r.door;
    return {
      a: { x: d.edgeA.x + d.dir.x * d.u0 + d.out.x * (d.depth / 2), z: d.edgeA.z + d.dir.z * d.u0 + d.out.z * (d.depth / 2) },
      b: { x: d.edgeA.x + d.dir.x * d.u1 + d.out.x * (d.depth / 2), z: d.edgeA.z + d.dir.z * d.u1 + d.out.z * (d.depth / 2) },
    };
  };
  const reachOf = (r: Rec, p: Vec2): number => { const w = doorway(r); return distanceToSegment(p, w.a, w.b); };
  /** A door behind a wall (the next room, round a corner) is not offered: march to the doorway and stop short of the leaf's own cells. */
  function inSight(r: Rec, p: Vec2): boolean {
    const w = doorway(r);
    const ux = w.b.x - w.a.x, uz = w.b.z - w.a.z;
    const L2 = ux * ux + uz * uz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - w.a.x) * ux + (p.z - w.a.z) * uz) / L2));
    const q = { x: w.a.x + ux * t, z: w.a.z + uz * t };
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len <= 0.15) return true;
    const g = store.grid();
    for (let s = 0; s < len - 0.12; s += g.cellM / 2) {
      if (cellValue(g, p.x + ((q.x - p.x) * s) / len, p.z + ((q.z - p.z) * s) / len) >= GRID_TALL_CM) return false;
    }
    return true;
  }
  function nearestRec(p: Vec2): { rec: Rec; distM: number } | null {
    let best: { rec: Rec; distM: number } | null = null;
    for (const r of recs.values()) {
      const distM = reachOf(r, p);
      if (distM <= DOOR_REACH_M && (!best || distM < best.distM) && inSight(r, p)) best = { rec: r, distM };
    }
    return best;
  }

  // ---------------------------------------------------------------- the first frame: the start room's doors stand open

  let started = deps.startOpen === false;
  function startRoomOpen(): void {
    started = true;
    const room = roomAt(layout, ctx.character.position);
    if (!room) return;
    for (const r of recs.values()) {
      if (!r.door.rooms.includes(room.id)) continue;
      const fp = freePos(statics(), r.door, 0);
      r.intent = 'open';
      r.pos = r.target = fp.pos;
      r.model.setPos(r.pos);
    }
    stamp();
  }

  // ---------------------------------------------------------------- per frame

  function update(dt: number): void {
    if (!started) startRoomOpen();
    toastClock = Math.max(0, toastClock - dt);
    let changed = false;
    for (const r of recs.values()) if (advance(r, dt)) changed = true;
    if (changed) stamp();
    // the card goes when the walker leaves the door
    if (cardFor !== null) {
      const r = recs.get(cardFor);
      if (!r || reachOf(r, ctx.character.position) > 3) hideCard();
    }
  }

  const unsubFrame = ctx.viewer.onFrame((dt) => update(dt));

  // ---------------------------------------------------------------- hooks for the prompt system and furnish mode

  const noteFor = (box: Box): string | null => {
    for (const r of recs.values()) {
      const s = doorBlockSentence(r.door, box);
      if (s) return s;
    }
    return null;
  };
  setDoorPrompts({
    nearest(p) {
      const n = nearestRec(p);
      return n ? { distM: n.distM, prompt: promptOf(n.rec) } : null;
    },
    activate(p) {
      const n = nearestRec(p);
      if (!n) return false;
      toggle(n.rec);
      return true;
    },
    noteFor,
  });
  setDoorSwingProvider((box) => noteFor(box));

  const run = (id: string, act: (r: Rec) => void): Promise<DoorReading | null> => {
    const r = recs.get(id);
    if (!r) return Promise.resolve(null);
    act(r);
    if (Math.abs(r.target - r.pos) < 1e-9) return Promise.resolve(readingOf(r));
    return new Promise((res) => { r.waiters.push(() => res(readingOf(r))); });
  };

  return {
    prompt: (p) => { const n = nearestRec(p); return n ? promptOf(n.rec) : null; },
    update,
    debug: {
      ids: () => [...recs.keys()],
      door: (id) => recs.get(id)?.door ?? null,
      read: (id) => { const r = recs.get(id); return r ? readingOf(r) : null; },
      open: (id) => run(id, (r) => { open(r); showCard(r); }),
      close: (id) => run(id, (r) => { close(r); showCard(r); }),
      card: (id) => { const r = recs.get(id); return r ? doorCard(r.door, stateOf(r), r.stopReason, label(r.door.swingRoomId)) : null; },
      noteFor,
      obstacles: () => [...recs.values()].map((r) => ({ id: r.door.id, ...leafObstacle(r.door, r.pos) })),
    },
    setPanelColour(hex) { for (const r of recs.values()) r.model.setPanelColour(hex); },
    setPanelFinish(f) { for (const r of recs.values()) r.model.setPanelFinish(f); },
    setHandleColour(hex) { for (const r of recs.values()) r.model.setHandleColour(hex); },
    dispose() {
      offChange();
      unsubFrame();
      setDoorPrompts(null);
      setDoorSwingProvider(null);
      hideCard();
      selfChange++;
      try { store.setTemporary(KEY, []); } finally { selfChange--; }
      for (const r of recs.values()) { r.model.dispose(); settle(r); }
      recs.clear();
    },
  };
}

/** The one line the buyer page needs: builds the doors, hooks them to the frame loop and the prompt system, and exposes them for the acceptance scripts. */
export function mountDoors(deps: { ctx: BuyerContext; store: FurnitureStoreImpl; layout: Layout; parent?: THREE.Object3D; frameColor?: string; looks?: ReadonlyMap<string, DoorStyle> }): Doors {
  const doors = createDoors({ ...deps, parent: deps.parent ?? deps.ctx.viewer.scene });
  (window as unknown as { __walkthruDoors?: Doors['debug'] }).__walkthruDoors = doors.debug;
  return doors;
}
