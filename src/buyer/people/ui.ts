// The people UI (SPEC 2.1, 16.6.9): the "Add a person" sheet (the walker's own sheet, reused), the placing flow (tap the floor to stand, a
// sofa or chair to sit, a bed to lie), and the card of a person with Move, Stand / Sit / Lie, Change person, Follow me, Become this
// person and Remove. Plain DOM; every word comes from this file or the person's own record, nothing from the home's files.
import { el } from '../hud';
import type { HudImpl } from '../hud';
import type { BuyerContext } from '../context';
import { createHeightPicker } from '../height';
import type { HeightPicker } from '../height';
import { BODY_DEFAULT_CM, PERSON_LABELS, clampPersonHeight } from '../person-store';
import type { FurnitureItem, Vec2 } from '../../types';
import { standBox } from './model';
import type { People, PersonSpec, Placement, WalkerPort } from './manager';
import type { PersonBodyId, PersonPose } from './rec';
import { PEOPLE_MAX } from './rec';
import './people.css';

const TAG = 'person-sel';
const SEL_COLOR = '#1E6B73';
/** the card closes when the walker is this far from the person it is about */
const CARD_RANGE_M = 6;

export interface PeopleUiDeps {
  ctx: BuyerContext;
  hud: HudImpl;
  people: People;
  walker: WalkerPort;
  parent: HTMLElement;
  /** another sheet is open, or the walker's own picker */
  otherBlocking?(): boolean;
}

export interface PeopleUi {
  /** the "Add a person" line on the walker's sheet */
  addOption(): { label(): string; enabled(): boolean; onClick(): void };
  openAdd(): void;
  /** a tap from the canvas: true when the people took it (placing, or a person was tapped) */
  handleTap(e: Parameters<BuyerContext['raycast']>[0], hit?: { kind: string; id: string } | null): boolean;
  /** a sheet of the people is open, or a person is being placed: the walker stands still, as for any sheet */
  blocking(): boolean;
  placing(): boolean;
  selected(): string | null;
  select(id: string | null): void;
  /** the person card or placing flow is dismissed because the mode changed */
  cancel(): void;
  update(dt: number): void;
  /** "2 people added by you. Not part of the home." or null */
  note(): string | null;
  dispose(): void;
}

export function peopleNote(total: number, shown: number): string | null {
  if (total === 0) return null;
  const base = `${total} ${total === 1 ? 'person' : 'people'} added by you. Not part of the home.`;
  return shown < total ? `${base} ${total - shown} not shown on this device.` : base;
}

