// The committed Sample Tower (public/buildings, public/scenes/st-* and se-*), read the way the site serves it.
import fs from 'node:fs';
import path from 'node:path';
import { validateProperty } from '../../src/core/layout-validate';
import { parseBuilding } from '../../src/building/parse';
import type { BuildingFile } from '../../src/building/types';
import type { PropertyFile } from '../../src/types';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const readBuilding = (id: string): BuildingFile => parseBuilding(JSON.parse(fs.readFileSync(path.join(ROOT, 'public/buildings', id, 'building.json'), 'utf8')));
export const readScene = (id: string): PropertyFile | undefined => {
  const f = path.join(ROOT, 'public/scenes', id, 'property.json');
  return fs.existsSync(f) ? validateProperty(JSON.parse(fs.readFileSync(f, 'utf8'))) : undefined;
};
export const rawBuilding = (id: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/buildings', id, 'building.json'), 'utf8'));
export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
