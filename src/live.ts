import type { Player, Role } from './types';
import type { MapDef, Vec } from './maps';
import { findPath, randomIn, scatter, rectCenter, gridOf, levelAt } from './maps';
import { UTILITY, THROW_PRIORITY, NADE_TIME } from './utility';
import type { NadeKind, NadeSpec } from './utility';
import { pickPlan, T_LABEL, CT_LABEL } from './tactics';
import type { RoundPlan, History, Eco } from './tactics';

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
/** Coupe un trajet à `d` px avant son arrivée : [jusqu'au point de coupe, reste du trajet]. */
function splitBefore(start: Vec, pts: Vec[], d: number): [Vec[], Vec[]] {
  const segs: number[] = [];
  let p = start;
  for (const q of pts) { segs.push(dist(p, q)); p = q; }
  const total = segs.reduce((a, b) => a + b, 0);
  let left = Math.max(0, total - d);
  if (left <= 0) return [[], pts];
  p = start;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    if (segs[i] >= left) {
      const k = segs[i] ? left / segs[i] : 0;
      const cut = { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
      return [[...pts.slice(0, i), cut], pts.slice(i)];
    }
    left -= segs[i];
    p = q;
  }
  return [pts, []];
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
  pistol: { interval: 0.26, acc: 0.85, range: 360, body: [14, 24], hs: 92, reward: 300 },
  smg: { interval: 0.1, acc: 0.82, range: 430, body: [15, 24], hs: 70, reward: 600 },
  rifle: { interval: 0.13, acc: 1, range: 640, body: [23, 33], hs: 100, reward: 300 },
  awp: { interval: 1.45, acc: 1.12, range: 1100, body: [100, 100], hs: 100, reward: 100 },
};

/* ---------- le match ---------- */
type Task = 'move' | 'stage' | 'hold' | 'plant' | 'defuse' | 'pickup' | 'retake' | 'hunt' | 'lurk' | 'push';

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
  /** grenades en poche (achetées selon l'économie et le rôle) */
  inv: Record<NadeKind, number>;
  /** fin du trajet des T après le point de regroupement */
  after: Vec[];
  /** CT agressif : poste de repli et moment du repli ; T lurker */
  home: Vec | null;
  retreatAt: number;
  lurker: boolean;
}

export type EndReason = 'elim' | 'bomb' | 'defuse' | 'time';
export type LiveEvent =
  | { type: 'roundStart'; round: number; half?: boolean; plan: { t: string; ct: string } }
  | { type: 'kill'; killer: number; victim: number; from: Vec; to: Vec; hs: boolean; tool?: 'molotov' }
  | { type: 'nade'; kind: NadeKind; name: string; at: Vec; team: 0 | 1 }
  | { type: 'plant'; site: 'A' | 'B' }
  | { type: 'defuse' }
  | { type: 'roundEnd'; round: number; winTeam: 0 | 1; reason: EndReason }
  | { type: 'chat'; from: number; text: string }
  | { type: 'matchEnd' };

