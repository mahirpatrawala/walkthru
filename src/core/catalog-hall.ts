// Community-hall pieces (SPEC 16.17): stacking chairs, banquet tables, stage platform modules, a podium, a projector screen, a speaker, and carrom,
// table-tennis and pool tables with their play clearances. Every clearance is an assumption and the sentence says so.
import type { Side } from '../types';
import { operate, piece } from './catalog-more';
import type { Def, MorePiece } from './catalog-more';
import type { Zone } from './pieces';

const HALL: Def['places'] = ['hall'];
const GUIDE = 'typical guidance, check your consultant';
type HDef = Omit<Def, 'kind' | 'family'> & Partial<Pick<Def, 'kind' | 'family'>>;
const hall = (o: HDef): MorePiece => piece({ places: HALL, kind: 'counter', family: null, ...o });
const around = (id: string, sides: Side[], m: number, what: string, blocked: string, tight: string, tf = 0.75): Zone => ({
  id, sides, needM: m, where: sides.length === 4 ? 'all round' : sides.length === 2 && sides[0] === 'left' ? 'at each end' : 'on each side', assumption: `${what} (${GUIDE})`, blockedText: blocked, tightText: tight, tightFrac: tf,
});
const FOUR: Side[] = ['front', 'back', 'left', 'right'];

