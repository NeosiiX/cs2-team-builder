import './style.css';
import playersData from './data/players.json';
import type { Player, SlotId, SlotDef, Role } from './types';
import { SLOTS, emptyTeam } from './types';
import { loadSave, persist } from './storage';
import { computeChemistry, CHEM } from './chemistry';
import { PACKS, RARITY_LABEL, DUPLICATE_REFUND, rollPlayer } from './packs';
import type { PackDef } from './packs';

const players = playersData as unknown as Player[];
const byId = new Map(players.map((p) => [p.id, p]));

let save = loadSave();
let activeTab = 'team';
let pickerSlot: SlotId | null = null;

const TABS = [
  { id: 'team', label: 'My team', ready: true },
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
    </div>`;
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
function renderCollection() {
  const mine = players.filter((p) => isOwned(p.id)).sort((a, b) => b.ovr - a.ovr);
  const header = `
    <div class="section-head">
      <h2>Ma collection</h2>
      <span class="muted">${mine.length} / ${players.length} joueurs débloqués</span>
    </div>`;
  if (!mine.length) {
    view.innerHTML = `${header}
      <div class="panel placeholder">
        <p>Tu n'as encore aucun joueur.</p>
        <button class="btn btn-gold" data-goto="packs" style="margin-top:16px">Ouvrir une caisse</button>
      </div>`;
    return;
  }
  view.innerHTML = `${header}<div class="card-grid">${mine.map((p) => cardHTML(p, null)).join('')}</div>`;
}

/* ---------- onglet Caisses ---------- */
const RARITIES = ['legend', 'gold', 'silver'] as const;

function packCardHTML(pack: PackDef): string {
  const can = save.coins >= pack.price;
  const odds = RARITIES.map(
    (r) => `
      <div class="odds-row ${r}">
        <span class="odds-label">${RARITY_LABEL[r]}</span>
        <div class="odds-bar"><div style="width:${pack.odds[r]}%"></div></div>
        <b>${pack.odds[r]}%</b>
      </div>`,
  ).join('');
  return `
    <article class="panel pack" style="--accent:${pack.accent}">
      <div class="pack-crate">📦</div>
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
      <span class="muted">Un joueur déjà possédé est revendu : 🪙 ${DUPLICATE_REFUND.silver} / ${DUPLICATE_REFUND.gold} / ${DUPLICATE_REFUND.legend} (Silver / Gold / Légende)</span>
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

function render() {
  renderTabs();
  renderAccountBtn();
  renderCoins();
  if (activeTab === 'team') renderTeam();
  else if (activeTab === 'collection') renderCollection();
  else if (activeTab === 'packs') renderPacks();
  else renderPlaceholder(TABS.find((t) => t.id === activeTab)!.label);
}

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
  if (!tab) return;
  activeTab = tab.dataset.tab!;
  render();
});

view.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const packBtn = target.closest<HTMLElement>('[data-open-pack]');
  if (packBtn) return openPack(packBtn.dataset.openPack!);
  const goto = target.closest<HTMLElement>('[data-goto]');
  if (goto) { activeTab = goto.dataset.goto!; return render(); }
  const el = target.closest<HTMLElement>('[data-action]');
  if (!el) return;
  const slot = el.dataset.slot as SlotId | undefined;
  switch (el.dataset.action) {
    case 'pick': if (slot) openPicker(slot); break;
    case 'remove': if (slot) { save.team[slot] = null; commit(); } break;
    case 'reset': save.team = emptyTeam(); commit(); break;
  }
});

render();