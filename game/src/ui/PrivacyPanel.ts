/**
 * "Privacy & data" panel (production roadmap 0.8.6, the legal minimum). Renders game/public/legal.json, which
 * tools/make-policy.ts generates from tools/legal-lib.ts (privacy notice, terms of play, community guidelines; the same
 * texts are served as pages under legal/), bundled at build time like the fairness policy so it works in the packaged app
 * and offline. Below the texts, the two data rights the notice promises as buttons: "Download my data" (GET /me/export,
 * saved as a JSON file) and "Delete my data" (DELETE /me after a confirmation, then the device key is replaced and the
 * local name, group and statistics state are cleared). Opened from the title (next to the statistics switch) and from the
 * results screen. A modal layer like the policy panel. The legal documents are exact texts outside the string table.
 */
import type Phaser from 'phaser';
import { h, btn, ui, dialog } from './dom';
import legal from '../../public/legal.json';
import { loadIdentity, exportMyData, deleteMyData, bearerAllowed } from '../render/identity';
import { savePlayer } from '../render/storage';
import { saveGroup } from '../render/groups';
import { telemetry } from '../render/telemetry';
import { labelFor } from '../identity/identity';
import { t } from '../content/strings';

type LegalId = 'privacy' | 'terms' | 'guidelines';
interface LegalDoc { id: string; title: string; summary: string; sections: { title: string; items: string[] }[] }
const DOCS = legal.docs as LegalDoc[];

export function openPrivacy(scene: Phaser.Scene, verifierUrl: string, tab: LegalId = 'privacy', onChanged?: () => void): void {
  const prev = document.activeElement as HTMLElement | null;
  const close = () => { layer.remove(); prev?.focus?.(); };
  let current: LegalId = tab;
  const tabs = DOCS.map((d) => btn(d.title, `legal-tab-${d.id}`, () => { current = d.id as LegalId; render(); }, { small: true }));
  const body = h('div', { tid: 'legal-body', style: 'max-height:42vh; overflow:auto; font-size:0.875em; display:flex; flex-direction:column; gap:0.6em' });
  const render = () => {
    const d = DOCS.find((x) => x.id === current) ?? DOCS[0];
    for (const tabBtn of tabs) tabBtn.classList.toggle('jd-btn-dark', tabBtn.dataset.testid !== `legal-tab-${d.id}`); // the active tab in the amber base style
    body.replaceChildren(
      h('div', { class: 'jd-mono jd-dim', tid: 'legal-meta', style: 'font-size:0.8em' }, t('privacy.meta', { title: d.title, date: legal.updated, product: legal.operator.product, holder: legal.operator.holder })),
      h('div', { tid: 'legal-summary', style: 'border-left:3px solid currentColor; padding-left:0.7em' }, d.summary),
      ...d.sections.map((sec) => h('div', {},
        h('div', { class: 'jd-head', style: 'margin-bottom:0.2em' }, sec.title),
        ...sec.items.map((p) => h('div', { class: 'jd-dim', style: 'font-size:0.9em; margin-top:0.25em' }, p)))),
      h('div', { class: 'jd-mono jd-dim', style: 'font-size:0.7em' }, t('privacy.also', { id: d.id, contact: legal.operator.contactEmail, appeal: legal.operator.appealEmail })));
    body.scrollTop = 0;
  };
  render();

  // ---- your data: the two rights as buttons ----
  const id = loadIdentity();
  const who = id.name && id.tag ? t('privacy.whoNamed', { label: labelFor(id.name, id.tag) }) : t('privacy.whoAnon');
  const canTalk = bearerAllowed(verifierUrl);
  const status = h('div', { class: 'jd-mono jd-dim', tid: 'data-status', style: 'font-size:0.75em; min-height:1.2em' }, canTalk ? t('privacy.statusOk', { who, url: verifierUrl }) : t('privacy.statusInsecure', { who, url: verifierUrl }));
  const exportBtn = btn(t('privacy.export'), 'data-export', () => {
    exportBtn.disabled = true; status.textContent = t('privacy.asking');
    void exportMyData(verifierUrl).then((r) => {
      exportBtn.disabled = false;
      if (!r.ok) { status.textContent = t('privacy.downloadFailed', { error: r.error }); status.classList.add('jd-red'); return; }
      status.classList.remove('jd-red');
      const text = JSON.stringify(r.data, null, 2);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = `junkyard-draft-my-data-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      status.textContent = t('privacy.saved', { file: a.download, n: r.entries, r: r.replays });
    });
  }, { small: true, disabled: !canTalk, title: t('privacy.exportTitle') });
  const deleteBtn = btn(t('privacy.delete'), 'data-delete', () => {
    void dialog(scene, { title: t('privacy.delete'), label: t('privacy.deleteLabel'), value: '', readonly: true, ok: t('privacy.deleteOk'), cancel: t('privacy.deleteCancel') }).then(async (confirmed) => {
      if (confirmed === null) return;
      deleteBtn.disabled = true; exportBtn.disabled = true; status.textContent = t('privacy.deleting');
      const r = await deleteMyData(verifierUrl);
      if (!r.ok) { deleteBtn.disabled = false; exportBtn.disabled = !canTalk; status.textContent = t('privacy.deleteFailed', { error: r.error }); status.classList.add('jd-red'); return; }
      savePlayer(''); saveGroup(null); if (telemetry.enabled) telemetry.setEnabled(false);
      status.classList.remove('jd-red'); status.textContent = t('privacy.deleted', { n: r.anonymisedEntries, r: r.coldReplaysDropped, days: legalBackupDays() });
      status.dataset.deleted = '1';
      onChanged?.();
    });
  }, { small: true, disabled: !canTalk, title: t('privacy.deleteTitle') });
  const data = h('div', { class: 'jd-panel', tid: 'data-rights', style: 'display:flex; flex-direction:column; gap:0.4em; padding:0.5em 0.7em' },
    h('div', { class: 'jd-head' }, t('privacy.yourData')),
    status,
    h('div', { class: 'jd-row', style: 'gap:0.5em' }, exportBtn, deleteBtn));

  const box = h('div', { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: t('privacy.aria'), tid: 'privacy-dialog', style: 'width:min(92%, 46em)' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, t('privacy.head')), btn(t('common.close'), 'privacy-close', close, { small: true })),
    h('div', { class: 'jd-row', style: 'gap:0.4em; flex-wrap:wrap' }, ...tabs),
    body,
    data);
  const layer = h('div', { class: 'jd-modal', onClick: (e) => { if (e.target === layer) close(); } }, box);
  layer.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } });
  ui.layer(scene, layer);
  (box.querySelector('[data-testid=privacy-close]') as HTMLElement | null)?.focus();
}

/** The backup retention the privacy notice states, read from its own text so the two never disagree (the notice is generated from OPERATOR.backupKeepDays). */
function legalBackupDays(): number {
  const m = DOCS.find((d) => d.id === 'privacy')?.sections.flatMap((sec) => sec.items).join(' ').match(/kept for (\d+) days/);
  return m ? Number(m[1]) : 14;
}
