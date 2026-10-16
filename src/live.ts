import type { Player, Role } from './types';

/**
 * Moteur du match en direct (sans DOM).
 * Le résultat final (score) est décidé avant le match par play.ts ; ici on « raconte » ce match :
 * un vainqueur est tiré pour chaque manche (le total retombe toujours sur le score décidé), puis la manche est
 * jouée visuellement : déplacements sur la carte, duels, plantage / désamorçage de la bombe, économie.
 */

export type Side = 'CT' | 'T';
export type Rng = () => number;
export interface Vec { x: number; y: number }

/* ---------- la carte (originale, dessinée pour le jeu) ---------- */
export const MAP = { w: 1000, h: 760, name: 'Cobalt Yard' };

export interface Room { k: 'A' | 'B' | 'T' | 'CT' | 'M'; x: number; y: number; w: number; h: number }
export const ROOMS: Room[] = [
  { k: 'A', x: 70, y: 60, w: 260, h: 190 },
  { k: 'B', x: 690, y: 500, w: 240, h: 200 },
  { k: 'T', x: 50, y: 540, w: 190, h: 180 },
  { k: 'CT', x: 770, y: 50, w: 190, h: 170 },
  { k: 'M', x: 440, y: 335, w: 160, h: 120 },
];
const room = (k: Room['k']) => ROOMS.find((r) => r.k === k)!;

/** Caisses décoratives, placées en bordure des zones. */
export const CRATES: { x: number; y: number; s: number }[] = [
  { x: 90, y: 78, s: 30 }, { x: 288, y: 78, s: 30 }, { x: 96, y: 206, s: 26 },
  { x: 712, y: 520, s: 32 }, { x: 892, y: 520, s: 28 }, { x: 898, y: 660, s: 30 }, { x: 734, y: 668, s: 26 },
  { x: 452, y: 348, s: 24 }, { x: 560, y: 420, s: 24 },
  { x: 70, y: 560, s: 28 }, { x: 790, y: 70, s: 26 },
];

export const NODES: Record<string, Vec> = {
  tS: { x: 145, y: 630 }, lA1: { x: 140, y: 470 }, lA2: { x: 140, y: 330 }, aEntry: { x: 175, y: 240 },
  aSite: { x: 200, y: 155 }, tMid1: { x: 300, y: 560 }, tMid2: { x: 410, y: 470 }, mid: { x: 520, y: 395 },
  aShort: { x: 400, y: 275 }, aShortEnd: { x: 325, y: 195 }, midCT: { x: 640, y: 300 }, ctMid: { x: 740, y: 200 },
  ctS: { x: 865, y: 135 }, ctCorr: { x: 680, y: 120 }, ctA: { x: 450, y: 125 },
  bApp1: { x: 260, y: 690 }, bApp2: { x: 480, y: 690 }, bEntry: { x: 690, y: 640 }, bSite: { x: 810, y: 600 },
  midB: { x: 600, y: 510 }, bMidEnd: { x: 690, y: 560 }, bTop: { x: 850, y: 510 }, bCT: { x: 850, y: 430 }, bCT2: { x: 860, y: 230 },
};

export const EDGES: [string, string][] = [
  ['tS', 'lA1'], ['lA1', 'lA2'], ['lA2', 'aEntry'], ['aEntry', 'aSite'],
  ['tS', 'tMid1'], ['tMid1', 'tMid2'], ['tMid2', 'mid'],
  ['mid', 'aShort'], ['aShort', 'aShortEnd'], ['aShortEnd', 'aSite'],
  ['mid', 'midCT'], ['midCT', 'ctMid'], ['ctMid', 'ctS'],
  ['ctS', 'ctCorr'], ['ctCorr', 'ctA'], ['ctA', 'aSite'],
  ['tS', 'bApp1'], ['bApp1', 'bApp2'], ['bApp2', 'bEntry'], ['bEntry', 'bSite'],
  ['mid', 'midB'], ['midB', 'bMidEnd'], ['bMidEnd', 'bSite'],
  ['bSite', 'bTop'], ['bTop', 'bCT'], ['bCT', 'bCT2'], ['bCT2', 'ctS'],
];

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

