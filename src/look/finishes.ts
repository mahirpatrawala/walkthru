// The finish palette: ids that a style pack, a design sheet and a viewer's choice (`FurnitureItem.finish`) all name. Each id is a
// colour and the kind of material it is made of (a key of furniture-materials.ts), nothing else: a finish never carries a size.
// Another branch (furnish-edit) owns the full palette and its UI; this file has the same shape so the two merge as one table.
import type { MatKey } from './furniture-materials';

export type FinishKind = 'wood' | 'laminate' | 'paint' | 'fabric' | 'metal' | 'stone' | 'tile' | 'sheer';
export interface FinishDef {
  id: string;
  name: string;
  /** '#rrggbb', the mean colour of the finished surface */
  colour: string;
  /** the material kind it is made of */
  material: MatKey;
  kind: FinishKind;
}

const F = (id: string, name: string, colour: string, material: MatKey, kind: FinishKind): FinishDef => ({ id, name, colour, material, kind });

export const FINISH_LIST: FinishDef[] = [
  // woods: one oak grain, tinted to the species
  F('oak', 'Natural oak', '#CDAB8A', 'wood', 'wood'),
  F('oak-light', 'Light oak', '#D9BC92', 'wood', 'wood'),
  F('ash-white', 'White-washed ash', '#E3D7C4', 'wood', 'wood'),
  F('walnut', 'Walnut', '#7B5B45', 'wood', 'wood'),
  F('teak', 'Teak', '#A9713F', 'wood', 'wood'),
  // laminates and lacquers
  F('white-laminate', 'White laminate', '#F1EFEA', 'laminate', 'laminate'),
  F('white-gloss', 'White gloss', '#F6F4F0', 'gloss', 'laminate'),
  F('cream-laminate', 'Cream laminate', '#E4D8C4', 'laminate', 'laminate'),
  F('navy-matte', 'Navy matte laminate', '#3D4A70', 'laminate', 'laminate'),
  F('charcoal-matte', 'Charcoal matte laminate', '#3B3D41', 'laminate', 'laminate'),
  F('sage-matte', 'Sage matte laminate', '#8C9A86', 'laminate', 'laminate'),
  F('grey-matte', 'Light grey matte laminate', '#B9B8B3', 'laminate', 'laminate'),
  // paints
  F('wall-beige', 'Warm beige paint', '#E9DAC4', 'paint', 'paint'),
  F('wall-cream', 'Cream paint', '#EFE6D6', 'paint', 'paint'),
  F('wall-white', 'Warm white paint', '#F2EFE9', 'paint', 'paint'),
  F('wall-greige', 'Greige paint', '#D3C9BB', 'paint', 'paint'),
  F('wall-stone', 'Stone grey paint', '#CFCCC5', 'paint', 'paint'),
  F('ceiling-white', 'Ceiling white', '#F7F5F0', 'paint', 'paint'),
  // fabrics
  F('linen-beige', 'Beige linen', '#CDBBA3', 'weave', 'fabric'),
  F('quilt-beige', 'Beige quilted cotton', '#DACBB5', 'quilt', 'fabric'),
  F('quilt-white', 'White quilted cotton', '#EEEBE4', 'quilt', 'fabric'),
  F('cotton-white', 'White cotton', '#F1EEE8', 'cotton', 'fabric'),
  F('weave-grey', 'Grey weave', '#8E9AA6', 'weave', 'fabric'),
  F('weave-charcoal', 'Charcoal weave', '#4A4C52', 'weave', 'fabric'),
  F('weave-sand', 'Sand weave', '#B9A88F', 'weave', 'fabric'),
  F('weave-sage', 'Sage weave', '#8E9B84', 'weave', 'fabric'),
  F('weave-navy', 'Navy weave', '#2B3A5C', 'weave', 'fabric'),
  F('ticking-navy', 'Navy ticking stripe', '#FFFFFF', 'stripe', 'fabric'),
  F('shag-grey', 'Grey shag', '#B3AEA6', 'shag', 'fabric'),
  F('shag-ivory', 'Ivory shag', '#D9D2C4', 'shag', 'fabric'),
  F('drape-grey', 'Grey drape', '#A0A3A8', 'drape', 'fabric'),
  F('drape-sand', 'Sand drape', '#B7A68E', 'drape', 'fabric'),
  F('drape-sage', 'Sage drape', '#8D9886', 'drape', 'fabric'),
  F('sheer-white', 'White sheer', '#F7F4EE', 'sheer', 'sheer'),
  // metals and stone
  F('black-metal', 'Matt black metal', '#1D1D1F', 'blackMetal', 'metal'),
  F('brass', 'Brushed brass', '#D4AD66', 'brass', 'metal'),
  F('steel', 'Brushed steel', '#B8B8B8', 'metal', 'metal'),
  F('black-stone', 'Black stone', '#1B1B1D', 'granite', 'stone'),
  F('white-stone', 'White stone', '#E9E6E0', 'gloss', 'stone'),
  // floors
  F('tile-beige-gloss', 'Glossy beige tile', '#EBDCC6', 'gloss', 'tile'),
  F('tile-ivory-gloss', 'Glossy ivory tile', '#ECE4D6', 'gloss', 'tile'),
  F('tile-grey', 'Soft grey tile', '#C9C6C0', 'gloss', 'tile'),
  F('tile-sand', 'Sand tile', '#D8C9AE', 'gloss', 'tile'),
];

export const FINISHES: Record<string, FinishDef> = Object.fromEntries(FINISH_LIST.map((f) => [f.id, f]));

export function finishDef(id: string | undefined | null): FinishDef | null {
  return id ? FINISHES[id] ?? null : null;
}

/** ids of one kind, for a picker */
export function finishesOfKind(kind: FinishKind): FinishDef[] {
  return FINISH_LIST.filter((f) => f.kind === kind);
}
