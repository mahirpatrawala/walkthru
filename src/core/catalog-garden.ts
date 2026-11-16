// Garden pieces (SPEC 19.4): benches, a pergola, lamp posts and bollards, a children's play area (slide, swings, see-saw, climbing frame, rubber
// safety surfacing), a jogging track segment, a yoga deck and a water feature. Fall zones and run-outs are assumptions ("typical guidance").
import type { Side } from '../types';
import { arc, operate, piece } from './catalog-more';
import type { Def, MorePiece } from './catalog-more';
import type { Zone } from './pieces';

const GARDEN: Def['places'] = ['garden'];
const GUIDE = 'typical guidance, check your consultant';
type GDef = Omit<Def, 'kind' | 'family' | 'look'> & Partial<Pick<Def, 'kind' | 'family'>>;
const garden = (o: GDef): MorePiece => piece({ places: GARDEN, kind: 'counter', family: null, look: 'garden', ...o });
const fall = (id: string, sides: Side[], m: number, what: string, blocked: string, tight: string, tf = 0.7): Zone => ({
  id, sides, needM: m, where: sides.length === 4 ? 'all round' : sides.length === 2 && sides[0] === 'left' ? 'at each end' : 'on each side', assumption: `${what} (${GUIDE})`, blockedText: blocked, tightText: tight, tightFrac: tf,
});
const FOUR: Side[] = ['front', 'back', 'left', 'right'];

