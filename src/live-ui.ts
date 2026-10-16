import type { LiveMatch, Unit, Side, LiveEvent, Vec } from './live';
import { placeAt, levelAt } from './maps';
import { FIRE_RADIUS } from './live';
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
const REASON: Record<string, string> = { elim: 'équipe adverse éliminée', bomb: 'bombe explosée', defuse: 'bombe désamorcée', time: 'temps écoulé' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmtClock = (s: number) => `${Math.floor(Math.ceil(s) / 60)}:${String(Math.ceil(s) % 60).padStart(2, '0')}`;

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
        <div class="lp-place"></div>
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
        <div class="lm-name">${esc(m.map.name)}</div>
        <div class="lm-feed"></div>
        <div class="lm-notice"></div>
        <div class="lm-banner"></div>
        <div class="lm-chat"></div>
      </div>
      ${panelHTML(oppUnits, 'right')}
    </div>
    <footer class="live-ctrl">
      <button class="lc-btn" data-live="pause" aria-label="Pause">II</button>
      <button class="lc-btn lc-speed" data-live="speed" aria-label="Vitesse">8×</button>
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

  let speed = 8;
  let paused = false;
  let showChat = true;
  let wait = 0;
  let finished = false;
  let raf = 0;
  let last = performance.now();
  let noticeUntil = 0;
  let bannerTimer = 0;
  const shots: Shot[] = [];
  const hpSeen = new Map<number, number>();
  const hurtUntil = new Map<number, number>();
  const fireUntil = new Map<number, number>();
  const shotSeen = new Map<number, number>();
  const bullets: Shot[] = [];
  const bursts: { at: Vec; born: number }[] = [];
  const labels: { text: string; at: Vec; born: number; color: string }[] = [];
  let activeIdx = -1;
  const feed: Line[] = [];
  const chat: Line[] = [];
  const img = new Image();
  img.src = m.map.image;
  const U = 1.6; // taille des repères à l'écran, en pixels du radar
  let view = { s: 1, ox: 0, oy: 0, dpr: 1 };

  const unitSide = (u: Unit): Side => m.sideOf(u.team);
  const color = (u: Unit) => SIDE_COLOR[unitSide(u)];
  const nameHTML = (u: Unit) => `<b style="color:${color(u)}">${esc(u.name)}</b>`;

  function resize() {
    const box = canvas.parentElement!.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    const v = m.map.view;
    const s = Math.min(canvas.width / v.w, canvas.height / v.h);
    view = { s, ox: (canvas.width - v.w * s) / 2, oy: (canvas.height - v.h * s) / 2, dpr };
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
        notice(`${e.half ? 'Mi-temps · ' : ''}T : ${e.plan.t}  ·  CT : ${e.plan.ct}`, 3400);
        break;
      case 'kill': {
        shots.push({ from: e.from, to: e.to, born: now });
        const k = m.units[e.killer];
        const v = m.units[e.victim];
        feed.push({ html: `${nameHTML(k)} <i>${e.tool ? '🔥' : e.hs ? '⌖' : '▸'}</i> ${nameHTML(v)}`, born: now });
        break;
      }
      case 'nade': {
        if (e.kind === 'flash') bursts.push({ at: e.at, born: now });
        const side = m.sideOf(e.team);
        labels.push({ text: e.name, at: e.at, born: now, color: side === 'CT' ? 'rgba(150,200,255,A)' : 'rgba(255,214,120,A)' });
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
      const bomb = u.alive && u.idx === m.carrier;
      const place = placeAt(m.map, u.pos);
      const lv = levelAt(m.map, u.pos);
      const placeTxt = u.alive && place.name ? `${place.name}${lv > 0 ? ' ▲' : lv < 0 ? ' ▼' : ''}` : '';
      const key = `${placeTxt}|${Math.ceil(u.hp)}|${u.kills}|${u.deaths}|${u.money}|${u.alive}|${bomb}`;
      if (row.dataset.k === key) continue;
      row.dataset.k = key;
      row.classList.toggle('dead', !u.alive);
      row.querySelector('.lp-kd')!.textContent = `${u.kills}/${u.deaths}`;
      row.querySelector('.lp-place')!.textContent = placeTxt;
      row.querySelector('.lp-hpn')!.textContent = `+ ${Math.ceil(u.hp)}`;
      const bar = row.querySelector<HTMLElement>('.lp-bar div')!;
      bar.style.width = `${u.hp}%`;
      bar.classList.toggle('low', u.hp <= 35);
      row.querySelector('.lp-money')!.textContent = `$${u.money}${bomb ? ' 💣' : ''}`;
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
    const v = m.map.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (img.complete && img.naturalWidth) ctx.drawImage(img, v.x, v.y, v.w, v.h, view.ox, view.oy, v.w * view.s, v.h * view.s);
    ctx.setTransform(view.s, 0, 0, view.s, view.ox - v.x * view.s, view.oy - v.y * view.s);

    // bombe
    if (m.bombPos) {
      const b = m.bombPos;
      const planted = m.bomb.state === 'planted';
      if (planted) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 160);
        ctx.fillStyle = `rgba(255,70,60,${0.12 + 0.2 * pulse})`;
        ctx.beginPath(); ctx.arc(b.x, b.y, (14 + 8 * pulse) * U, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = !planted ? '#ff8a1f' : m.defusing ? '#6cb7ff' : '#ff4a3d';
      ctx.fillRect(b.x - 6 * U, b.y - 4 * U, 12 * U, 8 * U);
      ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = 1.5 * U; ctx.strokeRect(b.x - 6 * U, b.y - 4 * U, 12 * U, 8 * U);
    }

    // grenades : en vol, feu (molotov), nuage (fumigène)
    const NADE_COL: Record<string, string> = { smoke: '#d9dee6', flash: '#fff6c8', molotov: '#ff8a2a' };
    for (const n of m.nades) {
      if (m.t < n.land) {
        const k = Math.max(0, (m.t - n.thrown) / (n.land - n.thrown));
        const x = n.from.x + (n.to.x - n.from.x) * k;
        const y = n.from.y + (n.to.y - n.from.y) * k - Math.sin(k * Math.PI) * 26 * U;
        ctx.fillStyle = NADE_COL[n.kind];
        ctx.beginPath(); ctx.arc(x, y, 2.6 * U, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1 * U; ctx.stroke();
        continue;
      }
      if (n.kind === 'molotov' && m.burning(n)) {
        const life = Math.min(1, (n.until - m.t) / 1.2);
        const seed = n.to.x * 3 + n.to.y * 5;
        for (let i = 0; i < 9; i++) {
          const a = seed + i * 2.399;
          const rr = i ? FIRE_RADIUS * (0.25 + ((i * 37) % 10) / 14) : 0;
          const x = n.to.x + Math.cos(a) * rr;
          const y = n.to.y + Math.sin(a) * rr;
          const flick = 0.75 + 0.25 * Math.sin(now / 70 + i * 1.3);
          const r = (9 + (i % 3) * 3) * U * 0.6 * flick;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, `rgba(255,220,120,${0.85 * life})`);
          g.addColorStop(0.5, `rgba(255,120,30,${0.7 * life})`);
          g.addColorStop(1, 'rgba(200,40,10,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = `rgba(255,120,40,${0.45 * life})`;
        ctx.lineWidth = 1.2 * U;
        ctx.setLineDash([4 * U, 3 * U]);
        ctx.beginPath(); ctx.arc(n.to.x, n.to.y, FIRE_RADIUS, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      const r = m.smokeRadius(n);
      if (r <= 0) continue;
      const fade = Math.min(1, (n.until - m.t) / 2);
      const seed = n.to.x * 7 + n.to.y * 13;
      for (let i = 0; i < 6; i++) {
        const a = seed + i * 1.7 + m.t * 0.05;
        const ox = i ? Math.cos(a) * r * 0.32 : 0;
        const oy = i ? Math.sin(a) * r * 0.32 : 0;
        const rr = r * (i ? 0.62 : 1);
        const g = ctx.createRadialGradient(n.to.x + ox, n.to.y + oy, rr * 0.15, n.to.x + ox, n.to.y + oy, rr);
        g.addColorStop(0, `rgba(205,210,218,${0.55 * fade})`);
        g.addColorStop(0.7, `rgba(180,186,196,${0.42 * fade})`);
        g.addColorStop(1, 'rgba(170,176,186,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(n.to.x + ox, n.to.y + oy, rr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = `rgba(225,230,238,${0.35 * fade})`;
      ctx.lineWidth = 1.2 * U;
      ctx.beginPath(); ctx.arc(n.to.x, n.to.y, r * 0.92, 0, Math.PI * 2); ctx.stroke();
    }

    // états visuels : dégâts reçus, tirs, aveuglement
    for (const u of m.units) {
      const prev = hpSeen.get(u.idx) ?? u.hp;
      if (u.hp < prev) hurtUntil.set(u.idx, now + 600);
      hpSeen.set(u.idx, u.hp);
      // nouvelle balle tirée : flash de bouche + traçante vers la cible
      if (u.lastShot !== (shotSeen.get(u.idx) ?? -99)) {
        shotSeen.set(u.idx, u.lastShot);
        if (u.alive && u.lastShot > 0) {
          fireUntil.set(u.idx, now + 70);
          const tg = u.target >= 0 ? m.units[u.target] : null;
          if (tg) bullets.push({ from: { ...u.pos }, to: { x: tg.pos.x + (Math.random() - 0.5) * 10, y: tg.pos.y + (Math.random() - 0.5) * 10 }, born: now });
        }
      }
    }
    const R = 8.5 * U;
    const slotOf = (u: Unit) => (u.idx % 5) + 1;

    // morts : petite croix
    for (const u of m.units) {
      if (u.alive) continue;
      ctx.strokeStyle = unitSide(u) === 'CT' ? 'rgba(69,170,242,0.45)' : 'rgba(242,194,48,0.45)';
      ctx.lineWidth = 2.6 * U;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(u.pos.x - 5 * U, u.pos.y - 5 * U); ctx.lineTo(u.pos.x + 5 * U, u.pos.y + 5 * U);
      ctx.moveTo(u.pos.x + 5 * U, u.pos.y - 5 * U); ctx.lineTo(u.pos.x - 5 * U, u.pos.y + 5 * U);
      ctx.stroke();
    }

    const alive = m.units.filter((u) => u.alive);
    // champ de vision du joueur sélectionné
    const sel = activeIdx >= 0 ? m.units[activeIdx] : null;
    if (sel && sel.alive) {
      const g = ctx.createRadialGradient(sel.pos.x, sel.pos.y, 4 * U, sel.pos.x, sel.pos.y, 70 * U);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sel.pos.x, sel.pos.y);
      ctx.arc(sel.pos.x, sel.pos.y, 70 * U, sel.angle - 0.55, sel.angle + 0.55);
      ctx.closePath();
      ctx.fill();
    }

    // points des joueurs (forme en goutte pointée vers le regard)
    const tip = R * 1.5;
    const th = Math.acos(R / tip);
    for (const u of alive) {
      const side = unitSide(u);
      const carrying = u.idx === m.carrier;
      const base = carrying ? '#ff8a1f' : side === 'CT' ? '#45aaf2' : '#f2c230';
      const light = carrying ? '#ffc58a' : side === 'CT' ? '#a9dcff' : '#ffeaa0';
      const flashed = u.flash > 0;
      ctx.save();
      ctx.translate(u.pos.x, u.pos.y);
      ctx.rotate(u.angle);

      if ((hurtUntil.get(u.idx) ?? 0) > now) { // dégâts : trait rouge dans le dos
        ctx.strokeStyle = '#e8453a';
        ctx.lineWidth = 3 * U;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, R + 3.5 * U, Math.PI - 0.85, Math.PI + 0.85);
        ctx.stroke();
      }
      if ((fireUntil.get(u.idx) ?? 0) > now) { // tir : chevrons gris
        ctx.strokeStyle = 'rgba(214,220,232,0.95)';
        ctx.lineWidth = 2.6 * U;
        ctx.lineJoin = 'round';
        for (const off of [0, 6 * U]) {
          ctx.beginPath();
          ctx.moveTo(tip + 2 * U + off, -4.5 * U); ctx.lineTo(tip + 9 * U + off, 0); ctx.lineTo(tip + 2 * U + off, 4.5 * U);
          ctx.stroke();
        }
      }
      if (flashed) { ctx.shadowColor = 'rgba(255,255,255,0.95)'; ctx.shadowBlur = 14 * U; }
      ctx.beginPath();
      ctx.moveTo(tip, 0);
      ctx.lineTo(R * Math.cos(th), R * Math.sin(th));
      ctx.arc(0, 0, R, th, -th, false);
      ctx.closePath();
      const g = ctx.createRadialGradient(-R * 0.3, -R * 0.35, 1, 0, 0, R * 1.4);
      g.addColorStop(0, flashed ? '#ffffff' : light);
      g.addColorStop(1, flashed ? light : base);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.4 * U;
      ctx.strokeStyle = 'rgba(8,12,22,0.7)';
      ctx.stroke();
      if (u.idx === activeIdx) { // sélection : anneau
        ctx.beginPath(); ctx.arc(0, 0, R + 4.5 * U, 0, Math.PI * 2);
        ctx.lineWidth = 3 * U; ctx.strokeStyle = 'rgba(8,12,22,0.8)'; ctx.stroke();
        ctx.lineWidth = 1.8 * U; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      }
      ctx.restore();

      // étage : ▲ en hauteur, ▼ en contrebas (comme le radar CS sur les cartes à étages)
      const lvl = levelAt(m.map, u.pos);
      if (lvl) {
        const bx = u.pos.x + R * 1.05;
        const by = u.pos.y - R * 1.05;
        ctx.beginPath();
        if (lvl > 0) { ctx.moveTo(bx, by - 4 * U); ctx.lineTo(bx + 4 * U, by + 3 * U); ctx.lineTo(bx - 4 * U, by + 3 * U); }
        else { ctx.moveTo(bx, by + 4 * U); ctx.lineTo(bx + 4 * U, by - 3 * U); ctx.lineTo(bx - 4 * U, by - 3 * U); }
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.2 * U;
        ctx.strokeStyle = 'rgba(8,12,22,0.85)';
        ctx.stroke();
      }

      // numéro de slot, pseudo et barre de vie
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${9.5 * U}px Barlow, "Segoe UI", sans-serif`;
      ctx.fillStyle = 'rgba(8,12,22,0.85)';
      ctx.fillText(String(slotOf(u)), u.pos.x, u.pos.y + 0.5 * U);
      ctx.textBaseline = 'alphabetic';
      ctx.font = `700 ${12 * U}px Barlow, "Segoe UI", sans-serif`;
      ctx.lineWidth = 3 * U;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(u.name, u.pos.x, u.pos.y - 19 * U);
      ctx.fillStyle = '#fff';
      ctx.fillText(u.name, u.pos.x, u.pos.y - 19 * U);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(u.pos.x - 13 * U, u.pos.y - 15 * U, 26 * U, 3 * U);
      ctx.fillStyle = base;
      ctx.fillRect(u.pos.x - 13 * U, u.pos.y - 15 * U, (26 * U * u.hp) / 100, 3 * U);
    }
    // traçantes (une par balle)
    ctx.lineCap = 'round';
    for (let i = bullets.length - 1; i >= 0; i--) {
      const age = now - bullets[i].born;
      if (age > 110) { bullets.splice(i, 1); continue; }
      const b = bullets[i];
      const a = 1 - age / 110;
      const dx = b.to.x - b.from.x;
      const dy = b.to.y - b.from.y;
      const head = Math.min(1, 0.35 + age / 70);
      const tail = Math.max(0, head - 0.45);
      ctx.strokeStyle = `rgba(255,232,150,${0.85 * a})`;
      ctx.lineWidth = 1.4 * U;
      ctx.beginPath();
      ctx.moveTo(b.from.x + dx * tail, b.from.y + dy * tail);
      ctx.lineTo(b.from.x + dx * head, b.from.y + dy * head);
      ctx.stroke();
    }
    // flashs qui éclatent (durée réelle, pour rester visibles même en accéléré)
    for (let i = bursts.length - 1; i >= 0; i--) {
      const age = now - bursts[i].born;
      if (age > 420) { bursts.splice(i, 1); continue; }
      const k = age / 420;
      const b = bursts[i].at;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, (18 + 70 * k) * U);
      g.addColorStop(0, `rgba(255,255,255,${0.95 * (1 - k)})`);
      g.addColorStop(0.4, `rgba(255,250,215,${0.55 * (1 - k)})`);
      g.addColorStop(1, 'rgba(255,250,215,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, (18 + 70 * k) * U, 0, Math.PI * 2); ctx.fill();
    }
    // nom des lancers (ex. « Fumée Jungle »)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${10.5 * U}px Barlow, "Segoe UI", sans-serif`;
    for (let i = labels.length - 1; i >= 0; i--) {
      const age = now - labels[i].born;
      if (age > 1900) { labels.splice(i, 1); continue; }
      const l = labels[i];
      const a = age < 1400 ? 1 : 1 - (age - 1400) / 500;
      const y = l.at.y - 30 * U - age / 120;
      ctx.lineWidth = 3 * U;
      ctx.strokeStyle = `rgba(0,0,0,${0.8 * a})`;
      ctx.strokeText(l.text, l.at.x, y);
      ctx.fillStyle = l.color.replace('A', String(a));
      ctx.fillText(l.text, l.at.x, y);
    }
    // impacts mortels
    for (let i = shots.length - 1; i >= 0; i--) {
      const age = now - shots[i].born;
      if (age > 320) { shots.splice(i, 1); continue; }
      const a = 1 - age / 320;
      const s = shots[i];
      ctx.fillStyle = `rgba(255,90,70,${a * 0.7})`;
      ctx.beginPath(); ctx.arc(s.to.x, s.to.y, (6 + 14 * (1 - a)) * U, 0, Math.PI * 2); ctx.fill();
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
          const d = Math.min(0.05, rem);
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
    const row = (e.target as HTMLElement).closest<HTMLElement>('.lp-row');
    if (row) {
      const i = Number(row.dataset.i);
      activeIdx = activeIdx === i ? -1 : i;
      rows.forEach((r, k) => r.classList.toggle('active', k === activeIdx));
      return;
    }
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
