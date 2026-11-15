// Gym equipment at commercial size (SPEC 16.17). One row and one rule each, like catalog-more.ts; every row is offered in a gym only (`places`).
// Sizes w (across the front) x d (depth) x h (total height) are typical commercial machine sizes: each note names the range the number sits in.
// Orientation: the BACK of a machine (its console, mast, stack, backrest or rack) is at -z, so squaring it to a wall puts the right end to the wall;
// the FRONT is the open end where you step on or get in, and is where the use zone is. A bench's head end is its back (like a bed).
// Honesty (SPEC 16.2): every use zone is an assumption, and the sentence says which. "Typical guidance, check your consultant": no code is claimed.
import type { AccessRule, Side } from '../types';
import type { Zone } from './pieces';
import { FRONT, arc, operate, piece } from './catalog-more';
import type { Def, MorePiece } from './catalog-more';

const GYM: Def['places'] = ['gym'];
const GUIDE = 'typical guidance, check your consultant';

/** a use zone beyond the sides named, with the standard words of a gym */
function zone(id: string, sides: Side[], needM: number, where: string, assumption: string, blocked: string, tight: string, o: Partial<Zone> = {}): Zone {
  return { id, sides, needM, where, assumption: `${assumption} (${GUIDE})`, blockedText: blocked, tightText: tight, tightFrac: 0.75, ...o };
}
const SIDES = (m: number, what = 'between machines', tf = 0.8): Zone => zone('sides', ['left', 'right'], m, 'on each side', `${Math.round(m * 100)} cm ${what}`, 'there is no room to get on or off, {obs} is in the way', 'the gap to the next machine is narrow', { tightFrac: tf });

/** the words of a machine seen from its front (where you step on or get in) */
const MACHINE_WORDS: Partial<Record<Side, string>> = { front: 'at the open end', back: 'at the back' };

/** access: the open end needs a person's width */
const GET_ON = (m: number): AccessRule[] => [FRONT(m)];

type GymDef = Omit<Def, 'kind' | 'family'> & Partial<Pick<Def, 'kind' | 'family'>>;
const gym = (o: GymDef): MorePiece => piece({ places: GYM, kind: 'counter', family: null, ...o });

