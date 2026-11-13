// C12d. The words and the JSON shapes sent to a model. Generic drawing vocabulary only: nothing here names a drawing.
// Boxes travel as [ymin, xmin, ymax, xmax] in 0..1000 of the image sent (the convention Gemini is trained on); `parsePlanRead`
// turns them into pixels. An entry without a usable box is dropped (SPEC 17.8).
import type { Box, PlanRead } from './provider';

export const PLAN_SCHEMA_ID = 'walkthru.plan-read.v1';
export const STRINGS_SCHEMA_ID = 'walkthru.strings.v1';
export const CLASSIFY_SCHEMA_ID = 'walkthru.classify.v1';
export const LAYOUT_SCHEMA_ID = 'walkthru.layout.v1';
export const SYMBOL_CLASSES = ['bed', 'sofa', 'dining', 'chair', 'wardrobe', 'desk', 'side table', 'tv unit', 'counter', 'wc', 'basin', 'shower', 'sink', 'hob', 'other'] as const;
export const VIEW_CHOICES = ['plan', 'elevation', 'section', 'detail', 'notes'] as const;

const box = { type: 'array', items: { type: 'integer' }, description: '[ymin, xmin, ymax, xmax], each 0 to 1000 of the image' };
export const PLAN_SCHEMA = {
  $id: PLAN_SCHEMA_ID,
  type: 'object',
  properties: {
    rooms: { type: 'array', items: { type: 'object', properties: {
      label: { type: 'string', description: 'the room name exactly as printed, or empty if none is printed' },
      size_text: { type: 'string', description: 'the printed size of the room such as 12\'0"X11\'6" or 3700 X 4000, exactly as printed, or empty' },
      area_text: { type: 'string', description: 'a printed area such as 150 SQFT, exactly as printed, or empty' },
      box,
      label_box: { type: 'array', items: { type: 'integer' }, description: 'box of the printed label block (name and size), or an empty array' },
    }, required: ['label', 'size_text', 'area_text', 'box', 'label_box'] } },
    dimensions: { type: 'array', items: { type: 'object', properties: {
      text: { type: 'string', description: 'the dimension string exactly as printed' },
      box,
      line: { type: 'array', items: { type: 'integer' }, description: '[y1, x1, y2, x2]: the two end points of the dimension line this text belongs to, or an empty array' },
    }, required: ['text', 'box', 'line'] } },
    openings: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['door', 'window', 'opening'] }, box }, required: ['kind', 'box'] } },
    symbols: { type: 'array', items: { type: 'object', properties: {
      class: { type: 'string', enum: [...SYMBOL_CLASSES] },
      label: { type: 'string', description: 'printed label next to the symbol, or empty' },
      box,
    }, required: ['class', 'label', 'box'] } },
  },
  required: ['rooms', 'dimensions', 'openings', 'symbols'],
} as const;

export const STRINGS_SCHEMA = {
  $id: STRINGS_SCHEMA_ID,
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, text: { type: 'string', description: 'the text exactly as printed, empty if unreadable' },
    box, confidence: { type: 'number', description: '0 to 1' },
  }, required: ['id', 'text', 'box', 'confidence'] } } },
  required: ['items'],
} as const;

export const LAYOUT_SCHEMA = {
  $id: LAYOUT_SCHEMA_ID,
  type: 'object',
  properties: { boxes: { type: 'array', items: { type: 'object', properties: {
    kind: { type: 'string', enum: ['title-block', 'notes', 'legend', 'schedule', 'other-text'] }, box,
  }, required: ['kind', 'box'] } } },
  required: ['boxes'],
} as const;

export const classifySchema = (choices: string[]): object => ({
  $id: CLASSIFY_SCHEMA_ID,
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, choice: { type: 'string', enum: choices }, confidence: { type: 'number' } }, required: ['id', 'choice', 'confidence'] } } },
  required: ['items'],
});

export const SYSTEM = 'You read architectural and interior-design drawings for a tool that builds a walk-through of a flat. '
  + 'Report only what is printed or drawn. Never guess a number: if text is unclear, leave it empty. '
  + 'Never report names, addresses, phone numbers, email addresses, sheet numbers or anything from a title block.';

export const planPrompt = (w: number, h: number): string => [
  `The image is a floor plan, ${w} by ${h} pixels. Read it and answer with JSON only.`,
  '- rooms: one entry per room. box = the floor area of the room, from the inner face of the walls around it (not the label). Copy the room name and any printed size or area exactly.',
  '- dimensions: every printed dimension string (a length such as 2\'-11", 3050, 3.05 m). box = the text. line = the two end points of the dimension line it measures, where the line meets its end marks.',
  '- openings: every door (with or without its swing arc), window and open doorway. box = the opening including its swing arc if drawn.',
  '- symbols: furniture and fixtures drawn on the plan (bed, sofa, dining table with chairs, chair, wardrobe, desk, side table, tv unit, counter, wc, basin, shower, sink, hob). box = the symbol.',
  'Boxes are [ymin, xmin, ymax, xmax] on a 0 to 1000 scale of this image. Skip anything you cannot box.',
].join('\n');

