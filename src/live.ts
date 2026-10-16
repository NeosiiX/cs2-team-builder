import type { Player, Role } from './types';
import type { MapDef, Vec } from './maps';
import { findPath, randomIn, scatter, rectCenter, gridOf } from './maps';

/**
 * Moteur du match en direct (sans DOM).
 *
 * Le score final est décidé avant le match (play.ts). Ici, chaque manche se joue « pour de vrai » sur le radar :
 * les joueurs se déplacent, se repèrent quand ils ont une ligne de vue (murs et caisses bloquent la vue),
 * s'arrêtent et tirent balle par balle (précision selon AIM, distance, arme, déplacement), plantent et désamorcent.
 *
 * Pour que la manche finisse quand même du côté prévu, quelques règles discrètes s'appliquent :
 * - le dernier survivant de l'équipe qui doit gagner ne peut pas tomber (il finit à 1 PV au pire) ;
 * - si les T doivent gagner : les CT ne peuvent pas désamorcer tant qu'un T est en vie, et les T foncent planter
 *   en fin de manche (le chrono attend la pose) ;
 * - si les CT doivent gagner : le compte à rebours de la bombe attend le désamorçage.
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
const angleDiff = (a: number, b: number) => Math.abs(turnToward(a, b, Infinity) - a);

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

/* ---------- armes ---------- */
export type Weapon = 'pistol' | 'smg' | 'rifle' | 'awp';
const WEAPON: Record<Weapon, { interval: number; acc: number; range: number; body: [number, number]; hs: number; reward: number }> = {
  pistol: { interval: 0.26, acc: 0.85, range: 700, body: [14, 24], hs: 92, reward: 300 },
  smg: { interval: 0.1, acc: 0.82, range: 650, body: [15, 24], hs: 70, reward: 600 },
  rifle: { interval: 0.13, acc: 1, range: 1100, body: [23, 33], hs: 100, reward: 300 },
  awp: { interval: 1.45, acc: 1.12, range: 1600, body: [100, 100], hs: 100, reward: 100 },
};

/* ---------- le match ---------- */
type Task = 'move' | 'hold' | 'plant' | 'defuse' | 'pickup' | 'retake' | 'hunt';

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
  /** direction surveillée à l'arrêt (vers l'entrée la plus probable de l'ennemi) */
  watch: number;
  /** secondes d'aveuglement restantes */
  flash: number;
  hold: Vec | null;
  wander: number;
  delay: number;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  money: number;
  weapon: Weapon;
  site: 'A' | 'B' | 'M' | null;
  task: Task;
  /** progression de la pose / du désamorçage (secondes restantes) */
  action: number;
  /** combat : cible (-1 = aucune), temps de réaction restant, délai avant la balle suivante, dernière balle tirée */
  target: number;
  react: number;
  cooldown: number;
  lostSight: number;
  lastShot: number;
  replan: number;
}

export type EndReason = 'elim' | 'bomb' | 'defuse' | 'time';
export type LiveEvent =
  | { type: 'roundStart'; round: number; half?: boolean }
  | { type: 'kill'; killer: number; victim: number; from: Vec; to: Vec; hs: boolean }
  | { type: 'plant'; site: 'A' | 'B' }
  | { type: 'defuse' }
  | { type: 'roundEnd'; round: number; winTeam: 0 | 1; reason: EndReason }
  | { type: 'chat'; from: number; text: string }
  | { type: 'matchEnd' };

export interface BombState {
  state: 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded';
  pos: Vec | null;
  carrier: number;
  site: 'A' | 'B' | null;
  timer: number;
}

const FREEZE = 4;
const ROUND_TIME = 115;
const BOMB_TIME = 40;
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5;
const FOV = 1.95; // demi-angle de vision (rad)
const HEAR = 140; // en dessous, on « entend » l'ennemi même hors champ
const RUN = 50; // vitesse de course (px radar / s)

export class LiveMatch {
  units: Unit[] = [];
  score: [number, number] = [0, 0];
  round = 0;
  phase: 'freeze' | 'live' | 'ended' | 'over' = 'freeze';
  t = 0;
  freezeLeft = FREEZE;
  events: LiveEvent[] = [];
  bomb: BombState = { state: 'carried', pos: null, carrier: -1, site: null, timer: 0 };

