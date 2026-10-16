import { LiveMatch, MAP, ROOMS, CRATES, EDGES, NODES } from './live';
import type { Unit, Side, LiveEvent, Vec } from './live';
import type { Player } from './types';

/**
 * Écran du match en direct : scoreboard en haut, ton équipe à gauche, l'adversaire à droite,
 * la carte 2D (canvas) au centre avec les joueurs qui bougent, et les commandes en bas.
 */

export interface LiveUIOptions {
  dialog: HTMLDialogElement;
  match: LiveMatch;
  myName: string;
  oppName: string;
  rating: number;
  winPct: number;
  cardHTML: (p: Player) => string;
  onFinish: () => void;
}

const SPEEDS = [1, 2, 4, 8, 16];
const SIDE_COLOR: Record<Side, string> = { CT: '#5aa2ff', T: '#f0b13a' };
const SIDE_LABEL: Record<Side, string> = { CT: 'COUNTER-TERRORISTS', T: 'TERRORISTS' };
const REASON: Record<string, string> = { elim: 'équipe adverse éliminée', bomb: 'bombe explosée', defuse: 'bombe désamorcée' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmtClock = (s: number) => `${Math.floor(Math.ceil(s) / 60)}:${String(Math.ceil(s) % 60).padStart(2, '0')}`;

/* ---------- la carte, dessinée une seule fois ---------- */
function buildMapLayer(scale: number): HTMLCanvasElement {
  const W = MAP.w * scale;
  const H = MAP.h * scale;
  const floor = document.createElement('canvas');
  floor.width = W;
  floor.height = H;
  const f = floor.getContext('2d')!;
  f.scale(scale, scale);
  f.lineCap = 'round';
  f.lineJoin = 'round';

  // murs puis sols des couloirs
  f.strokeStyle = '#1d1810';
  f.lineWidth = 76;
  for (const [a, b] of EDGES) { f.beginPath(); f.moveTo(NODES[a].x, NODES[a].y); f.lineTo(NODES[b].x, NODES[b].y); f.stroke(); }
  for (const r of ROOMS) { f.fillStyle = '#1d1810'; f.beginPath(); f.roundRect(r.x - 9, r.y - 9, r.w + 18, r.h + 18, 14); f.fill(); }
  f.strokeStyle = '#5f523a';
  f.lineWidth = 58;
  for (const [a, b] of EDGES) { f.beginPath(); f.moveTo(NODES[a].x, NODES[a].y); f.lineTo(NODES[b].x, NODES[b].y); f.stroke(); }
  const tint: Record<string, string> = { A: '#6d5a3c', B: '#6d5a3c', T: '#5d5038', CT: '#56503f', M: '#635640' };
  for (const r of ROOMS) { f.fillStyle = tint[r.k]; f.beginPath(); f.roundRect(r.x, r.y, r.w, r.h, 8); f.fill(); }
  const wash: Record<string, string> = { T: 'rgba(240,177,58,0.13)', CT: 'rgba(90,162,255,0.15)' };
  for (const r of ROOMS) if (wash[r.k]) { f.fillStyle = wash[r.k]; f.beginPath(); f.roundRect(r.x, r.y, r.w, r.h, 8); f.fill(); }

  // grain du sol (graine fixe)
  f.globalCompositeOperation = 'source-atop';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    f.fillStyle = rnd() < 0.5 ? 'rgba(255,240,200,0.045)' : 'rgba(0,0,0,0.09)';
    f.fillRect(rnd() * MAP.w, rnd() * MAP.h, 2 + rnd() * 5, 1 + rnd() * 3);
  }
  f.globalCompositeOperation = 'source-over';

  // zones de bombe
  for (const k of ['A', 'B'] as const) {
    const r = ROOMS.find((x) => x.k === k)!;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    f.fillStyle = 'rgba(214,72,60,0.14)';
    f.fillRect(cx - 52, cy - 52, 104, 104);
    f.strokeStyle = 'rgba(255,110,90,0.45)';
    f.lineWidth = 2;
    f.setLineDash([7, 6]);
    f.strokeRect(cx - 52, cy - 52, 104, 104);
    f.setLineDash([]);
    f.fillStyle = 'rgba(255,120,100,0.34)';
    f.font = '800 70px "Barlow Condensed", sans-serif';
    f.textAlign = 'center';
    f.textBaseline = 'middle';
    f.fillText(k, cx, cy + 3);
  }
  // caisses
  for (const c of CRATES) {
    f.fillStyle = '#44372a';
    f.fillRect(c.x, c.y, c.s, c.s);
    f.strokeStyle = '#17110a';
    f.lineWidth = 2;
    f.strokeRect(c.x, c.y, c.s, c.s);
    f.beginPath(); f.moveTo(c.x, c.y); f.lineTo(c.x + c.s, c.y + c.s); f.moveTo(c.x + c.s, c.y); f.lineTo(c.x, c.y + c.s); f.stroke();
  }
  // étiquettes
  f.font = '700 18px "Barlow Condensed", sans-serif';
  f.fillStyle = 'rgba(240,177,58,0.55)';
  f.fillText('T SPAWN', 145, 560);
  f.fillStyle = 'rgba(90,162,255,0.6)';
  f.fillText('CT SPAWN', 865, 72);
  f.fillStyle = 'rgba(255,255,255,0.28)';
  f.fillText('MID', 520, 345);

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const o = out.getContext('2d')!;
  o.fillStyle = '#000';
  o.fillRect(0, 0, W, H);
  o.drawImage(floor, 0, 0);
  return out;
}

