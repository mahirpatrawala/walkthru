// The reader as the upload runs it: readPlanPdf over real pdf.js (the same call the browser worker makes), on the synthetic drawing sets and on the
// files that cannot be read. Plus the honesty the home carries: its tag, "What we could not read", conflicts, and "not measured".
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSet, pdfOf } from '../scripts/make-drawing-sets';
import { SAMPLE_SEED } from '../scripts/make-upload-sample';
import { realLoader } from '../src/upload/loader';
import { readPlanPdf } from '../src/upload/read-core';
import type { HomeData, Progress } from '../src/upload/read-core';
import { sha1Hex } from '../src/understand/hash';
import { unverifiedRoomsFromExtras } from '../src/core/room-trust';
import { sceneEntry } from '../src/start/manifest';
import { validateProperty } from '../src/core/layout-validate';
import { gridPdf, imageOnlyPdf, manyPagesPdf, textOnlyPdf } from './helpers/upload-pdfs';
import { rebuild } from '../src/upload/check';
import { UPLOAD_TAG, SAMPLE_UPLOAD_TAG, tagFor, unreadLines, visitorWarning, conflictLines } from '../src/upload/honesty';
import { buildRows } from '../src/understand/review-model';

const read = async (bytes: Uint8Array, id = 'local-testtest01', progress: Progress[] = []): ReturnType<typeof readPlanPdf> =>
  readPlanPdf(bytes, { sceneId: id, title: 'Test plan', load: await realLoader(), onProgress: (p) => progress.push(p) });
const home = async (seed: number): Promise<HomeData> => { const r = await read(pdfOf(buildSet(seed))); if (!r.ok) throw new Error(`seed ${seed}: ${r.problem.code}`); return r.data; };

describe('the stable ids do not need node:crypto', () => {
  it('sha1Hex equals Node’s sha1', () => {
    for (const s of ['', 'a', 'abc', 'room.width.living-dining|12,40,200,310', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'café ½″']) {
      expect(sha1Hex(s)).toBe(createHash('sha1').update(s).digest('hex'));
    }
  });
});

describe('readPlanPdf on the synthetic sets', () => {
  it('reads a flat into a home the walk can use, with progress and timings', async () => {
    const progress: Progress[] = [];
    const r = await read(pdfOf(buildSet(SAMPLE_SEED)), 'local-testtest02', progress);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.data;
    expect(d.property.id).toBe('local-testtest02');
    expect(d.property.layout.rooms.length).toBeGreaterThanOrEqual(4);
    expect(() => validateProperty(JSON.parse(JSON.stringify(d.property)))).not.toThrow();
    expect(d.seconds.total).toBeGreaterThan(0);
    expect(d.pages).toBeGreaterThan(0);
    expect(progress.map((p) => p.stage)).toContain('read');
    expect(progress[progress.length - 1].fraction).toBe(1);
    const fractions = progress.map((p) => p.fraction);
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions);
  });

  it('no file name or title-block text reaches the home', async () => {
    const d = await home(SAMPLE_SEED);
    expect(d.extras.sourceFile).toBe('drawing set');
    expect(d.designs.source).toMatch(/^Imported drawing set, \d+ pages?$/);
  });

  it('tells a made-up sample apart and never claims a person checked anything', async () => {
    const d = await home(SAMPLE_SEED);
    expect(UPLOAD_TAG).toBe('Read automatically from your upload · not checked by a person');
    expect(d.notes.checkedByYou).toBe(0);
    expect(tagFor(0)).toBe(UPLOAD_TAG);
    expect(tagFor(3)).toBe('Read automatically from your upload · 3 values checked by you');
    expect(SAMPLE_UPLOAD_TAG).toMatch(/made-up/i);
    expect(SAMPLE_UPLOAD_TAG).toMatch(/not checked by a person/);
  });

  it('rooms the reader could not verify show as not measured, exactly as in the shipped scenes', async () => {
    const d = await home(93); // a sample whose utility room is label-sized and whose passage disagrees with its label
    const unverified = unverifiedRoomsFromExtras(d.extras);
    expect(Object.keys(unverified).length).toBeGreaterThan(0);
    const entry = sceneEntry({ id: d.property.id, property: d.property, extras: d.extras }).entry!;
    expect(entry.unverified).toEqual(unverified);
    expect(entry.origin).toBe('upload');
    const lines = unreadLines(d.extras, unverified);
    expect(lines.some((l) => /not measured/.test(l))).toBe(true);
  });

  it('shows printed size against drawn walls where they disagree, and speaks to a visitor, not a broker', async () => {
    const d = await home(93);
    expect(d.notes.conflicts.length).toBeGreaterThan(0);
    expect(d.notes.conflicts[0]).toMatch(/label says .* the walls drawn around it measure|printed .* the walls drawn around it measure/);
    expect(d.notes.conflicts[0]).toMatch(/not measured/);
    expect(conflictLines(d.extras)).toEqual(d.notes.conflicts);
    for (const l of d.notes.unread) expect(l).not.toMatch(/in the editor|Confirm it/i);
    expect(d.notes.unread.length).toBeGreaterThan(0);
  });

  it('the reader’s warnings are listed once each, with the broker wording removed', () => {
    expect(visitorWarning('Balcony has no door on the drawing and no swing arc was found. Add one in the editor.')).toBe('Balcony has no door on the drawing and no swing arc was found.');
    expect(visitorWarning('This sheet holds 2 flats (Flat 1: 4 rooms, Flat 2: 4 rooms). The rooms of all of them are listed, but a walk-through is of one flat: keep the rooms of one flat and delete the rest in the editor.'))
      .toBe('This sheet may show more than one flat (Flat 1: 4 rooms, Flat 2: 4 rooms). All of their rooms are in this home.');
    const l = unreadLines({ warnings: ['A', 'A', 'B'] }, {});
    expect(l).toEqual(['A', 'B']);
  });

  it('nothing is confirmed on the visitor’s behalf: every room the reader left unchecked stays unchecked', async () => {
    const d = await home(SAMPLE_SEED);
    const rows = buildRows(d.doc).filter((r) => r.kind === 'room-size');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(['verified', 'needs', 'conflict']).toContain(r.state);
  });
});

