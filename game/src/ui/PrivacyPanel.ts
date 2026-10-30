/**
 * "Privacy & data" panel (production roadmap 0.8.6, the legal minimum). Renders game/public/legal.json, which
 * tools/make-policy.ts generates from tools/legal-lib.ts (privacy notice, terms of play, community guidelines; the same
 * texts are served as pages under legal/), bundled at build time like the fairness policy so it works in the packaged app
 * and offline. Below the texts, the two data rights the notice promises as buttons: "Download my data" (GET /me/export,
 * saved as a JSON file) and "Delete my data" (DELETE /me after a confirmation, then the device key is replaced and the
 * local name, group and statistics state are cleared). Opened from the title (next to the statistics switch) and from the
 * results screen. A modal layer like the policy panel.
 */
import type Phaser from 'phaser';
import { h, btn, ui, dialog } from './dom';
import legal from '../../public/legal.json';
import { loadIdentity, exportMyData, deleteMyData, bearerAllowed } from '../render/identity';
import { savePlayer } from '../render/storage';
import { saveGroup } from '../render/groups';
import { telemetry } from '../render/telemetry';
import { labelFor } from '../identity/identity';

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
    for (const t of tabs) t.classList.toggle('jd-btn-dark', t.dataset.testid !== `legal-tab-${d.id}`); // the active tab in the amber base style
    body.replaceChildren(
      h('div', { class: 'jd-mono jd-dim', tid: 'legal-meta', style: 'font-size:0.8em' }, `${d.title} · last changed ${legal.updated} · ${legal.operator.product} is run by ${legal.operator.holder}`),
      h('div', { tid: 'legal-summary', style: 'border-left:3px solid currentColor; padding-left:0.7em' }, d.summary),
      ...d.sections.map((s) => h('div', {},
        h('div', { class: 'jd-head', style: 'margin-bottom:0.2em' }, s.title),
        ...s.items.map((p) => h('div', { class: 'jd-dim', style: 'font-size:0.9em; margin-top:0.25em' }, p)))),
      h('div', { class: 'jd-mono jd-dim', style: 'font-size:0.7em' }, `Also at legal/${d.id}.html next to the game. Contact ${legal.operator.contactEmail}; moderation appeals ${legal.operator.appealEmail}.`));
    body.scrollTop = 0;
  };
  render();

  // ---- your data: the two rights as buttons ----
  const id = loadIdentity();
  const who = id.name && id.tag ? `You are ${labelFor(id.name, id.tag)} to the verifier` : 'This device has a key but no claimed name';
  const status = h('div', { class: 'jd-mono jd-dim', tid: 'data-status', style: 'font-size:0.75em; min-height:1.2em' }, bearerAllowed(verifierUrl) ? `${who}; the verifier is ${verifierUrl}.` : `${who}; the verifier at ${verifierUrl} is not https, so the key is never sent to it and there is nothing to download or delete there.`);
  const canTalk = bearerAllowed(verifierUrl);
  const exportBtn = btn('Download my data', 'data-export', () => {
    exportBtn.disabled = true; status.textContent = 'Asking the verifier for everything stored under your player id…';
    void exportMyData(verifierUrl).then((r) => {
      exportBtn.disabled = false;
      if (!r.ok) { status.textContent = `Download failed: ${r.error}.`; status.classList.add('jd-red'); return; }
      status.classList.remove('jd-red');
      const text = JSON.stringify(r.data, null, 2);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = `junkyard-draft-my-data-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      status.textContent = `Saved ${a.download}: ${r.entries} ${r.entries === 1 ? 'entry' : 'entries'}, ${r.replays} with a stored replay, plus your name, groups and moderation record.`;
    });
  }, { small: true, disabled: !canTalk, title: 'GET /me/export with this device\'s key, saved as a JSON file' });
  const deleteBtn = btn('Delete my data', 'data-delete', () => {
    void dialog(scene, { title: 'Delete my data', label: 'The verifier removes your name, anonymises your entries as "deleted" (the scores stay, nothing links them to you), drops their replays and ends your group memberships. This device then gets a new key, forgets the name and the group code, and turns play statistics off. Local best scores and settings stay on this device. This cannot be undone.', value: '', readonly: true, ok: 'Delete everything', cancel: 'Keep my data' }).then(async (confirmed) => {
      if (confirmed === null) return;
      deleteBtn.disabled = true; exportBtn.disabled = true; status.textContent = 'Deleting…';
      const r = await deleteMyData(verifierUrl);
      if (!r.ok) { deleteBtn.disabled = false; exportBtn.disabled = !canTalk; status.textContent = `Deletion failed: ${r.error}.`; status.classList.add('jd-red'); return; }
      savePlayer(''); saveGroup(null); if (telemetry.enabled) telemetry.setEnabled(false);
      status.classList.remove('jd-red'); status.textContent = `Deleted. ${r.anonymisedEntries} ${r.anonymisedEntries === 1 ? 'entry' : 'entries'} anonymised, ${r.coldReplaysDropped} archived ${r.coldReplaysDropped === 1 ? 'replay' : 'replays'} dropped; this device has a new key and no name. Backups age out within ${legalBackupDays()} days.`;
      status.dataset.deleted = '1';
      onChanged?.();
    });
  }, { small: true, disabled: !canTalk, title: 'DELETE /me with this device\'s key, then a new key' });
  const data = h('div', { class: 'jd-panel', tid: 'data-rights', style: 'display:flex; flex-direction:column; gap:0.4em; padding:0.5em 0.7em' },
    h('div', { class: 'jd-head' }, 'Your data'),
    status,
    h('div', { class: 'jd-row', style: 'gap:0.5em' }, exportBtn, deleteBtn));

  const box = h('div', { class: 'jd-dialog jd-panel', role: 'dialog', ariaLabel: 'Privacy and data', tid: 'privacy-dialog', style: 'width:min(92%, 46em)' },
    h('div', { class: 'jd-row jd-between' }, h('div', { class: 'jd-head' }, 'Privacy & data'), btn('Close (Esc)', 'privacy-close', close, { small: true })),
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
  const m = DOCS.find((d) => d.id === 'privacy')?.sections.flatMap((s) => s.items).join(' ').match(/kept for (\d+) days/);
  return m ? Number(m[1]) : 14;
}
