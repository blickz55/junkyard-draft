/**
 * Crews panel (PLAN-v4 0.7.2; "groups" in the code, "crews" to the player since 0.9.0): my crews with their codes, a
 * "Use for boards" choice (Everyone or one crew), create by name, join by code, leave. A modal layer like the archive
 * panel. The code is the whole invitation: share it.
 */
import type Phaser from 'phaser';
import { h, btn, ui } from './dom';
import { createGroup, fetchGroups, joinGroup, leaveGroup, loadGroup, saveGroup, type GroupInfo } from '../render/groups';
import { NAME_MAX } from '../identity/identity';
import { t } from '../content/strings';
import { foremanSays, foremanName } from '../content/foreman';
import { firstTime } from '../render/storage';

export function openGroups(scene: Phaser.Scene, verifierUrl: string, onChange: () => void): void {
  const prev = document.activeElement as HTMLElement | null;
  let changed = false;
  const close = () => { layer.remove(); prev?.focus?.(); if (changed) onChange(); };
  const list = h('div', { tid: 'group-list', class: 'jd-mono', style: 'font-size:0.8em; display:flex; flex-direction:column; gap:0.4em' }, h('div', { class: 'jd-dim' }, t('crews.loading')));
  const status = h('div', { class: 'jd-mono jd-dim', tid: 'group-status', style: 'font-size:0.75em; min-height:1.2em' }, '');
  const say = (text: string, bad = false) => { status.textContent = text; status.className = `jd-mono ${bad ? 'jd-red' : 'jd-dim'}`; };
  const nameIn = h('input', { type: 'text', tid: 'group-name', ariaLabel: t('crews.namePlaceholder') }); nameIn.placeholder = t('crews.namePlaceholder'); nameIn.maxLength = NAME_MAX;
  const codeIn = h('input', { type: 'text', tid: 'group-join-code', ariaLabel: t('crews.codeAria') }); codeIn.placeholder = t('crews.codePlaceholder'); codeIn.maxLength = 8;
  const render = (groups: GroupInfo[] | null) => {
    list.replaceChildren();
    const sel = loadGroup();
    const everyone = h('div', { class: 'jd-row jd-between' }, h('span', {}, `${t('crews.everyone')}${sel ? '' : t('crews.inUse')}`), sel ? btn(t('crews.use'), 'group-use-everyone', () => { saveGroup(null); changed = true; render(groups); }, { small: true }) : null);
    list.append(everyone);
    if (groups === null) { list.append(h('div', { class: 'jd-red' }, t('crews.offline'))); return; }
    if (!groups.length) list.append(h('div', { class: 'jd-dim' }, t('crews.none')));
    for (const g of groups) {
      const inUse = sel?.code === g.code;
      const row = h('div', { class: 'jd-row jd-between', tid: 'group-row' },
        h('span', {}, t('crews.row', { name: g.name }), h('span', { class: 'jd-amber', tid: 'group-code', title: t('crews.codeTitle') }, g.code), t('crews.rowTail', { n: g.members, yours: g.creator ? t('crews.yours') : '', inUse: inUse ? t('crews.inUse') : '' })),
        h('span', { class: 'jd-row', style: 'gap:0.4em' },
          inUse ? null : btn(t('crews.use'), 'group-use', () => { saveGroup({ code: g.code, name: g.name }); changed = true; render(groups); }, { small: true }),
          btn(t('crews.leave'), 'group-leave', () => { void leaveGroup(verifierUrl, g.code).then((r) => { if (r && r.ok) { if (sel?.code === g.code) saveGroup(null); changed = true; say(t('crews.left', { name: g.name })); void refresh(); } else say(r ? r.error : t('crews.serverDown'), true); }); }, { small: true })));
      row.dataset.code = g.code;
      list.append(row);
    }
  };
  const refresh = async () => render(await fetchGroups(verifierUrl));
  const box = h('div', { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: t('crews.aria'), tid: 'groups-dialog' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, t('crews.head')), btn(t('common.close'), 'groups-close', close, { small: true })),
    h('div', { class: 'jd-dim jd-dialog-label' }, t('crews.intro', { groups: 5, members: 50 })),
    list,
    h('div', { class: 'jd-row', style: 'gap:0.5em; margin-top:0.4em' }, nameIn, btn(t('crews.create'), 'group-create', () => { void createGroup(verifierUrl, nameIn.value).then((r) => { if (r && r.ok) { nameIn.value = ''; say(t('crews.created', { name: r.group.name, code: r.group.code })); changed = true; void refresh(); if (firstTime('crew')) { const line = foremanSays('firstCrew'); if (line) say(`${foremanName()}: ${line}`); } } else say(r ? r.error : t('crews.serverDown'), true); }); }, { small: true, variant: 'primary' })),
    h('div', { class: 'jd-row', style: 'gap:0.5em' }, codeIn, btn(t('crews.join'), 'group-join', () => { void joinGroup(verifierUrl, codeIn.value).then((r) => { if (r && r.ok) { codeIn.value = ''; say(t('crews.joined', { name: r.group.name })); changed = true; void refresh(); if (firstTime('crew')) { const line = foremanSays('firstCrew'); if (line) say(`${foremanName()}: ${line}`); } } else say(r ? r.error : t('crews.serverDown'), true); }); }, { small: true })),
    status);
  const layer = h('div', { class: 'jd-modal', onClick: (e) => { if (e.target === layer) close(); } }, box);
  layer.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } });
  ui.layer(scene, layer);
  nameIn.focus();
  void refresh();
}
