import './style.css';
import playersData from './data/players.json';
import type { Player, SlotId, SlotDef, Role, TeamInfo, TeamLogo, ModeId, MatchRecord } from './types';
import { SLOTS, emptyTeam } from './types';
import { loadSave, persist, HISTORY_LIMIT } from './storage';
import { computeChemistry, CHEM } from './chemistry';
import { PACKS, RARITY_LABEL } from './packs';
import { RARITIES, DUPLICATE_REFUND, effectiveOdds, rollPlayer, fmtPct } from './luck';
import type { PackDef } from './packs';
import { MODES, modeById, simulateMatch, averageWinChance, winChance, cooldownLeft, fmtCountdown, fmtCooldown } from './play';
import { LiveMatch, buildOpponentRoster } from './live';
import { startLive } from './live-ui';
import type { ModeDef } from './play';

const players = playersData as unknown as Player[];
const byId = new Map(players.map((p) => [p.id, p]));

let save = loadSave();
let activeTab = 'team';
let pickerSlot: SlotId | null = null;

const TABS = [
  { id: 'team', label: 'My team', ready: true },
  { id: 'play', label: 'Play', ready: true },
  { id: 'market', label: 'Marché', ready: false },
  { id: 'collection', label: 'Collection', ready: true },
  { id: 'packs', label: 'Caisses CS2', ready: true },
  { id: 'ranking', label: 'Classement', ready: false },
];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const view = $('#view');
const tabsEl = $('#tabs');
const accountBtn = $<HTMLButtonElement>('#account-btn');
const accountDialog = $<HTMLDialogElement>('#account-dialog');
const pickerDialog = $<HTMLDialogElement>('#picker-dialog');
const packDialog = $<HTMLDialogElement>('#pack-dialog');
const coinsEl = $('#coins');
const coinsDialog = $<HTMLDialogElement>('#coins-dialog');
const teamDialog = $<HTMLDialogElement>('#team-dialog');
const matchDialog = $<HTMLDialogElement>('#match-dialog');
const liveDialog = $<HTMLDialogElement>('#live-dialog');

const isOwned = (id: string) => save.owned.includes(id);

/* ---------- helpers ---------- */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const yy = (n: number) => `'${String(n).slice(-2)}`;
const fmtPeriod = (p: Player['period']) => (p.to ? `${yy(p.from)}–${yy(p.to)}` : `${yy(p.from)}–`);
const flag = (code: string) =>
  `<img class="flag" src="https://flagcdn.com/w40/${code.toLowerCase()}.png" alt="${code}" loading="lazy" />`;

function teamPlayers(): Record<SlotId, Player | null> {
  const out = {} as Record<SlotId, Player | null>;
  for (const s of SLOTS) {
    const id = save.team[s.id];
    out[s.id] = id ? byId.get(id) ?? null : null;
  }
  return out;
}

function commit() {
  persist(save);
  render();
}

/* ---------- carte joueur ---------- */
function cardHTML(p: Player, fit: boolean | null): string {
  const roleClass = fit === null ? '' : fit ? 'role-ok' : 'role-bad';
  const initials = esc(p.nickname.slice(0, 2).toUpperCase());
  return `
  <article class="card ${p.rarity}">
    <div class="card-head">
      <div class="ovr">${p.ovr}</div>
      <div class="role-pill ${roleClass}">${p.role}</div>
      ${flag(p.countryCode)}
      <div class="period">${fmtPeriod(p.period)}</div>
    </div>
    <div class="portrait">
      <span class="initials">${initials}</span>
      <img src="/players/${esc(p.id)}.png" alt="" onerror="this.remove()" />
    </div>
    <div class="card-foot">
      <div class="nick">${esc(p.nickname)}</div>
      <div class="team">${esc(p.team)}</div>
      <div class="stats">
        <div><b>${p.stats.aim}</b><span>AIM</span></div>
        <div><b>${p.stats.utl}</b><span>UTL</span></div>
        <div><b>${p.stats.pos}</b><span>POS</span></div>
        <div><b>${p.stats.clu}</b><span>CLU</span></div>
      </div>
    </div>
  </article>`;
}