interface Shot { from: Vec; to: Vec; born: number }
interface Line { html: string; born: number }

export function startLive(opts: LiveUIOptions) {
  const { dialog, match: m } = opts;
  const mineUnits = m.units.slice(0, 5);
  const oppUnits = m.units.slice(5);

  const rowHTML = (u: Unit) => `
    <div class="lp-row" data-i="${u.idx}">
      <div class="lp-card">${opts.cardHTML(u.player)}</div>
      <div class="lp-info">
        <div class="lp-name"><b>${esc(u.name)}</b><span class="lp-kd">0/0</span></div>
        <div class="lp-hp"><span class="lp-hpn">+ 100</span><div class="lp-bar"><div></div></div></div>
        <div class="lp-money">$0</div>
      </div>
    </div>`;
  const panelHTML = (units: Unit[], cls: string) => `
    <aside class="lp ${cls}" data-side="CT">
      <div class="lp-head"><span class="lp-side">COUNTER-TERRORISTS</span><span class="lp-dots">${'<i></i>'.repeat(5)}</span><span class="lp-alive">5/5</span></div>
      ${units.map(rowHTML).join('')}
    </aside>`;

  dialog.innerHTML = `
  <div class="live">
    <header class="live-top">
      <div class="live-scorebar">
        <span class="ls-rating">Rating ${opts.rating} · ${opts.winPct}%</span>
        <span class="ls-team" data-me>${esc(opts.myName)}</span>
        <b class="ls-pts" data-me-pts>0</b>
        <span class="ls-clock">1:55</span>
        <b class="ls-pts" data-opp-pts>0</b>
        <span class="ls-team" data-opp>${esc(opts.oppName)}</span>
      </div>
      <span class="ls-round">ROUND 1</span>
      <button class="live-x" data-live="skip" aria-label="Quitter et voir le résultat">✕</button>
    </header>
    <div class="live-body">
      ${panelHTML(mineUnits, 'left')}
      <div class="lm">
        <canvas></canvas>
        <div class="lm-name">${esc(MAP.name)}</div>
        <div class="lm-feed"></div>
        <div class="lm-notice"></div>
        <div class="lm-banner"></div>
        <div class="lm-chat"></div>
      </div>
      ${panelHTML(oppUnits, 'right')}
    </div>
    <footer class="live-ctrl">
      <button class="lc-btn" data-live="pause" aria-label="Pause">II</button>
      <button class="lc-btn lc-speed" data-live="speed" aria-label="Vitesse">16×</button>
      <button class="lc-btn" data-live="chat" aria-label="Afficher / masquer le chat">💬</button>
      <button class="lc-btn lc-skip" data-live="skip">Passer ▸▸</button>
    </footer>
  </div>`;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => dialog.querySelector<T>(sel)!;
  const canvas = $<HTMLCanvasElement>('canvas');
  const ctx = canvas.getContext('2d')!;
  const clockEl = $('.ls-clock');
  const roundEl = $('.ls-round');
  const mePts = $('[data-me-pts]');
  const oppPts = $('[data-opp-pts]');
  const meName = $('[data-me]');
  const oppName = $('[data-opp]');
  const feedEl = $('.lm-feed');
  const noticeEl = $('.lm-notice');
  const bannerEl = $('.lm-banner');
  const chatEl = $('.lm-chat');
  const panels = [$('.lp.left'), $('.lp.right')];
  const rows = new Map<number, HTMLElement>();
  dialog.querySelectorAll<HTMLElement>('.lp-row').forEach((r) => rows.set(Number(r.dataset.i), r));

  // cartes réduites : 200×300 affichées à l'échelle
  dialog.querySelectorAll<HTMLElement>('.lp-card .card').forEach((c) => c.classList.add('card-mini'));

  let speed = SPEEDS[SPEEDS.length - 1];
  let paused = false;
  let showChat = true;
  let wait = 0;
  let finished = false;
  let raf = 0;
  let last = performance.now();
  let noticeUntil = 0;
  let bannerTimer = 0;
  const shots: Shot[] = [];
  const feed: Line[] = [];
  const chat: Line[] = [];
  let layer: HTMLCanvasElement | null = null;
  let view = { s: 1, ox: 0, oy: 0, dpr: 1 };

  const unitSide = (u: Unit): Side => m.sideOf(u.team);
  const color = (u: Unit) => SIDE_COLOR[unitSide(u)];
  const nameHTML = (u: Unit) => `<b style="color:${color(u)}">${esc(u.name)}</b>`;

  function resize() {
    const box = canvas.parentElement!.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    const s = Math.min(canvas.width / MAP.w, canvas.height / MAP.h);
    view = { s, ox: (canvas.width - MAP.w * s) / 2, oy: (canvas.height - MAP.h * s) / 2, dpr };
    layer = buildMapLayer(Math.max(1, Math.min(2.5, s)));
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement!);

  function showBanner(html: string, ms: number) {
    bannerEl.innerHTML = html;
    bannerEl.classList.add('show');
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => bannerEl.classList.remove('show'), ms);
  }
  function notice(text: string, ms = 2200) {
    noticeEl.textContent = text;
    noticeEl.classList.add('show');
    noticeUntil = performance.now() + ms;
  }

  function handle(e: LiveEvent, now: number) {
    switch (e.type) {
      case 'roundStart':
        bannerEl.classList.remove('show');
        if (e.half) notice('Mi-temps : changement de côté', 2800);
        break;
      case 'kill': {
        shots.push({ from: e.from, to: e.to, born: now });
        const k = m.units[e.killer];
        const v = m.units[e.victim];
        feed.push({ html: `${nameHTML(k)} <i>▸</i> ${nameHTML(v)}`, born: now });
        break;
      }
      case 'plant': notice(`Bombe plantée sur le site ${e.site}`); break;
      case 'defuse': notice('Bombe désamorcée'); break;
      case 'roundEnd': {
        const side = m.sideOf(e.winTeam, e.round);
        const name = e.winTeam === 0 ? opts.myName : opts.oppName;
        showBanner(
          `<div class="bn-sub">Manche ${e.round}</div><div class="bn-title" style="color:${SIDE_COLOR[side]}">${esc(name)}</div><div class="bn-sub">${REASON[e.reason]}</div>`,
          2600,
        );
        wait = 1500 + 2500 / speed;
        break;
      }
      case 'chat': {
        const u = m.units[e.from];
        chat.push({ html: `<span class="ch-all">[ALL]</span> ${nameHTML(u)}<span class="ch-txt"> : ${esc(e.text)}</span>`, born: now });
        break;
      }
      case 'matchEnd': {
        const won = m.score[0] > m.score[1];
        wait = 2600;
        showBanner(
          `<div class="bn-sub">Fin du match</div><div class="bn-title ${won ? 'win' : 'loss'}">${won ? 'Victoire' : 'Défaite'}</div><div class="bn-score">${m.score[0]} – ${m.score[1]}</div>`,
          4000,
        );
        break;
      }
    }
  }

  function updateDOM(now: number) {
    clockEl.textContent = fmtClock(m.clock);
    clockEl.classList.toggle('bomb', m.bombActive);
    roundEl.textContent = `ROUND ${m.round}`;
    mePts.textContent = String(m.score[0]);
    oppPts.textContent = String(m.score[1]);
    const mySide = m.sideOf(0);
    const oppSide = m.sideOf(1);
    (mePts as HTMLElement).style.color = SIDE_COLOR[mySide];
    (meName as HTMLElement).style.color = SIDE_COLOR[mySide];
    (oppPts as HTMLElement).style.color = SIDE_COLOR[oppSide];
    (oppName as HTMLElement).style.color = SIDE_COLOR[oppSide];
    [mySide, oppSide].forEach((side, i) => {
      const p = panels[i];
      if (p.dataset.side !== side) {
        p.dataset.side = side;
        p.querySelector('.lp-side')!.textContent = SIDE_LABEL[side];
      }
      const alive = m.units.filter((u) => u.team === i && u.alive).length;
      p.querySelector('.lp-alive')!.textContent = `${alive}/5`;
      p.querySelectorAll('.lp-dots i').forEach((d, j) => d.classList.toggle('off', j >= alive));
    });
    for (const u of m.units) {
      const row = rows.get(u.idx)!;
      const key = `${u.hp}|${u.kills}|${u.deaths}|${u.money}|${u.alive}`;
      if (row.dataset.k === key) continue;
      row.dataset.k = key;
      row.classList.toggle('dead', !u.alive);
      row.querySelector('.lp-kd')!.textContent = `${u.kills}/${u.deaths}`;
      row.querySelector('.lp-hpn')!.textContent = `+ ${u.hp}`;
      const bar = row.querySelector<HTMLElement>('.lp-bar div')!;
      bar.style.width = `${u.hp}%`;
      bar.classList.toggle('low', u.hp <= 35);
      row.querySelector('.lp-money')!.textContent = `$${u.money}`;
    }
    // lignes éphémères (fil des éliminations, chat)
    while (feed.length && now - feed[0].born > 5000) feed.shift();
    while (chat.length && now - chat[0].born > 6000) chat.shift();
    if (feed.length > 4) feed.splice(0, feed.length - 4);
    if (chat.length > 2) chat.splice(0, chat.length - 2);
    const fh = feed.map((l) => `<div>${l.html}</div>`).join('');
    if (feedEl.dataset.h !== fh) { feedEl.innerHTML = fh; feedEl.dataset.h = fh; }
    const ch = chat.map((l) => `<div>${l.html}</div>`).join('');
    if (chatEl.dataset.h !== ch) { chatEl.innerHTML = ch; chatEl.dataset.h = ch; }
    if (noticeUntil && now > noticeUntil) { noticeEl.classList.remove('show'); noticeUntil = 0; }
  }

  function draw(now: number) {
    if (!layer) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer, view.ox, view.oy, MAP.w * view.s, MAP.h * view.s);
    ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);

    // bombe
    if (m.bombPos && (m.stage !== 'ended' || m.phase !== 'freeze')) {
      const b = m.bombPos;
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      ctx.fillStyle = `rgba(255,70,60,${0.12 + 0.2 * pulse})`;
      ctx.beginPath(); ctx.arc(b.x, b.y, 14 + 8 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = m.stage === 'defusing' ? '#6cb7ff' : '#ff4a3d';
      ctx.fillRect(b.x - 6, b.y - 4, 12, 8);
      ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = 1.5; ctx.strokeRect(b.x - 6, b.y - 4, 12, 8);
    }

    const alive = m.units.filter((u) => u.alive);
    for (const u of m.units) {
      if (u.alive) continue;
      ctx.strokeStyle = 'rgba(190,190,190,0.55)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(u.pos.x - 5, u.pos.y - 5); ctx.lineTo(u.pos.x + 5, u.pos.y + 5);
      ctx.moveTo(u.pos.x + 5, u.pos.y - 5); ctx.lineTo(u.pos.x - 5, u.pos.y + 5);
      ctx.stroke();
    }
    for (const u of alive) {
      const col = color(u);
      const g = ctx.createRadialGradient(u.pos.x, u.pos.y, 4, u.pos.x, u.pos.y, 58);
      g.addColorStop(0, col + '55');
      g.addColorStop(1, col + '00');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(u.pos.x, u.pos.y);
      ctx.arc(u.pos.x, u.pos.y, 58, u.angle - 0.5, u.angle + 0.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 12px Barlow, "Segoe UI", sans-serif';
    for (const u of alive) {
      const col = color(u);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(u.pos.x, u.pos.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = u.team === 0 ? 2.5 : 1.8;
      ctx.strokeStyle = u.team === 0 ? '#ffffff' : '#0b1220';
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(u.name, u.pos.x, u.pos.y - 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(u.name, u.pos.x, u.pos.y - 18);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(u.pos.x - 13, u.pos.y - 15, 26, 3);
      ctx.fillStyle = col;
      ctx.fillRect(u.pos.x - 13, u.pos.y - 15, (26 * u.hp) / 100, 3);
    }
    // tirs
    for (let i = shots.length - 1; i >= 0; i--) {
      const age = now - shots[i].born;
      if (age > 320) { shots.splice(i, 1); continue; }
      const a = 1 - age / 320;
      const s = shots[i];
      ctx.strokeStyle = `rgba(255,236,150,${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); ctx.stroke();
      ctx.fillStyle = `rgba(255,90,70,${a * 0.7})`;
      ctx.beginPath(); ctx.arc(s.to.x, s.to.y, 6 + 14 * (1 - a), 0, Math.PI * 2); ctx.fill();
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.clearTimeout(bannerTimer);
    dialog.removeEventListener('click', onClick);
    dialog.removeEventListener('cancel', onCancel);
    dialog.close();
    dialog.innerHTML = '';
    opts.onFinish();
  }

  function frame(now: number) {
    if (finished) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) {
      if (m.phase === 'ended') {
        wait -= dt * 1000;
        if (wait <= 0) m.nextRound();
      } else if (m.phase === 'over') {
        wait -= dt * 1000;
        if (wait <= 0) return finish();
      } else {
        let rem = dt * speed;
        while (rem > 0 && (m.phase === 'live' || m.phase === 'freeze')) {
          const d = Math.min(0.25, rem);
          m.step(d);
          rem -= d;
        }
      }
    }
    const evs = m.events.splice(0);
    for (const e of evs) handle(e, now);
    updateDOM(now);
    draw(now);
    raf = requestAnimationFrame(frame);
  }

  function onClick(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-live]');
    if (!btn) return;
    const act = btn.dataset.live;
    if (act === 'skip') finish();
    else if (act === 'pause') {
      paused = !paused;
      btn.textContent = paused ? '▶' : 'II';
      dialog.classList.toggle('is-paused', paused);
    } else if (act === 'speed') {
      speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
      btn.textContent = `${speed}×`;
    } else if (act === 'chat') {
      showChat = !showChat;
      chatEl.style.display = showChat ? '' : 'none';
    }
  }
  function onCancel(e: Event) {
    e.preventDefault();
    finish();
  }
  dialog.addEventListener('click', onClick);
  dialog.addEventListener('cancel', onCancel);

  if (!dialog.open) dialog.showModal();
  resize();
  raf = requestAnimationFrame(frame);
}