  readonly mine: Player[];
  readonly opp: Player[];
  readonly finalScore: [number, number];
  readonly map: MapDef;
  private rng: Rng;
  private schedule: (0 | 1)[];
  private target: 'A' | 'B' = 'A';
  private rotated = false;
  private rush = false;
  private lossStreak: [number, number] = [0, 0];
  private aiClock = 0;

  constructor(mine: Player[], opp: Player[], finalScore: [number, number], map: MapDef, rng: Rng = Math.random) {
    this.map = map;
    this.mine = mine;
    this.opp = opp;
    this.finalScore = finalScore;
    this.rng = rng;
    this.schedule = buildSchedule(finalScore[0], finalScore[1], rng);
    [...mine, ...opp].forEach((player, i) => {
      this.units.push({
        idx: i, team: i < 5 ? 0 : 1, player, name: player.nickname, pos: { x: 0, y: 0 }, path: [], speed: RUN, v: 0,
        heading: 0, angle: 0, watch: 0, flash: 0, hold: null, wander: 0, delay: 0, hp: 100, alive: true, kills: 0, deaths: 0,
        money: 800, weapon: 'pistol', site: null, task: 'move', action: 0, target: -1, react: 0, cooldown: 0, lostSight: 0,
        lastShot: -99, replan: 0,
      });
    });
    this.startRound();
  }

  /* ---------- infos pour l'affichage ---------- */
  get totalRounds(): number { return this.schedule.length; }
  /** Côté d'une équipe (changement de côté après la 12e manche). */
  sideOf(team: 0 | 1, round = this.round): Side {
    return (team === 0) === round <= 12 ? 'CT' : 'T';
  }
  alive(side: Side): Unit[] { return this.units.filter((u) => u.alive && this.sideOf(u.team) === side); }
  get planted(): boolean { return this.bomb.state === 'planted'; }
  get bombActive(): boolean { return this.planted; }
  /** Temps affiché : fin de manche, ou compte à rebours de la bombe une fois plantée. */
  get clock(): number { return this.planted ? Math.max(0, this.bomb.timer) : Math.max(0, ROUND_TIME - this.t); }
  /** Position de la bombe quand elle est au sol (lâchée ou plantée). */
  get bombPos(): Vec | null { return this.bomb.state === 'dropped' || this.planted ? this.bomb.pos : null; }
  get carrier(): number { return this.bomb.state === 'carried' ? this.bomb.carrier : -1; }
  get defusing(): boolean { return this.units.some((u) => u.alive && u.task === 'defuse'); }

  private get winTeam(): 0 | 1 { return this.schedule[this.round - 1]; }
  private get winSide(): Side { return this.sideOf(this.winTeam); }
  private teamOf(side: Side): 0 | 1 { return this.sideOf(0) === side ? 0 : 1; }
  private aliveIn(team: 0 | 1): number { return this.units.filter((x) => x.alive && x.team === team).length; }
  /** Dernier survivant de l'équipe qui doit gagner la manche : il ne peut pas tomber. */
  private isProtected(u: Unit): boolean { return u.team === this.winTeam && this.aliveIn(u.team) === 1; }

  private emit(e: LiveEvent) { this.events.push(e); }
  private chat(from: number, text: string) { this.emit({ type: 'chat', from, text }); }
  private pathTo(from: Vec, to: Vec): Vec[] { return findPath(this.map, from, to); }
  private runSpeed(): number { return RUN * (0.95 + this.rng() * 0.12); }

  /** Direction à surveiller depuis `p` : le début du chemin vers `from` (là d'où viendra l'ennemi). */
  private watchFrom(p: Vec, from: Vec): number {
    const path = this.pathTo(p, from);
    const q = path.find((x) => dist(x, p) > 30) ?? path[0] ?? from;
    return Math.atan2(q.y - p.y, q.x - p.x);
  }

