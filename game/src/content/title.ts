/** A title beside a name (0.11.12): "Ann#8KH4 · Regular". A title this client does not know yet says nothing, so a newer server cannot break it. */
import { hasText, t } from './strings';

/** An id names a string: `title-old-hand` is `look.titleOldHand`. */
export const lookKey = (id: string) => `look.${id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`;

/** What a thing from the paint shop is called; empty for one this client does not know. */
export function lookName(id: string | null | undefined): string {
  const key = id ? lookKey(id) : '';
  return hasText(key) ? t(key) : '';
}
export function withTitle(player: string, id: string | null | undefined): string {
  const title = lookName(id);
  return title ? t('look.withTitle', { player, title }) : player;
}