/* ---------- onglet My team ---------- */
function renderTeam() {
  const team = teamPlayers();
  const chem = computeChemistry(team);

  const slotHTML = (s: SlotDef) => {
    const p = team[s.id];
    const fit = chem.fits[s.id];
    const body = p
      ? `${cardHTML(p, fit)}
         <div class="slot-actions">
           <button class="btn btn-ghost" data-action="pick" data-slot="${s.id}">Changer</button>
           <button class="btn btn-ghost danger" data-action="remove" data-slot="${s.id}">Retirer</button>
         </div>`
      : `<button class="slot-empty" data-action="pick" data-slot="${s.id}">
           <span class="plus">+</span><span>Choisir un ${s.role ? 'joueur' : 'coach'}</span>
         </button>`;
    return `
      <section class="slot ${s.id === 'coach' ? 'slot-coach' : ''}">
        <div class="slot-label"><b>${s.label}</b><small>${s.role ? `rôle ${s.role}` : 'bonus staff'}</small></div>
        ${body}
      </section>`;
  };

  const starters = SLOTS.filter((s) => s.role).map(slotHTML).join('');
  const coach = SLOTS.filter((s) => !s.role).map(slotHTML).join('');

  const statRow = (label: string, v: number) => `
    <div class="stat-row"><span>${label}</span>
      <span class="stat-val">${chem.filledStarters ? v : '–'}
        ${chem.bonus > 0 && chem.filledStarters ? `<em class="bonus">+${chem.bonus}</em>` : ''}</span></div>`;

  const pairsHTML = chem.pairs.length
    ? chem.pairs.map(([a, b]) => `<li>${esc(a.nickname)} ↔ ${esc(b.nickname)} <small>${esc(a.team)}</small></li>`).join('')
    : '<li class="muted">Aucune paire de vrais coéquipiers</li>';

  view.innerHTML = `
    ${teamHeaderHTML()}
    <div class="team-layout">
      <div class="board">
        <div class="lineup">${starters}</div>
        <div class="lineup lineup-coach">${coach}</div>
      </div>
      <aside class="panel chem">
        <h2>Alchimie</h2>
        <div class="chem-total"><span>${chem.total}</span><small>/100</small></div>
        <div class="bar"><div class="bar-fill" style="width:${chem.total}%"></div></div>

        <div class="chem-line"><span>Rôles</span><b>${chem.rolePoints}<small>/${CHEM.ROLE_MAX}</small></b></div>
        <div class="chem-line"><span>Vrais coéquipiers</span><b>${chem.teamPoints}<small>/${CHEM.PAIR_MAX}</small></b></div>
        <div class="chem-line"><span>Bonus de match</span><b class="bonus">+${chem.bonus}</b></div>

        <h3>Note d'équipe</h3>
        <div class="team-ovr">${chem.filledStarters ? chem.teamOvr : '–'}
          ${chem.bonus > 0 && chem.filledStarters ? `<em class="bonus">+${chem.bonus}</em>` : ''}
          <small>OVR</small></div>
        ${statRow('AIM', chem.teamStats.aim)}
        ${statRow('UTL', chem.teamStats.utl)}
        ${statRow('POS', chem.teamStats.pos)}
        ${statRow('CLU', chem.teamStats.clu)}

        <h3>Paires détectées</h3>
        <ul class="pairs">${pairsHTML}</ul>

        <button class="btn btn-ghost danger full" data-action="reset">Vider l'équipe</button>
      </aside>
    </div>
    ${historyHTML()}`;
}

function renderPlaceholder(label: string) {
  view.innerHTML = `<div class="panel placeholder"><h2>${label}</h2><p>Onglet à venir — prochaine étape du développement.</p></div>`;
}

/* ---------- navigation ---------- */
function renderTabs() {
  tabsEl.innerHTML = TABS.map(
    (t) => `<button class="tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">
      ${t.label}${t.ready ? '' : ' <small>bientôt</small>'}</button>`,
  ).join('');
}

function renderAccountBtn() {
  accountBtn.textContent = save.profile ? `👤 ${save.profile.username}` : 'Créer son compte';
  accountBtn.classList.toggle('btn-gold', !save.profile);
  accountBtn.classList.toggle('btn-ghost', !!save.profile);
}

function renderCoins() {
  coinsEl.textContent = save.coins.toLocaleString('fr-FR');
}

/* ---------- onglet Collection ---------- */
type CollectionFilter = 'all' | 'owned' | 'locked';
let collectionFilter: CollectionFilter = 'all';

function lockedCardHTML(p: Player): string {
  return `
    <div class="locked-wrap" title="${esc(p.nickname)} — à trouver dans une caisse">
      ${cardHTML(p, null)}
      <div class="lock"><span class="lock-icon" aria-hidden="true">🔒</span><span class="lock-text">Verrouillé</span></div>
    </div>`;
}

function renderCollection() {
  const sorted = [...players].sort((a, b) => b.ovr - a.ovr);
  const ownedCount = sorted.filter((p) => isOwned(p.id)).length;
  const lockedCount = sorted.length - ownedCount;
  const list = sorted.filter((p) =>
    collectionFilter === 'all' ? true : collectionFilter === 'owned' ? isOwned(p.id) : !isOwned(p.id),
  );

  const chip = (id: CollectionFilter, label: string, n: number) =>
    `<button class="chip ${collectionFilter === id ? 'active' : ''}" data-filter="${id}">${label} <b>${n}</b></button>`;

  const grid = list.length
    ? `<div class="card-grid">${list.map((p) => (isOwned(p.id) ? cardHTML(p, null) : lockedCardHTML(p))).join('')}</div>`
    : `<div class="panel placeholder"><p>${
        collectionFilter === 'owned' ? "Tu n'as encore aucun joueur." : 'Tu as débloqué tous les joueurs !'
      }</p>${
        collectionFilter === 'owned'
          ? '<button class="btn btn-gold" data-goto="packs" style="margin-top:16px">Ouvrir une caisse</button>'
          : ''
      }</div>`;

  view.innerHTML = `
    <div class="section-head">
      <h2>Ma collection</h2>
      <span class="muted">${ownedCount} / ${sorted.length} joueurs débloqués</span>
    </div>
    <div class="collection-bar">
      <div class="chips">
        ${chip('all', 'Tous', sorted.length)}
        ${chip('owned', 'Débloqués', ownedCount)}
        ${chip('locked', 'Verrouillés', lockedCount)}
      </div>
      <button class="btn btn-gold" data-goto="packs">Ouvrir une caisse</button>
    </div>
    ${grid}`;
}