  /* ---------- début de manche ---------- */
  private startRound() {
    this.round += 1;
    const half = this.round === 13;
    const pistol = this.round === 1 || half;
    if (half) this.lossStreak = [0, 0];
    this.phase = 'freeze';
    this.freezeLeft = FREEZE;
    this.t = 0;
    this.rotated = false;
    this.rush = false;
    this.aiClock = 0;
    this.target = this.rng() < 0.5 ? 'A' : 'B';

    for (const u of this.units) {
      const side = this.sideOf(u.team);
      Object.assign(u, {
        alive: true, hp: 100, path: [], hold: null, site: null, task: 'move', action: 0, target: -1, react: 0,
        cooldown: 0, lostSight: 0, lastShot: -99, flash: 0, v: 0, replan: 0,
        wander: 1 + this.rng() * 2, delay: side === 'T' ? this.rng() * 3 : this.rng() * 0.8,
      });
      u.pos = randomIn(this.map, side === 'T' ? this.map.tSpawn : this.map.ctSpawn, this.rng, 10);
      u.speed = this.runSpeed();
      if (pistol) u.money = 800;
      // achats : pistolet, AWP / fusil, SMG ou éco
      let spend = 0;
      if (pistol) { spend = 650; u.weapon = 'pistol'; }
      else if (u.money >= 4700) { spend = 4100 + Math.round(this.rng() * 3) * 100; u.weapon = u.player.role === 'AWP' ? 'awp' : 'rifle'; }
      else if (u.money >= 2400) { spend = Math.round((u.money * 0.7) / 50) * 50; u.weapon = 'smg'; }
      else { spend = Math.min(u.money, 200); u.weapon = 'pistol'; }
      u.money -= spend;
    }
    this.assignPlan();
    const ts = this.units.filter((u) => this.sideOf(u.team) === 'T');
    const carrier = ts[Math.floor(this.rng() * ts.length)];
    this.bomb = { state: 'carried', pos: null, carrier: carrier.idx, site: null, timer: 0 };
    this.emit({ type: 'roundStart', round: this.round, half });
    if (this.round === 1) this.chat(5 + Math.floor(this.rng() * 5), 'glhf');
  }