export const layoutPrompt = (w: number, h: number): string => [
  `The image is a small picture of a drawing sheet, ${w} by ${h} pixels. The writing is too small to read and that is intended: judge by layout only.`,
  'Give a box around each area that is a title block, general notes, legend, schedule or revision table: the ruled boxes and blocks of text at the edges of the sheet. Do not box the drawing itself, its dimensions or its labels.',
  'Boxes are [ymin, xmin, ymax, xmax] on a 0 to 1000 scale of this image. If there is none, return an empty list.',
].join('\n');

export const stringsPrompt = (hints: string[]): string => [
  'Each image below is a small crop from a drawing, labelled with its id. For each id give the text printed in the crop, exactly as printed (keep feet and inch marks, slashes and x signs), and a box around it.',
  `Kinds of crop: ${[...new Set(hints)].join(', ') || 'text'}. If nothing is readable give an empty text. Boxes are [ymin, xmin, ymax, xmax] on a 0 to 1000 scale of that crop.`,
].join('\n');

export const classifyPrompt = (choices: string[]): string => `Each image below is a small picture of part of a drawing sheet, labelled with its id. For each id choose exactly one of: ${choices.join(', ')}.`;

// ---------------------------------------------------------------- reading answers
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** [ymin, xmin, ymax, xmax] on 0..1000 -> pixel box, or null if it is not a box. */
export function boxFromNorm(v: unknown, w: number, h: number): Box | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const n = v.map(num); if (n.some((x) => x === null)) return null;
  const [y0, x0, y1, x1] = n as number[];
  if (y1 <= y0 || x1 <= x0) return null;
  const c = (a: number, m: number): number => Math.min(m, Math.max(0, (a / 1000) * m));
  return [c(x0, w), c(y0, h), c(x1, w), c(y1, h)];
}
const lineFromNorm = (v: unknown, w: number, h: number): Box | undefined => {
  if (!Array.isArray(v) || v.length !== 4) return undefined;
  const n = v.map(num); if (n.some((x) => x === null)) return undefined;
  const [y0, x0, y1, x1] = n as number[];
  return [(x0 / 1000) * w, (y0 / 1000) * h, (x1 / 1000) * w, (y1 / 1000) * h];
};
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);

/** Whole-view answer -> pixels. Entries with no box are dropped; the count dropped is returned for the log. */
export function parsePlanRead(raw: unknown, w: number, h: number): { read: PlanRead; dropped: number } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let dropped = 0;
  const read: PlanRead = { rooms: [], dimensions: [], openings: [], symbols: [] };
  for (const r of arr(o.rooms)) {
    const b = boxFromNorm(r.box, w, h); if (!b) { dropped++; continue; }
    const lb = boxFromNorm(r.label_box, w, h) ?? undefined;
    read.rooms.push({ label: str(r.label), sizeText: str(r.size_text) || undefined, areaText: str(r.area_text) || undefined, box: b, labelBox: lb });
  }
  for (const d of arr(o.dimensions)) {
    const b = boxFromNorm(d.box, w, h); const t = str(d.text); if (!b || !t) { dropped++; continue; }
    read.dimensions.push({ text: t, box: b, line: lineFromNorm(d.line, w, h) });
  }
  for (const d of arr(o.openings)) {
    const b = boxFromNorm(d.box, w, h); const k = str(d.kind);
    if (!b || !(k === 'door' || k === 'window' || k === 'opening')) { dropped++; continue; }
    read.openings.push({ kind: k, box: b });
  }
  for (const d of arr(o.symbols)) {
    const b = boxFromNorm(d.box, w, h); const c = str(d.class);
    if (!b || !c) { dropped++; continue; }
    read.symbols.push({ cls: c, label: str(d.label) || undefined, box: b });
  }
  return { read, dropped };
}

/** Layout answer -> pixel boxes (entries without a usable box are dropped). */
export function parseLayout(raw: unknown, w: number, h: number): { kind: string; box: Box }[] {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: { kind: string; box: Box }[] = [];
  for (const r of arr(o.boxes)) { const b = boxFromNorm(r.box, w, h); if (b) out.push({ kind: str(r.kind) || 'other-text', box: b }); }
  return out;
}