/* ---------- onglet Caisses ---------- */
function packCardHTML(pack: PackDef): string {
  const can = save.coins >= pack.price;
  const real = effectiveOdds(pack, players);
  const odds = RARITIES.filter((r) => real[r] > 0)
    .map(
      (r) => `
      <div class="odds-row ${r}">
        <span class="odds-label">${RARITY_LABEL[r]}</span>
        <div class="odds-bar"><div style="width:${Math.max(real[r], 1.5)}%"></div></div>
        <b>${fmtPct(real[r])}</b>
      </div>`,
    )
    .join('');
  return `
    <article class="panel pack" style="--accent:${pack.accent}">
      <div class="pack-crate"><span class="crate-fallback">📦</span><img src="${esc(pack.image)}" alt="${esc(pack.name)}" onerror="this.remove()" /></div>
      <h3>${esc(pack.name)}</h3>
      <p class="muted">${esc(pack.tagline)}</p>
      <div class="odds">${odds}</div>
      <button class="btn btn-gold full" data-open-pack="${pack.id}" ${can ? '' : 'disabled'}>
        Ouvrir — 🪙 ${pack.price}
      </button>
    </article>`;
}

function renderPacks() {
  view.innerHTML = `
    <div class="section-head">
      <h2>Caisses CS2</h2>
      <span class="muted">Doublon revendu : 🪙 ${DUPLICATE_REFUND.silver} / ${DUPLICATE_REFUND.gold} / ${DUPLICATE_REFUND.legend} (Silver / Gold / Légende)</span>
    </div>
    <div class="pack-grid">${PACKS.map(packCardHTML).join('')}</div>`;
}

/* ---------- ouverture de caisse ---------- */
let spinning = false;
const STRIP_LEN = 46;
const WIN_INDEX = 38;

function tileHTML(p: Player): string {
  return `<div class="roll-item ${p.rarity}"><b>${p.ovr}</b><span>${esc(p.nickname)}</span><small>${p.role}</small></div>`;
}

function openPack(packId: string) {
  if (!save.profile) return;
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack || spinning || save.coins < pack.price) return;

  // Le tirage et le paiement sont appliqués tout de suite (pas de triche en rafraîchissant)
  const winner = rollPlayer(pack, players);
  const duplicate = isOwned(winner.id);
  save.coins -= pack.price;
  if (duplicate) save.coins += DUPLICATE_REFUND[winner.rarity];
  else save.owned.push(winner.id);
  persist(save);
  renderCoins();

  const strip = Array.from({ length: STRIP_LEN }, (_, i) => (i === WIN_INDEX ? winner : rollPlayer(pack, players)));

  spinning = true;
  packDialog.innerHTML = `
    <h2 class="pack-title">${esc(pack.name)}</h2>
    <div class="roll-window">
      <div class="roll-marker"></div>
      <div class="roll-track" id="roll-track">${strip.map(tileHTML).join('')}</div>
    </div>
    <p class="muted center">Ouverture…</p>`;
  if (!packDialog.open) packDialog.showModal();

  const track = $('#roll-track');
  const windowEl = track.parentElement!;
  const finish = () => {
    if (!spinning) return;
    spinning = false;
    showPackResult(pack, winner, duplicate);
  };

  requestAnimationFrame(() => {
    const tile = track.children[WIN_INDEX] as HTMLElement;
    const jitter = (Math.random() - 0.5) * tile.offsetWidth * 0.6;
    const target = tile.offsetLeft + tile.offsetWidth / 2 - windowEl.clientWidth / 2 + jitter;
    track.style.transition = 'transform 5s cubic-bezier(0.12, 0.7, 0.12, 1)';
    track.style.transform = `translateX(${-target}px)`;
    track.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 5600); // filet de sécurité
  });
}

function showPackResult(pack: PackDef, p: Player, duplicate: boolean) {
  const can = save.coins >= pack.price;
  packDialog.innerHTML = `
    <div class="reveal ${p.rarity}">
      <div class="reveal-rarity">${RARITY_LABEL[p.rarity]}</div>
      <div class="reveal-card">${cardHTML(p, null)}</div>
      <p class="reveal-status">${
        duplicate
          ? `Doublon — revendu <b class="bonus">+🪙 ${DUPLICATE_REFUND[p.rarity]}</b>`
          : '<b class="bonus">Nouveau joueur débloqué !</b>'
      }</p>
    </div>
    <div class="dialog-actions">
      <button class="btn btn-ghost" data-close>Fermer</button>
      <button class="btn btn-gold" data-again="${pack.id}" ${can ? '' : 'disabled'}>Rouvrir — 🪙 ${pack.price}</button>
    </div>`;
  render();
}

packDialog.addEventListener('cancel', (e) => {
  if (spinning) e.preventDefault();
});

packDialog.addEventListener('click', (e) => {
  if (spinning) return;
  const t = e.target as HTMLElement;
  if (t === packDialog || t.hasAttribute('data-close')) return packDialog.close();
  const again = t.closest<HTMLElement>('[data-again]');
  if (again && !(again as HTMLButtonElement).disabled) openPack(again.dataset.again!);
});

