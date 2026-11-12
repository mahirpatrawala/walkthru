// C12a: one synthetic drawing set from a seed: options, layout, plan sheet, elevation sheets, and the truth (SPEC 17.10).
import { mulberry32 } from '../../src/core/geometry';
import type {
  CaptionStyle, Font, FtinFormat, KeyStyle, LabelStyle, SetOptions, SetTruth, SymbolClass, Template, Terminator, TextMode, TruthDimension,
  TruthItem, TruthOpening, TruthRoom, UnitsOpt, WallStyle,
} from './types';
import type { LOpening, LRoom, Layout, Rect, Rng } from './layout';
import { buildLayout, makeRng, snapDim, wallPieces, wallThickness } from './layout';
import { drawSymbol, furnish } from './symbols';
import type { Furnished } from './symbols';
import type { TextStyle, WallPaint } from './draw';
import { Canvas, WALL_COLORS, caseOf, drawWallRect, fmtArea, fmtLen, fmtSize, textWidth } from './draw';
import type { DimMaker, ElevCtx } from './elevation';
import { EDGE_SIDE, drawElevation, drawInternal, itemsOnWall, planUnit, wallLengthOf } from './elevation';

export const FIXED_SET_COUNT = 24;
export interface PageOut { prims: Canvas['prims']; widthPt: number; heightPt: number; kind: 'plan' | 'elevation' }
export interface BuiltSet { truth: SetTruth; pages: PageOut[]; layout: Layout; furnished: Furnished }

// ---------------------------------------------------------------- options
function balanced<T>(values: readonly T[], index: number, salt: number): T {
  const list: T[] = [];
  while (list.length < FIXED_SET_COUNT) list.push(...values);
  list.length = FIXED_SET_COUNT;
  const r = mulberry32(salt * 7919 + 13);
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list[index];
}
/**
 * Eight drawing offices. Firms 6 and 7 are held out. For the fixed sets the held-out seeds are picked so both sides of the
 * split carry a similar mix of wall, text and label styles (the options are drawn per seed, not per firm); a firm's sets are
 * never on both sides. Beyond seed 24 the firm is just seed mod 8.
 */
const HELD_OUT_SEEDS: number[][] = [[1, 3, 17], [13, 21, 24]];
export const HELD_OUT_FIRMS = [6, 7];
export const firmOf = (seed: number): number => {
  if (seed >= 1 && seed <= FIXED_SET_COUNT) {
    const h = HELD_OUT_SEEDS.findIndex((l) => l.includes(seed));
    if (h >= 0) return 6 + h;
    const dev = Array.from({ length: FIXED_SET_COUNT }, (_, i) => i + 1).filter((x) => !HELD_OUT_SEEDS.flat().includes(x));
    return dev.indexOf(seed) % 6;
  }
  return (((seed - 1) % 8) + 8) % 8;
};
export const splitOf = (seed: number): 'dev' | 'held-out' => (HELD_OUT_FIRMS.includes(firmOf(seed)) ? 'held-out' : 'dev');

export function optionsFor(seed: number, overrides: Partial<SetOptions> = {}): SetOptions {
  const r = mulberry32(seed * 104729 + 7);
  const rr = makeRng(seed, r);
  const fixed = seed >= 1 && seed <= FIXED_SET_COUNT;
  const i = seed - 1;
  const pick = <T,>(values: readonly T[], salt: number): T => (fixed ? balanced(values, i, salt) : rr.pick(values));
  const firm = firmOf(seed);
  const template = pick<Template>(['studio', '1bhk', '2bhk', '3bhk', 'single-bedroom'], 1);
  let labelStyle = pick<LabelStyle>(['brochure', 'designer', 'none'], 60);
  let elevations = pick([0, 0, 0, 0, 2, 3, 4, 5], 14);
  if (template === 'single-bedroom') { if (labelStyle === 'brochure') labelStyle = 'designer'; if (elevations === 0) elevations = 2 + (i % 4); }
  if (template === 'studio' && elevations > 0 && labelStyle === 'none') labelStyle = 'designer';
  const phone = pick([false, false, true], 23);
  const o: SetOptions = {
    template,
    wallStyle: pick<WallStyle>(['fill-dark', 'fill-grey', 'fill-two-grey', 'double', 'hatch'], 263),
    textMode: pick<TextMode>(['real', 'glyph', 'mixed'], 368),
    font: pick<Font>(['simplex', 'duplex', 'complex'], 4),
    slantDeg: pick([0, 0, 8, 15], 5),
    widthScale: pick([1, 0.9, 1.1], 6),
    upper: pick([true, true, false], 7),
    units: pick<UnitsOpt>(['ftin', 'ftin', 'ftin', 'mm', 'm'], 9),
    ftinFormat: pick<FtinFormat>(['dash', 'tight', 'space', 'fraction'], 10),
    areaUnit: pick<'sqft' | 'sqm'>(['sqft', 'sqft', 'sqm'], 11),
    labelStyle,
    vocab: firm % 4,
    terminator: pick<Terminator>(['tick', 'arrow', 'dot'], 12),
    chains: pick([true, true, false], 13),
    roundShare: pick([0, 0.25, 0.5], 15),
    plantWrong: fixed ? (i % 3 === 0 ? 1 : i % 5 === 0 ? 2 : 0) : rr.pick([0, 0, 1, 2]),
    symbolVariant: firm % 3,
    symbolsLabelled: pick([true, true, true, false], 198),
    elevations,
    keyStyle: pick<KeyStyle>(['number', 'letter', 'none'], 17),
    captionStyle: pick<CaptionStyle>(['elevation-n', 'elev-letter', 'wall-n'], 18),
    elevOnPlanPage: pick([true, false, false], 19),
    internalView: pick([true, false], 20),
    page: pick<'A4' | 'A3'>(['A4', 'A4', 'A3'], 21),
    rotation: pick<0 | 90 | 180 | 270>([0, 90, 180, 270], 22),
    noise: pick([true, true, false], 24),
    notToScale: pick([false, false, false, false, false, true], 25),
    raster: {
      dpi: pick([100, 150, 200], 26), jpegQuality: pick([40, 60, 90], 27), phone,
      warpDeg: phone ? pick([3, 6, 8], 28) : 0,
    },
  };
  if (o.labelStyle !== 'designer') o.symbolsLabelled = false;
  return { ...o, ...overrides };
}

