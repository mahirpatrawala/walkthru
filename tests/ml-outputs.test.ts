// C10 acceptance 1 (SPEC 15.7). Pure: the ML output files round-trip through their validators and apply.ts guards.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyMlScale, mlScaleHint, proposalFromMl, splatWithMlScale } from '../src/ml/apply';
import {
  isShippableMlPath, validateCeiling, validateFramesDrop, validateProposalShape, validateRegistration, validateReport, validateScale,
} from '../src/ml/outputs';
import type { MlCeilingFile, MlScaleFile } from '../src/ml/outputs';
import { applyScene } from '../scripts/ml-apply';
import { validateLayout } from '../src/core/layout-validate';
import { DEFAULT_FINISHES } from '../src/types';
import type { Layout, SplatOverlay } from '../src/types';

const scale: MlScaleFile = {
  version: 1, model: 'MoGe-2 ViT-S', licence: 'MIT', commercialOk: true, metresPerUnit: 0.41, spreadPct: 6, frames: 36,
  checks: [{ label: 'door height', expectedM: 2.1, measuredM: 2.05 }], crossCheck: { model: 'DA2 indoor small', metresPerUnit: 0.43 },
};
const ceiling: MlCeilingFile = { version: 1, model: 'MoGe-2 ViT-S', licence: 'MIT', commercialOk: true, heightM: 2.7, spreadPct: 4, frames: 14 };
const identity: SplatOverlay = {
  file: 'scene.ply', format: 'ply', upPreset: 'flip-x', mode: 'overlay', transform: { rotation: [0, 0, 0, 1], scale: 1, position: [0, 0, 0] },
};
const rect = (id: string): unknown => ({
  id, roomType: 'other', label: id, polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 5 }, { x: 0, z: 5 }], edges: ['wall', 'wall', 'wall', 'wall'],
});
const proposal = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1, source: 'ml-planes@1', rooms: [rect('r1')], openings: [], confidence: 0.3, ...over,
});

describe('C10 file validators round-trip', () => {
  it('report.json', () => {
    const f = {
      version: 1, generatedAt: '2026-11-12T00:00:00Z',
      experiments: [{ id: 'E2', variant: 'moge2-s', model: 'MoGe-2 ViT-S', licence: 'MIT', commercialOk: true, metrics: { a: 1.5, b: null }, passed: true, minutes: 2, peakMemoryGb: 1.2, notes: '' }],
    };
    expect(JSON.parse(JSON.stringify(validateReport(f)))).toEqual(f);
    expect(() => validateReport({ ...f, version: 2 })).toThrow();
  });
  it('registration.json', () => {
    const f = { version: 1, recipe: { extractorType: 'ALIKED_N16ROT', matcherType: 'ALIKED_LIGHTGLUE', extraArgs: ['--x', '1'] }, largestFragmentFrames: 210, fragments: 5, totalFrames: 355, commercialOk: true };
    expect(validateRegistration(f)).toEqual(f);
    expect(() => validateRegistration({ ...f, recipe: { ...f.recipe, extraArgs: [1] } })).toThrow();
  });
  it('scale.json and ceiling.json', () => {
    expect(validateScale(JSON.parse(JSON.stringify(scale)))).toEqual(scale);
    expect(validateCeiling(JSON.parse(JSON.stringify(ceiling)))).toEqual(ceiling);
    expect(() => validateScale({ ...scale, metresPerUnit: -1 })).toThrow();
    expect(() => validateCeiling({ ...ceiling, heightM: 40 })).toThrow();
  });
  it('frames-drop.json', () => {
    expect(validateFramesDrop({ version: 1, drop: ['f0003.jpg'] }).drop).toEqual(['f0003.jpg']);
    expect(() => validateFramesDrop({ version: 1, drop: ['../x.jpg'] })).toThrow();
  });
  it('layout-proposal.json shape', () => {
    const p = validateProposalShape(proposal());
    expect(p.rooms).toHaveLength(1);
    expect(() => validateProposalShape(proposal({ rooms: [{ id: 'x' }] }))).toThrow();
  });
  it('the path guard keeps experiments out', () => {
    expect(isShippableMlPath('ml/scale.json')).toBe(true);
    expect(isShippableMlPath('ml/experiments/depthpro/scale.json')).toBe(false);
    expect(isShippableMlPath('ml/../property.json')).toBe(false);
    expect(isShippableMlPath('property.json')).toBe(false);
  });
});