/* ---------- page d'accueil (sans compte) ---------- */
function renderWelcome() {
  view.innerHTML = `
    <section class="welcome">
      <h1>Construis l'équipe CS2 ultime</h1>
      <p class="welcome-goal">
        Ouvre des caisses pour débloquer des cartes de joueurs, puis compose ton équipe : cinq joueurs et un coach.
        Place chacun à son vrai rôle et réunis d'anciens coéquipiers pour faire monter l'alchimie et la note de ton équipe.
        Le but : bâtir la meilleure équipe possible.
      </p>
      <p class="welcome-note">Pour jouer, tu dois d'abord créer un compte.</p>
      <button class="btn btn-gold btn-lg" data-action="signup">Créer mon compte</button>
    </section>`;
}

function render() {
  const loggedIn = !!save.profile;
  document.body.classList.toggle('logged-out', !loggedIn);
  if (!loggedIn) {
    renderWelcome();
    return;
  }
  renderTabs();
  renderAccountBtn();
  renderCoins();
  if (activeTab === 'team') renderTeam();
  else if (activeTab === 'play') renderPlay();
  else if (activeTab === 'collection') renderCollection();
  else if (activeTab === 'packs') renderPacks();
  else renderPlaceholder(TABS.find((t) => t.id === activeTab)!.label);
}

/* ---------- identité de l'équipe (nom, logo, résultats) ---------- */
const LOGO_EMOJIS = ['🎯', '🔥', '⚡', '🐺', '🦅', '🐉', '🦁', '💀', '🛡️', '⚔️', '🚀', '👑'];
const LOGO_COLORS = ['#e8a838', '#4f8cff', '#9b7bff', '#3ddc97', '#ff6b7a', '#e8eef9'];

function logoHTML(logo: TeamLogo): string {
  if (logo.kind === 'image') return `<span class="team-logo"><img src="${esc(logo.dataUrl)}" alt="" /></span>`;
  return `<span class="team-logo" style="--logo:${esc(logo.color)}"><span class="team-logo-emoji">${logo.emoji}</span></span>`;
}

function teamHeaderHTML(): string {
  const t = save.teamInfo;
  const played = t.wins + t.losses;
  const rate = played ? `${Math.round((t.wins / played) * 100)} %` : '–';
  return `
    <section class="team-head">
      <button class="team-logo-btn" data-action="edit-team" title="Modifier le logo" aria-label="Modifier le logo">${logoHTML(t.logo)}</button>
      <div class="team-id">
        <div class="team-name-row">
          <h2 class="team-name">${esc(t.name)}</h2>
          <button class="btn btn-ghost btn-sm" data-action="edit-team">Modifier</button>
        </div>
        <p class="muted team-sub">${played ? `${played} partie${played > 1 ? 's' : ''} jouée${played > 1 ? 's' : ''}` : 'Joue un match dans l\'onglet Play pour remplir tes résultats.'}</p>
      </div>
      <dl class="record">
        <div class="record-box win"><dd>${t.wins}</dd><dt>Victoires</dt></div>
        <div class="record-box loss"><dd>${t.losses}</dd><dt>Défaites</dt></div>
        <div class="record-box"><dd>${rate}</dd><dt>Taux de victoire</dt></div>
      </dl>
    </section>`;
}

let teamDraft: TeamInfo | null = null;

function openTeamDialog() {
  teamDraft = structuredClone(save.teamInfo);
  teamDialog.innerHTML = `
    <h2>Mon équipe</h2>
    <form id="team-form">
      <label class="field"><span>Nom de l'équipe</span>
        <input id="team-name" name="name" maxlength="24" required autocomplete="off" value="${esc(teamDraft.name)}" />
      </label>

      <div class="field"><span>Logo</span>
        <div class="logo-preview" id="logo-preview"></div>
        <div class="emoji-grid" id="emoji-grid">
          ${LOGO_EMOJIS.map((e) => `<button type="button" class="emoji-btn" data-emoji="${e}" aria-label="Emblème ${e}">${e}</button>`).join('')}
        </div>
        <div class="color-row" id="color-row">
          ${LOGO_COLORS.map((c) => `<button type="button" class="color-btn" data-color="${c}" style="--c:${c}" aria-label="Couleur ${c}"></button>`).join('')}
        </div>
        <label class="btn btn-ghost btn-sm file-btn">Importer une image
          <input id="logo-file" type="file" accept="image/*" hidden />
        </label>
        <p class="muted field-error" id="logo-error" hidden>Image illisible : essaie un PNG ou un JPG.</p>
      </div>

      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" data-close>Annuler</button>
        <button type="submit" class="btn btn-gold">Enregistrer</button>
      </div>
    </form>`;
  refreshTeamDialog();
  teamDialog.showModal();
  $<HTMLInputElement>('#team-name').select();
}

function refreshTeamDialog() {
  if (!teamDraft) return;
  const logo = teamDraft.logo;
  $('#logo-preview').innerHTML = logoHTML(logo);
  teamDialog.querySelectorAll<HTMLElement>('.emoji-btn').forEach((b) =>
    b.classList.toggle('selected', logo.kind === 'emoji' && b.dataset.emoji === logo.emoji));
  teamDialog.querySelectorAll<HTMLElement>('.color-btn').forEach((b) =>
    b.classList.toggle('selected', logo.kind === 'emoji' && b.dataset.color === logo.color));
}

/** Recadre l'image en carré 160×160 pour qu'elle reste légère dans la sauvegarde. */
function imageToLogoData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 160;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const side = Math.min(img.width, img.height);
      canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
    img.src = url;
  });
}