const ADJ: Record<string, { to: string; d: number }[]> = {};
for (const id of Object.keys(NODES)) ADJ[id] = [];
for (const [a, b] of EDGES) {
  const d = dist(NODES[a], NODES[b]);
  ADJ[a].push({ to: b, d });
  ADJ[b].push({ to: a, d });
}

export function nearestNode(p: Vec): string {
  let best = 'tS';
  let bd = Infinity;
  for (const [id, n] of Object.entries(NODES)) {
    const d = dist(p, n);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

export function shortestPath(from: string, to: string): string[] {
  const d: Record<string, number> = {};
  const prev: Record<string, string> = {};
  const todo = new Set(Object.keys(NODES));
  for (const id of todo) d[id] = Infinity;
  d[from] = 0;
  while (todo.size) {
    let u = '';
    let ud = Infinity;
    for (const id of todo) if (d[id] < ud) { ud = d[id]; u = id; }
    if (!u || u === to) break;
    todo.delete(u);
    for (const e of ADJ[u]) {
      if (d[u] + e.d < d[e.to]) { d[e.to] = d[u] + e.d; prev[e.to] = u; }
    }
  }
  const out = [to];
  while (out[0] !== from && prev[out[0]]) out.unshift(prev[out[0]]);
  return out;
}

const SITE_NODE = { A: 'aSite', B: 'bSite' } as const;
const ROUTES: Record<'A' | 'B', string[][]> = {
  A: [['tS', 'lA1', 'lA2', 'aEntry', 'aSite'], ['tS', 'tMid1', 'tMid2', 'mid', 'aShort', 'aShortEnd', 'aSite']],
  B: [['tS', 'bApp1', 'bApp2', 'bEntry', 'bSite'], ['tS', 'tMid1', 'tMid2', 'mid', 'midB', 'bMidEnd', 'bSite']],
};

const pathLen = (pts: Vec[], from: Vec) => {
  let l = 0;
  let p = from;
  for (const q of pts) { l += dist(p, q); p = q; }
  return l;
};

function randIn(r: Room, margin: number, rng: Rng): Vec {
  return { x: r.x + margin + rng() * (r.w - 2 * margin), y: r.y + margin + rng() * (r.h - 2 * margin) };
}

/* ---------- scénarios de manche ---------- */
type EndType = 'elim' | 'bomb' | 'defuse';
interface Script { pre: Side[]; plant: boolean; post: Side[]; end: EndType }

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function rep<T>(v: T, n: number): T[] {
  return Array.from({ length: n }, () => v);
}
function weighted(w: number[], rng: Rng): number {
  const t = w.reduce((s, x) => s + x, 0);
  let x = rng() * t;
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i; }
  return w.length - 1;
}

/** Qui meurt, dans quel ordre, et comment la manche se termine, pour que `winner` gagne. */
export function makeScript(winner: Side, rng: Rng): Script {
  const r = rng();
  if (winner === 'T') {
    if (r < 0.55) {
      const d = weighted([30, 30, 22, 12, 6], rng);
      const t = shuffle([...rep<Side>('CT', 4), ...rep<Side>('T', d)], rng);
      return { pre: [...t, 'CT'], plant: false, post: [], end: 'elim' };
    }
    const c = 1 + weighted([20, 35, 30, 15], rng);
    const d = weighted([35, 35, 20, 10], rng);
    return { pre: shuffle([...rep<Side>('CT', c), ...rep<Side>('T', d)], rng), plant: true, post: [], end: 'bomb' };
  }
  if (r < 0.6) {
    const c = weighted([20, 30, 28, 14, 8], rng);
    const t = shuffle([...rep<Side>('T', 4), ...rep<Side>('CT', c)], rng);
    return { pre: [...t, 'T'], plant: false, post: [], end: 'elim' };
  }
  const c = 1 + weighted([40, 40, 20], rng);
  const t1 = weighted([40, 40, 20], rng);
  return {
    pre: shuffle([...rep<Side>('CT', c), ...rep<Side>('T', t1)], rng),
    plant: true,
    post: rep<Side>('T', 5 - t1),
    end: 'defuse',
  };
}

/** Vainqueur de chaque manche (0 = ton équipe, 1 = adversaire) ; le total retombe sur le score décidé. */
export function buildSchedule(myScore: number, oppScore: number, rng: Rng): (0 | 1)[] {
  const winner: 0 | 1 = myScore > oppScore ? 0 : 1;
  const loserRounds = Math.min(myScore, oppScore);
  const arr = shuffle([...rep<0 | 1>(winner, 12), ...rep<0 | 1>(winner === 0 ? 1 : 0, loserRounds)], rng);
  arr.push(winner);
  return arr;
}

/* ---------- équipe adverse ---------- */
const ROLES: Role[] = ['IGL', 'RIF', 'AWP', 'SUP', 'LRK'];

/** Cinq joueurs (un par rôle) dont la note moyenne s'approche de `target`, sans prendre ceux de ton équipe. */
export function buildOpponentRoster(all: Player[], mine: Player[], target: number, rng: Rng = Math.random): Player[] {
  const taken = new Set(mine.map((p) => p.id));
  const out: Player[] = [];
  for (const role of ROLES) {
    let pool = all.filter((p) => p.role === role && !taken.has(p.id));
    if (!pool.length) pool = all.filter((p) => !taken.has(p.id));
    const goal = target + (rng() - 0.5) * 8;
    const w = pool.map((p) => Math.exp(-((p.ovr - goal) ** 2) / (2 * 5 * 5)) + 0.001);
    const pick = pool[weighted(w, rng)];
    taken.add(pick.id);
    out.push(pick);
  }
  return out;
}

/* ---------- le match ---------- */
export interface Unit {
  idx: number;
  team: 0 | 1;
  player: Player;
  name: string;
  pos: Vec;
  path: Vec[];
  speed: number;
  angle: number;
  hold: Vec | null;
  wander: number;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  money: number;
  site: 'A' | 'B' | 'M' | null;
}

export type LiveEvent =
  | { type: 'roundStart'; round: number; half?: boolean }
  | { type: 'kill'; killer: number; victim: number; from: Vec; to: Vec }
  | { type: 'plant'; site: 'A' | 'B' }
  | { type: 'defuse' }
  | { type: 'roundEnd'; round: number; winTeam: 0 | 1; reason: EndType }
  | { type: 'chat'; from: number; text: string }
  | { type: 'matchEnd' };

type Stage = 'approach' | 'planting' | 'planted' | 'defusing' | 'ended';

const FREEZE = 4;
const ROUND_TIME = 115;
const BOMB_TIME = 40;
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 4;

export class LiveMatch {
  units: Unit[] = [];
  score: [number, number] = [0, 0];
  round = 0;
  phase: 'freeze' | 'live' | 'ended' | 'over' = 'freeze';
  stage: Stage = 'approach';
  t = 0;
  freezeLeft = FREEZE;
  bombLeft = 0;
  bombPos: Vec | null = null;
  bombSite: 'A' | 'B' = 'A';
  events: LiveEvent[] = [];
  lastWinner: 0 | 1 | null = null;

  private schedule: (0 | 1)[];
  private script!: Script;
  private queue: Side[] = [];
  private nextAt = 0;
  private target: 'A' | 'B' = 'A';
  private rotateAt = 0;
  private rotated = false;
  private actionLeft = 0;
  private actor: Unit | null = null;
  private lossStreak: [number, number] = [0, 0];

  readonly mine: Player[];
  readonly opp: Player[];
  readonly finalScore: [number, number];
  private rng: Rng;

  constructor(mine: Player[], opp: Player[], finalScore: [number, number], rng: Rng = Math.random) {
    this.mine = mine;
    this.opp = opp;
    this.finalScore = finalScore;
    this.rng = rng;
    this.schedule = buildSchedule(finalScore[0], finalScore[1], rng);
    [...mine, ...opp].forEach((player, i) => {
      this.units.push({
        idx: i, team: i < 5 ? 0 : 1, player, name: player.nickname, pos: { x: 0, y: 0 }, path: [], speed: 34, angle: 0,
        hold: null, wander: 0, hp: 100, alive: true, kills: 0, deaths: 0, money: 800, site: null,
      });
    });
    this.startRound();
  }

  get totalRounds(): number { return this.schedule.length; }
  /** Côté d'une équipe pendant la manche en cours (changement de côté après la 12e manche). */
  sideOf(team: 0 | 1, round = this.round): Side {
    const first = round <= 12;
    return (team === 0) === first ? 'CT' : 'T';
  }
  alive(side: Side): Unit[] { return this.units.filter((u) => u.alive && this.sideOf(u.team) === side); }
  /** Temps affiché (secondes) : fin de manche ou compte à rebours de la bombe une fois plantée. */
  get clock(): number {
    if (this.stage === 'planted' || this.stage === 'defusing') return Math.max(0, this.bombLeft);
    return Math.max(0, ROUND_TIME - this.t);
  }
  get bombActive(): boolean { return this.stage === 'planted' || this.stage === 'defusing'; }

  private emit(e: LiveEvent) { this.events.push(e); }

  private startRound() {
    this.round += 1;
    const half = this.round === 13;
    const pistol = this.round === 1 || half;
    if (half) this.lossStreak = [0, 0];
    this.script = makeScript(this.sideOf(this.schedule[this.round - 1]), this.rng);
    this.queue = [...this.script.pre];
    this.stage = 'approach';
    this.phase = 'freeze';
    this.freezeLeft = FREEZE;
    this.t = 0;
    this.bombPos = null;
    this.bombLeft = 0;
    this.actor = null;
    this.rotated = false;
    this.nextAt = 0;
    this.target = this.rng() < 0.5 ? 'A' : 'B';

    const tSpawn = room('T');
    const ctSpawn = room('CT');
    for (const u of this.units) {
      const side = this.sideOf(u.team);
      u.alive = true;
      u.hp = 100;
      u.path = [];
      u.hold = null;
      u.wander = 1 + this.rng() * 2;
      u.site = null;
      u.pos = randIn(side === 'T' ? tSpawn : ctSpawn, 28, this.rng);
      u.speed = 33 + this.rng() * 5;
      u.angle = side === 'T' ? -0.9 : 2.2;
      if (pistol) u.money = 800;
      // achats : pistolet, full buy, demi-achat ou éco selon l'argent
      let spend = 0;
      if (pistol) spend = 650;
      else if (u.money >= 4700) spend = 4100 + Math.round(this.rng() * 3) * 100;
      else if (u.money >= 2500) spend = Math.round((u.money * 0.7) / 50) * 50;
      u.money -= spend;
    }
    this.assignPlan();
    this.emit({ type: 'roundStart', round: this.round, half });
    if (this.round === 1) this.chatLine(5 + Math.floor(this.rng() * 5), 'glhf');
  }

  /** Les T prennent leurs routes vers le site visé, les CT se répartissent. */
  private assignPlan() {
    const site = this.target;
    const siteRoom = room(site);
    const ts = this.units.filter((u) => this.sideOf(u.team) === 'T');
    const cts = this.units.filter((u) => this.sideOf(u.team) === 'CT');
    const primary = this.rng() < 0.5 ? 0 : 1;
    shuffle(ts, this.rng).forEach((u, i) => {
      const route = ROUTES[site][i < 3 ? primary : 1 - primary];
      const pts = route.slice(1, -1).map((id) => ({ ...NODES[id] }));
      const end = randIn(siteRoom, 34, this.rng);
      pts.push(end);
      u.path = pts;
      u.hold = end;
      u.site = site;
    });
    let longest = 0;
    for (const u of ts) longest = Math.max(longest, pathLen(u.path, u.pos) / u.speed);
    this.rotateAt = Math.max(2, longest - 9);
    this.nextAt = Math.max(5, longest - 2 + this.rng() * 3);

    // CT : 2 en A, 2 en B, 1 au milieu
    const spots: ('A' | 'A' | 'B' | 'B' | 'M')[] = ['A', 'A', 'B', 'B', 'M'];
    shuffle(cts, this.rng).forEach((u, i) => {
      const s = spots[i];
      u.site = s;
      if (s === 'M') {
        const hold = { x: 585 + (this.rng() - 0.5) * 40, y: 330 + (this.rng() - 0.5) * 40 };
        u.path = [...this.graphPath(u.pos, 'midCT'), hold];
        u.hold = hold;
      } else {
        const hold = randIn(room(s), 34, this.rng);
        u.path = [...this.graphPath(u.pos, SITE_NODE[s]).slice(0, -1), hold];
        u.hold = hold;
      }
    });
  }

  private graphPath(from: Vec, toNode: string): Vec[] {
    return shortestPath(nearestNode(from), toNode).map((id) => ({ ...NODES[id] }));
  }

  private chatLine(from: number, text: string) {
    this.emit({ type: 'chat', from, text });
  }

  /** Avance la simulation de `dt` secondes de jeu. */
  step(dt: number) {
    if (this.phase === 'over' || this.phase === 'ended') return;
    if (this.phase === 'freeze') {
      this.freezeLeft -= dt;
      if (this.freezeLeft <= 0) this.phase = 'live';
      return;
    }
    this.t += dt;
    if (this.stage === 'planted' || this.stage === 'defusing') {
      this.bombLeft -= dt;
      if (this.script.end === 'defuse') this.bombLeft = Math.max(this.bombLeft, 5.2);
    }
    this.moveUnits(dt);
    this.runScript(dt);
  }

  private moveUnits(dt: number) {
    for (const u of this.units) {
      if (!u.alive) continue;
      let remaining = u.speed * dt;
      if (u.path.length) {
        while (remaining > 0 && u.path.length) {
          const to = u.path[0];
          const d = dist(u.pos, to);
          if (d <= remaining) {
            u.pos = { ...to };
            u.path.shift();
            remaining -= d;
          } else {
            u.angle = Math.atan2(to.y - u.pos.y, to.x - u.pos.x);
            u.pos = { x: u.pos.x + ((to.x - u.pos.x) / d) * remaining, y: u.pos.y + ((to.y - u.pos.y) / d) * remaining };
            remaining = 0;
          }
        }
      } else if (u.hold && u !== this.actor) {
        // à l'arrêt : petits pas autour du poste, regard sur l'ennemi le plus proche
        u.wander -= dt;
        if (u.wander <= 0) {
          u.wander = 1.5 + this.rng() * 2.5;
          u.path = [{ x: u.hold.x + (this.rng() - 0.5) * 36, y: u.hold.y + (this.rng() - 0.5) * 36 }];
          u.speed = 12 + this.rng() * 6;
        }
      }
      if (!u.path.length || u.speed < 20) {
        const foe = this.nearestEnemy(u);
        if (foe && dist(u.pos, foe.pos) < 260) u.angle = Math.atan2(foe.pos.y - u.pos.y, foe.pos.x - u.pos.x);
      }
    }
  }

  private nearestEnemy(u: Unit): Unit | null {
    let best: Unit | null = null;
    let bd = Infinity;
    for (const e of this.units) {
      if (!e.alive || e.team === u.team) continue;
      const d = dist(u.pos, e.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  private closestPairDist(): number {
    let bd = Infinity;
    for (const a of this.units) {
      if (!a.alive || a.team !== 0) continue;
      for (const b of this.units) {
        if (!b.alive || b.team !== 1) continue;
        bd = Math.min(bd, dist(a.pos, b.pos));
      }
    }
    return bd;
  }

  private runScript(dt: number) {
    // les CT hors site rotent vers le site attaqué
    if (!this.rotated && this.stage === 'approach' && this.t >= this.rotateAt) {
      this.rotated = true;
      this.rotateCTs();
    }

    if (this.stage === 'approach' || this.stage === 'planted') {
      const forced = this.t > ROUND_TIME - 6 || (this.stage === 'planted' && this.bombLeft < 9);
      if (this.queue.length && (forced || (this.t >= this.nextAt && (this.closestPairDist() < 190 || this.t > this.nextAt + 9)))) {
        this.fireKill(this.queue.shift()!);
        this.nextAt = this.t + (this.stage === 'planted' ? 1.5 + this.rng() * 2.5 : 2 + this.rng() * 4);
        if (this.phase !== 'live') return;
      }
    }

    if (this.stage === 'approach' && !this.queue.length && this.script.plant) this.beginPlant();

    if (this.stage === 'planting' && this.actor) {
      if (!this.actor.alive) { this.beginPlant(); return; }
      if (!this.actor.path.length) {
        this.actionLeft -= dt;
        if (this.actionLeft <= 0) this.finishPlant();
      }
    }

    if (this.stage === 'planted') {
      if (this.script.end === 'bomb' && this.bombLeft <= 0) return this.endRound(this.winnerTeamOfScript(), 'bomb');
      if (this.script.end === 'defuse' && !this.queue.length && !this.alive('T').length) this.beginDefuse();
    }

    if (this.stage === 'defusing' && this.actor) {
      if (!this.actor.alive) { this.beginDefuse(); return; }
      if (!this.actor.path.length) {
        this.actionLeft -= dt;
        if (this.actionLeft <= 0) { this.emit({ type: 'defuse' }); this.endRound(this.winnerTeamOfScript(), 'defuse'); }
      }
    }
  }

  private winnerTeamOfScript(): 0 | 1 {
    return this.schedule[this.round - 1];
  }

  private rotateCTs() {
    const site = this.target;
    for (const u of this.alive('CT')) {
      if (u.site === site) continue;
      const hold = randIn(room(site), 34, this.rng);
      u.path = [...this.graphPath(u.pos, SITE_NODE[site]).slice(0, -1), hold];
      u.hold = hold;
      u.site = site;
      u.speed = 33 + this.rng() * 5;
    }
  }

  private beginPlant() {
    const tAlive = this.alive('T');
    if (!tAlive.length) return;
    const spot = NODES[SITE_NODE[this.target]];
    const planter = tAlive.reduce((a, b) => (dist(a.pos, spot) < dist(b.pos, spot) ? a : b));
    const bombPos = { x: spot.x + 22, y: spot.y + 14 };
    this.actor = planter;
    this.stage = 'planting';
    this.actionLeft = PLANT_TIME;
    planter.path = [bombPos];
    planter.hold = bombPos;
    planter.speed = 34;
    this.bombPos = bombPos;
  }

  private finishPlant() {
    this.stage = 'planted';
    this.bombLeft = BOMB_TIME;
    this.bombSite = this.target;
    this.actor = null;
    this.queue = [...this.script.post];
    this.emit({ type: 'plant', site: this.target });
    if (this.script.end === 'bomb') {
      // les CT survivants ne peuvent plus retourner la situation : ils économisent leur arme
      for (const u of this.alive('CT')) {
        u.path = this.graphPath(u.pos, 'ctS');
        u.hold = { ...NODES.ctS };
        u.speed = 34;
      }
    } else {
      for (const u of this.alive('CT')) {
        const hold = { x: this.bombPos!.x + (this.rng() - 0.5) * 120, y: this.bombPos!.y + (this.rng() - 0.5) * 100 };
        u.path = [...this.graphPath(u.pos, SITE_NODE[this.target]).slice(0, -1), hold];
        u.hold = hold;
        u.speed = 35;
      }
      for (const u of this.alive('T')) {
        const hold = { x: this.bombPos!.x + (this.rng() - 0.5) * 140, y: this.bombPos!.y + (this.rng() - 0.5) * 120 };
        u.path = [hold];
        u.hold = hold;
        u.speed = 34;
      }
      this.nextAt = this.t + 4 + this.rng() * 3;
    }
  }

  private beginDefuse() {
    const cts = this.alive('CT');
    if (!cts.length || !this.bombPos) return;
    const bomb = this.bombPos;
    const d = cts.reduce((a, b) => (dist(a.pos, bomb) < dist(b.pos, bomb) ? a : b));
    this.actor = d;
    this.stage = 'defusing';
    this.actionLeft = DEFUSE_TIME;
    d.path = [{ x: bomb.x - 14, y: bomb.y }];
    d.hold = d.path[0];
    d.speed = 38;
  }

  private fireKill(victimSide: Side) {
    const killerSide: Side = victimSide === 'CT' ? 'T' : 'CT';
    const killers = this.alive(killerSide);
    const victims = this.alive(victimSide);
    if (!killers.length || !victims.length) return;
    let best: [Unit, Unit] | null = null;
    let bs = Infinity;
    for (const k of killers) {
      for (const v of victims) {
        const score = dist(k.pos, v.pos) + this.rng() * 90 - (k.player.ovr - v.player.ovr) * 2;
        if (score < bs) { bs = score; best = [k, v]; }
      }
    }
    const [k, v] = best!;
    v.alive = false;
    v.hp = 0;
    v.path = [];
    v.deaths += 1;
    k.kills += 1;
    k.money = Math.min(16000, k.money + 300);
    if (this.rng() < 0.45) k.hp = Math.max(4, k.hp - Math.round(10 + this.rng() * 55));
    this.emit({ type: 'kill', killer: k.idx, victim: v.idx, from: { ...k.pos }, to: { ...v.pos } });
    if (this.rng() < 0.12) {
      const speaker = this.rng() < 0.5 ? v : k;
      this.chatLine(speaker.idx, speaker === v ? ['nt', 'wp', 'gj', 'wow'][Math.floor(this.rng() * 4)] : ['ez', 'nice', ':)'][Math.floor(this.rng() * 3)]);
    }
    if (!this.alive(victimSide).length) {
      if (victimSide === 'CT') return this.endRound(this.sideOf(0) === 'T' ? 0 : 1, 'elim');
      if (this.stage !== 'planted' && this.stage !== 'defusing') return this.endRound(this.sideOf(0) === 'CT' ? 0 : 1, 'elim');
    }
  }

  private endRound(winTeam: 0 | 1, reason: EndType) {
    if (this.phase !== 'live') return;
    this.phase = 'ended';
    this.stage = 'ended';
    this.lastWinner = winTeam;
    this.score[winTeam] += 1;
    const loser = (1 - winTeam) as 0 | 1;
    const bonus = Math.min(4, this.lossStreak[loser]);
    for (const u of this.units) {
      u.money = Math.min(16000, u.money + (u.team === winTeam ? 3250 : 1400 + 500 * bonus));
    }
    this.lossStreak[loser] = Math.min(4, this.lossStreak[loser] + 1);
    this.lossStreak[winTeam] = Math.max(0, this.lossStreak[winTeam] - 1);
    this.emit({ type: 'roundEnd', round: this.round, winTeam, reason });
    if (this.rng() < 0.35) {
      const losers = this.units.filter((u) => u.team === loser);
      this.chatLine(losers[Math.floor(this.rng() * losers.length)].idx, ['wp', 'gg', 'nt'][Math.floor(this.rng() * 3)]);
    }
    if (this.score[0] >= 13 || this.score[1] >= 13) {
      this.phase = 'over';
      const l = this.units.filter((u) => u.team === loser);
      this.chatLine(l[Math.floor(this.rng() * l.length)].idx, 'gg wp');
      this.emit({ type: 'matchEnd' });
    }
  }

  /** À appeler après la pause de fin de manche. */
  nextRound() {
    if (this.phase !== 'ended') return;
    this.startRound();
  }
}
