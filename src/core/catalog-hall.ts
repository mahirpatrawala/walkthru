// Community-hall pieces (SPEC 16.17): stacking chairs, banquet tables, stage platform modules, a podium, a projector screen, a speaker, and carrom,
// table-tennis and pool tables with their play clearances. Every clearance is an assumption and the sentence says so.
import type { Side } from '../types';
import { operate, piece } from './catalog-more';
import type { Def, MorePiece } from './catalog-more';
import type { Zone } from './pieces';

const HALL: Def['places'] = ['hall'];
/** a piece a games room offers as well as a hall */
const HALL_GAMES: Def['places'] = ['hall', 'games'];
/** a piece only a games room offers */
const GAMES: Def['places'] = ['games'];
const GUIDE = 'typical guidance, check your consultant';
type HDef = Omit<Def, 'kind' | 'family'> & Partial<Pick<Def, 'kind' | 'family'>>;
const hall = (o: HDef): MorePiece => piece({ places: HALL, kind: 'counter', family: null, ...o });
const around = (id: string, sides: Side[], m: number, what: string, blocked: string, tight: string, tf = 0.75): Zone => ({
  id, sides, needM: m, where: sides.length === 4 ? 'all round' : sides.length === 2 && sides[0] === 'left' ? 'at each end' : 'on each side', assumption: `${what} (${GUIDE})`, blockedText: blocked, tightText: tight, tightFrac: tf,
});
const FOUR: Side[] = ['front', 'back', 'left', 'right'];