teamDialog.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t === teamDialog || t.hasAttribute('data-close')) return teamDialog.close();
  if (!teamDraft) return;
  const emoji = t.closest<HTMLElement>('[data-emoji]');
  if (emoji) {
    const color = teamDraft.logo.kind === 'emoji' ? teamDraft.logo.color : LOGO_COLORS[0];
    teamDraft.logo = { kind: 'emoji', emoji: emoji.dataset.emoji!, color };
    return refreshTeamDialog();
  }
  const color = t.closest<HTMLElement>('[data-color]');
  if (color) {
    const current = teamDraft.logo.kind === 'emoji' ? teamDraft.logo.emoji : LOGO_EMOJIS[0];
    teamDraft.logo = { kind: 'emoji', emoji: current, color: color.dataset.color! };
    refreshTeamDialog();
  }
});

teamDialog.addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id !== 'logo-file' || !input.files?.[0] || !teamDraft) return;
  const error = $('#logo-error');
  try {
    teamDraft.logo = { kind: 'image', dataUrl: await imageToLogoData(input.files[0]) };
    error.hidden = true;
    refreshTeamDialog();
  } catch {
    error.hidden = false;
  }
  input.value = '';
});

teamDialog.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!teamDraft) return;
  const name = $<HTMLInputElement>('#team-name').value.trim();
  if (!name) return;
  save.teamInfo = { ...save.teamInfo, name: name.slice(0, 24), logo: teamDraft.logo };
  teamDraft = null;
  teamDialog.close();
  commit();
});

/* ---------- onglet Play ---------- */
const fmtCoins = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fr-FR')}`;

function currentChem() {
  return computeChemistry(teamPlayers());
}

type PlayStatus = 'open' | 'wait' | 'blocked';

function playButtonState(mode: ModeDef): { disabled: boolean; status: PlayStatus; statusText: string } {
  if (currentChem().filledStarters < 5) return { disabled: true, status: 'blocked', statusText: 'Équipe incomplète' };
  const left = cooldownLeft(mode, save.lastPlayed[mode.id]);
  if (left > 0) return { disabled: true, status: 'wait', statusText: `Disponible dans ${fmtCountdown(left)}` };
  if (save.coins < mode.entry) return { disabled: true, status: 'blocked', statusText: `Il faut ${mode.entry} 🪙` };
  return { disabled: false, status: 'open', statusText: 'Ouvert' };
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function modeRowHTML(mode: ModeDef, chem: ReturnType<typeof currentChem>): string {
  const state = playButtonState(mode);
  const ready = chem.filledStarters === 5;
  const mine = save.history.filter((m) => m.mode === mode.id);
  const wins = mine.filter((m) => m.won).length;
  const today = mine.filter((m) => m.ts >= startOfToday()).length;
  const chance = ready ? `≈ ${Math.round(averageWinChance(mode, chem.teamOvr) * 100)} %` : '–';
  const isScrim = mode.id === 'scrim';

  const chips = [
    `<span class="chip-info">Entrée <b>${mode.entry ? `${mode.entry} 🪙` : 'gratuite'}</b></span>`,
    `<span class="chip-info prize">🪙 <b>${mode.win}</b> victoire</span>`,
    mode.id === 'scrim' ? '' : `<span class="chip-info">🪙 <b>${mode.loss}</b> défaite</span>`,
    `<span class="chip-info">Délai <b>${fmtCooldown(mode.cooldownMs)}</b></span>`,
    `<span class="chip-info">Chance de victoire <b>${chance}</b></span>`,
    `<span class="chip-info"><b>${today}</b> aujourd'hui</span>`,
  ].join('');

  return `
    <article class="play-row mode-${mode.id} ${isScrim ? 'play-scrim' : 'play-stage'}" style="--accent:${mode.accent}">
      <div class="hex"><div class="hex-in"><b>${mode.badge.big}</b>${mode.badge.small ? `<small>${mode.badge.small}</small>` : ''}</div></div>
      <div class="play-body">
        <div class="play-eyebrow">
          <span>${esc(mode.eyebrow)}</span>
          <span class="status-pill ${state.status}" data-status="${mode.id}">${esc(state.statusText)}</span>
          ${wins ? `<span class="wins-pill">Victoires ×${wins}</span>` : ''}
        </div>
        <h3>${esc(mode.name)}</h3>
        <p class="play-desc">${esc(mode.desc)}</p>
        <div class="play-chips">${chips}</div>
      </div>
      <button class="play-cta" data-play="${mode.id}" ${state.disabled ? 'disabled' : ''}>
        <span aria-hidden="true">▶</span> ${isScrim ? 'Lancer le scrim' : 'Entrer'}
      </button>
    </article>`;
}

function renderPlay() {
  const chem = currentChem();
  const ready = chem.filledStarters === 5;
  const row = (id: ModeId) => modeRowHTML(modeById(id), chem);
  view.innerHTML = `
    <div class="section-head">
      <h2>Play</h2>
      <span class="muted">${ready ? `Ton équipe : OVR ${chem.teamOvr}` : `Équipe incomplète : ${chem.filledStarters} / 5 joueurs`}</span>
    </div>
    ${ready ? '' : `<div class="panel notice"><p>Place tes 5 joueurs dans My team pour pouvoir jouer. Le coach est facultatif.</p>
      <button class="btn btn-gold" data-goto="team">Composer mon équipe</button></div>`}
    <div class="play">
      ${row('scrim')}
      <div class="stages">${row('showmatch')}${row('lan')}</div>
    </div>`;
}

/** Met à jour uniquement les statuts et les boutons (compte à rebours) sans reconstruire la page. */
function updatePlayButtons() {
  view.querySelectorAll<HTMLButtonElement>('[data-play]').forEach((btn) => {
    const id = btn.dataset.play as ModeId;
    const state = playButtonState(modeById(id));
    if (btn.disabled !== state.disabled) btn.disabled = state.disabled;
    const pill = view.querySelector<HTMLElement>(`[data-status="${id}"]`);
    if (pill) {
      if (pill.textContent !== state.statusText) pill.textContent = state.statusText;
      pill.className = `status-pill ${state.status}`;
    }
  });
}

setInterval(() => {
  if (activeTab === 'play' && save.profile && !matching && !matchDialog.open) updatePlayButtons();
}, 1000);

/* ---------- match ---------- */
let matching = false;

function versusHTML(opp: MatchRecord['opponent']): string {
  return `
    <div class="versus">
      <div class="versus-side">${logoHTML(save.teamInfo.logo)}<b>${esc(save.teamInfo.name)}</b></div>
      <div class="versus-vs">VS</div>
      <div class="versus-side"><span class="team-logo opp-logo"><span class="team-logo-emoji">${opp.emoji}</span></span><b>${esc(opp.name)}</b><small class="muted">OVR ${opp.ovr}</small></div>
    </div>`;
}

function playMatch(id: ModeId) {
  if (!save.profile || matching) return;
  const mode = modeById(id);
  const chem = currentChem();
  if (chem.filledStarters < 5 || playButtonState(mode).disabled) return;

  // Le résultat, le paiement et le délai sont enregistrés tout de suite : recharger la page n'annule rien.
  const out = simulateMatch(mode, chem.teamOvr);
  const record: MatchRecord = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ts: Date.now(),
    mode: id,
    opponent: out.opponent,
    myOvr: chem.teamOvr,
    myScore: out.myScore,
    oppScore: out.oppScore,
    won: out.won,
    entry: out.entry,
    payout: out.payout,
  };
  save.coins += out.payout - out.entry;
  save.lastPlayed[id] = record.ts;
  save.teamInfo.wins += out.won ? 1 : 0;
  save.teamInfo.losses += out.won ? 0 : 1;
  save.history.unshift(record);
  if (save.history.length > HISTORY_LIMIT) save.history.length = HISTORY_LIMIT;
  persist(save);
  renderCoins();

  // match en direct : ton équipe à gauche, l'adversaire à droite, la carte au centre
  const team = teamPlayers();
  const mine = SLOTS.filter((sl) => sl.role).map((sl) => team[sl.id]!);
  const live = new LiveMatch(mine, buildOpponentRoster(players, mine, out.opponent.ovr), [out.myScore, out.oppScore]);
  matching = true;
  startLive({
    dialog: liveDialog,
    match: live,
    myName: save.teamInfo.name,
    oppName: out.opponent.name,
    rating: chem.teamOvr,
    winPct: Math.round(winChance(chem.teamOvr, out.opponent.ovr) * 100),
    cardHTML: (p) => cardHTML(p, null),
    onFinish: () => {
      matching = false;
      showMatchResult(mode, record);
    },
  });
}