export function createPeopleUi(deps: PeopleUiDeps): PeopleUi {
  const { ctx, hud, people, walker } = deps;

  let draft: PersonSpec = { body: 'woman', tone: 2, heightCm: BODY_DEFAULT_CM.woman };
  let placing: { spec: PersonSpec; moveId: string | null } | null = null;
  let selected: string | null = null;
  let editId: string | null = null;
  let selClock = 0;
  let ring: string | null = null;

  // ---------------------------------------------------------------- the sheets

  const startDraft = (): void => {
    const mine = walker.body().body;
    const pick = (['woman', 'man', 'child', 'elder'] as PersonBodyId[]).find((b) => b !== mine) ?? 'woman';
    draft = { body: pick, tone: walker.body().tone, heightCm: BODY_DEFAULT_CM[pick] };
  };

  const addPicker: HeightPicker = createHeightPicker(deps.parent, {
    title: 'Add a person',
    testId: 'add-person-sheet',
    goLabel: 'Place them',
    getCm: () => draft.heightCm,
    onChange: (cm) => { draft = { ...draft, heightCm: clampPersonHeight(draft.body, cm) }; },
    person: {
      get: () => ({ body: draft.body, tone: draft.tone }),
      onChange: (p) => {
        const bodyChanged = p.body !== draft.body;
        draft = { body: p.body, tone: p.tone, heightCm: bodyChanged ? BODY_DEFAULT_CM[p.body] : draft.heightCm };
        addPicker.syncPerson(p);
        addPicker.sync(draft.heightCm);
      },
    },
    onCancel: () => { hud.setVisible(true); },
    onClose: () => beginPlacing(draft, null),
  });

  const editPicker: HeightPicker = createHeightPicker(deps.parent, {
    title: 'Change this person',
    testId: 'change-person-sheet',
    goLabel: 'Done',
    getCm: () => (editId ? people.get(editId)?.heightCm ?? 170 : 170),
    onChange: (cm) => { if (editId) void people.change(editId, { heightCm: cm }); },
    person: {
      get: () => { const r = editId ? people.get(editId) : null; return { body: r?.body ?? 'woman', tone: r?.tone ?? 2 }; },
      onChange: (p) => {
        const id = editId;
        if (!id) return;
        void people.change(id, { body: p.body, tone: p.tone }).then(() => {
          const r = people.get(id);
          if (r) { editPicker.syncPerson({ body: r.body, tone: r.tone }); editPicker.sync(r.heightCm); }
        });
      },
    },
    onCancel: () => finishEdit(),
    onClose: () => finishEdit(),
  });

  function finishEdit(): void {
    const id = editId;
    editId = null;
    hud.setVisible(true);
    if (id && people.get(id)) select(id);
  }

  function openAdd(): void {
    if (people.count() >= people.cap()) { hud.toast(capMessage()); return; }
    closeCard();
    startDraft();
    hud.setVisible(false);
    addPicker.syncPerson({ body: draft.body, tone: draft.tone });
    addPicker.sync(draft.heightCm);
    addPicker.open(false);
  }

  function capMessage(): string {
    const cap = people.cap();
    return people.maxPeople() > cap
      ? `This device shows up to ${cap} added ${cap === 1 ? 'person' : 'people'}. Remove one to add another.`
      : `You can add up to ${PEOPLE_MAX} people.`;
  }

  // ---------------------------------------------------------------- placing

  function beginPlacing(spec: PersonSpec, moveId: string | null): void {
    placing = { spec, moveId };
    closeCard();
    hud.setVisible(true);
    hud.setModeBar(moveId ? 'Tap where they go: floor, sofa, chair or bed' : 'Floor to stand · sofa to sit · bed to lie', cancelPlacing);
  }

  function cancelPlacing(): void {
    if (!placing) return;
    const back = placing.moveId;
    placing = null;
    hud.setModeBar(null);
    if (back && people.get(back)) select(back);
  }

  /** What the tap means: a sofa, chair or bed under it, or the floor. */
  function placementAt(hit: { point: { x: number; y: number; z: number }; object: unknown } | null): { p: Placement } | { error: string } {
    if (!hit) return { error: 'Tap the floor, a sofa, a chair or a bed.' };
    const at: Vec2 = { x: hit.point.x, z: hit.point.z };
    if (hit.point.y > 0.12) {
      const item = people.hostAt(at);
      if (!item) return { error: 'Tap the floor, a sofa, a chair or a bed.' };
      return { p: { kind: 'host', item, action: item.kind === 'bed' ? 'lie' : 'sit', approach: at } };
    }
    return { p: { kind: 'stand', at } };
  }

  async function placeAt(e: Parameters<BuyerContext['raycast']>[0]): Promise<void> {
    const st = placing;
    if (!st) return;
    const hit = ctx.raycast(e);
    if (hit && people.personIdOf(hit.object) && hit.point.y <= 0.12) { hud.toast('Someone is there.'); return; }
    const w = placementAt(hit);
    if ('error' in w) { hud.toast(w.error); return; }
    placing = null; // one tap places; a refusal puts the flow back below
    const res = st.moveId ? await people.move(st.moveId, w.p) : await people.place(st.spec, w.p);
    if (!res.ok) { placing = st; hud.toast(res.message); return; }
    hud.setModeBar(null);
    const r = people.get(res.id);
    hud.toast(r ? `${PERSON_LABELS[r.body]} ${r.pose === 'stand' ? 'standing here' : r.pose === 'sit' ? 'sitting here' : 'lying here'}. Tap them to change.` : 'Done.');
    if (st.moveId) select(res.id);
  }

  // ---------------------------------------------------------------- the person card

  const slot = el('div', 'wtp-root');
  slot.dataset.testid = 'person-card-root';
  const card = el('div', 'wtp-card', undefined, slot);
  card.dataset.testid = 'person-card';
  card.hidden = true;
  const head = el('div', 'wtp-head', undefined, card);
  const title = el('div', 'wtp-title', undefined, head);
  const x = el('button', 'wtp-x', '×', head);
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  x.addEventListener('click', (e) => { e.stopPropagation(); select(null); });
  const lines = el('div', 'wtp-lines', undefined, card);
  const poseRow = el('div', 'wtp-seg', undefined, card);
  poseRow.setAttribute('role', 'group');
  poseRow.setAttribute('aria-label', 'Pose');
  const poseBtns = new Map<PersonPose, HTMLButtonElement>();
  for (const [pose, label] of [['stand', 'Stand'], ['sit', 'Sit'], ['lie', 'Lie']] as const) {
    const b = el('button', 'wtp-seg-b', label, poseRow);
    b.type = 'button';
    b.dataset.pose = pose;
    b.addEventListener('click', () => { if (selected) void people.setPose(selected, pose).then((r) => { if (!r.ok) hud.toast(r.message); render(); }); });
    poseBtns.set(pose, b);
  }
  const row = el('div', 'wtp-row', undefined, card);
  const act = (id: string, label: string, cls: string, fn: () => void): HTMLButtonElement => {
    const b = el('button', `wtp-b ${cls}`, label, row);
    b.type = 'button';
    b.dataset.act = id;
    b.addEventListener('click', fn);
    return b;
  };
  act('move', 'Move', '', () => { const r = selected ? people.get(selected) : null; if (r) beginPlacing({ body: r.body, tone: r.tone, heightCm: r.heightCm }, r.id); });
  act('change', 'Change person', '', () => {
    if (!selected) return;
    editId = selected;
    closeCard(false);
    hud.setVisible(false);
    editPicker.syncPerson({ body: people.get(editId)!.body, tone: people.get(editId)!.tone });
    editPicker.open(false);
  });
  const followBtn = act('follow', 'Follow me', '', () => { if (selected) { people.setFollow(selected, !people.isFollowing(selected)); render(); } });
  act('become', 'Become this person', 'is-wide', () => {
    if (!selected) return;
    const id = selected;
    void people.become(id).then((r) => { select(null); hud.toast(r.ok ? 'Now walking as them. You stay where you stood.' : r.message); });
  });
  act('remove', 'Remove', 'is-danger', () => { if (selected) { const id = selected; select(null); people.remove(id); hud.toast('Removed.'); } });
  hud.mount(slot, 'bottom');

  function drawRing(): void {
    ctx.overlays.clear(TAG);
    ring = null;
    if (!selected) return;
    const r = people.get(selected);
    const ch = people.bodyOf(selected);
    if (!r || !ch) return;
    if (r.pose === 'stand') {
      const p = ch.position;
      const b = standBox({ ...r, x: p.x, z: p.z, yawDeg: ch.yawDeg });
      ctx.overlays.outlineBox({ ...b, w: Math.max(b.w + 0.22, 0.6), d: Math.max(b.d + 0.22, 0.6) }, 0.02, SEL_COLOR, TAG);
      ring = `${Math.round(p.x * 50)},${Math.round(p.z * 50)}`;
    } else {
      const host = (r.host ? [...ctx.furniture.all()].find((i: FurnitureItem) => i.id === r.host) : undefined) ?? people.hostAt({ x: r.x, z: r.z });
      if (host) ctx.overlays.outlineBox(host.box, host.surfaceHeightM + 0.012, SEL_COLOR, TAG);
    }
  }

  function render(): void {
    const d = selected ? people.describe(selected) : null;
    if (!d || !selected) { card.hidden = true; return; }
    title.textContent = d.title;
    lines.replaceChildren(...d.lines.map((l) => el('div', 'wtp-line', l)));
    for (const [pose, b] of poseBtns) { b.classList.toggle('is-on', pose === d.pose); b.setAttribute('aria-pressed', String(pose === d.pose)); }
    followBtn.textContent = d.follows ? 'Stay here' : 'Follow me';
    followBtn.disabled = d.pose !== 'stand';
    card.hidden = false;
    drawRing();
  }

  function select(id: string | null): void {
    selected = id && people.get(id) ? id : null;
    if (!selected) { ctx.overlays.clear(TAG); card.hidden = true; ring = null; return; }
    render();
  }

  /** hides the card (keeping who is selected when `forget` is false, for the change sheet) */
  function closeCard(forget = true): void {
    if (forget) selected = null;
    card.hidden = true;
    ctx.overlays.clear(TAG);
    ring = null;
  }

  people.onChange(() => {
    if (selected && !people.get(selected)) { select(null); return; }
    if (selected && !card.hidden) render();
  });

  // ---------------------------------------------------------------- taps and time

  return {
    addOption: () => ({
      label: () => (people.count() >= people.cap() ? `Add a person · ${people.count()} of ${people.cap()} on this device` : people.count() ? `Add a person · ${people.count()} added` : 'Add a person'),
      enabled: () => people.count() < people.cap(),
      onClick: () => openAdd(),
    }),
    openAdd,
    handleTap(e, hit) {
      if (ctx.mode() !== 'walk' || deps.otherBlocking?.()) return false;
      if (placing) { void placeAt(e); return true; }
      // `hit` is the page's one hit-test (ctx.pickAt): the nearest of piece, fitting and person. A person is taken here, nothing else is.
      if (hit?.kind === 'person' && people.get(hit.id)) { select(hit.id); return true; }
      if (selected) select(null);
      return false;
    },
    blocking: () => addPicker.isOpen() || editPicker.isOpen(),
    placing: () => !!placing,
    selected: () => selected,
    select,
    cancel() { cancelPlacing(); if (selected) select(null); },
    update(dt) {
      if (!selected) return;
      selClock += dt;
      if (selClock < 0.15) return;
      selClock = 0;
      const ch = people.bodyOf(selected);
      if (!ch) return;
      const w = walker.position();
      const p = ch.position;
      if (Math.hypot(w.x - p.x, w.z - p.z) > CARD_RANGE_M) { select(null); return; }
      // a follower walks: the ring goes with them
      const now = `${Math.round(p.x * 50)},${Math.round(p.z * 50)}`;
      if (ring !== null && now !== ring) drawRing();
    },
    note: () => peopleNote(people.count(), people.shown()),
    dispose() { slot.remove(); ctx.overlays.clear(TAG); },
  };
}