describe('splatWithMlScale', () => {
  it('scales an unpinned splat', () => {
    expect(splatWithMlScale(identity, scale).transform.scale).toBe(0.41);
  });
  it('rejects a spread over 10 with a warning and returns the splat unchanged', () => {
    const r = applyMlScale(identity, { ...scale, spreadPct: 10.5 });
    expect(r.applied).toBe(false);
    expect(r.warning).toMatch(/disagree/);
    expect(r.splat).toBe(identity);
    expect(splatWithMlScale(identity, { ...scale, spreadPct: 12 })).toBe(identity);
  });
  it('never rescales a pinned splat', () => {
    const pinned: SplatOverlay = { ...identity, transform: { rotation: [0, 0, 0, 1], scale: 0.9, position: [0, 0, 0] } };
    expect(splatWithMlScale(pinned, scale)).toBe(pinned);
    const moved: SplatOverlay = { ...identity, transform: { rotation: [0, 0, 0, 1], scale: 1, position: [1, 0, 0] } };
    expect(splatWithMlScale(moved, scale)).toBe(moved);
  });
  it('refuses a file marked non-commercial', () => {
    const r = applyMlScale(identity, { ...scale, commercialOk: false });
    expect(r.applied).toBe(false);
    expect(r.splat).toBe(identity);
  });
  it('hint text', () => {
    expect(mlScaleHint(scale)).toBe('Depth model suggests 1 unit = 0.41 m (±6%).');
  });
});

describe('proposalFromMl', () => {
  it('caps confidence at 0.4', () => {
    expect(proposalFromMl(proposal({ confidence: 0.9 }), null).confidence).toBe(0.4);
    expect(proposalFromMl(proposal({ confidence: 0.2 }), null).confidence).toBe(0.2);
  });
  it('drops a bow-tie room with a warning and its openings', () => {
    const bow = { id: 'bow', roomType: 'other', label: 'bow', polygon: [{ x: 0, z: 0 }, { x: 4, z: 4 }, { x: 4, z: 0 }, { x: 0, z: 4 }], edges: ['wall', 'wall', 'wall', 'wall'] };
    const o = { id: 'o1', roomId: 'bow', edge: 0, type: 'opening', centreM: 1, widthM: 0.9, sillM: 0, headM: 2 };
    const p = proposalFromMl(proposal({ rooms: [rect('r1'), bow], openings: [o] }), null);
    expect(p.rooms.map((r) => r.id)).toEqual(['r1']);
    expect(p.openings).toEqual([]);
    expect((p.notes ?? []).join(' ')).toMatch(/crosses itself/);
  });
  it('normalises a clockwise room and takes the wall height from the ceiling file', () => {
    const cw = { ...(rect('cw') as object), polygon: [{ x: 0, z: 0 }, { x: 0, z: 5 }, { x: 4, z: 5 }, { x: 4, z: 0 }] };
    const p = proposalFromMl(proposal({ rooms: [cw], wallHeightM: 2.5 }), ceiling);
    expect(p.wallHeightM).toBe(2.7);
    const layout: Layout = {
      wallHeightM: 2.7, wallThicknessM: 0.12, railingHeightM: 1.1, rooms: p.rooms, openings: p.openings, finishes: DEFAULT_FINISHES, scaleSource: 'scan',
    };
    expect(validateLayout(layout).errors).toEqual([]);
  });
});

describe('scripts/ml-apply applyScene', () => {
  const mk = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-apply-'));
    fs.mkdirSync(path.join(d, 'ml'));
    return d;
  };
  it('writes proposal.json when none exists and skips when it does', () => {
    const d = mk();
    fs.writeFileSync(path.join(d, 'ml/layout-proposal.json'), JSON.stringify(proposal({ confidence: 0.9 })));
    const a = applyScene(d, false);
    expect(a.did.join(' ')).toMatch(/Wrote proposal.json/);
    expect(JSON.parse(fs.readFileSync(path.join(d, 'proposal.json'), 'utf8')).confidence).toBe(0.4);
    const b = applyScene(d, false);
    expect(b.did).toEqual([]);
    expect(b.skipped.join(' ')).toMatch(/already exists/);
  });
  it('refuses a proposal whose source is not ml-planes', () => {
    const d = mk();
    fs.writeFileSync(path.join(d, 'ml/layout-proposal.json'), JSON.stringify(proposal({ source: 'depthpro@x' })));
    const r = applyScene(d, false);
    expect(r.did).toEqual([]);
    expect(fs.existsSync(path.join(d, 'proposal.json'))).toBe(false);
  });
  it('refuses a non-commercial ceiling file', () => {
    const d = mk();
    fs.writeFileSync(path.join(d, 'ml/ceiling.json'), JSON.stringify({ ...ceiling, commercialOk: false }));
    expect(applyScene(d, false).skipped.join(' ')).toMatch(/not commercial-OK/);
  });
});