function showMatchResult(mode: ModeDef, m: MatchRecord) {
  const net = m.payout - m.entry;
  const lines = [
    m.entry ? `<li><span>Ticket d'entrée</span><b>${fmtCoins(-m.entry)} 🪙</b></li>` : '',
    `<li><span>Gain</span><b>${m.payout ? `${fmtCoins(m.payout)} 🪙` : 'Aucun'}</b></li>`,
    m.entry ? `<li class="total"><span>Bilan</span><b class="${net >= 0 ? 'pos' : 'neg'}">${fmtCoins(net)} 🪙</b></li>` : '',
  ].join('');
  const state = playButtonState(mode);
  matchDialog.innerHTML = `
    <h2 class="pack-title">${esc(mode.name)}</h2>
    ${versusHTML(m.opponent)}
    <div class="match-result ${m.won ? 'won' : 'lost'}">
      <div class="match-score">${m.myScore} <span>–</span> ${m.oppScore}</div>
      <div class="match-verdict">${m.won ? 'Victoire' : 'Défaite'}</div>
    </div>
    <ul class="match-rewards">${lines}</ul>
    <div class="dialog-actions">
      <button class="btn btn-ghost" data-close>Fermer</button>
      <button class="btn btn-gold" data-replay="${mode.id}" ${state.disabled ? 'disabled' : ''}>${state.disabled ? esc(state.statusText) : 'Rejouer'}</button>
    </div>`;
  if (!matchDialog.open) matchDialog.showModal();
  render();
}

matchDialog.addEventListener('cancel', (e) => {
  if (matching) e.preventDefault();
});

matchDialog.addEventListener('click', (e) => {
  if (matching) return;
  const t = e.target as HTMLElement;
  if (t === matchDialog || t.hasAttribute('data-close')) return matchDialog.close();
  const again = t.closest<HTMLButtonElement>('[data-replay]');
  if (again && !again.disabled) playMatch(again.dataset.replay as ModeId);
});

