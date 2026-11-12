// C12a: the metrics and bars of SPEC 17.11, as data. A field is scored as right/expected; F1 fields also carry tp/pred.
export type Variant = 'vector' | 'raster';
export interface FieldDef { key: string; label: string; tolerance: string; vector: number | null; raster: number | null; /** 'max' bars must stay at or under */ dir: 'min' | 'max' }
export const FIELDS: FieldDef[] = [
  { key: 'rooms', label: 'Rooms found and typed (F1)', tolerance: 'type must match', vector: 0.92, raster: 0.8, dir: 'min' },
  { key: 'roomSize', label: 'Room width and length', tolerance: '2%', vector: 0.9, raster: 0.7, dir: 'min' },
  { key: 'roomArea', label: 'Room area', tolerance: '3%', vector: 0.9, raster: 0.7, dir: 'min' },
  { key: 'openings', label: 'Openings found (F1)', tolerance: 'type + 0.45 m', vector: 0.85, raster: 0.65, dir: 'min' },
  { key: 'openingWidth', label: 'Opening width', tolerance: '5 cm', vector: 0.85, raster: 0.6, dir: 'min' },
  { key: 'dimStrings', label: 'Dimension strings read', tolerance: 'exact string', vector: 0.95, raster: 0.85, dir: 'min' },
  { key: 'furniture', label: 'Furniture found (F1)', tolerance: 'class + 0.5 m', vector: 0.85, raster: 0.65, dir: 'min' },
  { key: 'furnitureSize', label: 'Furniture size', tolerance: '5 cm', vector: 0.85, raster: 0.6, dir: 'min' },
  { key: 'fixtures', label: 'Fixtures and chairs classified (F1)', tolerance: 'class + 0.5 m', vector: 0.8, raster: 0.65, dir: 'min' },
  { key: 'elevLink', label: 'Elevation linked to the right wall', tolerance: 'exact wall', vector: 0.9, raster: null, dir: 'min' },
  { key: 'heights', label: 'Ceiling, sill, head, bed heights', tolerance: '2 cm', vector: 0.9, raster: null, dir: 'min' },
  { key: 'unitBays', label: 'Unit bays and shutters per bay', tolerance: 'exact', vector: 0.85, raster: null, dir: 'min' },
  { key: 'hinge', label: 'Hinge side, where drawn', tolerance: 'exact', vector: 0.85, raster: null, dir: 'min' },
  { key: 'conflicts', label: 'Planted wrong strings surfaced', tolerance: 'flagged conflict', vector: 0.95, raster: 0.8, dir: 'min' },
  { key: 'wrongVerified', label: 'Verified values that are wrong', tolerance: 'as above', vector: 0.005, raster: 0.005, dir: 'max' },
  { key: 'brokerShare', label: 'Share of values the broker must look at', tolerance: 'count', vector: 0.3, raster: 1.0, dir: 'max' },
];
export const FIELD_KEYS = FIELDS.map((f) => f.key);
