/**
 * "Player: Jon#7Q2M" dialog (PLAN-v3 0.6.0). The name is saved locally first (the legacy `jd.player` fallback keeps
 * working offline), then claimed with our server over the device key; the server's normalised name and tag are
 * cached. Two side doors: show your key (the device token in base32 groups) and use a key from another device.
 */
import type Phaser from 'phaser';
import { dialog, alertText, promptText } from './dom';
import { loadIdentity, localTag, claimName, recoveryCode, restoreIdentity, fetchClaimed, bearerAllowed } from '../render/identity';
import { loadPlayer, savePlayer } from '../render/storage';
import { labelFor, NAME_MAX } from '../identity/identity';
import { t } from '../content/strings';

/** The label for the title button: claimed name#tag, the local name, or the invitation. */
export function playerLabel(): string {
  const id = loadIdentity();
  if (id.name && id.tag) return t('identity.button', { label: labelFor(id.name, id.tag) });
  const local = loadPlayer();
  return local ? t('identity.button', { label: local }) : t('identity.set');
}

/** Save the name locally and claim it with our server; resolves with a one-line outcome for the caller's status. */
export async function applyName(verifierUrl: string, typed: string): Promise<string> {
  const name = typed.trim().slice(0, NAME_MAX);
  savePlayer(name);
  if (!name) return t('identity.cleared');
  if (!bearerAllowed(verifierUrl)) return t('identity.insecure');
  const r = await claimName(verifierUrl, name);
  if (r === null) return t('identity.noAnswer');
  if ('error' in r) return t('identity.refused', { error: r.error });
  return t('identity.claimed', { label: labelFor(r.name, r.tag) });
}

export async function identityDialog(scene: Phaser.Scene, verifierUrl: string, onDone: (note: string | null) => void): Promise<void> {
  const id = loadIdentity();
  const tag = id.tag ?? (await localTag());
  const current = id.name ?? loadPlayer();
  const typed = await dialog(scene, {
    title: id.name ? t('identity.button', { label: labelFor(id.name, tag) }) : t('identity.dialogTitle'),
    label: t('identity.dialogLabel', { tag, max: NAME_MAX }),
    value: current || 'player',
    maxLength: NAME_MAX,
    ok: t('identity.save'),
    extra: [
      {
        label: t('identity.showKey'),
        tid: 'dialog-recovery',
        onClick: () => {
          void dialog(scene, {
            title: t('identity.keyTitle'),
            label: t('identity.keyLabel'),
            value: recoveryCode(),
            readonly: true,
            multiline: true,
            cancel: null,
            ok: t('common.closeShort'),
          }).then(() => onDone(null));
        },
      },
      {
        label: t('identity.useKey'),
        tid: 'dialog-restore',
        onClick: () => {
          void promptText(scene, t('identity.useKey'), t('identity.useKeyLabel'), '').then(async (code) => {
            if (code === null) return onDone(null);
            if (!restoreIdentity(code)) {
              await alertText(scene, t('identity.restoreTitle'), t('identity.badKey'));
              return onDone(null);
            }
            const claimed = bearerAllowed(verifierUrl) ? await fetchClaimed(verifierUrl) : null;
            if (claimed) savePlayer(claimed.name);
            onDone(claimed ? t('identity.restored', { label: labelFor(claimed.name, claimed.tag) }) : t('identity.restoredPending'));
          });
        },
      },
    ],
  });
  if (typed === null) return onDone(null);
  onDone(await applyName(verifierUrl, typed));
}