// ---------------------------------------------------------------- names
const NAMES: Record<number, Record<string, string>> = {
  0: { master: 'M.BED ROOM', bedroom: 'BED ROOM', kids: 'KIDS BED ROOM', living: 'LIVING/DINING', kitchen: 'KITCHEN', toilet: 'TOILET', balcony: 'BALCONY', passage: 'PASSAGE', foyer: 'FOYER', pooja: 'POOJA', utility: 'UTILITY', store: 'STORE', study: 'STUDY ROOM', dining: 'DINING' },
  1: { master: 'MASTER BEDROOM', bedroom: 'BEDROOM', kids: 'KIDS BEDROOM', living: 'LIVING ROOM', kitchen: 'KITCHEN', toilet: 'BATH', balcony: 'TERRACE', passage: 'LOBBY', foyer: 'ENTRANCE', pooja: 'PUJA', utility: 'WASH AREA', store: 'STORE ROOM', study: 'STUDY ROOM', dining: 'DINING ROOM' },
  2: { master: 'MBR', bedroom: 'BEDROOM', kids: 'KIDS ROOM', living: 'DRAWING ROOM', kitchen: 'KIT', toilet: 'W.C.', balcony: 'DRY BALCONY', passage: 'CORRIDOR', foyer: 'FOYER', pooja: 'MANDIR', utility: 'UTILITY', store: 'STORE', study: 'STUDY', dining: 'DINING' },
  3: { master: 'MASTER BED ROOM', bedroom: 'GUEST ROOM', kids: 'PARENTS ROOM', living: 'LIVING/DINING', kitchen: 'KITCHEN', toilet: 'WASHROOM', balcony: 'SIT-OUT', passage: 'PASSAGE', foyer: 'LOBBY', pooja: 'POOJA ROOM', utility: 'UTILITY AREA', store: 'STORE', study: 'STUDY ROOM', dining: 'DINING AREA' },
};

// ---------------------------------------------------------------- the set
const A4 = { w: 842, h: 595 }, A3 = { w: 1191, h: 842 };
const mkRect = (r: Rect): Rect => r;