/* ---------- historique et stats (My team) ---------- */
let historyExpanded = false;
const HISTORY_PREVIEW = 15;

function historyHTML(): string {
  const h = save.history;
  if (!h.length) {
    return `
      <section class="history">
        <div class="section-head"><h2>Historique des parties</h2></div>
        <div class="panel notice"><p>Aucune partie jouée pour l'instant.</p>
          <button class="btn btn-gold" data-goto="play">Jouer un match</button></div>
      </section>`;
  }

  const net = (m: MatchRecord) => m.payout - m.entry;
  const total = h.length;
  const totalNet = h.reduce((sum, m) => sum + net(m), 0);
  let streak = 0;
  for (const m of h) {
    if (m.won !== h[0].won) break;
    streak++;
  }

  const modeStats = MODES.map((mode) => {
    const g = h.filter((m) => m.mode === mode.id);
    const w = g.filter((m) => m.won).length;
    const gNet = g.reduce((sum, m) => sum + net(m), 0);
    return `
      <article class="panel mode-stat" style="--accent:${mode.accent}">
        <h3>${esc(mode.name)}</h3>
        ${g.length
          ? `<div class="mode-stat-main"><b class="win">${w}</b> V <span class="muted">·</span> <b class="loss">${g.length - w}</b> D</div>
             <div class="mode-stat-sub muted">${Math.round((w / g.length) * 100)} % de victoires · ${fmtCoins(gNet)} 🪙</div>`
          : '<div class="muted">Aucun match</div>'}
      </article>`;
  }).join('');

  const shown = historyExpanded ? h : h.slice(0, HISTORY_PREVIEW);
  const rows = shown
    .map((m) => {
      const n = net(m);
      return `
        <tr>
          <td class="muted">${new Date(m.ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
          <td>${esc(modeById(m.mode).name)}</td>
          <td>${m.opponent.emoji} ${esc(m.opponent.name)} <small class="muted">OVR ${m.opponent.ovr}</small></td>
          <td class="score">${m.myScore} – ${m.oppScore}</td>
          <td><span class="result-chip ${m.won ? 'won' : 'lost'}">${m.won ? 'Victoire' : 'Défaite'}</span></td>
          <td class="coins-cell ${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${fmtCoins(n)} 🪙</td>
        </tr>`;
    })
    .join('');

  return `
    <section class="history">
      <div class="section-head">
        <h2>Historique des parties</h2>
        <span class="muted">${total} partie${total > 1 ? 's' : ''} · série en cours : ${streak} ${h[0].won ? 'victoire' : 'défaite'}${streak > 1 ? 's' : ''} · bilan ${fmtCoins(totalNet)} 🪙</span>
      </div>
      <div class="mode-stats">${modeStats}</div>
      <div class="panel history-table-wrap">
        <table class="history-table">
          <thead><tr><th>Date</th><th>Mode</th><th>Adversaire</th><th>Score</th><th>Résultat</th><th>Pièces</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${h.length > HISTORY_PREVIEW
        ? `<button class="btn btn-ghost history-more" data-action="toggle-history">${historyExpanded ? 'Réduire' : `Voir les ${h.length} parties`}</button>`
        : ''}
    </section>`;
}

/* ---------- ajout de pièces ---------- */
const COIN_AMOUNTS = [100, 500, 1000, 5000];

function openCoinsDialog() {
  coinsDialog.innerHTML = `
    <h2>Ajouter des pièces</h2>
    <p class="muted">Solde actuel : 🪙 ${save.coins.toLocaleString('fr-FR')}</p>
    <div class="coin-options">
      ${COIN_AMOUNTS.map((n) => `<button class="btn btn-gold" data-add-coins="${n}">+ 🪙 ${n.toLocaleString('fr-FR')}</button>`).join('')}
    </div>
    <div class="dialog-actions"><button class="btn btn-ghost" data-close>Fermer</button></div>`;
  coinsDialog.showModal();
}

$('#add-coins-btn').addEventListener('click', openCoinsDialog);

coinsDialog.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t === coinsDialog || t.hasAttribute('data-close')) return coinsDialog.close();
  const btn = t.closest<HTMLElement>('[data-add-coins]');
  if (!btn) return;
  save.coins += Number(btn.dataset.addCoins);
  persist(save);
  render();
  openCoinsDialog(); // rafraîchit le solde affiché
});

/* ---------- compte ---------- */
function openAccountDialog() {
  if (save.profile) {
    accountDialog.innerHTML = `
      <h2>Mon compte</h2>
      <p>Connecté en tant que <b>${esc(save.profile.username)}</b></p>
      <p class="muted">Créé le ${new Date(save.profile.createdAt).toLocaleDateString('fr-FR')}</p>
      <div class="dialog-actions">
        <button class="btn btn-ghost" data-close>Fermer</button>
        <button class="btn btn-ghost danger" id="logout">Se déconnecter</button>
      </div>`;
  } else {
    accountDialog.innerHTML = `
      <h2>Créer son compte</h2>
      <p class="muted">Ton compte et ton équipe sont sauvegardés dans ce navigateur (localStorage).</p>
      <form id="account-form">
        <input id="username" name="username" placeholder="Pseudo" maxlength="20" required autocomplete="off" />
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-close>Annuler</button>
          <button type="submit" class="btn btn-gold">Créer</button>
        </div>
      </form>`;
  }
  accountDialog.showModal();
}