  /** Les T prennent leurs routes vers le site visé, les CT se répartissent sur A, B et le milieu. */
  private assignPlan() {
    const site = this.target;
    const ts = this.units.filter((u) => this.sideOf(u.team) === 'T');
    const cts = this.units.filter((u) => this.sideOf(u.team) === 'CT');
    const tSpawn = rectCenter(this.map.tSpawn);
    const ctSpawn = rectCenter(this.map.ctSpawn);
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
      u.watch = this.watchFrom(end, ctSpawn);
      u.angle = u.heading = Math.atan2((pts[0]?.y ?? end.y) - u.pos.y, (pts[0]?.x ?? end.x) - u.pos.x);
    });
    const spots: ('A' | 'A' | 'B' | 'B' | 'M')[] = ['A', 'A', 'B', 'B', 'M'];
    shuffle(cts, this.rng).forEach((u, i) => {
      const s = spots[i];
      u.site = s;
      const hold = s === 'M' ? scatter(this.map, this.map.mid, 22, this.rng) : randomIn(this.map, this.map.sites[s], this.rng, 6);
      u.path = this.pathTo(u.pos, hold);
      u.hold = hold;
      u.watch = this.watchFrom(hold, tSpawn);
      u.angle = u.heading = Math.atan2((u.path[0]?.y ?? hold.y) - u.pos.y, (u.path[0]?.x ?? hold.x) - u.pos.x);
    });
  }

  /* ---------- boucle ---------- */
  step(dt: number) {
    if (this.phase === 'over' || this.phase === 'ended') return;
    if (this.phase === 'freeze') {
      this.freezeLeft -= dt;
      if (this.freezeLeft <= 0) this.phase = 'live';
      return;
    }
    this.t += dt;

    if (this.planted) {
      this.bomb.timer -= dt;
      if (this.winSide === 'CT') this.bomb.timer = Math.max(this.bomb.timer, 6);
      if (this.bomb.timer <= 0) {
        this.bomb.state = 'exploded';
        return this.endRound(this.teamOf('T'), 'bomb');
      }
    } else if (this.t >= ROUND_TIME) {
      if (this.winSide === 'CT') return this.endRound(this.teamOf('CT'), 'time');
      this.t = ROUND_TIME - 0.01; // les T doivent encore poser : le chrono attend
    }
    if (!this.rush && !this.planted && this.winSide === 'T' && ROUND_TIME - this.t < 35) this.startRush();

    this.aiClock -= dt;
    if (this.aiClock <= 0) {
      this.aiClock = 0.25;
      this.think();
    }
    this.combat(dt);
    if (this.phase !== 'live') return;
    this.actions(dt);
    if (this.phase !== 'live') return;
    this.move(dt);
  }

  /* ---------- décisions (4 fois par seconde) ---------- */
  private think() {
    // les CT tournent vers le site où au moins deux T sont repérés
    if (!this.rotated && !this.planted) {
      for (const s of ['A', 'B'] as const) {
        const c = rectCenter(this.map.sites[s]);
        const near = this.alive('T').filter((u) => dist(u.pos, c) < 420).length;
        if (near < 2) continue;
        this.rotated = true;
        this.target = s;
        for (const u of this.alive('CT')) {
          if (u.site === s) continue;
          const hold = randomIn(this.map, this.map.sites[s], this.rng, 6);
          u.path = this.pathTo(u.pos, hold);
          u.hold = hold;
          u.site = s;
          u.speed = this.runSpeed();
          u.watch = this.watchFrom(hold, rectCenter(this.map.tSpawn));
        }
        break;
      }
    }

    // bombe au sol : le T le plus proche va la ramasser
    if (this.bomb.state === 'dropped' && this.bomb.pos) {
      const bp = this.bomb.pos;
      const ts = this.alive('T');
      if (ts.length && !ts.some((u) => u.task === 'pickup')) {
        const u = ts.reduce((a, b) => (dist(a.pos, bp) < dist(b.pos, bp) ? a : b));
        u.task = 'pickup';
        u.path = this.pathTo(u.pos, bp);
        u.hold = { ...bp };
        u.speed = this.runSpeed();
      }
    }

    // porteur : une fois sur le site et sans ennemi en vue, il pose
    if (this.bomb.state === 'carried') {
      const c = this.units[this.bomb.carrier];
      if (c.alive && c.task !== 'plant' && (c.target < 0 || this.rush) && this.onSite(c.pos)) {
        c.task = 'plant';
        c.action = PLANT_TIME;
        c.path = [];
      }
    }

    // bombe posée : les CT reprennent le site (ou chassent les T si le désamorçage est impossible)
    if (this.planted && this.bomb.pos) {
      const bp = this.bomb.pos;
      for (const u of this.alive('CT')) {
        if (u.task === 'defuse') continue;
        u.replan -= 0.25;
        if (dist(u.pos, bp) < 16 && u.target < 0 && this.canDefuse(u)) {
          u.task = 'defuse';
          u.action = DEFUSE_TIME;
          u.path = [];
          continue;
        }
        if (u.replan > 0) continue;
        u.replan = 2;
        const foes = this.alive('T');
        if (this.winSide === 'T' && foes.length && dist(u.pos, bp) < 140) {
          const f = foes.reduce((a, b) => (dist(a.pos, u.pos) < dist(b.pos, u.pos) ? a : b));
          u.task = 'hunt';
          u.path = this.pathTo(u.pos, f.pos);
          u.hold = { ...f.pos };
          continue;
        }
        if (u.task !== 'retake' || !u.path.length) {
          u.task = 'retake';
          u.path = this.pathTo(u.pos, bp);
          u.hold = { ...bp };
          u.speed = this.runSpeed();
        }
      }
    }
  }

  private onSite(p: Vec): boolean {
    return (['A', 'B'] as const).some((s) => {
      const r = this.map.sites[s];
      return p.x > r.x - 20 && p.x < r.x + r.w + 20 && p.y > r.y - 20 && p.y < r.y + r.h + 20;
    });
  }
  private siteAt(p: Vec): 'A' | 'B' {
    return dist(p, rectCenter(this.map.sites.A)) < dist(p, rectCenter(this.map.sites.B)) ? 'A' : 'B';
  }

  /** Un CT peut désamorcer si aucun T vivant ne le voit (et jamais si les T doivent gagner la manche). */
  private canDefuse(u: Unit): boolean {
    const ts = this.alive('T');
    if (this.winSide === 'T' && ts.length) return false;
    const g = gridOf(this.map);
    return !ts.some((t) => dist(t.pos, u.pos) < 700 && g.los(t.pos, u.pos));
  }

  /** Fin de manche sans pose alors que les T doivent gagner : tout le monde fonce sur le site. */
  private startRush() {
    this.rush = true;
    const site = this.target;
    for (const u of this.alive('T')) {
      if (u.task === 'pickup' || u.task === 'plant') continue;
      const end = this.bomb.state === 'carried' && u.idx === this.bomb.carrier
        ? { ...this.map.bomb[site] }
        : randomIn(this.map, this.map.sites[site], this.rng, 6);
      u.path = this.pathTo(u.pos, end);
      u.hold = end;
      u.task = 'move';
      u.speed = this.runSpeed() * 1.05;
    }
  }

  /* ---------- ramassage, pose et désamorçage ---------- */
  private actions(dt: number) {
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.task === 'pickup' && this.bomb.state === 'dropped' && this.bomb.pos && dist(u.pos, this.bomb.pos) < 14) {
        this.bomb.state = 'carried';
        this.bomb.carrier = u.idx;
        this.bomb.pos = null;
        u.task = 'move';
        const end = { ...this.map.bomb[this.target] };
        u.path = this.pathTo(u.pos, end);
        u.hold = end;
      }
      if (u.task === 'plant') {
        if (this.bomb.state !== 'carried' || this.bomb.carrier !== u.idx) { u.task = 'hold'; continue; }
        u.action -= dt;
        if (u.action <= 0) this.finishPlant(u);
      }
      if (u.task === 'defuse') {
        if (!this.planted) { u.task = 'hold'; continue; }
        if (this.winSide === 'T' && !this.canDefuse(u)) { u.task = 'retake'; continue; }
        u.action -= dt;
        if (u.action <= 0) {
          this.bomb.state = 'defused';
          this.emit({ type: 'defuse' });
          return this.endRound(this.teamOf('CT'), 'defuse');
        }
      }
    }
  }

  private finishPlant(u: Unit) {
    const site = this.siteAt(u.pos);
    this.bomb = { state: 'planted', pos: { ...u.pos }, carrier: -1, site, timer: BOMB_TIME };
    u.task = 'hold';
    u.hold = { ...u.pos };
    this.emit({ type: 'plant', site });
    const ctSpawn = rectCenter(this.map.ctSpawn);
    for (const t of this.alive('T')) {
      if (t !== u) {
        const hold = scatter(this.map, this.bomb.pos!, 90, this.rng);
        t.path = this.pathTo(t.pos, hold);
        t.hold = hold;
        t.task = 'hold';
      }
      t.watch = this.watchFrom(t.hold ?? t.pos, ctSpawn);
    }
    for (const c of this.alive('CT')) c.replan = 0;
  }

  /* ---------- combat ---------- */
  private combat(dt: number) {
    const g = gridOf(this.map);
    for (const u of this.units) {
      if (!u.alive) continue;
      u.flash = Math.max(0, u.flash - dt);
      const busy = u.task === 'plant' || u.task === 'defuse';

      // la cible est-elle toujours visible ?
      if (u.target >= 0) {
        const t = this.units[u.target];
        if (!t.alive) u.target = -1;
        else if (dist(u.pos, t.pos) < WEAPON[u.weapon].range && g.los(u.pos, t.pos)) u.lostSight = 0;
        else {
          u.lostSight += dt;
          if (u.lostSight > 0.7) u.target = -1;
        }
      }
      // repérage : ennemi dans le champ de vision (ou tout près) avec une ligne de vue
      if (u.target < 0) {
        let best: Unit | null = null;
        let bd = Infinity;
        for (const e of this.units) {
          if (!e.alive || e.team === u.team) continue;
          const d = dist(u.pos, e.pos);
          if (d >= WEAPON[u.weapon].range || d >= bd) continue;
          if (d > HEAR && angleDiff(u.angle, Math.atan2(e.pos.y - u.pos.y, e.pos.x - u.pos.x)) > FOV) continue;
          if (!g.los(u.pos, e.pos)) continue;
          best = e;
          bd = d;
        }
        if (best) {
          const s = u.player.stats;
          u.target = best.idx;
          u.lostSight = 0;
          u.react = Math.max(0.08, 0.16 + ((100 - s.aim) / 100) * 0.35 - (s.pos / 100) * 0.08 + this.rng() * 0.18);
          u.cooldown = 0;
          // utilitaire : une flash jetée sur l'adversaire de temps en temps
          if (bd > 120 && this.rng() < (s.utl / 100) * 0.12) best.flash = Math.max(best.flash, 1.1 + this.rng() * 1.2);
        }
      }
      if (u.target < 0 || busy) continue;

      const tgt = this.units[u.target];
      u.angle = turnToward(u.angle, Math.atan2(tgt.pos.y - u.pos.y, tgt.pos.x - u.pos.x), 14 * dt);
      if (u.react > 0) { u.react -= dt; continue; }
      u.cooldown -= dt;
      if (u.cooldown > 0) continue;
      u.cooldown = WEAPON[u.weapon].interval * (0.9 + this.rng() * 0.25);
      this.shoot(u, tgt);
      if (this.phase !== 'live') return;
    }
  }

  private shoot(u: Unit, tgt: Unit) {
    const w = WEAPON[u.weapon];
    const s = u.player.stats;
    const d = dist(u.pos, tgt.pos);
    u.lastShot = this.t;
    let p = (0.2 + (s.aim / 100) * 0.5) * w.acc * Math.max(0.2, 1 - d / (w.range * 1.3));
    if (u.v > 20) p *= 0.45;
    if (u.flash > 0) p *= 0.15;
    p *= u.team === this.winTeam ? 1.12 : 0.9;
    if (this.aliveIn(u.team) === 1) p *= 0.9 + (s.clu / 100) * 0.3;
    if (this.isProtected(tgt)) p *= 0.4;
    if (this.isProtected(u)) p *= 1.7;
    if (this.rush && this.sideOf(u.team) === 'CT') p *= 0.55;
    p = Math.min(0.92, Math.max(0.03, p));
    // la cible se retourne quand on lui tire dessus
    if (tgt.target < 0 && tgt.task !== 'plant' && tgt.task !== 'defuse') {
      tgt.target = u.idx;
      tgt.react = 0.12 + this.rng() * 0.15;
    }
    if (this.rng() >= p) return;
    const hs = this.rng() < 0.06 + (s.aim / 100) * 0.16;
    const dmg = hs ? w.hs : w.body[0] + Math.round(this.rng() * (w.body[1] - w.body[0]));
    tgt.hp -= dmg;
    if (this.isProtected(tgt)) tgt.hp = Math.max(1, tgt.hp);
    if (tgt.hp <= 0) this.kill(u, tgt, hs);
  }

  private kill(k: Unit, v: Unit, hs: boolean) {
    v.alive = false;
    v.hp = 0;
    v.path = [];
    v.target = -1;
    v.deaths += 1;
    k.kills += 1;
    k.money = Math.min(16000, k.money + WEAPON[k.weapon].reward);
    if (k.target === v.idx) k.target = -1;
    if (this.bomb.state === 'carried' && this.bomb.carrier === v.idx) {
      this.bomb = { ...this.bomb, state: 'dropped', pos: { ...v.pos }, carrier: -1 };
    }
    this.emit({ type: 'kill', killer: k.idx, victim: v.idx, from: { ...k.pos }, to: { ...v.pos }, hs });
    if (this.rng() < 0.1) {
      const speaker = this.rng() < 0.5 ? v : k;
      this.chat(speaker.idx, speaker === v ? ['nt', 'wp', 'gj', 'wow'][Math.floor(this.rng() * 4)] : ['ez', 'nice', ':)'][Math.floor(this.rng() * 3)]);
    }
    if (!this.alive('CT').length) return this.endRound(this.teamOf('T'), 'elim');
    if (!this.alive('T').length && !this.planted) return this.endRound(this.teamOf('CT'), 'elim');
  }

  /* ---------- déplacements ---------- */
  private move(dt: number) {
    const TURN = 9; // rad/s : coins arrondis
    const ACCEL = 170;
    const g = gridOf(this.map);
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.delay > 0) { u.delay -= dt; continue; }
      const engaged = u.target >= 0 && u.react <= 0.05 && u.task !== 'pickup';
      const busy = u.task === 'plant' || u.task === 'defuse';

      // à l'arrêt : petits pas autour du poste
      if (!u.path.length && u.hold && !busy && !engaged) {
        u.wander -= dt;
        if (u.wander <= 0) {
          u.wander = 2.5 + this.rng() * 3.5;
          u.path = [scatter(this.map, u.hold, 12, this.rng)];
          u.speed = RUN * 0.35;
        }
      }

      const moving = u.path.length > 0 && !engaged && !busy;
      u.v += Math.max(-ACCEL * 2.5 * dt, Math.min(ACCEL * dt, (moving ? u.speed : 0) - u.v));

      if (moving) {
        const to = u.path[0];
        u.heading = turnToward(u.heading, Math.atan2(to.y - u.pos.y, to.x - u.pos.x), TURN * dt);
        const step = u.v * dt;
        const d = dist(u.pos, to);
        if (u.path.length > 1 && d <= Math.max(step, 10)) u.path.shift();
        else if (u.path.length === 1 && d <= Math.max(step, 3)) {
          u.pos = { ...to };
          u.path.shift();
          if (u.task === 'move') u.task = 'hold';
        } else this.advance(u, step, g);
      } else if (u.v > 0.5) this.advance(u, u.v * dt, g);

      // regard : la cible (géré par le combat) > la marche > la direction surveillée
      if (u.target < 0) {
        const running = u.v > 18;
        u.angle = turnToward(u.angle, running ? u.heading : u.watch, (running ? 6 : 3) * dt);
      }
    }

    // les coéquipiers ne se marchent pas dessus
    for (let i = 0; i < this.units.length; i++) {
      const a = this.units[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.units.length; j++) {
        const b = this.units[j];
        if (!b.alive || b.team !== a.team) continue;
        const d = dist(a.pos, b.pos);
        if (d >= 20 || d < 0.01) continue;
        const push = ((20 - d) / 2) * Math.min(1, dt * 8);
        const nx = (a.pos.x - b.pos.x) / d;
        const ny = (a.pos.y - b.pos.y) / d;
        const pa = { x: a.pos.x + nx * push, y: a.pos.y + ny * push };
        const pb = { x: b.pos.x - nx * push, y: b.pos.y - ny * push };
        if (g.walk(pa) && a.task !== 'plant' && a.task !== 'defuse') a.pos = pa;
        if (g.walk(pb) && b.task !== 'plant' && b.task !== 'defuse') b.pos = pb;
      }
    }
  }

  /** Avance dans la direction de marche sans traverser un mur (glisse le long sinon). */
  private advance(u: Unit, step: number, g: ReturnType<typeof gridOf>) {
    const nx = u.pos.x + Math.cos(u.heading) * step;
    const ny = u.pos.y + Math.sin(u.heading) * step;
    if (g.walk({ x: nx, y: ny })) u.pos = { x: nx, y: ny };
    else if (g.walk({ x: nx, y: u.pos.y })) u.pos = { x: nx, y: u.pos.y };
    else if (g.walk({ x: u.pos.x, y: ny })) u.pos = { x: u.pos.x, y: ny };
    else if (u.path.length) u.pos = { ...u.path[0] }; // coincé : on se recolle au chemin
  }

  /* ---------- fin de manche ---------- */
  private endRound(winTeam: 0 | 1, reason: EndReason) {
    if (this.phase !== 'live') return;
    this.phase = 'ended';
    this.score[winTeam] += 1;
    const loser = (1 - winTeam) as 0 | 1;
    const bonus = Math.min(4, this.lossStreak[loser]);
    for (const u of this.units) {
      u.money = Math.min(16000, u.money + (u.team === winTeam ? 3250 : 1400 + 500 * bonus));
      u.target = -1;
    }
    this.lossStreak[loser] = Math.min(4, this.lossStreak[loser] + 1);
    this.lossStreak[winTeam] = Math.max(0, this.lossStreak[winTeam] - 1);
    this.emit({ type: 'roundEnd', round: this.round, winTeam, reason });
    const losers = this.units.filter((u) => u.team === loser);
    if (this.rng() < 0.3) this.chat(losers[Math.floor(this.rng() * losers.length)].idx, ['wp', 'gg', 'nt'][Math.floor(this.rng() * 3)]);
    if (this.score[0] >= 13 || this.score[1] >= 13) {
      this.phase = 'over';
      this.chat(losers[Math.floor(this.rng() * losers.length)].idx, 'gg wp');
      this.emit({ type: 'matchEnd' });
    }
  }

  /** À appeler après la pause de fin de manche. */
  nextRound() {
    if (this.phase !== 'ended') return;
    this.startRound();
  }
}