export const HALL_PIECES: MorePiece[] = [
  hall({
    id: 'hall-chair', name: 'Stacking chair', cat: 'seating', kind: 'sofa', w: 0.46, d: 0.52, h: 0.82, s: 0.46,
    label: '46 × 52 × 82 cm, seat at 46 cm', look: 'hall', params: { variant: 'chair' }, pose: 'chair', kw: 'stacking chair hall chair banquet seating event steel padded',
    prompt: 'Sit on the chair', up: 'Get up', note: 'A stacking hall chair is 44 to 48 wide, 48 to 55 deep, 80 to 85 high with the seat at 44 to 47 cm. Use Place a row or Place a grid for a block of seating.',
  }),
  hall({
    id: 'hall-table-rect', name: 'Banquet table, 6 ft', cat: 'tables', w: 1.8, d: 0.76, h: 0.74, s: 0.74,
    label: '180 × 76 × 74 cm, folding', look: 'hall', params: { variant: 'table-rect' }, pose: 'dims', kw: 'banquet table folding table rectangular trestle event buffet 6 ft',
    zones: [around('chairs', ['front', 'back'], 0.9, '90 cm on each long side for chairs pulled out and a person to pass', 'seats cannot be pulled out, {obs} is in the way', 'the chairs would be cramped')],
    note: 'A 6 ft (1.83 m) folding banquet table is 180 × 76 (or 180 × 90) and 74 cm high.',
  }),
  hall({
    id: 'hall-table-round', name: 'Banquet table, round 150', cat: 'tables', w: 1.5, d: 1.5, h: 0.74, s: 0.74,
    label: '150 cm across, 74 cm high, seats 8 to 10', look: 'hall', params: { variant: 'table-round' }, pose: 'dims', kw: 'banquet table round folding table event dining seats eight ten 5 ft',
    zones: [around('chairs', FOUR, 0.9, '90 cm all round for chairs pulled out and a person to pass', 'seats cannot be pulled out, {obs} is in the way', 'the chairs would be cramped')],
    note: 'A 5 ft (152 cm) round banquet table seats eight to ten and is 74 cm high.',
  }),
  ...[0.2, 0.4, 0.6].map((hh) => hall({
    id: `hall-stage-${Math.round(hh * 100)}`, name: `Stage platform, ${Math.round(hh * 100)} cm`, cat: 'stage', w: 1.2, d: 2.4, h: hh, s: hh,
    label: `120 × 240 cm module, ${Math.round(hh * 100)} cm high`, look: 'hall', params: { variant: 'stage' }, pose: 'dims', kw: `stage platform deck riser module staging ${Math.round(hh * 100)} stackable`,
    note: `A staging deck module is 1.22 × 2.44 m (4 × 8 ft) and is made in several heights (here ${Math.round(hh * 100)} cm); modules butt side to side. To build a taller stage, stand a lower module on a higher one is not modelled: use the height you need.`,
  })),
  hall({
    id: 'hall-podium', name: 'Podium (lectern)', cat: 'stage', w: 0.6, d: 0.5, h: 1.15, s: 1.05,
    label: '60 × 50 × 115 cm, microphone', look: 'hall', params: { variant: 'podium' }, pose: 'stand', kw: 'podium lectern speaker stand microphone stage hall',
    prompt: 'Stand at the podium', up: 'Step back', sideWords: { front: 'on the audience side', back: 'where the speaker stands' },
    zones: [operate('speaker', 0.7, '70 cm behind for the speaker', 'the speaker has no room, {obs} is in the way', 'the speaker would be cramped', { sides: ['back'], where: 'where the speaker stands', assumption: `70 cm behind for the speaker (${GUIDE})`, tightFrac: 0.75 })],
    note: 'A lectern is 55 to 65 wide, 45 to 55 deep and 105 to 120 cm high, with the reading top at about 105 cm.',
  }),
  hall({
    id: 'hall-screen', name: 'Projector screen, 3 m', cat: 'stage', w: 3.0, d: 0.1, h: 2.6, s: 2.6,
    label: '300 cm wide, 170 cm viewing height, 90 to 260 cm', look: 'hall', params: { variant: 'screen', liftM: 0.9 }, pose: 'dims', kw: 'projector screen wall screen electric roller presentation hall av',
    mountY: 0.9, wall: true,
    note: 'A 3 m wide 16:9 screen has a 170 cm viewing height. Its underside is at 90 cm here. It is fixed to a wall, and needs a projector and a power point that are not on the drawing.',
  }),
  hall({
    id: 'hall-speaker', name: 'PA speaker on stand', cat: 'stage', w: 0.7, d: 0.7, h: 1.65, s: 1.65,
    label: '70 cm tripod, cabinet top at 165 cm', look: 'hall', params: { variant: 'speaker' }, pose: 'dims', kw: 'speaker pa speaker stand tripod sound system hall av',
    note: 'A 12 inch PA speaker on a tripod stand: the tripod spreads 70 cm and the cabinet top is at 165 cm.',
  }),
  hall({
    id: 'hall-carrom', name: 'Carrom table', cat: 'games', w: 0.85, d: 0.85, h: 0.75, s: 0.75,
    label: '85 × 85 cm board and frame, 75 cm high', look: 'hall', params: { variant: 'carrom' }, pose: 'dims', kw: 'carrom board table game indoor hall games',
    zones: [around('players', FOUR, 0.8, '80 cm all round for the players to sit or stand', 'the players have no room, {obs} is in the way', 'the players would be cramped')],
    note: 'A carrom board is 74 × 74 cm of playing surface in a frame about 85 cm across, played at about 75 cm.',
  }),
  hall({
    id: 'hall-table-tennis', name: 'Table-tennis table', cat: 'games', w: 2.74, d: 1.525, h: 0.91, s: 0.76,
    label: '274 × 152.5 × 76 cm, net 15.25 cm', look: 'hall', params: { variant: 'tt' }, pose: 'dims', kw: 'table tennis ping pong table game indoor hall games',
    zones: [around('ends', ['left', 'right'], 1.8, '1.8 m behind each end to play and to chase a ball', 'there is no room to play, {obs} is too close', 'play would be cramped', 0.7), around('sides', ['front', 'back'], 1.1, '1.1 m each side to move across', 'there is no room to play, {obs} is too close', 'play would be cramped', 0.7)],
    note: 'A table-tennis table is 274 × 152.5 cm and 76 cm high, the net 15.25 cm above it (ITTF). Tournament play needs far more room (about 9 × 4.5 m): these are recreational distances.',
  }),
  hall({
    id: 'hall-pool-table', name: 'Pool table, 8 ft', cat: 'games', w: 2.65, d: 1.45, h: 0.86, s: 0.8,
    label: '265 × 145 × 80 cm (86 with balls), six pockets', look: 'hall', params: { variant: 'pool' }, pose: 'dims', kw: 'pool table billiards snooker game indoor hall games 8 ft',
    zones: [around('cue', FOUR, 1.2, '1.2 m all round to play a shot (a cue is 1.47 m: a shorter cue is used against a wall)', 'there is no room to play a shot, {obs} is too close', 'some shots would need a short cue', 0.75)],
    note: 'An 8 ft pool table is about 265 × 145 cm overall with the cloth at 80 cm; a standard cue is 147 cm long.',
  }),
];