export function buildSet(seed: number, overrides: Partial<SetOptions> = {}): BuiltSet {
  const o = optionsFor(seed, overrides);
  const base = mulberry32(seed * 2654435761 + 99);
  const rng: Rng = makeRng(seed, base);
  const L = buildLayout(o, rng);
  const F = furnish(L, o, rng);
  const dimsText = (kind: 'label' | 'dim'): TextStyle => ({
    mode: o.textMode === 'real' ? 'real' : o.textMode === 'glyph' ? 'glyph' : kind === 'label' ? 'real' : 'glyph',
    font: o.font, slantDeg: o.slantDeg, widthScale: o.widthScale,
  });
  const page = o.page === 'A3' ? A3 : A4;
  const wp: WallPaint = { style: o.wallStyle, step: 3 };
  const dimsOut: TruthDimension[] = [];
  let dimCount = 0;
  const nextDim = (): string => `dim-${++dimCount}`;
  // dimension strings: which room-size members are made wrong, and which are rounded
  const plantAt = new Set<number>();
  while (plantAt.size < o.plantWrong) plantAt.add(rng.int(0, 2));
  let memberNo = 0;
  const dimStr: DimMaker = (value, role) => {
    // with no chains drawn, the overall dimensions are the strings a wrong value can be planted in
    if (role === 'wall' || (role === 'overall' && o.chains)) return { ...fmtLen(value, o), rounded: false, planted: false };
    const idx = memberNo++;
    const unit = o.units === 'ftin' ? 0.0254 : o.units === 'mm' ? 0.001 : 0.01;
    if (plantAt.has(idx)) {
      let delta = rng.pick(o.units === 'ftin' ? [12, -12, 6, -6, 24] : o.units === 'mm' ? [100, -100, 300, -200] : [30, -30, 20, -20]) * unit;
      if (value + delta < 0.12) delta = Math.abs(delta); // never drive a length to nothing: the wrong string must still differ clearly
      return { ...fmtLen(value + delta, o), rounded: false, planted: true };
    }
    if (rng() < o.roundShare) {
      const d = rng.pick(o.units === 'ftin' ? [1, 1.5, 2, -1, -1.5, -2] : o.units === 'mm' ? [25, 40, 50, -25, -40, -50] : [2.5, 4, 5, -2.5, -4, -5]) * unit;
      return { ...fmtLen(value + d, o), rounded: true, planted: false };
    }
    return { ...fmtLen(value, o), rounded: false, planted: false };
  };

  // ---- sheet geometry: fit the flat into the plan region
  const hasElev = o.elevations > 0;
  const onPlan = hasElev && o.elevOnPlanPage;
  const planRegionW = page.w * (onPlan ? 0.6 : 0.9);
  const balcony = L.balconies[0];
  const bd = balcony ? balcony.rect.z1 - balcony.rect.z0 : 0;
  const extX0 = -L.o - 1.6, extX1 = L.W + L.o + 0.5, extZ0 = -L.o - bd - 0.4, extZ1 = L.D + L.o + 1.6;
  const stretch = o.notToScale ? 1.12 : 1;
  const S = Math.floor(Math.min(planRegionW / (extX1 - extX0), (page.h * 0.8) / ((extZ1 - extZ0) * stretch)));
  const ox = 30 + (planRegionW - 30 - (extX1 - extX0) * S) / 2 - extX0 * S + 10;
  const oy = 40 + ((page.h - 120) - (extZ1 - extZ0) * S * stretch) / 2 - extZ0 * S * stretch;
  const pt = (x: number, z: number): [number, number] => [ox + x * S, oy + z * S * stretch];
  const cv = new Canvas();
  const black = '#000000';

  // ---- walls
  const pieces = wallPieces(L);
  const tri = o.wallStyle.startsWith('fill') && rng.chance(0.5);
  for (const { rect, run } of pieces) {
    const a = pt(rect.x0, rect.z0), b = pt(rect.x1, rect.z1);
    drawWallRect(cv, wp, a[0], a[1], b[0], b[1], !run.exterior, tri && run.exterior);
  }
  // ---- openings
  const drawOpening = (q: LOpening): void => {
    const run = L.runs.find((r) => r.id === q.run)!;
    const horizontal = run.axis === 'h';
    const t = horizontal ? run.rect.z1 - run.rect.z0 : run.rect.x1 - run.rect.x0;
    const mid = horizontal ? (run.rect.z0 + run.rect.z1) / 2 : (run.rect.x0 + run.rect.x1) / 2;
    const P = (along: number, perp: number): [number, number] => (horizontal ? pt(along, perp) : pt(perp, along));
    const a0 = q.centre - q.width / 2, a1 = q.centre + q.width / 2;
    if (q.type === 'window') {
      const lines = q.style === 'ventilator' || rng.chance(0.5) ? [-t / 2, t / 2] : [-t / 2, 0, t / 2];
      for (const d of lines) cv.line('#333333', 0.3, P(a0, mid + d), P(a1, mid + d));
      return;
    }
    if (q.style === 'sliding') {
      const mk = (x0: number, x1: number, p0: number, p1: number): void => cv.poly(black, 0.3, [P(x0, p0), P(x1, p0), P(x1, p1), P(x0, p1)], true);
      mk(a0, q.centre + q.width * 0.08, mid - t * 0.4, mid - t * 0.04);
      mk(q.centre - q.width * 0.08, a1, mid + t * 0.04, mid + t * 0.4);
      return;
    }
    // swing: hinge on the jamb, leaf open at 90 degrees, arc from the closed leaf end to the open leaf end
    const s = q.swingSide;
    const face = mid + s * t / 2;
    const hAlong = q.hingeEnd === 0 ? a0 : a1;
    const dirClosed = q.hingeEnd === 0 ? 1 : -1;
    const open = P(hAlong, face + s * q.width);
    cv.line(black, 0.35, P(hAlong, face), open);
    // arc as a polyline, curve flag set
    const pts: [number, number][] = [];
    for (let k = 0; k <= 14; k++) {
      const th = (k / 14) * (Math.PI / 2);
      pts.push(P(hAlong + dirClosed * q.width * Math.cos(th), face + s * q.width * Math.sin(th)));
    }
    cv.prims.push({ t: 'stroke', color: black, width: 0.15, pts, closed: false, curve: true });
  };
  for (const q of L.openings) drawOpening(q);
  // balcony railing
  if (balcony) {
    const R = balcony.rect;
    const rail: [number, number][] = [pt(R.x0, R.z1), pt(R.x0, R.z0), pt(R.x1, R.z0), pt(R.x1, R.z1)];
    cv.poly(black, 0.6, rail, false);
    if (o.wallStyle === 'double' || o.wallStyle === 'hatch') cv.poly(black, 0.3, [pt(R.x0 + 0.06, R.z1), pt(R.x0 + 0.06, R.z0 + 0.06), pt(R.x1 - 0.06, R.z0 + 0.06), pt(R.x1 - 0.06, R.z1)], false);
  }
  // ---- symbols
  for (const sym of F.symbols) drawSymbol(cv, pt, sym.cls, sym.variant, sym.box);

  // ---- labels
  const ts = dimsText('label');
  const nameSize = Math.max(5.5, Math.min(9.5, S * 0.17)), subSize = nameSize * 0.8;
  const roomTruth: TruthRoom[] = [];
  const occupied: Rect[] = F.symbols.map((s) => ({ x0: s.bboxM[0], z0: s.bboxM[1], x1: s.bboxM[2], z1: s.bboxM[3] }));
  const counters: Record<string, number> = {};
  const numbered = (k: string): number => (counters[k] = (counters[k] ?? 0) + 1);
  const lowerX = !o.upper;
  for (const room of L.rooms) {
    const R = room.rect;
    const w = R.x1 - R.x0, l = R.z1 - R.z0;
    let name: string | null = null; let dimsS: string | null = null; let areaS: string | null = null;
    let labelDims: { w: number; l: number } | null = null;
    if (o.labelStyle !== 'none') {
      const base = NAMES[o.vocab][room.kind];
      const same = L.rooms.filter((q) => q.kind === room.kind).length;
      const idx = numbered(room.kind);
      const suffix = same > 1 && room.kind !== 'toilet' ? (o.vocab % 2 === 0 ? `-${idx}` : ` ${idx}`) : same > 1 ? (o.vocab % 2 === 0 ? `-${idx}` : ` ${idx}`) : '';
      name = caseOf(base + suffix, o);
      const nominal = o.roundShare > 0 ? { w: snapDim(w, o), l: snapDim(l, o) } : { w, l };
      const wantDims = o.labelStyle === 'designer' || rng.chance(0.85);
      if (wantDims) {
        // designer sheets read "short x long", brochures "width x length" in plan orientation
        const lo = Math.min(nominal.w, nominal.l), hi = Math.max(nominal.w, nominal.l);
        const sz = o.labelStyle === 'brochure' ? fmtSize(nominal.w, nominal.l, o, lowerX) : fmtSize(lo, hi, o, lowerX);
        dimsS = sz.s; labelDims = { w: sz.w, l: sz.l };
        if (o.labelStyle === 'designer' && (room.roomType === 'bedroom' || room.roomType === 'living')) areaS = fmtArea(labelDims.w * labelDims.l, o, rng.int(0, 1));
      }
      const lines: { s: string; size: number }[] = [];
      if (o.labelStyle === 'brochure' && dimsS && o.vocab % 2 === 1) lines.push({ s: `${name} ${dimsS}`, size: nameSize * 0.85 });
      else { lines.push({ s: name, size: nameSize }); if (dimsS) lines.push({ s: dimsS, size: o.labelStyle === 'brochure' ? nameSize * 0.85 : subSize }); if (areaS) lines.push({ s: areaS, size: subSize }); }
      placeLabel(cv, lines, room, occupied, pt, ts, S, rng);
    }
    const holder: TruthRoom = {
      id: room.id, kind: room.kind, roomType: room.roomType, labelString: name, dimsString: dimsS, areaString: areaS,
      polygonM: [[R.x0, R.z0], [R.x1, R.z0], [R.x1, R.z1], [R.x0, R.z1]], widthM: Math.min(w, l), lengthM: Math.max(w, l), areaM2: w * l, labelDimsM: labelDims,
    };
    roomTruth.push(holder);
  }
  // furniture labels (designer sheets)
  const fLabel: TextStyle = ts;
  const itemTruth: TruthItem[] = F.items.map((i) => ({ ...i }));
  if (o.labelStyle === 'designer' && o.symbolsLabelled) {
    const smallSize = Math.max(4.2, nameSize * 0.55);
    for (const it of itemTruth) {
      const sym = F.symbols.find((s) => s.itemId === it.id)!;
      const sz = fmtSize(Math.min(it.box.w, it.box.d), Math.max(it.box.w, it.box.d), o, lowerX);
      const cx = it.box.cx, cz = it.box.cz;
      const lines: { s: string; size: number }[] = [];
      let at = pt(cx, cz);
      switch (it.cls) {
        case 'bed': lines.push({ s: caseOf('BED', o), size: smallSize }, { s: sz.s, size: smallSize }); it.labelString = caseOf('BED', o); it.sizeString = sz.s; break;
        case 'sofa': lines.push({ s: caseOf('SOFA', o), size: smallSize }, { s: sz.s, size: smallSize }); it.labelString = caseOf('SOFA', o); it.sizeString = sz.s; break;
        case 'side table': lines.push({ s: caseOf('SIDE TABLE', o), size: smallSize * 0.8 }, { s: sz.s, size: smallSize * 0.8 }); it.labelString = caseOf('SIDE TABLE', o); it.sizeString = sz.s; at = pt(cx, cz + it.box.d * 0.9); break;
        case 'desk': lines.push({ s: caseOf('STUDY', o), size: smallSize }, { s: sz.s, size: smallSize }); it.labelString = caseOf('STUDY', o); it.sizeString = sz.s; break;
        case 'dining': lines.push({ s: caseOf('DINING TABLE', o), size: smallSize }, { s: sz.s, size: smallSize }); it.labelString = caseOf('DINING TABLE', o); it.sizeString = sz.s; break;
        case 'tv unit': lines.push({ s: caseOf('TV UNIT', o), size: smallSize }); it.labelString = caseOf('TV UNIT', o); break;
        case 'wardrobe': {
          const run = it.runningLengthM ?? it.box.w;
          const rs = o.units === 'ftin' ? fmtLen(run, { ...o, ftinFormat: 'tight' }).s : `${run.toFixed(2)}M`;
          const unit = o.units === 'ftin' ? 'RFT' : 'RMT';
          const form = (it.variant + itemTruth.indexOf(it)) % 4;
          const s = form === 0 ? `WARDROBE=${rs}${unit}` : form === 1 ? `WARDROBE ${rs} ${unit}` : form === 2 ? `W/R ${rs} ${unit}` : `WARDROBE ${rs}${unit}`;
          lines.push({ s: caseOf(s, o).replace(/rft|rmt/i, unit), size: smallSize });
          it.labelString = lines[0].s; it.sizeString = null;
          const f = { x: Math.sin((it.box.yawDeg * Math.PI) / 180), z: Math.cos((it.box.yawDeg * Math.PI) / 180) };
          at = pt(cx + f.x * (it.box.d / 2 + 0.28), cz + f.z * (it.box.d / 2 + 0.28));
          break;
        }
        default: break;
      }
      if (!lines.length) continue;
      sym.labelled = true;
      let y = at[1] - ((lines.length - 1) * smallSize * 1.2) / 2 + smallSize * 0.3;
      for (const ln of lines) { cv.text(ln.s, at[0], y, ln.size, fLabel, 0, 'mid'); y += ln.size * 1.25; }
    }
  }
  const labelledIds = new Set(F.symbols.filter((s) => s.labelled).map((s) => s.id));
  void labelledIds;

  // ---- dimension chains and overalls
  const dimTs = dimsText('dim');
  const dsz = Math.max(4, Math.min(6.2, S * 0.12));
  const drawDim = (chain: string, view: string, a: [number, number], b: [number, number], axis: 'x' | 'z', line: number, role: 'member' | 'overall' | 'wall', over: number, textBelow: boolean): void => {
    const len = axis === 'x' ? b[0] - a[0] : b[1] - a[1];
    const ds = dimStr(len, role);
    dimsOut.push({
      id: nextDim(), kind: role === 'overall' ? 'overall' : 'chain-member', chain, view, a, b, valueM: len, shownM: ds.shownM, string: ds.s, textMode: dimTs.mode,
      rounded: ds.rounded, planted: ds.planted,
    });
    const p0 = axis === 'x' ? pt(a[0], line) : pt(line, a[1]), p1 = axis === 'x' ? pt(b[0], line) : pt(line, b[1]);
    cv.line(black, 0.3, p0, p1);
    // terminators
    for (const p of [p0, p1]) {
      if (o.terminator === 'tick') cv.line(black, 0.4, [p[0] - 2.5, p[1] + 2.5], [p[0] + 2.5, p[1] - 2.5]);
      else if (o.terminator === 'dot') cv.circle(black, 0.8, p[0], p[1], 1);
      else {
        const dir = (p === p0 ? 1 : -1);
        const ax = axis === 'x' ? [dir * 4, 0] : [0, dir * 4];
        const nx = axis === 'x' ? [0, 1.3] : [1.3, 0];
        cv.fill(black, [[p[0], p[1]], [p[0] + ax[0] + nx[0], p[1] + ax[1] + nx[1]], [p[0] + ax[0] - nx[0], p[1] + ax[1] - nx[1]]]);
      }
    }
    // extension lines from the building face
    for (const e of [a, b]) {
      const f0 = axis === 'x' ? pt(e[0], over) : pt(over, e[1]), f1 = axis === 'x' ? pt(e[0], line) : pt(line, e[1]);
      const dx = f1[0] - f0[0], dy = f1[1] - f0[1], dl = Math.hypot(dx, dy) || 1;
      cv.line(black, 0.2, [f0[0] + (dx / dl) * 3, f0[1] + (dy / dl) * 3], [f1[0] + (dx / dl) * 2, f1[1] + (dy / dl) * 2]);
    }
    const mid: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    if (axis === 'x') cv.text(ds.s, mid[0], mid[1] + (textBelow ? dsz + 1.5 : -1.8), dsz, dimTs, 0, 'mid');
    else cv.text(ds.s, mid[0] + (textBelow ? dsz + 1.5 : -1.8), mid[1] + textWidth(ds.s, dsz, dimTs) / 2, dsz, dimTs, -90, 'start');
  };
  {
    // bottom chain: the row with the most cells; left chain: the row depths
    const bottomRow = L.rows.reduce((a, b) => (b.cells.length >= a.cells.length ? b : a));
    const z1 = L.D + L.o + 0.55, z2 = L.D + L.o + 1.1;
    const xs: { a: number; b: number; role: 'member' | 'wall' }[] = [{ a: -L.o, b: 0, role: 'wall' }];
    bottomRow.cells.forEach((c, k) => {
      xs.push({ a: c.x0, b: c.x1, role: 'member' });
      if (k < bottomRow.cells.length - 1) xs.push({ a: c.x1, b: bottomRow.cells[k + 1].x0, role: 'wall' });
    });
    xs.push({ a: bottomRow.cells[bottomRow.cells.length - 1].x1, b: L.W + L.o, role: 'wall' });
    // the last cell absorbs the row's remainder: its x1 is W for every row
    if (o.chains) xs.forEach((m, k) => drawDim('bottom', 'plan', [m.a, z1], [m.b, z1], 'x', z1, m.role, L.D + L.o, m.role === 'wall' && k % 2 === 0));
    drawDim('bottom', 'plan', [-L.o, z2], [L.W + L.o, z2], 'x', z2, 'overall', L.D + L.o, false);
    const x1 = -L.o - 0.55, x2 = -L.o - 1.1;
    const zs: { a: number; b: number; role: 'member' | 'wall' }[] = [{ a: -L.o, b: 0, role: 'wall' }];
    L.rows.forEach((r, k) => { zs.push({ a: r.z0, b: r.z1, role: 'member' }); if (k < L.rows.length - 1) zs.push({ a: r.z1, b: L.rows[k + 1].z0, role: 'wall' }); });
    zs.push({ a: L.D, b: L.D + L.o, role: 'wall' });
    if (o.chains) zs.forEach((m, k) => drawDim('left', 'plan', [x1, m.a], [x1, m.b], 'z', x1, m.role, -L.o, m.role === 'wall' && k % 2 === 0));
    drawDim('left', 'plan', [x2, -L.o], [x2, L.D + L.o], 'z', x2, 'overall', -L.o, false);
  }

  // ---- elevation key, elevations
  const elevations: SetTruth['elevations'] = [];
  const pages: PageOut[] = [];
  let key: SetTruth['elevationKey'] = null;
  const elevCtx: ElevCtx = { L, F, o, rng, H: 0, paint: wp, ts: dimsText, dimStr, dims: dimsOut, nextDim, signalBase: seed, unitNo: { n: 0 } };
  const ceilings = o.units === 'ftin' ? [8 * 0.3048, 8.5 * 0.3048, 9 * 0.3048] : [2.4, 2.6, 2.7, 3.0];
  const H = rng.pick(ceilings);
  elevCtx.H = H;
  const planPage: PageOut = { prims: cv.prims, widthPt: page.w, heightPt: page.h, kind: 'plan' };
  pages.push(planPage);
  const target = pickTargetRoom(L, F);
  const elevCanvases: { cv: Canvas; kind: 'elevation' }[] = [];
  if (hasElev && target) {
    const wallsOrder = rankWalls(L, F, target, rng);
    const nWalls = Math.min(4, o.elevations);
    const edges = wallsOrder.slice(0, nWalls);
    const tags = (o.keyStyle === 'letter' ? ['A', 'B', 'C', 'D'] : ['1', '2', '3', '4']);
    const tagOfEdge = new Map<number, string>();
    if (o.keyStyle !== 'none') [0, 1, 2, 3].forEach((e, k) => tagOfEdge.set(e, tags[(k + seed) % 4]));
    if (o.keyStyle !== 'none') {
      const c = pt((target.rect.x0 + target.rect.x1) / 2, (target.rect.z0 + target.rect.z1) / 2);
      cv.circle(black, 0.5, c[0], c[1], 5);
      const R = 5;
      [0, 1, 2, 3].forEach((e) => {
        const ang = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][e];
        const dx = Math.cos(ang), dy = Math.sin(ang);
        cv.fill(black, [[c[0] + dx * (R + 5), c[1] + dy * (R + 5)], [c[0] + dx * R - dy * 3, c[1] + dy * R + dx * 3], [c[0] + dx * R + dy * 3, c[1] + dy * R - dx * 3]]);
        cv.text(tagOfEdge.get(e)!, c[0] + dx * (R + 10) - 1.6, c[1] + dy * (R + 10) + 2.2, 5.5, ts);
      });
      key = { at: { x: (target.rect.x0 + target.rect.x1) / 2, z: (target.rect.z0 + target.rect.z1) / 2 }, style: o.keyStyle, tags: [...tagOfEdge.entries()].map(([edge, tag]) => ({ tag, edge })) };
    }
    const captionOf = (idx: number, edge: number): { caption: string; tag: string } => {
      const tag = o.keyStyle === 'none' ? (o.captionStyle === 'elev-letter' ? String.fromCharCode(65 + idx) : String(idx + 1)) : tagOfEdge.get(edge)!;
      return { tag, caption: caseOf(o.captionStyle === 'elevation-n' ? `ELEVATION-${tag}` : o.captionStyle === 'elev-letter' ? `ELEV. ${tag}` : `WALL ${tag}`, o) };
    };
    // regions: on the plan page, a column at the right; otherwise one page each
    const regionsOnPlan: [number, number, number, number][] = [[page.w * 0.62, 40, page.w - 30, page.h * 0.46], [page.w * 0.62, page.h * 0.46 + 6, page.w - 30, page.h - 90]];
    let onPlanUsed = 0;
    const unitByItem = new Map<string, ReturnType<typeof planUnit>>();
    edges.forEach((edge, idx) => {
      const { caption, tag } = captionOf(idx, edge);
      const id = `elev-${idx + 1}`;
      let c2: Canvas; let region: [number, number, number, number]; let pageNo: number; let onP = false;
      if (onPlan && onPlanUsed < 2) { c2 = cv; region = regionsOnPlan[onPlanUsed++]; pageNo = 1; onP = true; }
      else { c2 = new Canvas(); region = [40, 50, page.w - 40, page.h - 100]; pageNo = pages.length + 1; pages.push({ prims: c2.prims, widthPt: page.w, heightPt: page.h, kind: 'elevation' }); }
      const unit = itemsOnWall(F, target, EDGE_SIDE[edge]).find((x) => x.item.cls === 'wardrobe');
      let meta: Parameters<typeof drawElevation>[5] = { id, caption, tag, page: pageNo, onPlanPage: onP };
      if (unit) { const u = unitByItem.get(unit.item.id) ?? planUnit(elevCtx, unit.item, edge); unitByItem.set(unit.item.id, u); meta = { ...meta, unit: u }; }
      const out = drawElevation(c2, region, elevCtx, target, edge, meta);
      elevations.push(out.truth);
      // caption under the view
      const capY = region[3] - 8;
      c2.text(caption, (region[0] + region[2]) / 2, capY, 8, ts, 0, 'mid');
      c2.line(black, 0.5, [(region[0] + region[2]) / 2 - 40, capY + 3], [(region[0] + region[2]) / 2 + 40, capY + 3]);
    });
    if (o.internalView || o.elevations === 5) {
      const withUnit = elevations.find((e) => e.units.length);
      if (withUnit && (o.internalView || o.elevations === 5)) {
        const c2 = new Canvas();
        const pageNo = pages.length + 1;
        pages.push({ prims: c2.prims, widthPt: page.w, heightPt: page.h, kind: 'elevation' });
        const cap = caseOf(`${withUnit.caption}A (INTERNAL)`, o);
        const t = drawInternal(c2, [40, 50, page.w - 40, page.h - 100], elevCtx, withUnit.units[0], { id: `elev-${elevations.length + 1}`, caption: cap, page: pageNo, parent: withUnit.id });
        c2.text(cap, page.w / 2, page.h - 108, 8, ts, 0, 'mid');
        elevations.push(t);
      }
    }
    void elevCanvases;
  }

  // ---- title blocks, borders, notes, noise on every page
  const notes = ['NOTES', o.units === 'ftin' ? 'ALL DIMENSIONS IN FEET AND INCHES' : o.units === 'mm' ? 'ALL DIMENSIONS IN MM' : 'ALL DIMENSIONS IN METRES', 'DO NOT SCALE FROM THIS DRAWING', 'FOR DISCUSSION ONLY'];
  const nTs: TextStyle = { ...ts };
  pages.forEach((pg, pi) => {
    const c = pi === 0 ? cv : new Canvas();
    const target2 = pi === 0 ? cv : null;
    const cc = target2 ?? c;
    const bx0 = 24, by0 = 24, bx1 = pg.widthPt - 24, by1 = pg.heightPt - 24;
    cc.rect(black, 0.6, bx0, by0, bx1, by1);
    cc.rect(black, 0.4, bx1 - 230, by1 - 62, bx1, by1);
    cc.line(black, 0.3, [bx1 - 230, by1 - 31], [bx1, by1 - 31]);
    const title = pi === 0 ? caseOf(rng.pick(['FLOOR PLAN', 'FURNITURE LAYOUT PLAN', 'PLAN']), o) : (elevations.find((e) => e.page === pi + 1 && !e.onPlanPage)?.caption ?? 'ELEVATION');
    cc.text(title, bx1 - 224, by1 - 38, 9, ts);
    cc.text(caseOf('TYPICAL RESIDENCE', o), bx1 - 224, by1 - 19, 7, ts);
    cc.text(o.notToScale ? caseOf('NOT TO SCALE', o) : caseOf('SCALE NTS', o), bx1 - 224, by1 - 8, 5.5, ts);
    cc.text(`A-${101 + pi}`, bx1 - 40, by1 - 8, 6, ts);
    if (o.noise) {
      notes.forEach((n, k) => cc.text(caseOf(n, o), bx0 + 8, by1 - 50 + k * 8, 5, nTs));
      const nr = mulberry32(seed * 31 + pi);
      for (let k = 0; k < 160; k++) {
        const x = bx0 + 10 + nr() * 220, y = by1 - 8 - nr() * 70; const s = 1.2 + nr() * 1.3;
        cc.fill(black, [[x, y], [x + s, y], [x + s, y + s * 0.4], [x + s * 0.4, y + s * 0.4], [x + s * 0.4, y + s], [x, y + s]]);
      }
      if (pi === 0 && !onPlan) for (let k = 0; k < 90; k++) cc.line(black, 0.1, [bx1 - 90 + (k % 9) * 6, by0 + 12 + Math.floor(k / 9) * 6], [bx1 - 86 + (k % 9) * 6, by0 + 17 + Math.floor(k / 9) * 6]);
    }
    if (pi > 0) pg.prims.push(...cc.prims);
  });

  // ---- truth assembly
  const openings: TruthOpening[] = L.openings.map((q) => {
    const run = L.runs.find((r) => r.id === q.run)!;
    const mid = run.axis === 'h' ? (run.rect.z0 + run.rect.z1) / 2 : (run.rect.x0 + run.rect.x1) / 2;
    return {
      id: q.id, type: q.type, style: q.style, at: run.axis === 'h' ? { x: q.centre, z: mid } : { x: mid, z: q.centre }, axis: q.axis, widthM: q.width,
      sillM: q.sill, headM: q.head, rooms: q.rooms,
    };
  });
  const allX = pieces.flatMap((p) => [p.rect.x0, p.rect.x1]), allZ = pieces.flatMap((p) => [p.rect.z0, p.rect.z1]);
  const firm = firmOf(seed);
  const rotation = o.rotation;
  const rotated = rotation === 90 || rotation === 270;
  const truth: SetTruth = {
    version: 1, id: `set-${String(seed).padStart(3, '0')}`, seed, firm: `firm-${firm}`, split: splitOf(seed), options: o,
    page: { size: o.page, widthPt: rotated ? page.h : page.w, heightPt: rotated ? page.w : page.h, rotationDeg: rotation, pages: pages.length },
    planPtPerM: S, planPage: 1, rooms: roomTruth, openings, items: itemTruth, symbols: F.symbols, dimensions: dimsOut, ceilingM: H, elevations, elevationKey: key,
    wallBBoxM: [Math.min(...allX), Math.min(...allZ), Math.max(...allX), Math.max(...allZ)], notToScale: o.notToScale,
    plantedWrong: dimsOut.filter((d) => d.planted).map((d) => d.id), roundedStrings: dimsOut.filter((d) => d.rounded).map((d) => d.id),
  };
  void wallThickness; void mkRect;
  return { truth, pages, layout: L, furnished: F };
}

