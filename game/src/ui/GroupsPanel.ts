/**
 * Groups panel (PLAN-v4 0.7.2): my groups with their codes, a "Use for boards" choice (Everyone or one group), create
 * by name, join by code, leave. A modal layer like the archive panel. The code is the whole invitation: share it.
 */
import type Phaser from 'phaser';
import { h, btn, ui } from './dom';
import { createGroup, fetchGroups, joinGroup, leaveGroup, loadGroup, saveGroup, type GroupInfo } from '../render/groups';
import { NAME_MAX } from '../identity/identity';

export function openGroups(scene: Phaser.Scene, verifierUrl: string, onChange: () => void): void {
  const prev = document.activeElement as HTMLElement | null;
  let changed = false;
  const close = () => { layer.remove(); prev?.focus?.(); if (changed) onChange(); };
  const list = h('div', { tid: 'group-list', class: 'jd-mono', style: 'font-size:0.8em; display:flex; flex-direction:column; gap:0.4em' }, h('div', { class: 'jd-dim' }, 'Loading your groups…'));
  const status = h('div', { class: 'jd-mono jd-dim', tid: 'group-status', style: 'font-size:0.75em; min-height:1.2em' }, '');
  const say = (t: string, bad = false) => { status.textContent = t; status.className = `jd-mono ${bad ? 'jd-red' : 'jd-dim'}`; };
  const nameIn = h('input', { type: 'text', tid: 'group-name', ariaLabel: 'new group name' }); nameIn.placeholder = 'new group name'; nameIn.maxLength = NAME_MAX;
  const codeIn = h('input', { type: 'text', tid: 'group-join-code', ariaLabel: 'group code to join' }); codeIn.placeholder = 'code to join (8 characters)'; codeIn.maxLength = 8;
  const render = (groups: GroupInfo[] | null) => {
    list.replaceChildren();
    const sel = loadGroup();
    const everyone = h('div', { class: 'jd-row jd-between' }, h('span', {}, `Everyone${sel ? '' : ' · in use'}`), sel ? btn('Use for boards', 'group-use-everyone', () => { saveGroup(null); changed = true; render(groups); }, { small: true }) : null);
    list.append(everyone);
    if (groups === null) { list.append(h('div', { class: 'jd-red' }, 'Verifier unreachable or no identity yet: groups live on the verifier.')); return; }
    if (!groups.length) list.append(h('div', { class: 'jd-dim' }, 'No groups yet. Create one and share its code, or join with a code someone gave you.'));
    for (const g of groups) {
      const inUse = sel?.code === g.code;
      const row = h('div', { class: 'jd-row jd-between', tid: 'group-row' },
        h('span', {}, `${g.name} · code `, h('span', { class: 'jd-amber', tid: 'group-code', title: 'share this code; anyone with it can join' }, g.code), ` · ${g.members} member${g.members === 1 ? '' : 's'}${g.creator ? ' · yours' : ''}${inUse ? ' · in use' : ''}`),
        h('span', { class: 'jd-row', style: 'gap:0.4em' },
          inUse ? null : btn('Use for boards', 'group-use', () => { saveGroup({ code: g.code, name: g.name }); changed = true; render(groups); }, { small: true }),
          btn('Leave', 'group-leave', () => { void leaveGroup(verifierUrl, g.code).then((r) => { if (r && r.ok) { if (sel?.code === g.code) saveGroup(null); changed = true; say(`Left ${g.name}.`); void refresh(); } else say(r ? r.error : 'verifier unreachable', true); }); }, { small: true })));
      row.dataset.code = g.code;
      list.append(row);
    }
  };
  const refresh = async () => render(await fetchGroups(verifierUrl));
  const box = h('div', { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: 'Groups', tid: 'groups-dialog' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, 'Groups — a code that scopes the board'), btn('Close (Esc)', 'groups-close', close, { small: true })),
    h('div', { class: 'jd-dim jd-dialog-label' }, 'A group is a code. Share it and the boards, histograms and the daily strip can show only its members’ verified runs, with ranks and percentiles recomputed over the group. Up to 5 groups per player, 50 members per group. No chat.'),
    list,
    h('div', { class: 'jd-row', style: 'gap:0.5em; margin-top:0.4em' }, nameIn, btn('Create', 'group-create', () => { void createGroup(verifierUrl, nameIn.value).then((r) => { if (r && r.ok) { nameIn.value = ''; say(`Created ${r.group.name}: share the code ${r.group.code}.`); changed = true; void refresh(); } else say(r ? r.error : 'verifier unreachable', true); }); }, { small: true, variant: 'primary' })),
    h('div', { class: 'jd-row', style: 'gap:0.5em' }, codeIn, btn('Join', 'group-join', () => { void joinGroup(verifierUrl, codeIn.value).then((r) => { if (r && r.ok) { codeIn.value = ''; say(`Joined ${r.group.name}.`); changed = true; void refresh(); } else say(r ? r.error : 'verifier unreachable', true); }); }, { small: true })),
    status);
  const layer = h('div', { class: 'jd-modal', onClick: (e) => { if (e.target === layer) close(); } }, box);
  layer.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } });
  ui.layer(scene, layer);
  nameIn.focus();
  void refresh();
}
