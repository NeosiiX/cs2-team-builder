import type { Player, Role } from './types';
import type { MapDef, Vec } from './maps';
import { findPath, randomIn, scatter, rectCenter, pathLength } from './maps';

/**
 * Moteur du match en direct (sans DOM).
 * Le résultat final (score) est décidé avant le match par play.ts ; ici on « raconte » ce match :
 * un vainqueur est tiré pour chaque manche (le total retombe toujours sur le score décidé), puis la manche est
 * jouée visuellement : déplacements sur la carte, duels, plantage / désamorçage de la bombe, économie.
 */

export type Side = 'CT' | 'T';
export type Rng = () => number;
export type { Vec };

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Tourne `a` vers `b` par le chemin le plus court, de `max` radians au plus. */
export function turnToward(a: number, b: number, max: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-max, Math.min(max, d));
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
  /** vitesse actuelle (accélère et freine) */
  v: number;
  /** direction de marche et direction du regard (lissées) */
  heading: number;
  angle: number;
  /** secondes d'aveuglement restantes (effet visuel) */
  flash: number;
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
  /** index du T qui porte la bombe (-1 si personne) */
  carrier = -1;
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
  readonly map: MapDef;
  private rng: Rng;

  constructor(mine: Player[], opp: Player[], finalScore: [number, number], map: MapDef, rng: Rng = Math.random) {
    this.map = map;
    this.mine = mine;
    this.opp = opp;
    this.finalScore = finalScore;
    this.rng = rng;
    this.schedule = buildSchedule(finalScore[0], finalScore[1], rng);
    [...mine, ...opp].forEach((player, i) => {
      this.units.push({
        idx: i, team: i < 5 ? 0 : 1, player, name: player.nickname, pos: { x: 0, y: 0 }, path: [], speed: 34, v: 0, heading: 0, angle: 0, flash: 0,
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

    for (const u of this.units) {
      const side = this.sideOf(u.team);
      u.alive = true;
      u.hp = 100;
      u.path = [];
      u.hold = null;
      u.wander = 1 + this.rng() * 2;
      u.site = null;
      u.pos = randomIn(this.map, side === 'T' ? this.map.tSpawn : this.map.ctSpawn, this.rng, 10);
      u.speed = this.runSpeed();
      u.angle = u.heading = side === 'T' ? -0.9 : 2.2;
      u.v = 0;
      u.flash = 0;
      if (pistol) u.money = 800;
      // achats : pistolet, full buy, demi-achat ou éco selon l'argent
      let spend = 0;
      if (pistol) spend = 650;
      else if (u.money >= 4700) spend = 4100 + Math.round(this.rng() * 3) * 100;
      else if (u.money >= 2500) spend = Math.round((u.money * 0.7) / 50) * 50;
      u.money -= spend;
    }
    this.assignPlan();
    const tUnits = this.units.filter((u) => this.sideOf(u.team) === 'T');
    this.carrier = tUnits[Math.floor(this.rng() * tUnits.length)].idx;
    this.emit({ type: 'roundStart', round: this.round, half });
    if (this.round === 1) this.chatLine(5 + Math.floor(this.rng() * 5), 'glhf');
  }

  private runSpeed(): number {
    return (33 + this.rng() * 5) * 1.5;
  }

  private pathTo(from: Vec, to: Vec): Vec[] {
    return findPath(this.map, from, to);
  }

  /** Les T prennent leurs routes vers le site visé, les CT se répartissent. */
  private assignPlan() {
    const site = this.target;
    const ts = this.units.filter((u) => this.sideOf(u.team) === 'T');
    const cts = this.units.filter((u) => this.sideOf(u.team) === 'CT');
    const primary = this.rng() < 0.5 ? 0 : 1;
    shuffle(ts, this.rng).forEach((u, i) => {
      const via = this.map.routes[site][i < 3 ? primary : 1 - primary];
      const end = randomIn(this.map, this.map.sites[site], this.rng, 6);
      const pts: Vec[] = [];
      let from = u.pos;
      for (const wp of [...via, end]) {
        pts.push(...this.pathTo(from, wp));
        from = wp;
      }
      u.path = pts;
      u.hold = end;
      u.site = site;
    });
    let longest = 0;
    for (const u of ts) longest = Math.max(longest, pathLength(u.path, u.pos) / u.speed);
    this.rotateAt = Math.max(2, longest - 9);
    this.nextAt = Math.max(5, longest - 2 + this.rng() * 3);

    // CT : 2 en A, 2 en B, 1 au milieu
    const spots: ('A' | 'A' | 'B' | 'B' | 'M')[] = ['A', 'A', 'B', 'B', 'M'];
    shuffle(cts, this.rng).forEach((u, i) => {
      const s = spots[i];
      u.site = s;
      const hold = s === 'M' ? scatter(this.map, this.map.mid, 22, this.rng) : randomIn(this.map, this.map.sites[s], this.rng, 6);
      u.path = this.pathTo(u.pos, hold);
      u.hold = hold;
    });
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
    const TURN = 9; // rad/s : rayon de virage d'environ 6 px, les coins sont arrondis
    const ACCEL = 170; // px/s²
    for (const u of this.units) {
      if (!u.alive) continue;
      u.flash = Math.max(0, u.flash - dt);

      // à l'arrêt : petits pas autour du poste
      if (!u.path.length && u.hold && u !== this.actor) {
        u.wander -= dt;
        if (u.wander <= 0) {
          u.wander = 2 + this.rng() * 3;
          u.path = [scatter(this.map, u.hold, 18, this.rng)];
          u.speed = (11 + this.rng() * 6) * 1.5;
        }
      }

      // accélération / freinage
      const moving = u.path.length > 0;
      const goal = moving ? u.speed : 0;
      u.v += Math.max(-ACCEL * 2 * dt, Math.min(ACCEL * dt, goal - u.v));

      if (moving) {
        const to = u.path[0];
        const want = Math.atan2(to.y - u.pos.y, to.x - u.pos.x);
        u.heading = turnToward(u.heading, want, TURN * dt);
        const step = u.v * dt;
        const d = dist(u.pos, to);
        if (d <= Math.max(step, 9) && (u.path.length > 1 || d <= Math.max(step, 4))) {
          if (u.path.length > 1) u.path.shift();
          else { u.pos = { ...to }; u.path.shift(); }
        } else {
          u.pos = { x: u.pos.x + Math.cos(u.heading) * step, y: u.pos.y + Math.sin(u.heading) * step };
        }
      } else if (u.v > 0.5) {
        u.pos = { x: u.pos.x + Math.cos(u.heading) * u.v * dt, y: u.pos.y + Math.sin(u.heading) * u.v * dt };
      }

      // regard : l'ennemi proche, sinon la direction de marche
      const foe = this.nearestEnemy(u);
      if (foe && dist(u.pos, foe.pos) < 300) {
        u.angle = turnToward(u.angle, Math.atan2(foe.pos.y - u.pos.y, foe.pos.x - u.pos.x), 10 * dt);
      } else if (u.v > 8) {
        u.angle = turnToward(u.angle, u.heading, 6 * dt);
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
      if (this.queue.length && (forced || (this.t >= this.nextAt && (this.closestPairDist() < 230 || this.t > this.nextAt + 9)))) {
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
      const hold = randomIn(this.map, this.map.sites[site], this.rng, 6);
      u.path = this.pathTo(u.pos, hold);
      u.hold = hold;
      u.site = site;
      u.speed = this.runSpeed();
    }
  }

  private beginPlant() {
    const tAlive = this.alive('T');
    if (!tAlive.length) return;
    const bombPos = { ...this.map.bomb[this.target] };
    const carrying = tAlive.find((u) => u.idx === this.carrier);
    const planter = carrying ?? tAlive.reduce((a, b) => (dist(a.pos, bombPos) < dist(b.pos, bombPos) ? a : b));
    this.actor = planter;
    this.stage = 'planting';
    this.actionLeft = PLANT_TIME;
    planter.path = this.pathTo(planter.pos, bombPos);
    planter.hold = bombPos;
    planter.speed = this.runSpeed();
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
        const safe = rectCenter(this.map.ctSpawn);
        u.path = this.pathTo(u.pos, safe);
        u.hold = safe;
        u.speed = this.runSpeed();
      }
    } else {
      for (const u of this.alive('CT')) {
        const hold = scatter(this.map, this.bombPos!, 70, this.rng);
        u.path = this.pathTo(u.pos, hold);
        u.hold = hold;
        u.speed = this.runSpeed();
      }
      for (const u of this.alive('T')) {
        const hold = scatter(this.map, this.bombPos!, 70, this.rng);
        u.path = this.pathTo(u.pos, hold);
        u.hold = hold;
        u.speed = this.runSpeed();
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
    d.path = this.pathTo(d.pos, bomb);
    d.hold = bomb;
    d.speed = this.runSpeed() * 1.1;
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
    if (this.rng() < 0.3) {
      const near = this.units.filter((x) => x.alive && dist(x.pos, v.pos) < 220);
      if (near.length) near[Math.floor(this.rng() * near.length)].flash = 1.2 + this.rng() * 1.6;
    }
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