export const GYM_PIECES: MorePiece[] = [
  // ------------------------------------------------------------ cardio
  gym({
    id: 'gym-treadmill', name: 'Treadmill, commercial', cat: 'cardio', w: 0.9, d: 2.1, h: 1.5, s: 0.22,
    label: '90 × 210 × 150 cm, belt 55 × 150 cm', look: 'cardio', params: { variant: 'treadmill' }, pose: 'walk-on', kw: 'treadmill running walking cardio belt commercial gym machine',
    prompt: 'Step on the treadmill', up: 'Step off', access: GET_ON(0.6), sideWords: { ...MACHINE_WORDS, front: 'behind the belt', back: 'at the console end' },
    zones: [
      zone('runoff', ['front'], 2.0, 'behind the belt', '2 m clear behind the belt to step off and to stop safely, many suppliers give 1 m as the least', 'there is no safe room behind the belt, {obs} is too close', 'a stop or a slip would have little room behind the belt', { tightFrac: 0.5 }),
      SIDES(0.5, 'at each side to step on and to pass'),
    ],
    note: 'Commercial treadmills measure 200 to 216 long, 82 to 97 wide and 145 to 160 cm high (Life Fitness Aspire 212 × 92 × 147, Matrix 201 × 90 × 164, a gym-equipment guide 216 × 97 × 157). The console end goes to the wall; the step-on end is the front.',
  }),
  gym({
    id: 'gym-cross', name: 'Cross trainer (elliptical)', cat: 'cardio', w: 0.75, d: 1.85, h: 1.7, s: 0.2,
    label: '75 × 185 × 170 cm', look: 'cardio', params: { variant: 'cross' }, pose: 'dims', kw: 'cross trainer elliptical orbitrek cardio commercial gym machine',
    access: GET_ON(0.6), sideWords: MACHINE_WORDS,
    zones: [operate('step-on', 0.6, '60 cm behind to step on and off', 'there is no room to step on', 'stepping on is tight', { where: 'behind the pedals', assumption: `60 cm behind the pedals to step on and off (${GUIDE})`, tightFrac: 0.75 }), SIDES(0.5)],
    note: 'Commercial cross trainers are 170 to 200 long, 70 to 80 wide and 165 to 175 cm high. The console end goes to the wall.',
  }),
  gym({
    id: 'gym-upright-bike', name: 'Upright bike', cat: 'cardio', w: 0.6, d: 1.25, h: 1.35, s: 0.8,
    label: '60 × 125 × 135 cm, saddle at 80 cm', look: 'cardio', params: { variant: 'upright' }, pose: 'chair', seat: { z: 0.29, face: -1 }, kw: 'upright bike exercise cycle cycling cardio commercial gym machine',
    prompt: 'Sit on the bike', up: 'Get off', access: GET_ON(0.5), sideWords: MACHINE_WORDS,
    zones: [operate('mount', 0.5, '50 cm to the side or behind to get on', 'there is no room to get on', 'getting on is tight', { where: 'at the open end', assumption: `50 cm to get on (${GUIDE})`, tightFrac: 0.75 }), SIDES(0.5)],
    note: 'Commercial upright bikes are 110 to 140 long, 55 to 65 wide and 130 to 145 cm high; the saddle adjusts about 70 to 95 cm.',
  }),
  gym({
    id: 'gym-spin-bike', name: 'Spin bike', cat: 'cardio', w: 0.52, d: 1.2, h: 1.15, s: 0.95,
    label: '52 × 120 × 115 cm, saddle at 95 cm', look: 'cardio', params: { variant: 'spin' }, pose: 'chair', seat: { z: 0.22, face: -1 }, kw: 'spin bike indoor cycle studio spinning cardio gym machine',
    prompt: 'Sit on the spin bike', up: 'Get off', access: GET_ON(0.5), sideWords: MACHINE_WORDS,
    zones: [operate('mount', 0.5, '50 cm to get on', 'there is no room to get on', 'getting on is tight', { where: 'at the open end', assumption: `50 cm to get on (${GUIDE})`, tightFrac: 0.75 }), SIDES(0.5, 'between bikes (a studio often uses 60)')],
    note: 'Studio spin bikes are 110 to 125 long, 48 to 55 wide and 110 to 120 cm high (a Keiser M3i is 122 × 53). The saddle is drawn at 95 cm; it adjusts.',
  }),
  gym({
    id: 'gym-recumbent', name: 'Recumbent bike', cat: 'cardio', w: 0.68, d: 1.65, h: 1.25, s: 0.5,
    label: '68 × 165 × 125 cm, seat at 50 cm', look: 'cardio', params: { variant: 'recumbent' }, pose: 'chair', seat: { z: 0.31, face: -1 }, kw: 'recumbent bike seated cycle cardio elderly gym machine',
    prompt: 'Sit on the recumbent bike', up: 'Get off', access: [{ sides: ['left', 'right'], minM: 0.5, mode: 'any' }], sideWords: MACHINE_WORDS,
    zones: [zone('step-in', ['left', 'right'], 0.6, 'on each side', '60 cm at the side to step over into the seat', 'there is no room to get in', 'getting in is tight', { tightFrac: 0.8 })],
    note: 'Recumbent bikes are 150 to 180 long, 60 to 75 wide and 120 to 135 cm high. You step in from the side.',
  }),
  gym({
    id: 'gym-rower', name: 'Rowing machine', cat: 'cardio', w: 0.61, d: 2.44, h: 1.0, s: 0.36,
    label: '61 × 244 × 100 cm, seat at 36 cm', look: 'cardio', params: { variant: 'rower' }, pose: 'chair', seat: { z: 0.4, face: -1 }, kw: 'rower rowing machine concept2 ergometer air cardio gym',
    prompt: 'Sit on the rower', up: 'Get off', access: GET_ON(0.6), sideWords: MACHINE_WORDS,
    zones: [operate('mount', 0.6, '60 cm at the seat end to get on and off', 'there is no room to get on', 'getting on is tight', { where: 'at the seat end', assumption: `60 cm at the seat end to get on and off (${GUIDE})`, tightFrac: 0.75 }), SIDES(0.5)],
    note: 'A Concept2 RowErg is 244 × 61 cm with the seat at 36 cm (Concept2). Its monitor top is assumed at 100 cm. The whole stroke happens along the rail.',
  }),
  gym({
    id: 'gym-stair', name: 'Stair climber', cat: 'cardio', w: 0.85, d: 1.45, h: 1.8, s: 0.25,
    label: '85 × 145 × 180 cm', look: 'cardio', params: { variant: 'stair' }, pose: 'dims', kw: 'stair climber stepper stairmaster step mill cardio gym machine',
    access: GET_ON(0.6), sideWords: MACHINE_WORDS,
    zones: [operate('step-on', 0.6, '60 cm behind to step on', 'there is no room to step on', 'stepping on is tight', { where: 'behind the steps', assumption: `60 cm behind the steps (${GUIDE})`, tightFrac: 0.75 }), SIDES(0.5)],
    note: 'Step mills are 140 to 160 long, 80 to 90 wide and 170 to 190 cm high.',
  }),

  // ------------------------------------------------------------ strength machines
  gym({
    id: 'gym-multi-4', name: 'Multi-gym, 4 stations', cat: 'strength', w: 2.9, d: 2.1, h: 2.1, s: 0.45,
    label: '290 × 210 × 210 cm, four 80 kg stacks', look: 'strength', params: { variant: 'multi' }, pose: 'dims', kw: 'multi gym multistation jungle four station stack lat pulldown chest press strength',
    access: [FRONT(0.8)], sideWords: MACHINE_WORDS,
    zones: [zone('stations', ['front', 'back', 'left', 'right'], 0.8, 'all round', '80 cm round the frame to reach each station', 'a station cannot be used, {obs} is in the way', 'one station is cramped')],
    note: 'Four-stack commercial multi-gyms measure 280 to 350 long, 200 to 345 wide and 195 to 255 cm high (BodyCraft X4 281 × 223 × 212, Xtreme MTSG 290 × 207 × 197, Body-Solid S1000 315 × 343 × 211). This one is 290 × 210 × 210.',
  }),
  gym({
    id: 'gym-lat-pulldown', name: 'Lat pulldown', cat: 'strength', w: 1.2, d: 1.4, h: 2.15, s: 0.5,
    label: '120 × 140 × 215 cm, 90 kg stack', look: 'strength', params: { variant: 'lat' }, pose: 'dims', kw: 'lat pulldown pull down latissimus back strength machine cable',
    access: [FRONT(0.8)], sideWords: MACHINE_WORDS,
    zones: [zone('access', ['front'], 0.9, 'in front', '90 cm behind the seat to get in and out', 'you cannot get in, {obs} is in the way', 'getting in is tight'), SIDES(0.4, 'between machines to pass', 0.75)],
    note: 'Selectorised lat pulldowns are 110 to 145 long, 100 to 130 wide and 205 to 220 cm high.',
  }),
  gym({
    id: 'gym-seated-row', name: 'Seated row', cat: 'strength', w: 0.9, d: 1.5, h: 1.5, s: 0.45,
    label: '90 × 150 × 150 cm, 80 kg stack', look: 'strength', params: { variant: 'row' }, pose: 'dims', kw: 'seated row low row back strength machine cable',
    access: [FRONT(0.8)], sideWords: MACHINE_WORDS,
    zones: [zone('access', ['front'], 0.8, 'behind the seat', '80 cm behind the seat to get in and out', 'you cannot get in, {obs} is in the way', 'getting in is tight'), SIDES(0.4, 'between machines to pass', 0.75)],
    note: 'Selectorised seated rows are 130 to 165 long, 75 to 100 wide and 140 to 155 cm high.',
  }),
  gym({
    id: 'gym-chest-press', name: 'Chest press', cat: 'strength', w: 1.05, d: 1.35, h: 1.5, s: 0.48,
    label: '105 × 135 × 150 cm, 80 kg stack', look: 'strength', params: { variant: 'chest' }, pose: 'dims', kw: 'chest press bench press pecs strength machine',
    access: [FRONT(0.8)], sideWords: MACHINE_WORDS,
    zones: [zone('access', ['front'], 0.9, 'in front', '90 cm in front to get in and out', 'you cannot get in, {obs} is in the way', 'getting in is tight'), SIDES(0.4, 'between machines to pass', 0.75)],
    note: 'Selectorised chest presses are 115 to 150 long, 95 to 115 wide and 140 to 160 cm high.',
  }),
  gym({
    id: 'gym-shoulder-press', name: 'Shoulder press', cat: 'strength', w: 1.05, d: 1.3, h: 1.65, s: 0.48,
    label: '105 × 130 × 165 cm, 80 kg stack', look: 'strength', params: { variant: 'shoulder' }, pose: 'dims', kw: 'shoulder press overhead deltoid strength machine',
    access: [FRONT(0.8)], sideWords: MACHINE_WORDS,
    zones: [zone('access', ['front'], 0.9, 'in front', '90 cm in front to get in and out', 'you cannot get in, {obs} is in the way', 'getting in is tight'), SIDES(0.4, 'between machines to pass', 0.75)],
    note: 'Selectorised shoulder presses are 115 to 145 long, 95 to 115 wide and 150 to 175 cm high.',
  }),
  gym({
    id: 'gym-pec-fly', name: 'Pec fly / rear delt', cat: 'strength', w: 1.2, d: 1.1, h: 1.55, s: 0.48,
    label: '120 × 110 × 155 cm, 70 kg stack', look: 'strength', params: { variant: 'fly' }, pose: 'dims', kw: 'pec fly pec deck butterfly rear delt chest strength machine',
    access: [FRONT(0.8)], sideWords: MACHINE_WORDS,
    zones: [zone('access', ['front'], 0.9, 'in front', '90 cm in front to get in and out', 'you cannot get in, {obs} is in the way', 'getting in is tight'), SIDES(0.4, 'between machines to pass', 0.75)],
    note: 'Pec fly machines are 100 to 130 long, 110 to 135 wide and 145 to 165 cm high.',
  }),
  gym({
    id: 'gym-leg-press', name: 'Leg press, 45°', cat: 'strength', w: 1.42, d: 2.25, h: 1.3, s: 0.4,
    label: '142 × 225 × 130 cm, plate loaded', look: 'strength', params: { variant: 'legpress' }, pose: 'dims', kw: 'leg press 45 degree plate loaded quads legs strength machine',
    access: [FRONT(0.8)], sideWords: MACHINE_WORDS,
    zones: [zone('access', ['front'], 0.8, 'at the seat end', '80 cm at the seat end to get in', 'you cannot get in, {obs} is in the way', 'getting in is tight'), zone('plates', ['left', 'right'], 0.7, 'on each side', '70 cm each side to load and unload the plates', 'the plates cannot be changed, {obs} is in the way', 'changing plates is tight', { tightFrac: 0.7 })],
    note: 'Plate-loaded 45° leg presses are 210 to 240 long and 120 to 145 wide, 120 to 150 cm high. It is drawn with three 20 kg plates each side.',
  }),
  gym({
    id: 'gym-leg-extension', name: 'Leg extension', cat: 'strength', w: 0.8, d: 1.25, h: 1.2, s: 0.48,
    label: '80 × 125 × 120 cm, 70 kg stack', look: 'strength', params: { variant: 'legext' }, pose: 'dims', kw: 'leg extension quads quadriceps legs strength machine',
    access: [FRONT(0.8)], sideWords: MACHINE_WORDS,
    zones: [zone('access', ['front'], 0.8, 'in front', '80 cm in front for the legs to swing and to get in', 'the legs have no room to swing, {obs} is in the way', 'the swing is tight'), SIDES(0.4, 'between machines to pass', 0.75)],
    note: 'Leg extension machines are 105 to 140 long, 70 to 90 wide and 110 to 130 cm high.',
  }),
  gym({
    id: 'gym-leg-curl', name: 'Leg curl, seated', cat: 'strength', w: 0.8, d: 1.25, h: 1.2, s: 0.48,
    label: '80 × 125 × 120 cm, 70 kg stack', look: 'strength', params: { variant: 'legcurl' }, pose: 'dims', kw: 'leg curl hamstring seated legs strength machine',
    access: [FRONT(0.8)], sideWords: MACHINE_WORDS,
    zones: [zone('access', ['front'], 0.8, 'in front', '80 cm in front for the legs to swing and to get in', 'the legs have no room to swing, {obs} is in the way', 'the swing is tight'), SIDES(0.4, 'between machines to pass', 0.75)],
    note: 'Seated leg curl machines are 105 to 140 long, 70 to 90 wide and 110 to 130 cm high.',
  }),
  gym({
    id: 'gym-cable-crossover', name: 'Cable crossover', cat: 'strength', w: 3.3, d: 1.0, h: 2.3, s: 1.2,
    label: '330 × 100 × 230 cm, two 80 kg stacks', look: 'strength', params: { variant: 'cable' }, pose: 'dims', kw: 'cable crossover cable fly functional trainer pulley chest strength machine',
    access: [FRONT(1.0)], sideWords: MACHINE_WORDS,
    zones: [zone('stance', ['front'], 1.2, 'in front', '1.2 m in front to stand, step forward and pull the cables across', 'there is no room to use the cables, {obs} is in the way', 'the stance is tight', { widthM: 2.0 }), SIDES(0.5, 'at each end to reach the pulleys', 0.8)],
    note: 'Cable crossovers are 300 to 360 wide, 90 to 120 deep and 215 to 235 cm high.',
  }),
  gym({
    id: 'gym-smith', name: 'Smith machine', cat: 'strength', w: 2.15, d: 1.25, h: 2.25, s: 1.25,
    label: '215 × 125 × 225 cm, bar on guide rods', look: 'strength', params: { variant: 'smith' }, pose: 'dims', kw: 'smith machine squat bench barbell guided bar strength',
    access: [FRONT(1.0)], sideWords: MACHINE_WORDS,
    zones: [zone('stance', ['front'], 1.2, 'in front', '1.2 m in front to stand, squat, and for a bench or a spotter', 'there is no room to lift, {obs} is in the way', 'the lifting space is tight', { widthM: 1.6 }), zone('loading', ['left', 'right'], 0.6, 'at each end', '60 cm beyond each end of the bar to load plates', 'plates cannot be loaded, {obs} is in the way', 'loading plates is tight', { tightFrac: 0.7 })],
    note: 'Smith machines are 205 to 235 wide, 120 to 160 deep and 215 to 235 cm high, with the 2.1 m bar sticking out at both ends.',
  }),

  // ------------------------------------------------------------ free weights
  gym({
    id: 'gym-bench-flat', name: 'Flat bench', cat: 'freeweights', w: 0.56, d: 1.3, h: 0.45, s: 0.45,
    label: '56 × 130 × 45 cm, pad 30 cm wide', look: 'freew', params: { variant: 'bench-flat' }, pose: 'chair', seat: { z: 0.4, face: 1 }, kw: 'flat bench weight bench dumbbell press free weights',
    prompt: 'Sit on the bench', up: 'Get up', sideWords: { front: 'at the foot end', back: 'at the head end' },
    zones: [zone('dumbbells', ['left', 'right'], 0.6, 'on each side', '60 cm each side for dumbbells and to get on and off', 'there is no room to use it, {obs} is in the way', 'the space beside it is tight', { tightFrac: 0.7 })],
    note: 'Commercial flat benches are 120 to 135 long, 55 to 60 wide at the feet (the pad is 28 to 32) and 44 to 48 cm high. The head end is the back.',
  }),
  gym({
    id: 'gym-bench-incline', name: 'Incline bench', cat: 'freeweights', w: 0.6, d: 1.4, h: 1.05, s: 0.45,
    label: '60 × 140 × 105 cm, 30° back rest', look: 'freew', params: { variant: 'bench-incline' }, pose: 'chair', seat: { z: 0.45, face: 1 }, kw: 'incline bench fixed 30 degree dumbbell press free weights',
    prompt: 'Sit on the bench', up: 'Get up', sideWords: { front: 'at the foot end', back: 'at the head end' },
    zones: [zone('dumbbells', ['left', 'right'], 0.6, 'on each side', '60 cm each side for dumbbells and to get on and off', 'there is no room to use it, {obs} is in the way', 'the space beside it is tight', { tightFrac: 0.7 })],
    note: 'Fixed incline benches are 130 to 150 long, 55 to 65 wide and 95 to 120 cm high.',
  }),
  gym({
    id: 'gym-bench-adjustable', name: 'Adjustable bench', cat: 'freeweights', w: 0.6, d: 1.45, h: 1.15, s: 0.47,
    label: '60 × 145 × 115 cm, back rest at 45° shown', look: 'freew', params: { variant: 'bench-adjust' }, pose: 'chair', seat: { z: 0.45, face: 1 }, kw: 'adjustable bench utility incline decline dumbbell free weights',
    prompt: 'Sit on the bench', up: 'Get up', sideWords: { front: 'at the foot end', back: 'at the head end' },
    zones: [zone('dumbbells', ['left', 'right'], 0.6, 'on each side', '60 cm each side for dumbbells and to get on and off', 'there is no room to use it, {obs} is in the way', 'the space beside it is tight', { tightFrac: 0.7 })],
    note: 'Adjustable benches are 130 to 155 long, 55 to 65 wide and 100 to 125 cm high with the back rest raised. It is drawn at 45°.',
  }),
  gym({
    id: 'gym-bench-press', name: 'Olympic bench press', cat: 'freeweights', w: 2.2, d: 1.6, h: 1.35, s: 0.43,
    label: '220 × 160 × 135 cm with a loaded 2.2 m bar', look: 'freew', params: { variant: 'bench-press' }, pose: 'dims', kw: 'olympic bench press flat barbell rack free weights spotter',
    sideWords: { front: 'at the foot end', back: 'behind the head' },
    zones: [
      zone('spotter', ['back'], 0.9, 'behind the head', '90 cm behind the head for a spotter to stand and to lift the bar off', 'a spotter has no room behind the head, {obs} is in the way', 'a spotter would be cramped', { widthM: 1.2, tightFrac: 0.7 }),
      zone('loading', ['left', 'right'], 0.5, 'at each end of the bar', '50 cm beyond each end of the 2.2 m bar to load and unload the plates', 'plates cannot be loaded, {obs} is in the way', 'loading plates is tight', { tightFrac: 0.7 }),
    ],
    note: 'An Olympic bar is 2.2 m long (the footprint is the bar). Bench-press stations are 165 to 230 wide, 150 to 200 deep and 120 to 140 cm high (a Cybex-style station is 165 × 173 × 122). The head end is the back, so a wall behind it leaves no room for a spotter.',
  }),
  gym({
    id: 'gym-power-rack', name: 'Power rack', cat: 'freeweights', w: 2.2, d: 1.6, h: 2.3, s: 1.3,
    label: '220 × 160 × 230 cm with a 2.2 m bar and plates', look: 'freew', params: { variant: 'rack' }, pose: 'dims', kw: 'power rack squat rack cage half rack barbell pull up free weights',
    zones: [
      zone('bar-path', ['front'], 1.2, 'in front', '1.2 m in front to walk the bar out, squat and step back', 'there is no room to unrack the bar, {obs} is in the way', 'the walk-out is tight', { widthM: 1.4, tightFrac: 0.7 }),
      zone('loading', ['left', 'right'], 0.5, 'at each end of the bar', '50 cm beyond each end of the 2.2 m bar to load and unload the plates', 'plates cannot be loaded, {obs} is in the way', 'loading plates is tight', { tightFrac: 0.7 }),
    ],
    note: 'Power racks are 185 to 210 wide, 135 to 170 deep and 205 to 250 cm high (Body-Solid SPR1000 206 × 135 × 229, Cybex 196 × 166 × 248). The frame here is 135 deep; the footprint also holds the 2.2 m bar and the plates, which hang out in front of the front uprights.',
  }),
  gym({
    id: 'gym-dumbbell-rack', name: 'Dumbbell rack, 10 pairs', cat: 'freeweights', w: 2.4, d: 0.64, h: 0.84, s: 0.64,
    label: '240 × 64 × 84 cm, 2.5 to 25 kg in 2.5 kg steps', look: 'freew', params: { variant: 'dumbbells' }, pose: 'dims', kw: 'dumbbell rack dumbbells weights 2.5 25 kg two tier free weights',
    zones: [zone('pick', ['front'], 1.0, 'in front', '1 m in front to pick a dumbbell and to step back', 'there is no room to take a dumbbell, {obs} is in the way', 'picking a dumbbell is cramped')],
    note: 'Two-tier ten-pair dumbbell racks are 229 to 244 long, 53 to 73 deep and 77 to 84 cm high (Life Fitness 229 × 64 × 84, Gymleco 240 × 64 × 77). The set is 2.5 to 25 kg in 2.5 kg steps, twenty dumbbells.',
  }),
  gym({
    id: 'gym-plate-tree', name: 'Plate tree', cat: 'freeweights', w: 0.8, d: 0.8, h: 1.3, s: 1.25,
    label: '80 × 80 × 130 cm, plates 2.5 to 20 kg', look: 'freew', params: { variant: 'plate-tree' }, pose: 'dims', kw: 'plate tree weight plates storage barbell free weights',
    zones: [zone('pick', ['front'], 0.6, 'in front', '60 cm in front to load and take plates', 'plates cannot be reached, {obs} is in the way', 'reaching the plates is tight')],
    note: 'Plate trees are 60 to 90 square and 110 to 140 cm high. It carries plates from 20 kg down to 2.5 kg.',
  }),
  gym({
    id: 'gym-kettlebell-rack', name: 'Kettlebell rack, 8 bells', cat: 'freeweights', w: 1.2, d: 0.5, h: 0.86, s: 0.64,
    label: '120 × 50 × 86 cm, 4 to 32 kg', look: 'freew', params: { variant: 'kettlebells' }, pose: 'dims', kw: 'kettlebell rack kettlebells kb functional free weights',
    zones: [zone('pick', ['front'], 0.8, 'in front', '80 cm in front to lift a kettlebell off and to swing it', 'there is no room to take a kettlebell, {obs} is in the way', 'taking a kettlebell is cramped')],
    note: 'Two-tier kettlebell racks are 100 to 130 long, 45 to 60 deep and 80 to 90 cm high. Bells are drawn from 4 to 32 kg (a 24 kg bell is about 22 cm across).',
  }),
  gym({
    id: 'gym-preacher-curl', name: 'Preacher curl bench', cat: 'freeweights', w: 0.68, d: 1.05, h: 0.95, s: 0.5,
    label: '68 × 105 × 95 cm', look: 'freew', params: { variant: 'preacher' }, pose: 'chair', seat: { z: 0.28, face: -1 }, kw: 'preacher curl bench arm curl biceps free weights',
    prompt: 'Sit at the preacher bench', up: 'Get up', sideWords: { front: 'behind the seat', back: 'at the arm pad' },
    zones: [zone('seat', ['front'], 0.6, 'behind the seat', '60 cm behind the seat to get on and off', 'you cannot get on, {obs} is in the way', 'getting on is tight')],
    note: 'Preacher curl benches are 90 to 115 long, 60 to 75 wide and 85 to 105 cm high.',
  }),

  // ------------------------------------------------------------ studio and functional
  gym({
    id: 'gym-ball', name: 'Exercise ball, 65 cm', cat: 'studio', w: 0.65, d: 0.65, h: 0.65, s: 0.65,
    label: '65 cm across', look: 'studio', params: { variant: 'ball' }, pose: 'dims', kw: 'exercise ball swiss ball gym ball stability studio',
    note: 'A 65 cm ball suits people about 165 to 175 cm tall (55 and 75 cm balls also exist).',
  }),
  gym({
    id: 'gym-plyo-box', name: '3-in-1 plyo box', cat: 'studio', w: 0.76, d: 0.61, h: 0.61, s: 0.61,
    label: '76 × 61 × 61 cm, tipped to 51 or 76', look: 'studio', params: { variant: 'plyo' }, pose: 'dims', kw: 'plyo box plyometric jump box step functional studio',
    zones: [zone('jump', ['front'], 1.0, 'in front', '1 m in front to jump and land', 'there is no room to land, {obs} is in the way', 'landing room is tight')],
    note: 'A wooden 3-in-1 plyo box is 76 × 61 × 51 cm tipped onto each of its faces (51, 61 and 76 cm high). It is drawn at 61.',
  }),
  gym({
    id: 'gym-battle-rope', name: 'Battle rope with floor anchor', cat: 'studio', w: 0.5, d: 0.55, h: 0.9, s: 0.9,
    label: '50 × 55 cm base, post 90 cm, rope coiled', look: 'studio', params: { variant: 'rope' }, pose: 'dims', kw: 'battle rope anchor post functional studio conditioning',
    zones: [zone('waves', ['front'], 4.0, 'in front', '4 m in front for a 9 m, 38 mm rope doubled on its anchor to wave', 'the rope has no room to wave, {obs} is in the way', 'the rope would hit {obs}', { widthM: 1.2, tightFrac: 0.75 })],
    note: 'A 9 m rope doubled on an anchor throws waves about 4 m. The rope is drawn coiled on the floor.',
  }),
  gym({
    id: 'gym-heavy-bag', name: 'Punching bag, hung', cat: 'studio', w: 0.38, d: 0.38, h: 1.65, s: 1.65,
    label: '38 cm across, 120 cm long, hung from the ceiling', look: 'studio', params: { variant: 'bag' }, pose: 'dims', kw: 'punching bag heavy bag boxing hung studio',
    zones: [{ ...arc(20, 'ceiling', 0.19, { sides: ['front', 'back', 'left', 'right'], minNeedM: 1.0, minCeilingM: 2.4, where: 'all round', attachM: 1.65 }), label: 'Heavy bag', assumption: `a 20° swing each way, and 1 m all round for the boxer to move (${GUIDE})`, blockedText: 'it will be hit by the bag or the boxer, {obs} is too close' }],
    hung: true, note: 'A 120 cm heavy bag is 33 to 40 cm across; its bottom is 45 cm off the floor. Hanging needs a structural hook: check with your builder.',
  }),
  gym({
    id: 'gym-wall-bars', name: 'Wall bars (Swedish ladder)', cat: 'studio', w: 0.9, d: 0.12, h: 2.3, s: 2.3,
    label: '90 × 12 × 230 cm, rungs every 12 cm', look: 'studio', params: { variant: 'wallbars' }, pose: 'dims', kw: 'wall bars swedish ladder stall bars gymnastics studio',
    wall: true, zones: [operate('stand', 1.0, '1 m in front to stand and swing the legs', 'there is no room to use it', 'using it is cramped', { assumption: `1 m in front to stand and swing the legs (${GUIDE})`, tightFrac: 0.75 })],
    note: 'Wall bars are 80 to 100 wide and 220 to 250 cm high. They are fixed to a wall.',
  }),
  gym({
    id: 'gym-trx-frame', name: 'Suspension trainer frame', cat: 'studio', w: 2.4, d: 0.9, h: 2.4, s: 2.4,
    label: '240 × 90 × 240 cm, two strap sets', look: 'studio', params: { variant: 'trx' }, pose: 'dims', kw: 'trx suspension trainer functional rig frame straps studio',
    zones: [operate('stand', 1.2, '1.2 m in front to lie out under the straps', 'there is no room to train, {obs} is in the way', 'training room is tight', { assumption: `1.2 m in front to lie out under the straps (${GUIDE})`, widthM: 2.0, tightFrac: 0.75 })],
    note: 'Functional rigs are 180 to 300 wide, 60 to 120 deep and 230 to 250 cm high. Two strap sets hang from the front rail.',
  }),

  // ------------------------------------------------------------ amenities
  gym({
    id: 'gym-mirror', name: 'Mirror panel, 120 × 200', cat: 'amenities', w: 1.2, d: 0.03, h: 2.3, s: 2.3, places: ['gym', 'hall'],
    label: '120 × 200 cm, 30 cm off the floor', look: 'studio', params: { variant: 'mirror', liftM: 0.3 }, pose: 'dims', kw: 'mirror panel wall mirror gym glass amenities',
    mountY: 0.3, wall: true,
    note: 'A gym mirror is usually 120 cm panels, 2 m high, from 30 cm off the floor. The panel is drawn shiny, not as a live reflection.',
  }),
  gym({
    id: 'gym-water', name: 'Water dispenser', cat: 'amenities', w: 0.34, d: 0.38, h: 1.1, s: 0.95, places: ['gym', 'lobby', 'hall', 'corridor'],
    label: '34 × 38 × 110 cm, taps at 95 cm', look: 'studio', params: { variant: 'water' }, pose: 'dims', kw: 'water dispenser cooler drinking water amenities',
    zones: [operate('use', 0.6, '60 cm in front to fill a bottle and to queue', 'there is no room to use the taps', 'using the taps is cramped', { assumption: `60 cm in front to fill a bottle (${GUIDE})`, tightFrac: 0.75 })],
    note: 'Floor-standing coolers are 30 to 40 wide and deep and 100 to 120 cm high. It needs a power socket and a bottle or a water line, which are not on the drawing.',
  }),
  gym({
    id: 'gym-towel-station', name: 'Towel and sanitiser station', cat: 'amenities', w: 0.6, d: 0.4, h: 1.0, s: 0.9, places: ['gym', 'pool'],
    label: '60 × 40 × 100 cm', look: 'studio', params: { variant: 'towel' }, pose: 'dims', kw: 'towel sanitiser sanitizer station amenities hygiene',
    zones: [operate('use', 0.6, '60 cm in front to take a towel', 'there is no room to use it', 'using it is cramped', { assumption: `60 cm in front to take a towel (${GUIDE})`, tightFrac: 0.75 })],
    note: 'A stand with a shelf of folded towels, a used-towel bin below and a hand-sanitiser pump.',
  }),
  gym({
    id: 'gym-lockers-6', name: 'Lockers, bank of 6', cat: 'amenities', w: 0.9, d: 0.45, h: 1.8, s: 1.8, places: ['gym', 'pool'],
    label: '90 × 45 × 180 cm, 3 columns, 2 tiers', look: 'studio', params: { variant: 'lockers' }, pose: 'dims', kw: 'lockers locker bank six 6 storage changing amenities',
    sideWords: { front: 'in front of the doors' },
    zones: [operate('open', 0.9, '90 cm in front to open the doors and to pass', 'the doors cannot be opened, {obs} is in the way', 'opening the doors is tight', { assumption: `90 cm in front to stand at a door and let someone pass (${GUIDE})`, tightFrac: 0.7 })],
    note: 'Steel gym lockers are 30 cm wide, 45 cm deep and 180 cm high in two tiers of 90 cm; a bank of six is 3 wide by 2 high.',
  }),
  gym({
    id: 'gym-lockers-12', name: 'Lockers, bank of 12', cat: 'amenities', w: 1.8, d: 0.45, h: 1.8, s: 1.8, places: ['gym', 'pool'],
    label: '180 × 45 × 180 cm, 6 columns, 2 tiers', look: 'studio', params: { variant: 'lockers' }, pose: 'dims', kw: 'lockers locker bank twelve 12 storage changing amenities',
    sideWords: { front: 'in front of the doors' },
    zones: [operate('open', 0.9, '90 cm in front to open the doors and to pass', 'the doors cannot be opened, {obs} is in the way', 'opening the doors is tight', { assumption: `90 cm in front to stand at a door and let someone pass (${GUIDE})`, tightFrac: 0.7 })],
    note: 'Steel gym lockers are 30 cm wide, 45 cm deep and 180 cm high in two tiers of 90 cm; a bank of twelve is 6 wide by 2 high.',
  }),
  gym({
    id: 'gym-locker-bench', name: 'Changing-room bench', cat: 'amenities', kind: 'sofa', w: 1.5, d: 0.35, h: 0.45, s: 0.45, places: ['gym', 'pool', 'corridor', 'lobby'],
    label: '150 × 35 × 45 cm', look: 'studio', params: { variant: 'locker-bench' }, pose: 'sit', kw: 'bench changing room locker room seat wooden amenities',
    prompt: 'Sit on the bench', up: 'Get up', sideWords: { front: 'in front' },
    note: 'A changing-room bench is 120 to 200 long, 30 to 40 deep and 42 to 46 cm high.',
  }),
  gym({
    id: 'gym-scale', name: 'Digital weighing scale', cat: 'amenities', w: 0.32, d: 0.32, h: 0.04, s: 0.04,
    label: '32 × 32 × 4 cm', look: 'studio', params: { variant: 'scale' }, pose: 'dims', kw: 'weighing scale digital bathroom scale weight amenities',
    note: 'A flat digital scale. It lies on the floor: you can walk over it.',
  }),
  gym({
    id: 'gym-wall-fan', name: 'Wall fan, 65 cm', cat: 'amenities', w: 0.65, d: 0.3, h: 2.45, s: 2.45, places: ['gym', 'hall'],
    label: '65 cm drum fan, centre at 213 cm', look: 'studio', params: { variant: 'fan', liftM: 1.8 }, pose: 'dims', kw: 'wall fan drum fan cooling gym amenities',
    mountY: 1.8, wall: true,
    note: 'A 26 inch (65 cm) wall-mounted drum fan, its guard from 180 to 245 cm. It needs a wall that takes its weight and a power point: neither is on the drawing.',
  }),
  gym({
    id: 'gym-floor-2x2', name: 'Rubber flooring, 2 × 2 m', cat: 'amenities', w: 2.0, d: 2.0, h: 0.015, s: 0.015,
    label: '200 × 200 cm, 50 cm tiles, 15 mm', look: 'studio', params: { variant: 'tiles' }, pose: 'dims', kw: 'rubber flooring tiles floor mat gym rubber area finish',
    note: 'Interlocking rubber tiles, 50 × 50 cm and 15 mm thick, laid in a block. Lay as many as the area needs (Place a row, or Fill area): you walk over them.',
  }),
  gym({
    id: 'gym-floor-4x2', name: 'Rubber flooring, 4 × 2 m', cat: 'amenities', w: 4.0, d: 2.0, h: 0.015, s: 0.015,
    label: '400 × 200 cm, 50 cm tiles, 15 mm', look: 'studio', params: { variant: 'tiles' }, pose: 'dims', kw: 'rubber flooring tiles floor mat gym rubber area finish',
    note: 'Interlocking rubber tiles, 50 × 50 cm and 15 mm thick, laid in a block. Lay as many as the area needs (Place a row, or Fill area): you walk over them.',
  }),
];
