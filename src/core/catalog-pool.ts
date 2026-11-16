// Pool-side pieces (SPEC 19.3): loungers, a parasol, chairs and a table, a shower post, a towel rack, a lifeguard chair, a life-ring post,
// a depth sign, a changing-room marker and a deck planter. Every clearance is an assumption and its sentence says so ("typical guidance").
import type { Side } from '../types';
import { operate, piece } from './catalog-more';
import type { Def, MorePiece } from './catalog-more';
import type { Zone } from './pieces';

const POOL: Def['places'] = ['pool'];
const GUIDE = 'typical guidance, check your consultant';
type PDef = Omit<Def, 'kind' | 'family' | 'look'> & Partial<Pick<Def, 'kind' | 'family'>>;
const pool = (o: PDef): MorePiece => piece({ places: POOL, kind: 'counter', family: null, look: 'pool', ...o });
const between = (id: string, sides: Side[], m: number, what: string, blocked: string, tight: string, tf = 0.7): Zone => ({
  id, sides, needM: m, where: sides.length === 4 ? 'all round' : sides.length === 2 && sides[0] === 'left' ? 'on each side' : 'in front', assumption: `${what} (${GUIDE})`, blockedText: blocked, tightText: tight, tightFrac: tf,
});

export const POOL_PIECES: MorePiece[] = [
  pool({
    id: 'pool-lounger', name: 'Pool lounger', cat: 'seating', kind: 'sofa', w: 0.7, d: 2.0, h: 0.8, s: 0.38,
    label: '70 × 200 cm, back raised to 80 cm, seat 38 cm', params: { variant: 'lounger' }, family: 'chair', pose: 'dims', kw: 'lounger sun lounger pool chair sunbed deck chair reclining relax poolside',
    zones: [between('spacing', ['left', 'right'], 0.6, '60 cm beside it so a person can step between loungers', 'there is no room to step beside it, {obs} is too close', 'a person would squeeze past', 0.7)],
    note: 'A resin or teak sun lounger is about 70 wide and 195 to 205 long, the back adjusts, the seat is about 38 cm. Allow room to pull one round to follow the sun.',
  }),
  pool({
    id: 'pool-umbrella', name: 'Parasol on a base', cat: 'amenities', w: 0.55, d: 0.55, h: 2.4, s: 2.4,
    label: 'canopy 250 cm across, 240 cm high, base 55 cm', params: { variant: 'umbrella', canopyM: 2.5 }, pose: 'dims', kw: 'parasol umbrella shade pool sun cover canopy base poolside',
    note: 'The footprint is the base; the canopy (about 250 cm across, lowest edge at 2.1 m) reaches beyond it and is drawn, not counted as floor taken. It needs a weighted base: a loose parasol is a hazard in wind.',
  }),
  pool({
    id: 'pool-chair', name: 'Pool-side chair', cat: 'seating', kind: 'sofa', w: 0.62, d: 0.64, h: 0.85, s: 0.43,
    label: '62 × 64 cm, seat 43 cm, resin', params: { variant: 'chair' }, family: 'chair', pose: 'chair', kw: 'pool chair armchair resin outdoor patio chair poolside seat', prompt: 'Sit on the chair', up: 'Get up', probe: [0, 0],
  }),
  pool({
    id: 'pool-table', name: 'Pool-side table, 90 cm', cat: 'seating', w: 0.9, d: 0.9, h: 0.72, s: 0.72,
    label: '90 cm across, 72 cm high', params: { variant: 'table' }, pose: 'dims', kw: 'table round outdoor patio poolside cafe drinks',
    zones: [between('chairs', ['front', 'back', 'left', 'right'], 0.7, '70 cm all round for chairs pulled out', 'chairs cannot be pulled out, {obs} is in the way', 'the chairs would be cramped')],
  }),
  pool({
    id: 'pool-shower', name: 'Outdoor shower post', cat: 'amenities', w: 0.4, d: 0.4, h: 2.3, s: 2.3,
    label: '40 × 40 cm, shower head at 230 cm, foot wash at the base', params: { variant: 'shower' }, pose: 'stand', kw: 'shower post outdoor pool rinse foot wash steel stainless poolside', prompt: 'Stand under the shower', up: 'Step back',
    sideWords: { front: 'where you stand' },
    zones: [operate('rinse', 0.9, '90 cm in front to stand under it', 'there is no room to stand, {obs} is in the way', 'it would be cramped', { assumption: `90 cm in front to stand under it (${GUIDE})`, tightFrac: 0.75 })],
    note: 'It needs a cold-water point and a drain under its tray: neither is on a drawing. Place it clear of the walkway round the water.',
  }),
  pool({
    id: 'pool-towel-rack', name: 'Towel rack', cat: 'amenities', w: 1.2, d: 0.4, h: 1.15, s: 1.15,
    label: '120 × 40 cm, rails at 115 cm', params: { variant: 'towel' }, pose: 'dims', kw: 'towel rack rail stand pool dry hanger poolside',
  }),
  pool({
    id: 'pool-lifeguard-chair', name: 'Lifeguard chair', cat: 'amenities', kind: 'sofa', w: 0.9, d: 1.1, h: 2.1, s: 1.45,
    label: '90 × 110 cm, seat at 145 cm, ladder at the back', params: { variant: 'lifeguard' }, pose: 'dims', kw: 'lifeguard chair tower high seat pool safety',
    note: 'A raised seat for watching the water. Whether a residential pool needs a lifeguard is set by your local pool code, not by this model.',
  }),
  pool({
    id: 'pool-life-ring', name: 'Life-ring post', cat: 'amenities', w: 0.5, d: 0.3, h: 1.5, s: 1.5,
    label: 'post 150 cm high with a ring and a line', params: { variant: 'life-ring' }, pose: 'dims', kw: 'life ring buoy lifebuoy post rescue safety pool',
    note: 'A rescue ring with a line, kept within reach of the water. Number and place of them are set by your local pool code.',
  }),
  pool({
    id: 'pool-depth-sign', name: 'Depth sign', cat: 'amenities', w: 0.5, d: 0.08, h: 1.1, s: 1.1,
    label: '50 × 8 cm plate on a post, 110 cm high', params: { variant: 'depth-sign', text: '1.2 m' }, pose: 'dims', kw: 'depth sign pool marker warning no diving shallow deep',
    note: 'A plate on a post at the side of the pool. The numeral is the depth you choose; the model does not read it from the pool.',
  }),
  pool({
    id: 'pool-changing-sign', name: 'Changing-room door marker', cat: 'amenities', w: 0.45, d: 0.06, h: 0.45, s: 0.45,
    label: '45 × 45 cm plate, its lower edge at 1.7 m, on a wall', params: { variant: 'changing-sign' }, pose: 'dims', kw: 'changing room sign door marker plate men women pool wall',
    mountY: 1.7, wall: true, note: 'A plate on the wall beside a changing-room door. The doors themselves are not modelled in this space.',
  }),
  pool({
    id: 'pool-deck-planter', name: 'Deck planter', cat: 'decor', w: 0.8, d: 0.8, h: 1.1, s: 0.6,
    label: '80 × 80 cm, 60 cm tall pot with a palm', params: { variant: 'planter' }, pose: 'dims', kw: 'planter pot palm deck plant poolside green tub', places: ['pool', 'garden'],
  }),
];