/** Grenade : lancée de `from` vers `to`, atterrit à `land`, effet jusqu'à `until` (temps de manche). */
export interface Projectile {
  kind: NadeKind;
  name: string;
  from: Vec;
  to: Vec;
  thrown: number;
  land: number;
  until: number;
  team: 0 | 1;
  thrower: number;
  landed: boolean;
}
export const SMOKE_RADIUS = 40;
export const FIRE_RADIUS = 30;
const SMOKE_BLOOM = 0.9;
const FIRE_DPS = 40;

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
  nades: Projectile[] = [];

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
  /** début de l'exécution T (-1 = pas encore) et lancers programmés */
  private execAt = -1;
  private pending: { u: number; spec: NadeSpec; at: number }[] = [];
  private delaysUsed = new Set<number>();
  private retakeDone = false;
  private postMolly = false;
  /** plan de la manche (stratégie T, placement CT) et historique pour varier */
  plan!: RoundPlan;
  private history: History = { t: [], ct: [], tLost: false };
  private fakeAt = -1;
  private pendingRotate: { site: 'A' | 'B'; at: number } | null = null;
  private lurkGone = false;
  /** temps réel de manche (le chrono affiché peut attendre la pose) */
  private liveTime = 0;

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
        lastShot: -99, replan: 0, inv: { smoke: 0, flash: 0, molotov: 0 }, after: [], home: null, retreatAt: -1, lurker: false,
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

  /** Rayon actuel d'un fumigène (0 en vol, grossit à l'atterrissage, se dissipe à la fin). */
  smokeRadius(n: Projectile, t = this.t): number {
    if (n.kind !== 'smoke' || t < n.land || t > n.until) return 0;
    const grow = Math.min(1, (t - n.land) / SMOKE_BLOOM);
    const fade = Math.min(1, (n.until - t) / 2);
    return SMOKE_RADIUS * (0.35 + 0.65 * grow) * (0.6 + 0.4 * fade);
  }
  /** Molotov en train de brûler ? */
  burning(n: Projectile, t = this.t): boolean {
    return n.kind === 'molotov' && n.landed && t < n.until;
  }
  private inFire(p: Vec): boolean {
    return this.nades.some((n) => this.burning(n) && dist(n.to, p) < FIRE_RADIUS + 4);
  }

  /** Vue dégagée : pas de mur, pas de caisse, pas de fumigène entre a et b. */
  sees(a: Vec, b: Vec): boolean {
    if (!gridOf(this.map).los(a, b)) return false;
    if (dist(a, b) < 45) return true; // à bout portant, la fumée ne cache rien
    for (const n of this.nades) {
      const r = this.smokeRadius(n) * 0.9;
      if (r <= 0) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      const k = Math.max(0, Math.min(1, ((n.to.x - a.x) * dx + (n.to.y - a.y) * dy) / l2));
      if (Math.hypot(a.x + dx * k - n.to.x, a.y + dy * k - n.to.y) < r) return false;
    }
    return true;
  }

  /* ---------- module de stuff ---------- */
  /** Répartit une séquence du module entre les joueurs d'un camp, selon leur rôle et ce qu'ils ont en poche. */
  private planNades(side: Side, specs: NadeSpec[], t0: number, only: (u: Unit) => boolean = () => true) {
    const perPlayer = new Map<number, number>();
    for (const spec of specs) {
      const pri = THROW_PRIORITY[spec.kind];
      const left = (u: Unit) => u.inv[spec.kind] - this.pending.filter((p) => p.u === u.idx && p.spec.kind === spec.kind).length;
      const cand = this.alive(side)
        .filter((u) => only(u) && left(u) > 0 && (perPlayer.get(u.idx) ?? 0) < 2 && u.task !== 'plant' && u.task !== 'defuse')
        .sort((a, b) => pri.indexOf(a.player.role) - pri.indexOf(b.player.role) || dist(a.pos, spec.at) - dist(b.pos, spec.at))[0];
      if (!cand) continue;
      perPlayer.set(cand.idx, (perPlayer.get(cand.idx) ?? 0) + 1);
      this.pending.push({ u: cand.idx, spec, at: t0 + spec.delay });
    }
  }

  private throwNade(u: Unit, spec: NadeSpec) {
    if (!u.alive || u.inv[spec.kind] <= 0) return;
    u.inv[spec.kind] -= 1;
    const g = gridOf(this.map);
    const [c, r] = g.snap(spec.at);
    const to = g.walk(spec.at) ? { ...spec.at } : g.center(c, r);
    const flight = (spec.kind === 'flash' ? 0.8 : 1.1) * Math.min(1.5, Math.max(0.6, dist(u.pos, to) / 320));
    const land = this.t + flight;
    const life = spec.kind === 'smoke' ? NADE_TIME.smoke
      : spec.kind === 'flash' ? NADE_TIME.flashBurst
      : this.sideOf(u.team) === 'T' ? NADE_TIME.molotovT : NADE_TIME.molotovCT;
    this.nades.push({ kind: spec.kind, name: spec.name, from: { ...u.pos }, to, thrown: this.t, land, until: land + life, team: u.team, thrower: u.idx, landed: false });
    if (u.target < 0) u.angle = Math.atan2(to.y - u.pos.y, to.x - u.pos.x);
  }

  /** Lancers programmés, atterrissages (flash, extinction du feu par la fumée) et dégâts du feu. */
  private updateNades(dt: number) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (this.t < p.at) continue;
      this.pending.splice(i, 1);
      const u = this.units[p.u];
      if (u.alive && u.task !== 'plant' && u.task !== 'defuse') this.throwNade(u, p.spec);
    }
    for (const n of this.nades) {
      if (n.landed || this.t < n.land) continue;
      n.landed = true;
      this.emit({ type: 'nade', kind: n.kind, name: n.name, at: { ...n.to }, team: n.team });
      if (n.kind === 'flash') this.detonateFlash(n);
      if (n.kind === 'smoke') {
        for (const f of this.nades) if (this.burning(f) && dist(f.to, n.to) < SMOKE_RADIUS + FIRE_RADIUS * 0.5) f.until = this.t;
      }
      if (n.kind === 'molotov' && this.nades.some((x) => this.smokeRadius(x) > 0 && dist(x.to, n.to) < SMOKE_RADIUS)) n.until = this.t;
    }
    for (const f of this.nades) {
      if (!this.burning(f)) continue;
      for (const u of this.units) {
        if (!u.alive || dist(u.pos, f.to) > FIRE_RADIUS) continue;
        if (u.team !== f.team) {
          u.hp -= FIRE_DPS * dt;
          if (this.isProtected(u)) u.hp = Math.max(1, u.hp);
          if (u.hp <= 0) {
            this.kill(this.units[f.thrower], u, false, 'molotov');
            if (this.phase !== 'live') return;
            continue;
          }
        }
        this.fleeFire(u, f.to);
      }
    }
  }

  /** Aveugle les adversaires qui voient la flash, surtout s'ils la regardent. */
  private detonateFlash(n: Projectile) {
    for (const u of this.units) {
      if (!u.alive || u.team === n.team) continue;
      const d = dist(u.pos, n.to);
      if (d > 320 || !this.sees(u.pos, n.to)) continue;
      const a = angleDiff(u.angle, Math.atan2(n.to.y - u.pos.y, n.to.x - u.pos.x));
      const facing = a < 1.0 ? 1 : a < 1.9 ? 0.5 : 0.12;
      u.flash = Math.max(u.flash, 2.8 * facing * (1 - d / 380));
    }
  }

  /** Personne ne reste dans le feu : on sort par le côté le plus proche (le poseur de bombe continue). */
  private fleeFire(u: Unit, c: Vec) {
    if (u.task === 'plant') return;
    if (u.path.length && dist(u.path[0], c) > FIRE_RADIUS + 6) return;
    if (u.task === 'defuse') u.task = 'retake';
    const d = Math.max(1, dist(u.pos, c));
    const out = { x: c.x + ((u.pos.x - c.x) / d) * (FIRE_RADIUS + 20), y: c.y + ((u.pos.y - c.y) / d) * (FIRE_RADIUS + 20) };
    const dest = gridOf(this.map).walk(out) ? out : scatter(this.map, out, 30, this.rng);
    u.path = this.pathTo(u.pos, dest);
    u.speed = this.runSpeed();
    if (u.hold && dist(u.hold, c) < FIRE_RADIUS + 6) u.hold = dest;
    u.delay = 0;
  }

  /**
   * Exécution T sur le site visé. `hot` = déclenchée au contact (pas d'attente des flashs, stuff resserré).
   * Chaque grenade a une petite chance d'être sautée : deux exécutions ne sont jamais identiques.
   */
  private startExecute(hot = false) {
    if (this.execAt >= 0) return;
    this.execAt = this.t;
    const site = this.target;
    const all = UTILITY[this.map.id].execute[site];
    let specs = all.filter((_n, i) => i === 0 || this.rng() > 0.18);
    if (this.plan.t === 'rush') specs = all.filter((n) => n.kind !== 'smoke' || this.rng() < 0.4);
    if (hot) specs = specs.map((n) => ({ ...n, delay: n.delay * 0.45 }));
    this.planNades('T', specs, this.t, (u) => !u.lurker);
    const ctSpawn = rectCenter(this.map.ctSpawn);
    const wait = hot || this.plan.t === 'rush' ? 0 : 2.4;
    for (const u of this.alive('T')) {
      if (u.lurker && this.plan.t === 'lurk') continue;
      if (u.task === 'pickup' || u.task === 'plant') continue;
      if (u.task === 'stage' || u.lurker) {
        u.path = u.after.length ? u.after : this.pathTo(u.pos, randomIn(this.map, this.map.sites[site], this.rng, 6));
        u.after = [];
        u.lurker = false;
      }
      u.hold = u.path[u.path.length - 1] ?? u.hold ?? u.pos;
      u.task = 'move';
      u.speed = this.runSpeed();
      u.delay = wait ? Math.max(u.delay, wait + (u.player.role === 'RIF' ? -0.3 : this.rng() * 0.7)) : this.rng() * 0.3;
      u.watch = this.watchFrom(u.hold!, ctSpawn);
    }
    // les CT entendent l'exécution un peu plus tard
    this.pendingRotate = { site, at: this.t + 0.8 + this.rng() * 1.2 };
  }

  /** Rotation CT vers un site (`force` : même si on a déjà tourné, ex. après un fake). */
  private rotateTo(s: 'A' | 'B', force = false) {
    if (this.rotated && !force) return;
    this.rotated = true;
    this.target = s;
    for (const u of this.alive('CT')) {
      if (u.site === s && u.task !== 'push') continue;
      // tout le monde ne tourne pas : un CT garde parfois son site
      if (u.site !== 'M' && u.task !== 'push' && this.rng() < 0.2) continue;
      const hold = randomIn(this.map, this.map.sites[s], this.rng, 6);
      u.path = this.pathTo(u.pos, hold);
      u.hold = hold;
      u.home = hold;
      u.site = s;
      u.task = 'hold';
      u.retreatAt = -1;
      u.speed = this.runSpeed();
      u.watch = this.watchFrom(hold, rectCenter(this.map.tSpawn));
    }
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
    this.nades = [];
    this.pending = [];
    this.execAt = -1;
    this.delaysUsed.clear();
    this.retakeDone = false;
    this.postMolly = false;
    this.fakeAt = -1;
    this.pendingRotate = null;
    this.lurkGone = false;
    this.liveTime = 0;

    for (const u of this.units) {
      const side = this.sideOf(u.team);
      Object.assign(u, {
        alive: true, hp: 100, path: [], hold: null, site: null, task: 'move', action: 0, target: -1, react: 0,
        cooldown: 0, lostSight: 0, lastShot: -99, flash: 0, v: 0, replan: 0, after: [], home: null, retreatAt: -1, lurker: false,
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
      // grenades : achat complet = fumigène + flash(s) + molotov ; supports et IGL prennent une flash de plus
      const role = u.player.role;
      const sup = role === 'SUP' || role === 'IGL';
      if (pistol) u.inv = { smoke: sup ? 1 : 0, flash: role === 'SUP' ? 1 : 0, molotov: 0 };
      else if (u.weapon === 'rifle' || u.weapon === 'awp') u.inv = { smoke: 1, flash: sup ? 2 : 1, molotov: 1 };
      else if (u.weapon === 'smg') u.inv = { smoke: 1, flash: 1, molotov: 0 };
      else u.inv = { smoke: 0, flash: role === 'SUP' ? 1 : 0, molotov: 0 };
    }
    // plan de manche selon l'économie des deux camps
    const ecoOf = (side: Side): Eco => {
      if (pistol) return 'pistol';
      const us = this.units.filter((u) => this.sideOf(u.team) === side);
      const full = us.filter((u) => u.weapon === 'rifle' || u.weapon === 'awp').length;
      const half = us.filter((u) => u.weapon === 'smg').length;
      return full >= 4 ? 'full' : full + half >= 3 ? 'half' : 'eco';
    };
    this.plan = pickPlan(ecoOf('T'), ecoOf('CT'), this.history, this.rng);
    this.target = this.plan.site;
    this.assignPlan();
    const ts = this.units.filter((u) => this.sideOf(u.team) === 'T');
    const carrier = ts[Math.floor(this.rng() * ts.length)];
    this.bomb = { state: 'carried', pos: null, carrier: carrier.idx, site: null, timer: 0 };
    // débuts de manche classiques de la carte (ex. fumigène Xbox)
    for (const e of UTILITY[this.map.id].early) {
      if (this.rng() < e.p) this.planNades(e.side, [e], 0);
    }
    const siteTxt = this.plan.t === 'default' || this.plan.t === 'contact' ? '' : ` ${this.plan.site}`;
    this.emit({ type: 'roundStart', round: this.round, half, plan: { t: T_LABEL[this.plan.t] + siteTxt, ct: CT_LABEL[this.plan.ct] } });
    if (this.round === 1) this.chat(5 + Math.floor(this.rng() * 5), 'glhf');
  }

  /** Point situé à `d` px le long du chemin de `a` vers `b`. */
  private alongPath(a: Vec, b: Vec, d: number): Vec {
    let p = a;
    let left = d;
    for (const q of this.pathTo(a, b)) {
      const l = dist(p, q);
      if (l >= left) return { x: p.x + ((q.x - p.x) / l) * left, y: p.y + ((q.y - p.y) / l) * left };
      left -= l;
      p = q;
    }
    return p;
  }

  /** Trajet d'un T : itinéraire k du site, jusqu'à `end`. */
  private routePath(from: Vec, site: 'A' | 'B', k: number, end: Vec): Vec[] {
    const pts: Vec[] = [];
    let p = from;
    for (const wp of [...this.map.routes[site][k], end]) {
      pts.push(...this.pathTo(p, wp));
      p = wp;
    }
    return pts;
  }

  /** Place les deux équipes selon le plan de la manche. */
  private assignPlan() {
    const plan = this.plan;
    const site = plan.site;
    const other = site === 'A' ? 'B' : 'A';
    const ts = shuffle(this.units.filter((u) => this.sideOf(u.team) === 'T'), this.rng);
    const cts = shuffle(this.units.filter((u) => this.sideOf(u.team) === 'CT'), this.rng);
    const tSpawn = rectCenter(this.map.tSpawn);
    const ctSpawn = rectCenter(this.map.ctSpawn);
    const primary = this.rng() < 0.5 ? 0 : 1;

    /* ----- T ----- */
    // lurker (fake / lurk) : de préférence le joueur LRK
    ts.sort((x, y) => (x.player.role === 'LRK' ? 1 : 0) - (y.player.role === 'LRK' ? 1 : 0));
    const controlPts = shuffle([
      ...this.map.routes.A.map((r) => r[Math.floor(r.length / 2)]),
      ...this.map.routes.B.map((r) => r[Math.floor(r.length / 2)]),
      ...this.map.routes[site].map((r) => r[Math.max(0, r.length - 2)]),
    ], this.rng);

    ts.forEach((u, i) => {
      const k = i < plan.groups[0] ? primary : 1 - primary;
      const end = randomIn(this.map, this.map.sites[site], this.rng, 6);
      u.site = site;
      u.lurker = false;
      u.watch = this.watchFrom(end, ctSpawn);

      if (plan.t === 'rush' || plan.t === 'contact') {
        u.path = this.routePath(u.pos, site, k, end);
        u.hold = end;
        u.task = 'move';
        u.delay = this.rng() * (plan.t === 'rush' ? 0.6 : 2);
        u.speed = plan.t === 'rush' ? this.runSpeed() * 1.12 : RUN * 0.55; // contact : on avance en marchant
      } else if (plan.t === 'default') {
        const cp = controlPts[i % controlPts.length];
        u.path = this.pathTo(u.pos, cp);
        u.after = [];
        u.hold = cp;
        u.task = 'stage';
        u.watch = this.watchFrom(cp, ctSpawn);
      } else {
        const lurk = (plan.t === 'lurk' && i === ts.length - 1) || (plan.t === 'fake' && i >= ts.length - 2);
        const s2 = lurk ? other : site;
        const end2 = lurk ? randomIn(this.map, this.map.sites[other], this.rng, 6) : end;
        const pts = this.routePath(u.pos, s2, lurk ? Math.floor(this.rng() * 2) : k, end2);
        const [toStage, rest] = splitBefore(u.pos, pts, plan.stage + (lurk ? 60 : 0));
        const stage = toStage[toStage.length - 1] ?? u.pos;
        u.path = toStage;
        u.after = lurk ? [] : rest.length ? rest : [end];
        u.hold = stage;
        u.task = lurk && plan.t === 'lurk' ? 'lurk' : 'stage';
        u.lurker = lurk;
        u.site = s2;
        u.watch = Math.atan2(end2.y - stage.y, end2.x - stage.x);
      }
      const first = u.path[0] ?? end;
      u.angle = u.heading = Math.atan2(first.y - u.pos.y, first.x - u.pos.x);
    });

    /* ----- CT ----- */
    const layout: Record<string, ('A' | 'B' | 'M')[]> = {
      standard: ['A', 'A', 'B', 'B', 'M'],
      stackA: ['A', 'A', 'A', 'M', 'B'],
      stackB: ['B', 'B', 'B', 'M', 'A'],
      aggro: ['A', 'A', 'B', 'B', 'M'],
      deep: ['A', 'A', 'B', 'B', 'M'],
    };
    const spots = layout[plan.ct];
    // l'agressif : un RIF ou l'AWP
    const aggroIdx = plan.ct === 'aggro' ? Math.max(0, cts.findIndex((u) => u.player.role === 'RIF' || u.player.role === 'AWP')) : -1;
    cts.forEach((u, i) => {
      const s = spots[i];
      u.site = s;
      let hold: Vec;
      if (s === 'M') hold = scatter(this.map, this.map.mid, 26, this.rng);
      else {
        const c = rectCenter(this.map.sites[s]);
        const r = this.rng();
        // poste sur le site, avancé (vers l'entrée T) ou reculé (vers le spawn CT)
        if (plan.ct === 'deep' || r < 0.2) hold = scatter(this.map, this.alongPath(c, ctSpawn, 70 + this.rng() * 50), 14, this.rng);
        else if (r < 0.45) hold = scatter(this.map, this.alongPath(c, tSpawn, 60 + this.rng() * 60), 14, this.rng);
        else hold = randomIn(this.map, this.map.sites[s], this.rng, 6);
      }
      u.home = hold;
      u.retreatAt = -1;
      u.task = 'hold';
      if (i === aggroIdx) {
        // push pour l'info : sur un itinéraire T, puis repli
        const routes = [...this.map.routes.A, ...this.map.routes.B];
        const r = routes[Math.floor(this.rng() * routes.length)];
        const spot = scatter(this.map, r[Math.min(r.length - 1, 1 + Math.floor(this.rng() * 2))], 16, this.rng);
        u.path = this.pathTo(u.pos, spot);
        u.hold = spot;
        u.task = 'push';
        u.retreatAt = 14 + this.rng() * 10;
        u.watch = this.watchFrom(spot, tSpawn);
      } else {
        u.path = this.pathTo(u.pos, hold);
        u.hold = hold;
        u.watch = this.watchFrom(hold, tSpawn);
      }
      const first = u.path[0] ?? hold;
      u.angle = u.heading = Math.atan2(first.y - u.pos.y, first.x - u.pos.x);
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
    this.liveTime += dt;
    // filet de sécurité : une manche ne s'éternise jamais
    if (this.liveTime > 200) {
      const lose = this.winTeam === 0 ? 1 : 0;
      for (const u of this.units) if (u.team === lose && u.alive) { u.alive = false; u.hp = 0; }
      return this.endRound(this.winTeam, this.planted ? (this.winSide === 'T' ? 'bomb' : 'defuse') : this.winSide === 'CT' ? 'time' : 'elim');
    }

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
    this.updateNades(dt);
    if (this.phase !== 'live') return;
    this.combat(dt);
    if (this.phase !== 'live') return;
    this.actions(dt);
    if (this.phase !== 'live') return;
    this.move(dt);
  }

  /* ---------- décisions (4 fois par seconde) ---------- */
  private think() {
    const util = UTILITY[this.map.id];

    // ----- T : déroulé de la stratégie -----
    if (this.execAt < 0 && !this.planted) {
      const ts = this.alive('T');
      const core = ts.filter((u) => !u.lurker);
      const staged = core.filter((u) => u.task === 'stage' && !u.path.length).length;
      const spotted = core.some((u) => u.target >= 0 && u.lostSight === 0);
      const siteC = rectCenter(this.map.sites[this.target]);
      const plan = this.plan.t;
      if (plan === 'rush') {
        if (ts.some((u) => dist(u.pos, siteC) < 320)) this.startExecute(true);
      } else if (plan === 'contact') {
        if (spotted) this.startExecute(true);
        else if (this.t > this.plan.timing) this.startExecute(false);
      } else if (plan === 'default') {
        if (this.t > this.plan.timing) this.startExecute(false);
      } else if (plan === 'fake') {
        const fakers = ts.filter((u) => u.lurker);
        if (this.fakeAt < 0 && (fakers.length && fakers.every((u) => !u.path.length) || this.t > this.plan.timing * 0.8)) {
          // le fake : un peu de stuff sur l'autre site pour faire tourner les CT
          this.fakeAt = this.t;
          const fakeSite = this.target === 'A' ? 'B' : 'A';
          const fake = UTILITY[this.map.id].execute[fakeSite].filter((n, i) => i === 0 || (n.kind === 'flash' && this.rng() < 0.6) || (n.kind === 'molotov' && this.rng() < 0.4));
          this.planNades('T', fake, this.t, (u) => u.lurker);
          this.pendingRotate = { site: fakeSite, at: this.t + 1.5 };
        }
        if (this.fakeAt >= 0 && this.t > this.fakeAt + 7 + this.rng() * 0.5) this.startExecute(false);
        else if (spotted && this.fakeAt >= 0) this.startExecute(true);
      } else if (spotted || staged >= Math.max(1, core.length - 1) || this.t > this.plan.timing) {
        this.startExecute(spotted);
      }
    }
    // lurker : quand l'exécution est lancée, il coupe la route de rotation des CT
    if (this.plan.t === 'lurk' && this.execAt >= 0 && !this.lurkGone && this.t > this.execAt + 4) {
      this.lurkGone = true;
      const l = this.alive('T').find((u) => u.lurker);
      if (l) {
        const other = this.target === 'A' ? 'B' : 'A';
        const flank = scatter(this.map, this.alongPath(rectCenter(this.map.sites[other]), rectCenter(this.map.sites[this.target]), 180), 20, this.rng);
        l.path = this.pathTo(l.pos, flank);
        l.hold = flank;
        l.task = 'move';
        l.speed = RUN * 0.6;
        l.watch = this.watchFrom(flank, rectCenter(this.map.sites[this.target]));
      }
    }
    // rotation CT programmée (après avoir « entendu » une exécution ou un fake)
    if (this.pendingRotate && this.t >= this.pendingRotate.at && !this.planted) {
      this.rotateTo(this.pendingRotate.site, true);
      this.pendingRotate = null;
    }
    // CT agressif : repli vers son poste
    for (const u of this.alive('CT')) {
      if (u.retreatAt > 0 && this.t >= u.retreatAt && u.target < 0 && u.home) {
        u.retreatAt = -1;
        u.task = 'hold';
        u.path = this.pathTo(u.pos, u.home);
        u.hold = u.home;
        u.speed = this.runSpeed();
        u.watch = this.watchFrom(u.home, rectCenter(this.map.tSpawn));
      }
    }

    // retardement CT : un T se montre à un passage clé → incendiaire / flash / fumigène prévus pour ce passage
    if (!this.planted) {
      util.ctDelay.forEach((d, i) => {
        if (this.delaysUsed.has(i)) return;
        if (!this.alive('T').some((u) => dist(u.pos, d.zone) < d.r)) return;
        this.delaysUsed.add(i);
        this.planNades('CT', d.nades, this.t + 0.3);
      });
    }

    // reprise CT : dès que les CT arrivent près de la bombe, flash au-dessus du site et fumigène sur la garde T
    if (this.planted && !this.retakeDone && this.bomb.site && this.bomb.pos) {
      const bp = this.bomb.pos;
      const cts = this.alive('CT');
      if (cts.length && cts.filter((u) => dist(u.pos, bp) < 380).length >= Math.min(2, cts.length)) {
        this.retakeDone = true;
        this.planNades('CT', util.retake[this.bomb.site], this.t);
      }
    }

    // sécurité : deux T sur un site sans exécution → les CT tournent quand même
    if (!this.rotated && !this.planted) {
      for (const s of ['A', 'B'] as const) {
        const c = rectCenter(this.map.sites[s]);
        if (this.alive('T').filter((u) => dist(u.pos, c) < 300).length >= 2) { this.rotateTo(s); break; }
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
        if (dist(u.pos, bp) < 16 && u.target < 0 && !this.inFire(bp) && this.canDefuse(u)) {
          u.task = 'defuse';
          u.action = DEFUSE_TIME;
          u.path = [];
          // classique : un T molotov la bombe dès qu'il entend le désamorçage
          if (!this.postMolly) {
            const thrower = this.alive('T').filter((t) => t.inv.molotov > 0 && dist(t.pos, bp) < 520)
              .sort((x, y) => dist(x.pos, bp) - dist(y.pos, bp))[0];
            if (thrower) {
              this.postMolly = true;
              this.planNades('T', [{ kind: 'molotov', name: 'Molotov sur la bombe', at: bp, delay: 0.2 }], this.t);
            }
          }
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
    return !ts.some((t) => dist(t.pos, u.pos) < 700 && this.sees(t.pos, u.pos));
  }

  /** Fin de manche sans pose alors que les T doivent gagner : tout le monde fonce sur le site. */
  private startRush() {
    this.rush = true;
    this.startExecute(true);
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
    for (const u of this.units) {
      if (!u.alive) continue;
      u.flash = Math.max(0, u.flash - dt);
      const busy = u.task === 'plant' || u.task === 'defuse';

      // la cible est-elle toujours visible ?
      if (u.target >= 0) {
        const t = this.units[u.target];
        if (!t.alive) u.target = -1;
        else if (dist(u.pos, t.pos) < WEAPON[u.weapon].range && this.sees(u.pos, t.pos)) u.lostSight = 0;
        else {
          u.lostSight += dt;
          if (u.lostSight > 0.7) u.target = -1;
        }
      }
      // repérage : ennemi dans le champ de vision (ou tout près) avec une ligne de vue
      if (u.target < 0 && u.flash < 0.6) {
        let best: Unit | null = null;
        let bd = Infinity;
        for (const e of this.units) {
          if (!e.alive || e.team === u.team) continue;
          const d = dist(u.pos, e.pos);
          if (d >= WEAPON[u.weapon].range || d >= bd) continue;
          if (d > HEAR && angleDiff(u.angle, Math.atan2(e.pos.y - u.pos.y, e.pos.x - u.pos.x)) > FOV) continue;
          if (!this.sees(u.pos, e.pos)) continue;
          best = e;
          bd = d;
        }
        if (best) {
          const s = u.player.stats;
          u.target = best.idx;
          u.lostSight = 0;
          u.react = Math.max(0.08, 0.16 + ((100 - s.aim) / 100) * 0.35 - (s.pos / 100) * 0.08 + this.rng() * 0.18);
          u.cooldown = 0;
        }
      }
      if (u.target < 0 || busy) continue;

      const tgt = this.units[u.target];
      u.angle = turnToward(u.angle, Math.atan2(tgt.pos.y - u.pos.y, tgt.pos.x - u.pos.x), 14 * dt);
      if (u.react > 0) { u.react -= dt; continue; }
      if (u.lostSight > 0) continue; // plus de ligne de vue : on ne tire pas à travers un mur
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
    // avantage de hauteur : tirer depuis l'étage sur le sol (ou d'en bas vers le haut)
    const dh = levelAt(this.map, u.pos) - levelAt(this.map, tgt.pos);
    if (dh > 0) p *= 1.12;
    else if (dh < 0) p *= 0.9;
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

  private kill(k: Unit, v: Unit, hs: boolean, tool?: 'molotov') {
    v.alive = false;
    v.hp = 0;
    v.path = [];
    v.target = -1;
    v.deaths += 1;
    k.kills += 1;
    k.money = Math.min(16000, k.money + (tool ? 300 : WEAPON[k.weapon].reward));
    if (k.target === v.idx) k.target = -1;
    if (this.bomb.state === 'carried' && this.bomb.carrier === v.idx) {
      this.bomb = { ...this.bomb, state: 'dropped', pos: { ...v.pos }, carrier: -1 };
    }
    this.emit({ type: 'kill', killer: k.idx, victim: v.idx, from: { ...k.pos }, to: { ...v.pos }, hs, tool });
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
      const engaged = u.target >= 0 && u.lostSight === 0 && u.react <= 0.05 && u.task !== 'pickup';
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
    this.history.t.push(this.plan.t);
    this.history.ct.push(this.plan.ct);
    this.history.tLost = winTeam !== this.teamOf('T');
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