function pickTargetRoom(L: Layout, F: Furnished): LRoom | undefined {
  const score = (r: LRoom): number => F.items.filter((i) => i.roomId === r.id).length * 2 + F.items.filter((i) => i.roomId === r.id && i.cls === 'wardrobe').length * 5;
  return [...L.rooms].filter((r) => r.roomType === 'bedroom').sort((a, b) => score(b) - score(a))[0] ?? [...L.rooms].sort((a, b) => score(b) - score(a))[0];
}
function rankWalls(L: Layout, F: Furnished, room: LRoom, rng: Rng): number[] {
  const sc = [0, 1, 2, 3].map((e) => {
    const side = EDGE_SIDE[e];
    const items = itemsOnWall(F, room, side);
    const wins = L.openings.filter((q) => q.rooms.includes(room.id)).length;
    return { e, s: items.reduce((a, x) => a + (x.item.cls === 'wardrobe' ? 5 : x.item.cls === 'bed' ? 4 : 1), 0) + rng() * 0.5 + (wallLengthOf(room, side) > 2 ? 0.2 : 0) + wins * 0 };
  });
  return sc.sort((a, b) => b.s - a.s).map((x) => x.e);
}

/** Put a label block where it overlaps the least furniture: the room centre first, then a grid of other spots. */
function placeLabel(
  cv: Canvas, lines: { s: string; size: number }[], room: LRoom, occ: Rect[], pt: (x: number, z: number) => [number, number], ts: TextStyle, S: number, rng: Rng,
): void {
  const R = room.rect;
  const wPt = Math.max(...lines.map((l) => textWidth(l.s, l.size, ts)));
  const hPt = lines.reduce((a, l) => a + l.size * 1.25, 0);
  const wM = wPt / S, hM = hPt / S;
  let best: { x: number; z: number; cost: number } | null = null;
  const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
  const tries: [number, number][] = [[0, 0]];
  for (let gx = -1; gx <= 1; gx += 0.5) for (let gz = -1; gz <= 1; gz += 0.5) tries.push([gx, gz]);
  for (const [gx, gz] of tries) {
    const x = cx + gx * Math.max(0, (R.x1 - R.x0 - wM) / 2), z = cz + gz * Math.max(0, (R.z1 - R.z0 - hM) / 2);
    const r: Rect = { x0: x - wM / 2, x1: x + wM / 2, z0: z - hM / 2, z1: z + hM / 2 };
    let cost = Math.hypot(gx, gz) * 0.01;
    for (const q of occ) { const ox = Math.max(0, Math.min(r.x1, q.x1) - Math.max(r.x0, q.x0)), oz = Math.max(0, Math.min(r.z1, q.z1) - Math.max(r.z0, q.z0)); cost += ox * oz; }
    if (r.x0 < R.x0 - 0.3 * (room.kind === 'balcony' ? 0 : 1) || r.x1 > R.x1 + 0.3 || r.z0 < R.z0 - 0.1 || r.z1 > R.z1 + 0.1) cost += 5;
    if (!best || cost < best.cost) best = { x, z: z, cost };
  }
  void rng;
  const p = pt(best!.x, best!.z);
  let y = p[1] - hPt / 2 + lines[0].size * 0.95;
  for (const ln of lines) { cv.text(ln.s, p[0], y, ln.size, ts, 0, 'mid'); y += ln.size * 1.25; }
}
