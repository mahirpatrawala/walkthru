// Owned by C10. SPEC 15.7: tsx scripts/ml-apply.ts --scene <id> [--force]
// Applies a scene's ml/ outputs: proposal.json from ml/layout-proposal.json (when none exists), and the splat scale in
// property.json (only when the splat is unpinned). Refuses non-commercial files and anything under ml/experiments/.
import fs from 'node:fs';
import path from 'node:path';
import { applyMlScale, proposalFromMl } from '../src/ml/apply';
import { isShippableMlPath, validateCeiling, validateScale } from '../src/ml/outputs';
import type { MlCeilingFile, MlScaleFile } from '../src/ml/outputs';
import { validateProperty } from '../src/core/layout-validate';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function applyScene(sceneDir: string, force: boolean): { did: string[]; skipped: string[] } {
  const did: string[] = [];
  const skipped: string[] = [];
  const rel = (name: string): string => `ml/${name}`;
  const mlFile = (name: string): string | null => {
    if (!isShippableMlPath(rel(name))) { skipped.push(`${rel(name)}: not a shippable path.`); return null; }
    const f = path.join(sceneDir, rel(name));
    return fs.existsSync(f) ? f : null;
  };

  // ceiling
  let ceiling: MlCeilingFile | null = null;
  const cf = mlFile('ceiling.json');
  if (cf) {
    try {
      const c = validateCeiling(readJson(cf));
      if (!c.commercialOk) skipped.push('ml/ceiling.json: refused, the model is not commercial-OK.');
      else ceiling = c;
    } catch (e) { skipped.push(`ml/ceiling.json: ${(e as Error).message}`); }
  }

  // proposal
  const pf = mlFile('layout-proposal.json');
  const target = path.join(sceneDir, 'proposal.json');
  if (pf) {
    if (fs.existsSync(target) && !force) skipped.push('proposal.json already exists (use --force to replace it).');
    else {
      try {
        const raw = readJson(pf) as { source?: unknown };
        if (typeof raw.source !== 'string' || !raw.source.startsWith('ml-planes@')) throw new Error('source is not ml-planes@N, refusing.');
        const out = proposalFromMl(raw, ceiling);
        fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
        did.push(`Wrote proposal.json (${out.rooms.length} room, confidence ${out.confidence}).`);
      } catch (e) { skipped.push(`ml/layout-proposal.json: ${(e as Error).message}`); }
    }
  }

  // splat scale
  const sf = mlFile('scale.json');
  if (sf) {
    const propFile = path.join(sceneDir, 'property.json');
    if (!fs.existsSync(propFile)) skipped.push('Scale not applied: no property.json.');
    else {
      try {
        const scale: MlScaleFile = validateScale(readJson(sf));
        const prop = validateProperty(readJson(propFile));
        if (!prop.splat) skipped.push('Scale not applied: property.json has no splat.');
        else {
          const r = applyMlScale(prop.splat, scale);
          if (!r.applied) skipped.push(r.warning ?? 'Scale not applied.');
          else {
            prop.splat = r.splat;
            validateProperty(prop);
            fs.writeFileSync(propFile, JSON.stringify(prop, null, 2) + '\n');
            did.push(`Set splat scale to ${scale.metresPerUnit} (spread ${scale.spreadPct.toFixed(1)}%, ${scale.model}).`);
          }
        }
      } catch (e) { skipped.push(`ml/scale.json: ${(e as Error).message}`); }
    }
  }
  return { did, skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const si = args.indexOf('--scene');
  const scene = si >= 0 ? args[si + 1] : undefined;
  if (!scene || !/^[a-z0-9-]{1,40}$/.test(scene)) {
    console.error('usage: tsx scripts/ml-apply.ts --scene <id> [--force]');
    process.exit(2);
  }
  const { did, skipped } = applyScene(path.join(ROOT, 'public', 'scenes', scene), args.includes('--force'));
  for (const d of did) console.log(`did:     ${d}`);
  for (const s of skipped) console.log(`skipped: ${s}`);
  if (!did.length && !skipped.length) console.log('nothing to apply (no ml/ outputs).');
}
