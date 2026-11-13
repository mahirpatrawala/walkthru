// Owned by C3. Interaction prompts and the three poses (SPEC 2.1): lie on the bed, sit on the sofa, stand at the
// counter, plus the plain "See dimensions" card for dining tables and wardrobes. The poses run in the 'pose' mode.
import { checkFor } from '../core/checks';
import { circleFree, nearestFree } from '../core/grid-query';
import { liePose, seatPose, standPose } from '../core/poses';
import { CHARACTER_RADIUS_M } from '../types';
import type { FurnitureItem, Vec2 } from '../types';
import type { BuyerContext, BuyerMode } from './context';
import { CHAIR_PROMPT } from './seats';
import type { Seats } from './seats';
import { toneColor } from './overlays';
import { actionFor, nearestInteractable } from './store';
import type { PoseAction } from './store';

const POSE_TAG = 'pose';
const DIMS_SHOW_MS = 6000;
/** Movement input above this ends a pose (once the keys have been released since the pose began). */
const MOVE_END = 0.2;

export interface PoseInfo {
  itemId: string;
  action: PoseAction;
  ready: boolean;
  tone: string;
}

export interface Interactions {
  /** the 'pose' mode, to register with the mode manager */
  mode: BuyerMode;
  /** per frame: refreshes the prompt pill */
  update(dt: number): void;
  /** E / tap on the pill: get up when posed, otherwise act on the nearest item. Resolves when the action is done. */
  interact(): Promise<string>;
  /** end the current pose (waits for it to be reached first). Resolves when the character stands again. */
  getUp(): Promise<void>;
  /** immediately end any pose and put the character at `to` (used by teleport) */
  cancelTo(to: Vec2): void;
  /** the character's height changed: redo the open pose and card at the new size */
  refresh(): void;
  /** the nearest interactable item right now, or null */
  nearest(): { item: FurnitureItem; distM: number } | null;
  pose(): PoseInfo | null;
  hideDims(): void;
}

/** Optional extras: a wardrobe that opens takes over the prompt and the action of its items (src/buyer/wardrobe.ts);
 *  seats are chairs that are not furniture-store items (src/buyer/seats.ts): they take part in nearest(), with their own card and pose. */
export interface InteractionExtras {
  seats?: Seats;
  wardrobe?: { promptFor(item: FurnitureItem): string | null; activate(item: FurnitureItem): boolean };
  /** a footnote for an item's card when part of what it shows is an assumption (e.g. a standard height), or null */
  cardNote?: (item: FurnitureItem) => string | null;
}