export const HALL_PIECES: MorePiece[] = [
  hall({
    id: 'hall-chair', places: HALL_GAMES, name: 'Stacking chair', cat: 'seating', kind: 'sofa', w: 0.46, d: 0.52, h: 0.82, s: 0.46,
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
  hall({
    id: 'hall-banquet-set-4', name: 'Round banquet table with 4 chairs', cat: 'tables', w: 1.7, d: 1.7, h: 0.82, s: 0.74,
    label: '120 cm round table, four chairs set in, 170 × 170 cm with them', look: 'hall', params: { variant: 'banquet-set' }, pose: 'dims', kw: 'banquet table round table with chairs set dining hall event wedding four chairs seats',
    zones: [around('aisle', FOUR, 0.4, '40 cm all round to reach the chairs (a chair is pulled out about 50 cm to sit: this is the least to pass behind a seated guest)', 'guests cannot reach the chairs, {obs} is too close', 'a seated guest would be squeezed against {obs}', 0.7)],
    note: 'A 120 cm round table seats six; four chairs are set in here, as a plan symbol draws it, so the set is 170 cm across. For a full banquet switch to the 150 cm table (eight to ten) and a block of chairs.',
  }),
  hall({
    id: 'hall-cafe-set-2', name: 'Café table with 2 chairs', cat: 'tables', w: 1.6, d: 0.7, h: 0.82, s: 0.74,
    label: '70 cm round table, two chairs, 160 × 70 cm with them', look: 'hall', params: { variant: 'cafe-set' }, pose: 'dims', kw: 'cafe table small round table two chairs bistro lounge seating',
    zones: [around('aisle', FOUR, 0.4, '40 cm all round to reach the chairs', 'guests cannot reach the chairs, {obs} is too close', 'a seated guest would be squeezed against {obs}', 0.7)],
    note: 'A café table is 60 to 80 cm across and 74 cm high with two chairs; a lounge usually puts them in a row with a metre or more between sets.',
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
    id: 'hall-carrom', places: HALL_GAMES, name: 'Carrom table', cat: 'games', w: 0.85, d: 0.85, h: 0.75, s: 0.75,
    label: '85 × 85 cm board and frame, 75 cm high', look: 'hall', params: { variant: 'carrom' }, pose: 'dims', kw: 'carrom board table game indoor hall games',
    zones: [around('players', FOUR, 0.8, '80 cm all round for the players to sit or stand', 'the players have no room, {obs} is in the way', 'the players would be cramped')],
    note: 'A carrom board is 74 × 74 cm of playing surface in a frame about 85 cm across, played at about 75 cm.',
  }),
  hall({
    id: 'hall-table-tennis', places: HALL_GAMES, name: 'Table-tennis table', cat: 'games', w: 2.74, d: 1.525, h: 0.91, s: 0.76,
    label: '274 × 152.5 × 76 cm, net 15.25 cm', look: 'hall', params: { variant: 'tt' }, pose: 'dims', kw: 'table tennis ping pong table game indoor hall games',
    zones: [around('ends', ['left', 'right'], 1.8, '1.8 m behind each end to play and to chase a ball', 'there is no room to play, {obs} is too close', 'play would be cramped', 0.7), around('sides', ['front', 'back'], 1.1, '1.1 m each side to move across', 'there is no room to play, {obs} is too close', 'play would be cramped', 0.7)],
    note: 'A table-tennis table is 274 × 152.5 cm and 76 cm high, the net 15.25 cm above it (ITTF). Tournament play needs far more room (about 9 × 4.5 m): these are recreational distances.',
  }),
  hall({
    id: 'hall-pool-table', places: HALL_GAMES, name: 'Pool table, 8 ft', cat: 'games', w: 2.54, d: 1.42, h: 0.86, s: 0.8,
    label: '254 × 142 × 80 cm (86 with balls), six pockets', look: 'hall', params: { variant: 'pool' }, pose: 'dims', kw: 'pool table billiards snooker game indoor hall games 8 ft',
    zones: [around('cue', FOUR, 1.5, '1.5 m all round to play a shot with a full cue (a cue is 1.47 m: a shorter cue is used against a wall)', 'there is no room to play a shot, {obs} is too close', 'some shots would need a short cue', 0.75)],
    note: 'An 8 ft pool table is about 254 × 142 cm overall (a playing surface of about 224 × 112 cm) with the cloth at 80 cm; a standard cue is 147 cm long, so players ask for about 1.5 m all round.',
  }),
  // games-room pieces (a games room offers these and the carrom, table-tennis and pool tables above)
  hall({
    id: 'games-foosball', places: GAMES, name: 'Foosball table', cat: 'games', w: 1.4, d: 1.2, h: 0.9, s: 0.8,
    label: '140 × 120 × 90 cm with the rod handles out (cabinet 140 × 76)', look: 'hall', params: { variant: 'foosball' }, pose: 'dims', kw: 'foosball table football soccer table game indoor games room rods',
    zones: [around('players', ['front', 'back'], 0.9, '90 cm along each long side for the players to stand and turn the rods', 'the players have no room, {obs} is too close', 'play would be cramped'), around('ends', ['left', 'right'], 0.6, '60 cm at each end to pass', 'there is no room to pass the end, {obs} is too close', 'passing the end would be tight')],
    note: 'A full-size foosball table is about 140 × 76 cm with the rod handles reaching 22 cm out on each side (about 120 cm across), 80 cm to the field and about 90 cm to the top of the rods.',
  }),
  hall({
    id: 'games-chess-set', places: GAMES, name: 'Chess table with 2 chairs', cat: 'games', w: 0.6, d: 1.44, h: 0.82, s: 0.74,
    label: '60 cm square table, a chair at each end, 60 × 144 cm with them', look: 'hall', params: { variant: 'chess-set' }, pose: 'dims', kw: 'chess table board game checkers draughts two chairs indoor games room',
    zones: [around('aisle', ['left', 'right'], 0.6, '60 cm beside it to reach the chairs', 'the players cannot reach the chairs, {obs} is too close', 'the players would be squeezed against {obs}', 0.7), around('ends', ['front', 'back'], 0.4, '40 cm behind each chair to pull it out', 'a chair cannot be pulled out, {obs} is too close', 'a chair would be hard to pull out', 0.7)],
    note: 'A chess table is about 60 cm square and 74 cm high (a tournament board has 5.5 cm squares), with a chair at each end. The chairs are set in under the top, so the set is 144 cm long.',
  }),
  hall({
    id: 'games-card-set', places: GAMES, name: 'Card table with 4 chairs', cat: 'games', w: 1.7, d: 1.7, h: 0.82, s: 0.74,
    label: '85 cm square table, a chair on each side, 170 × 170 cm with them', look: 'hall', params: { variant: 'card-set' }, pose: 'dims', kw: 'card table cards poker rummy bridge teen patti playing cards four chairs game indoor games room',
    zones: [around('aisle', FOUR, 0.4, '40 cm all round to pull a chair out and sit', 'a chair cannot be pulled out, {obs} is too close', 'a chair would be hard to pull out', 0.7)],
    note: 'A square card table seats four: 84 to 92 cm across and 74 cm high, with a chair on each side set in under the top (170 cm across with them).',
  }),
  hall({
    id: 'games-carrom-set', places: GAMES, name: 'Carrom board with 4 stools', cat: 'games', w: 1.6, d: 1.6, h: 0.75, s: 0.75,
    label: '85 cm board on a stand, a stool on each side, 160 × 160 cm with them', look: 'hall', params: { variant: 'carrom-set' }, pose: 'dims', kw: 'carrom board stand stools four players game indoor games room',
    zones: [around('aisle', FOUR, 0.4, '40 cm all round for the players to get on and off the stools', 'a player cannot get to a stool, {obs} is too close', 'a stool would be hard to reach', 0.7)],
    note: 'A carrom board is 74 × 74 cm of playing surface in a frame about 85 cm across, played at about 75 cm with a round stool at each side (stools 32 to 36 cm across, seat at 46 cm).',
  }),
];
