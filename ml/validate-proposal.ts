// Runs the app's own validateLayout on an ml/layout-proposal.json. Used by e4_layout.py. Prints JSON.
//   tsx ml/validate-proposal.ts <path to layout-proposal.json>
import fs from 'node:fs';
import { proposalFromMl } from '../src/ml/apply';
import { validateLayout } from '../src/core/layout-validate';
import { DEFAULT_FINISHES } from '../src/types';

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const p = proposalFromMl(raw, null);
const v = validateLayout({
  wallHeightM: p.wallHeightM ?? 2.75, wallThicknessM: 0.12, railingHeightM: 1.1, rooms: p.rooms, openings: p.openings,
  finishes: DEFAULT_FINISHES, scaleSource: 'scan',
});
console.log(JSON.stringify({ errors: v.errors, warnings: v.warnings, rooms: p.rooms.length, openings: p.openings.length, confidence: p.confidence, notes: p.notes }));