export function createInteractions(ctx: BuyerContext, extras: InteractionExtras = {}): Interactions {
  const R = CHARACTER_RADIUS_M;
  let gen = 0;
  interface Active {
    item: FurnitureItem; action: PoseAction; gen: number; ready: boolean; approach: Vec2;
    reached: Promise<void>; armed: boolean;
  }
  let active: Active | null = null;
  let dimsId: string | null = null;
  let dimsTimer: ReturnType<typeof setTimeout> | null = null;
  let promptClock = 0;

  const seats = extras.seats;
  const cardOf = (item: FurnitureItem, H: number) => {
    const card = seats?.card(item, H) ?? checkFor(item, H);
    const note = card.footer ? null : extras.cardNote?.(item) ?? null;
    return note ? { ...card, footer: note } : card;
  };
  const nearest = (): { item: FurnitureItem; distM: number } | null =>
    nearestInteractable(seats ? [...ctx.furniture.all(), ...seats.items()] : ctx.furniture.all(), ctx.character.position, undefined, ctx.grid());
  const freeToStand = (): boolean => {
    const s = ctx.character.state;
    return s === 'idle' || s === 'walk' || s === 'jog';
  };

  function hideDims(): void {
    if (dimsTimer) { clearTimeout(dimsTimer); dimsTimer = null; }
    if (dimsId !== null) {
      dimsId = null;
      if (!active) ctx.hud.hideCard();
    }
  }

  function showDims(item: FurnitureItem): void {
    hideDims();
    dimsId = item.id;
    ctx.hud.showCard(cardOf(item, ctx.heightM()));
    dimsTimer = setTimeout(hideDims, DIMS_SHOW_MS);
  }

  /** Card, outline and camera for an active pose, at the character's current height. */
  function present(a: Active, H: number): void {
    const item = a.item;
    const card = cardOf(item, H);
    ctx.hud.showCard(card);
    ctx.overlays.clear(POSE_TAG);
    if (a.action === 'lie') {
      const inner = item.inner ?? { w: item.box.w, d: item.box.d };
      ctx.overlays.outlineBox({ ...item.box, w: inner.w, d: inner.d }, item.surfaceHeightM + 0.012, toneColor(card.tone), POSE_TAG);
    }
  }

  function focusCamera(a: Active): void {
    const b = a.item.box;
    if (a.action === 'lie') {
      const len = (a.item.inner ?? b).d;
      // three-quarter view from the foot end, on the side the buyer stood
      const y = (b.yawDeg * Math.PI) / 180;
      const side = ((a.approach.x - b.cx) * Math.cos(y) - (a.approach.z - b.cz) * Math.sin(y)) >= 0 ? 1 : -1;
      ctx.camera.focusOn({ x: b.cx, y: a.item.surfaceHeightM, z: b.cz }, Math.max(2.2, 1.2 * len), 50, b.yawDeg + 180 + 30 * side);
    } else if (a.action === 'sit' && seats?.isSeat(a.item)) {
      // a chair often has its front against a desk or a wall: look from the first heading, front first, whose camera spot is clear
      const g = ctx.grid();
      const dist = 2.0;
      let heading = b.yawDeg + 180;
      for (const delta of [0, 45, -45, 90, -90, 135, -135, 180]) {
        const h = ((b.yawDeg + 180 + delta) * Math.PI) / 180;
        const clear = [0.8, 1.4, dist].every((r) => circleFree(g, b.cx - Math.sin(h) * r, b.cz - Math.cos(h) * r, 0.15));
        if (clear) { heading = b.yawDeg + 180 + delta; break; }
      }
      ctx.camera.focusOn({ x: b.cx, y: 0.7, z: b.cz }, dist, 20, heading);
    } else if (a.action === 'sit') {
      // from the front: the sofa's front (+a) is where the camera goes, so it looks back along -a
      ctx.camera.focusOn({ x: b.cx, y: 0.7, z: b.cz }, 2.4, 20, b.yawDeg + 180);
    }
  }

  async function runPose(a: Active, H: number): Promise<void> {
    const item = a.item;
    const c = ctx.character;
    if (a.action === 'lie') await c.lie(liePose(item, H, a.approach));
    else if (a.action === 'sit') await c.sit(seats?.pose(item, H) ?? seatPose(item, H, a.approach));
    else await c.standAt(standPose(item, H, a.approach));
  }

  async function startPose(item: FurnitureItem, action: PoseAction): Promise<void> {
    hideDims();
    const myGen = ++gen;
    ctx.setMode('pose');
    const H = ctx.heightM();
    const a: Active = {
      item, action, gen: myGen, ready: false, approach: ctx.character.position,
      reached: Promise.resolve(), armed: Math.hypot(ctx.input.moveX, ctx.input.moveY) < 0.1,
    };
    active = a;
    present(a, H);
    focusCamera(a);
    a.reached = (async () => {
      try {
        await runPose(a, H);
      } catch (err) {
        console.error('[walkthru] pose failed', err);
        ctx.hud.toast('Could not start that pose.');
        if (active === a) void releaseNow(true);
        return;
      }
      if (active === a) a.ready = true;
    })();
    await a.reached;
  }

  /** Ends the pose now (idempotent). `switchMode` is false when called from the pose mode's own exit(). */
  async function releaseNow(switchMode: boolean): Promise<void> {
    const a = active;
    if (!a) return;
    active = null;
    gen++;
    ctx.camera.releaseFocus();
    ctx.overlays.clear(POSE_TAG);
    ctx.hud.hideCard();
    ctx.hud.setPrompt(null);
    const grid = ctx.grid();
    const p = ctx.character.position;
    const to = nearestFree(grid, p.x, p.z, R)
      ?? (circleFree(grid, a.approach.x, a.approach.z, R) ? a.approach : { x: ctx.property.spawn.x, z: ctx.property.spawn.z });
    if (switchMode) ctx.setMode('walk');
    await ctx.character.release(to);
  }

  async function getUp(): Promise<void> {
    const a = active;
    if (!a) return;
    if (!a.ready) await a.reached;
    if (active !== a) return;
    await releaseNow(true);
  }

  async function interact(): Promise<string> {
    if (active) {
      await getUp();
      return 'getup';
    }
    if (dimsId !== null) {
      const same = nearest()?.item.id === dimsId;
      hideDims();
      if (same) return 'dims-hidden';
    }
    if (ctx.mode() !== 'walk' || !freeToStand()) return 'none';
    const n = nearest();
    if (!n) return 'none';
    if (extras.wardrobe?.activate(n.item)) return 'wardrobe';
    const { action } = actionFor(n.item.kind);
    if (action === 'dims') {
      showDims(n.item);
      return 'dims';
    }
    await startPose(n.item, action);
    return action;
  }

  const mode: BuyerMode = {
    id: 'pose',
    enter() { /* startPose sets everything up */ },
    exit() { void releaseNow(false); },
    update() {
      const a = active;
      if (!a) return;
      const m = Math.hypot(ctx.input.moveX, ctx.input.moveY);
      if (!a.armed) { if (m < 0.1) a.armed = true; return; }
      if (m > MOVE_END) void getUp();
    },
  };

  return {
    mode,
    update(dt) {
      promptClock += dt;
      if (promptClock < 0.08) return;
      promptClock = 0;
      const h = ctx.hud;
      if (active) {
        if (active.ready) h.setPrompt(actionFor(active.item.kind).upPrompt, () => { void getUp(); });
        else h.setPrompt(null);
        return;
      }
      if (ctx.mode() !== 'walk' || !freeToStand()) { h.setPrompt(null); return; }
      const n = nearest();
      // moving away, or ending up beside something else, closes the dimensions card
      if (dimsId !== null && (Math.hypot(ctx.input.moveX, ctx.input.moveY) > MOVE_END || n?.item.id !== dimsId)) hideDims();
      if (!n) { h.setPrompt(null); return; }
      h.setPrompt(extras.wardrobe?.promptFor(n.item) ?? (seats?.isSeat(n.item) ? CHAIR_PROMPT : actionFor(n.item.kind).prompt), () => { void interact(); });
    },
    interact,
    getUp,
    cancelTo(to) {
      const a = active;
      hideDims();
      if (a) {
        active = null;
        gen++;
        ctx.camera.releaseFocus();
        ctx.overlays.clear(POSE_TAG);
        ctx.hud.hideCard();
        ctx.setMode('walk');
      }
      void ctx.character.release(to);
    },
    refresh() {
      const a = active;
      if (a) {
        const H = ctx.heightM();
        present(a, H);
        focusCamera(a);
        // the body keeps its old size mid-pose: ask for the pose again at the new one
        a.ready = false;
        const myGen = ++gen;
        a.gen = myGen;
        a.reached = (async () => {
          try { await runPose(a, H); } catch (err) { console.error('[walkthru] re-pose failed', err); return; }
          if (active === a && a.gen === myGen) a.ready = true;
        })();
      } else if (dimsId !== null) {
        const it = ctx.furniture.all().find((i) => i.id === dimsId);
        if (it) ctx.hud.showCard(cardOf(it, ctx.heightM()));
      }
    },
    nearest,
    pose() {
      return active
        ? { itemId: active.item.id, action: active.action, ready: active.ready, tone: cardOf(active.item, ctx.heightM()).tone }
        : null;
    },
    hideDims,
  };
}