describe('Check the drawing rebuilds the home from the visitor’s decisions', () => {
  it('confirming a room clears its "not measured", renaming sticks, and the tag counts what the visitor checked', async () => {
    const d = await home(93);
    const rec = { id: d.property.id, createdAt: '2026-01-01', source: 'file' as const, data: d };
    const unv = unverifiedRoomsFromExtras(d.extras);
    const roomId = Object.keys(unv)[0];
    const row = buildRows(d.doc).find((r) => r.kind === 'room-size' && r.target.kind === 'room' && r.target.roomId === roomId)!;
    const next = rebuild(rec, { version: 1, decisions: { [row.id]: { action: 'confirm', at: '2026-01-01' } } }, { [roomId]: 'My study' }, 'My flat');
    expect(next.data.property.title).toBe('My flat');
    expect(next.data.property.layout.rooms.find((r) => r.id === roomId)?.label).toBe('My study');
    expect(unverifiedRoomsFromExtras(next.data.extras)[roomId]).toBeUndefined();
    expect(next.data.notes.checkedByYou).toBe(2);
    expect(tagFor(next.data.notes.checkedByYou)).toBe('Read automatically from your upload · 2 values checked by you');
    // the original is untouched
    expect(unverifiedRoomsFromExtras(d.extras)[roomId]).toBeTruthy();
  });
});

describe('files that cannot be read answer with a problem, never a hang', () => {
  it('a scan', async () => { const r = await read(imageOnlyPdf()); expect(r.ok ? 'ok' : r.problem.code).toBe('picture-pdf'); });
  it('a letter', async () => { const r = await read(textOnlyPdf()); expect(r.ok ? 'ok' : r.problem.code).toBe('not-a-plan'); });
  it('lines that are not a plan', async () => { const r = await read(gridPdf()); expect(r.ok ? 'ok' : r.problem.code).toBe('no-rooms'); });
  it('too many pages, before reading any of them', async () => { const r = await read(manyPagesPdf(15)); expect(r.ok ? 'ok' : r.problem.code).toBe('too-many-pages'); });
  it('bytes that are not a PDF', async () => { const r = await read(new TextEncoder().encode('%PDF-1.4\nnot really\n%%EOF')); expect(r.ok ? 'ok' : r.problem.code).toBe('unreadable'); });
  it('empty bytes', async () => { const r = await read(new Uint8Array(0)); expect(r.ok).toBe(false); });
});