accountBtn.addEventListener('click', openAccountDialog);

accountDialog.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id !== 'account-form') return;
  e.preventDefault();
  const username = (form.elements.namedItem('username') as HTMLInputElement).value.trim();
  if (!username) return;
  save.profile = { username, createdAt: new Date().toISOString() };
  activeTab = 'team';
  accountDialog.close();
  commit();
});

accountDialog.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t === accountDialog || t.hasAttribute('data-close')) accountDialog.close();
  if (t.id === 'logout') {
    save.profile = null;
    accountDialog.close();
    commit();
  }
});

/* ---------- sélecteur de joueur ---------- */
let pickerQuery = '';
let pickerRole: Role | 'ALL' = 'ALL';

function openPicker(slotId: SlotId) {
  pickerSlot = slotId;
  pickerQuery = '';
  pickerRole = 'ALL';
  const slot = SLOTS.find((s) => s.id === slotId)!;
  pickerDialog.innerHTML = `
    <div class="picker-head">
      <h2>Choisir — ${slot.label}</h2>
      <button class="btn btn-ghost" data-close>✕</button>
    </div>
    <div class="picker-filters">
      <input id="picker-search" placeholder="Rechercher un pseudo ou une équipe…" autocomplete="off" />
      <select id="picker-role">
        <option value="ALL">Tous les rôles</option>
        ${(['IGL', 'RIF', 'AWP', 'SUP', 'LRK'] as Role[]).map((r) => `<option value="${r}">${r}</option>`).join('')}
      </select>
    </div>
    <ul class="picker-list" id="picker-list"></ul>`;
  renderPickerList();
  pickerDialog.showModal();
}

function renderPickerList() {
  const slot = SLOTS.find((s) => s.id === pickerSlot)!;
  const used = new Set(
    Object.entries(save.team).filter(([k, v]) => v && k !== slot.id).map(([, v]) => v as string),
  );
  const q = pickerQuery.toLowerCase();
  const list = players
    .filter((p) => isOwned(p.id))
    .filter((p) => !used.has(p.id))
    .filter((p) => pickerRole === 'ALL' || p.role === pickerRole)
    .filter((p) => !q || p.nickname.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
    .sort((a, b) => Number(slot.role && b.role === slot.role) - Number(slot.role && a.role === slot.role) || b.ovr - a.ovr);

  let empty = '';
  if (!save.owned.length) {
    empty = `<li class="picker-empty">Tu n'as encore débloqué aucun joueur.
      <button class="btn btn-gold" data-goto="packs">Ouvrir une caisse</button></li>`;
  } else if (!list.length) {
    empty = '<li class="picker-empty">Aucun joueur ne correspond à ta recherche.</li>';
  }

  $('#picker-list').innerHTML =
    list
      .map((p) => {
        // vert/rouge sur le rôle : bien placé ou non (rien pour le coach)
        const fit = slot.role ? p.role === slot.role : null;
        return `<li><button class="picker-card" data-pick="${esc(p.id)}" title="${esc(p.nickname)}">${cardHTML(p, fit)}</button></li>`;
      })
      .join('') + empty;
}

pickerDialog.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  if (t.id === 'picker-search') pickerQuery = t.value;
  if (t.id === 'picker-role') pickerRole = t.value as Role | 'ALL';
  renderPickerList();
});

pickerDialog.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t === pickerDialog || t.hasAttribute('data-close')) return pickerDialog.close();
  const goto = t.closest<HTMLElement>('[data-goto]');
  if (goto) {
    pickerDialog.close();
    activeTab = goto.dataset.goto!;
    return render();
  }
  const row = t.closest<HTMLElement>('[data-pick]');
  if (row && pickerSlot) {
    save.team[pickerSlot] = row.dataset.pick!;
    pickerDialog.close();
    commit();
  }
});

/* ---------- événements globaux ---------- */
tabsEl.addEventListener('click', (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
  if (!tab || !save.profile) return;
  activeTab = tab.dataset.tab!;
  render();
});

view.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!save.profile) {
    // sans compte, la seule action possible est de créer un compte
    if (target.closest('[data-action="signup"]')) openAccountDialog();
    return;
  }
  const playBtn = target.closest<HTMLButtonElement>('[data-play]');
  if (playBtn) return playBtn.disabled ? undefined : playMatch(playBtn.dataset.play as ModeId);
  const packBtn = target.closest<HTMLElement>('[data-open-pack]');
  if (packBtn) return openPack(packBtn.dataset.openPack!);
  const filter = target.closest<HTMLElement>('[data-filter]');
  if (filter) { collectionFilter = filter.dataset.filter as CollectionFilter; return render(); }
  const goto = target.closest<HTMLElement>('[data-goto]');
  if (goto) { activeTab = goto.dataset.goto!; return render(); }
  const el = target.closest<HTMLElement>('[data-action]');
  if (!el) return;
  const slot = el.dataset.slot as SlotId | undefined;
  switch (el.dataset.action) {
    case 'pick': if (slot) openPicker(slot); break;
    case 'edit-team': openTeamDialog(); break;
    case 'toggle-history': historyExpanded = !historyExpanded; render(); break;
    case 'remove': if (slot) { save.team[slot] = null; commit(); } break;
    case 'reset': save.team = emptyTeam(); commit(); break;
  }
});

render();