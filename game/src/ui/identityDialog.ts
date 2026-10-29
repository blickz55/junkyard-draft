/**
 * "Player: Jon#7Q2M" dialog (PLAN-v3 0.6.0). The name is saved locally first (the legacy `jd.player` fallback keeps
 * working offline), then claimed with the verifier over the bearer token; the verifier's normalised name and tag are
 * cached. Two side doors: show the recovery code (the device token in base32 groups) and restore a player from one.
 */
import type Phaser from 'phaser';
import { dialog, alertText, promptText } from './dom';
import { loadIdentity, localTag, claimName, recoveryCode, restoreIdentity, fetchClaimed, bearerAllowed } from '../render/identity';
import { loadPlayer, savePlayer } from '../render/storage';
import { labelFor, NAME_MAX } from '../identity/identity';

/** The label for the title button: claimed name#tag, the local name, or the invitation. */
export function playerLabel(): string {
  const id = loadIdentity();
  if (id.name && id.tag) return `Player: ${labelFor(id.name, id.tag)}`;
  const local = loadPlayer();
  return local ? `Player: ${local}` : 'Set player name…';
}

/** Save the name locally and claim it with the verifier; resolves with a one-line outcome for the caller's status. */
export async function applyName(verifierUrl: string, typed: string): Promise<string> {
  const name = typed.trim().slice(0, NAME_MAX);
  savePlayer(name);
  if (!name) return 'Name cleared locally.';
  if (!bearerAllowed(verifierUrl)) return `Saved locally; the verifier at ${verifierUrl} is not https, so the name was not claimed.`;
  const r = await claimName(verifierUrl, name);
  if (r === null) return 'Saved locally; the verifier did not answer, so the name is not claimed yet (it will be on your next submission).';
  if ('error' in r) return `Verifier refused the name: ${r.error}. Kept locally only.`;
  return `Claimed as ${labelFor(r.name, r.tag)}.`;
}

export async function identityDialog(scene: Phaser.Scene, verifierUrl: string, onDone: (note: string | null) => void): Promise<void> {
  const id = loadIdentity();
  const tag = id.tag ?? (await localTag());
  const current = id.name ?? loadPlayer();
  const typed = await dialog(scene, {
    title: id.name ? `Player: ${labelFor(id.name, tag)}` : 'Player name',
    label: `Shown on verified boards as Name#${tag} (the tag comes from this device's key; max ${NAME_MAX} characters, leave empty to clear). One best entry per player per seed. Keep the recovery code private: it is this player.`,
    value: current || 'player', maxLength: NAME_MAX, ok: 'Save',
    extra: [
      { label: 'Show recovery code', tid: 'dialog-recovery', onClick: () => { void dialog(scene, { title: 'Recovery code', label: 'Anyone with this code can play as you; store it privately. Enter it on another device with "Restore from code".', value: recoveryCode(), readonly: true, multiline: true, cancel: null, ok: 'Close' }).then(() => onDone(null)); } },
      { label: 'Restore from code', tid: 'dialog-restore', onClick: () => { void promptText(scene, 'Restore from code', 'Paste the recovery code from your other device (this replaces the player on this device):', '').then(async (code) => {
        if (code === null) return onDone(null);
        if (!restoreIdentity(code)) { await alertText(scene, 'Restore', 'That is not a valid recovery code.'); return onDone(null); }
        const claimed = bearerAllowed(verifierUrl) ? await fetchClaimed(verifierUrl) : null;
        if (claimed) savePlayer(claimed.name);
        onDone(claimed ? `Restored ${labelFor(claimed.name, claimed.tag)}.` : 'Restored the player key; the claimed name will show once the verifier is reachable.');
      }); } },
    ],
  });
  if (typed === null) return onDone(null);
  onDone(await applyName(verifierUrl, typed));
}