export const GARDEN_PIECES: MorePiece[] = [
  garden({
    id: 'garden-bench', name: 'Park bench, 3-seat', cat: 'seating', kind: 'sofa', w: 1.8, d: 0.62, h: 0.82, s: 0.45,
    label: '180 × 62 cm, seat 45 cm, teak slats on cast-iron ends', params: { variant: 'bench' }, family: 'chair', pose: 'sit', kw: 'bench park bench garden seat wooden slat outdoor three seater', prompt: 'Sit on the bench', up: 'Get up', probe: [0, 0.05],
  }),
  garden({
    id: 'garden-bench-senior', name: 'Senior seating bench', cat: 'seating', kind: 'sofa', w: 1.6, d: 0.65, h: 0.95, s: 0.5,
    label: '160 × 65 cm, seat 50 cm with arm rests', params: { variant: 'senior-bench' }, family: 'chair', pose: 'sit', kw: 'bench senior seating arm rest elderly old garden high seat easy get up', prompt: 'Sit on the bench', up: 'Get up', probe: [0, 0.05],
    note: 'A higher seat (50 cm) with arm rests and a firm back makes it easier to get up from. Keep a level path to it.',
  }),
  garden({
    id: 'garden-pergola', name: 'Pergola with a bench', cat: 'amenities', w: 2.6, d: 1.1, h: 2.5, s: 0.45,
    label: '260 × 110 cm, four posts, slatted roof at 250 cm, bench inside', params: { variant: 'pergola' }, pose: 'dims', kw: 'pergola gazebo shade arbour bench timber posts garden roof cover',
    note: 'A timber pergola over a bench: the roof slats cast a striped shade. Its footprint is solid in the walk; a free-standing gazebo is not offered.',
  }),
  garden({
    id: 'garden-lamp-post', name: 'Lamp post', cat: 'decor', w: 0.3, d: 0.3, h: 3.6, s: 3.6,
    label: '30 cm base, 360 cm, lantern on top (lit from evening)', params: { variant: 'lamp-post' }, pose: 'dims', kw: 'lamp post light pole garden path lantern street light evening night',
    note: 'The lantern is lit in the evening and at night. The power and its cable are not on a drawing.',
  }),
  garden({
    id: 'garden-bollard', name: 'Bollard light', cat: 'decor', w: 0.22, d: 0.22, h: 0.85, s: 0.85,
    label: '22 cm, 85 cm high (lit from evening)', params: { variant: 'bollard' }, pose: 'dims', kw: 'bollard light path lamp low garden track evening night',
  }),
  garden({
    id: 'garden-slide', name: 'Slide, 1.2 m platform', cat: 'amenities', w: 0.8, d: 2.7, h: 1.9, s: 1.2,
    label: '80 × 270 cm, platform at 120 cm, slide chute to the front', params: { variant: 'slide' }, pose: 'dims', kw: 'slide kids children play playground chute climb',
    sideWords: { front: 'at the bottom of the slide', back: 'behind the ladder' },
    zones: [
      fall('runout', ['front'], 1.5, '1.5 m clear beyond the end of the chute', 'children land on {obs}', 'the run-out would be short', 0.75),
      fall('fall', ['left', 'right', 'back'], 1.5, '1.5 m clear to the sides and behind', 'a fall would land on {obs}', 'the fall zone is short', 0.75),
    ],
    note: 'A platform at 120 cm gives a free fall height of about 1.2 m, and the surfacing under and round it should be impact absorbing (rubber, sand or wood fibre), not paving or bare lawn.',
  }),
  garden({
    id: 'garden-swingset', name: 'Swing set, two seats', cat: 'amenities', w: 3.0, d: 1.8, h: 2.3, s: 0.5,
    label: '300 × 180 cm frame, top bar at 220 cm, two seats on chains', params: { variant: 'swingset' }, pose: 'dims', kw: 'swing set kids children play playground jhoola seats chains',
    sideWords: { front: 'in front of the swings', back: 'behind the swings' },
    zones: [
      arc(30, 2.2, 0.2, { sides: ['front', 'back'], minNeedM: 1.75, where: 'in front and behind', attachM: 0.55 }),
      fall('sides', ['left', 'right'], 1.5, '1.5 m clear at each end', 'a child would hit {obs}', 'the end zone is short', 0.75),
    ],
    note: 'The swing arc is worked out as for a jhoola (30 degrees each way from a 220 cm beam on 1.65 m chains) with a floor of 1.75 m in front and behind. Surface under and round it should absorb impact.',
  }),
  garden({
    id: 'garden-seesaw', name: 'See-saw', cat: 'amenities', w: 2.4, d: 0.36, h: 0.72, s: 0.55,
    label: '240 × 36 cm plank, pivot at 40 cm, seats at 55 cm', params: { variant: 'seesaw' }, pose: 'dims', kw: 'see saw seesaw teeter kids children play playground balance',
    zones: [fall('fall', FOUR, 1.5, '1.5 m clear all round', 'a fall would land on {obs}', 'the fall zone is short', 0.75)],
  }),
  garden({
    id: 'garden-climber', name: 'Climbing frame', cat: 'amenities', w: 2.0, d: 2.0, h: 2.4, s: 1.2,
    label: '200 × 200 cm, top at 240 cm, platform at 120 cm, net and ladder', params: { variant: 'climber' }, pose: 'dims', kw: 'climbing frame jungle gym climber net kids children play playground',
    zones: [fall('fall', FOUR, 1.8, '1.8 m clear all round for a fall from the top', 'a fall would land on {obs}', 'the fall zone is short', 0.75)],
    note: 'A fall from the 240 cm top is the free fall height here, so the fall zone is 1.8 m and the surface is impact absorbing.',
  }),
  garden({
    id: 'garden-rubber-mat', name: 'Rubber safety surfacing', cat: 'amenities', w: 2.0, d: 2.0, h: 0.02, s: 0.02,
    label: '200 × 200 cm, 2 cm thick rubber tiles (impact absorbing)', params: { variant: 'rubber-mat', colour: '#B5483A' }, pose: 'walk-on', kw: 'rubber mat surfacing safety surface play area tiles epdm fall protection floor',
    note: 'Rubber tiles are walked over. Their thickness sets how far a child may fall onto them safely: that is a product figure to ask the supplier for, not a model figure.',
  }),
  garden({
    id: 'garden-track', name: 'Jogging track segment', cat: 'amenities', w: 6.0, d: 1.5, h: 0.015, s: 0.015,
    label: '600 × 150 cm, rubberised, with a lane line', params: { variant: 'track' }, pose: 'walk-on', kw: 'jogging track running walking path rubber track segment exercise walk',
    note: 'A track for one runner abreast is about 1.2 m wide and two abreast 1.5 to 2 m. Segments butt end to end; a bend is not modelled.',
  }),
  garden({
    id: 'garden-yoga-deck', name: 'Yoga deck with mats', cat: 'amenities', w: 3.0, d: 3.0, h: 0.05, s: 0.05,
    label: '300 × 300 cm timber platform, four mats', params: { variant: 'yoga-deck' }, pose: 'walk-on', kw: 'yoga deck lawn mat platform exercise stretching meditation garden',
    note: 'Four mats (61 × 183 cm each) at an arm\'s span apart on a low platform that keeps them off the damp lawn.',
  }),
  garden({
    id: 'garden-fountain', name: 'Water feature, 1.6 m bowl', cat: 'decor', w: 1.6, d: 1.6, h: 1.1, s: 0.55,
    label: '160 cm stone bowl, a jet at 110 cm', params: { variant: 'fountain' }, pose: 'dims', kw: 'fountain water feature bowl pond jet garden plaza stone',
    note: 'A shallow stone bowl with a jet. It needs a pump, a power point and a drain: none of them are on a drawing.',
  }),
];
