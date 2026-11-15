// Lobby and corridor pieces (SPEC 16.17): reception desks, a visitor seating set, planters, a letterbox bank, a security desk, notice and directory boards, a
// lift-lobby bench, a wall art panel and a queue stanchion pair. Sizes are common commercial sizes; every note says what the number rests on.
import { operate, piece } from './catalog-more';
import type { Def, MorePiece } from './catalog-more';

const LOBBY: Def['places'] = ['lobby', 'corridor'];
const GUIDE = 'typical guidance, check your consultant';
type LDef = Omit<Def, 'kind' | 'family'> & Partial<Pick<Def, 'kind' | 'family'>>;
const lobby = (o: LDef): MorePiece => piece({ places: LOBBY, kind: 'counter', family: null, ...o });
const stand = (id: string, m: number, why: string): ReturnType<typeof operate> => operate(id, m, `${Math.round(m * 100)} cm in front ${why}`, 'there is no room to stand there, {obs} is in the way', 'standing room is tight', { assumption: `${Math.round(m * 100)} cm in front ${why} (${GUIDE})`, tightFrac: 0.75 });

export const LOBBY_PIECES: MorePiece[] = [
  lobby({
    id: 'lobby-desk', name: 'Reception desk, straight', cat: 'reception', w: 2.4, d: 0.8, h: 1.15, s: 1.05, places: ['lobby'],
    label: '240 × 80 × 115 cm, counter at 105 cm', look: 'lobby', params: { variant: 'desk' }, pose: 'stand', kw: 'reception desk front desk counter concierge lobby straight',
    prompt: 'Stand at the desk', up: 'Step back', sideWords: { front: 'on the visitor side', back: 'on the staff side' },
    zones: [stand('visitors', 1.0, 'for visitors to stand and queue'), operate('staff', 0.8, '80 cm behind for the receptionist', 'the receptionist has no room, {obs} is in the way', 'the staff side is cramped', { where: 'on the staff side', assumption: `80 cm behind for the receptionist (${GUIDE})`, sides: ['back'], tightFrac: 0.75 })],
    note: 'A staffed reception counter is usually 180 to 300 long, 60 to 90 deep, with the counter at 105 to 115 and a lower desk at 75 cm behind it.',
  }),
  lobby({
    id: 'lobby-desk-l', name: 'Reception desk, L-shaped', cat: 'reception', w: 2.4, d: 1.8, h: 1.15, s: 1.05, places: ['lobby'],
    label: '240 × 180 × 115 cm, return on the left', look: 'lobby', params: { variant: 'desk-l' }, pose: 'stand', kw: 'reception desk l shaped corner counter concierge lobby',
    prompt: 'Stand at the desk', up: 'Step back', sideWords: { front: 'on the visitor side' },
    zones: [stand('visitors', 1.0, 'for visitors to stand and queue')],
    note: 'An L-shaped reception counter is 240 along the front with a 180 cm return; the staff stand inside the L.',
  }),
  lobby({
    id: 'lobby-visitor-set', name: 'Visitor seating set', cat: 'seating', kind: 'sofa', w: 2.4, d: 2.0, h: 0.85, s: 0.45, places: ['lobby', 'corridor'], family: 'sofa',
    label: '240 × 200 cm: 3-seater, two armchairs, table', look: 'lobby', params: { variant: 'visitor-set' }, pose: 'dims', kw: 'visitor seating set sofa armchairs coffee table waiting lounge lobby',
    note: 'A 190 cm sofa, two 80 cm armchairs facing in and a 90 × 50 cm table, as one set. The pieces are not separate here: to arrange them freely use the sofa and armchair pieces.',
  }),
  lobby({
    id: 'lobby-planter-large', name: 'Planter, large round', cat: 'decor', w: 0.8, d: 0.8, h: 1.5, s: 0.55, places: ['lobby', 'hall', 'corridor'],
    label: '80 cm pot, plant to 150 cm', look: 'lobby', params: { variant: 'planter-round' }, pose: 'dims', kw: 'planter large pot plant lobby decor tall indoor tree',
    note: 'A large lobby pot is 60 to 90 cm across and 50 to 60 high, with a plant to about 150 cm.',
  }),
  lobby({
    id: 'lobby-planter-trough', name: 'Planter, long trough', cat: 'decor', w: 1.5, d: 0.45, h: 0.9, s: 0.45, places: ['lobby', 'hall', 'corridor'],
    label: '150 × 45 cm, 45 cm box, plants to 90 cm', look: 'lobby', params: { variant: 'planter-trough' }, pose: 'dims', kw: 'planter trough long box plants lobby decor divider',
    note: 'A long trough planter is 120 to 200 long, 40 to 50 wide and 45 cm high.',
  }),
  lobby({
    id: 'lobby-letterboxes', name: 'Letterbox bank, 30 boxes', cat: 'reception', w: 1.2, d: 0.15, h: 2.0, s: 2.0,
    label: '120 × 15 cm, 6 across, 5 high, 90 to 200 cm', look: 'lobby', params: { variant: 'letterbox', liftM: 0.9 }, pose: 'dims', kw: 'letterbox letterboxes mailbox post boxes pigeon holes lobby',
    mountY: 0.9, wall: true, zones: [stand('collect', 0.9, 'to stand and collect post')],
    note: 'A steel letterbox bank of 30 boxes is about 120 wide, 15 deep and 110 high, its lowest row 90 cm off the floor. It is fixed to a wall.',
  }),
  lobby({
    id: 'lobby-security-desk', name: 'Security desk', cat: 'reception', w: 1.6, d: 0.75, h: 1.45, s: 0.76, places: ['lobby'],
    label: '160 × 75 × 145 cm, three monitors', look: 'lobby', params: { variant: 'security' }, pose: 'stand', kw: 'security desk guard desk monitors cctv lobby gate',
    prompt: 'Stand at the desk', up: 'Step back', sideWords: { front: 'on the visitor side' },
    zones: [stand('visitors', 0.9, 'for a visitor to stand')],
    note: 'A security desk is 140 to 200 long, 70 to 80 deep and 75 cm high, with monitors up to 145 cm.',
  }),
  lobby({
    id: 'lobby-notice-board', name: 'Notice board, 120 × 90', cat: 'reception', w: 1.2, d: 0.04, h: 2.0, s: 2.0, places: ['lobby', 'corridor', 'hall', 'gym'],
    label: '120 × 90 cm, centre at 155 cm', look: 'lobby', params: { variant: 'notice', liftM: 1.1 }, pose: 'dims', kw: 'notice board pin board cork society notices lobby',
    mountY: 1.1, wall: true, zones: [stand('read', 0.8, 'to stand and read')],
    note: 'A society notice board is 90 to 150 wide and 60 to 120 high, its middle at about 155 cm. It is fixed to a wall.',
  }),
  lobby({
    id: 'lobby-directory', name: 'Name directory board', cat: 'reception', w: 0.9, d: 0.05, h: 2.1, s: 2.1,
    label: '90 × 120 cm, names of 18 flats, 90 to 210 cm', look: 'lobby', params: { variant: 'directory', liftM: 0.9 }, pose: 'dims', kw: 'directory board name board resident names flats tenants signage lobby',
    mountY: 0.9, wall: true, zones: [stand('read', 0.9, 'to stand and read')],
    note: 'A directory board is 60 to 120 wide and 90 to 150 high, its names between 100 and 200 cm. It is fixed to a wall.',
  }),
  lobby({
    id: 'lobby-bench', name: 'Lift-lobby bench', cat: 'seating', kind: 'sofa', w: 1.5, d: 0.45, h: 0.45, s: 0.45, places: ['lobby', 'corridor'], family: 'sofa',
    label: '150 × 45 × 45 cm, padded seat', look: 'lobby', params: { variant: 'bench' }, pose: 'sit', kw: 'bench lift lobby waiting seat padded corridor',
    prompt: 'Sit on the bench', up: 'Get up', sideWords: { front: 'in front' },
    note: 'A waiting bench is 120 to 180 long, 40 to 50 deep and 44 to 47 cm high.',
  }),
  lobby({
    id: 'lobby-art-panel', name: 'Wall art panel, 180 × 100', cat: 'decor', w: 1.8, d: 0.04, h: 2.2, s: 2.2, places: ['lobby', 'corridor', 'hall'],
    label: '180 × 100 cm, three canvases, 120 to 220 cm', look: 'lobby', params: { variant: 'art', liftM: 1.2 }, pose: 'dims', kw: 'wall art panel painting canvas triptych decor lobby',
    mountY: 1.2, wall: true,
    note: 'Gallery wall art hangs with its middle at about 170 cm. This panel is 180 wide and 100 high, of three canvases. The picture is illustrative.',
  }),
  lobby({
    id: 'lobby-stanchions', name: 'Queue stanchions, pair with belt', cat: 'reception', w: 2.0, d: 0.32, h: 0.95, s: 0.95, places: ['lobby', 'hall'],
    label: '200 × 32 × 95 cm, two posts and a belt', look: 'lobby', params: { variant: 'stanchion' }, pose: 'dims', kw: 'stanchions queue barrier rope posts belt crowd control',
    note: 'A queue-barrier post is 32 cm across at the base and 95 cm high; the belt is 180 cm.',
  }),
];
