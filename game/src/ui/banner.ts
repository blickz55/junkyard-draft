/**
 * Page-level banner (production roadmap 0.8.0): one line the player must see whatever scene is up, outside the Phaser
 * overlay so it survives scene changes. Used for storage failure ("progress is not being saved"). Idempotent per id;
 * styles go through the CSSOM so the strict Content-Security-Policy needs no inline-style exception for it.
 */
export function showBanner(id: string, text: string, opts: { tone?: 'warn' | 'info' } = {}): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`[data-testid="banner-${id}"]`);
  if (existing) { existing.querySelector('[data-role=text]')!.textContent = text; return existing; }
  const el = document.createElement('div');
  el.dataset.testid = `banner-${id}`;
  el.setAttribute('role', 'status');
  el.style.cssText = `position:fixed; left:50%; top:0.5rem; transform:translateX(-50%); z-index:50; max-width:min(92vw, 44rem); display:flex; gap:0.75rem; align-items:center; padding:0.5rem 0.75rem 0.5rem 0.9rem; border-radius:0.3rem; font: 600 14px/1.35 Inter, "Segoe UI", system-ui, sans-serif; color:#f4ede0; background:rgba(36,32,26,0.96); border:1px solid ${opts.tone === 'info' ? '#5a6670' : '#f0a830'}; box-shadow:0 2px 10px rgba(0,0,0,0.45); pointer-events:auto;`;
  const span = document.createElement('span'); span.dataset.role = 'text'; span.textContent = text;
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'OK'; close.setAttribute('aria-label', 'Dismiss'); close.dataset.testid = `banner-${id}-dismiss`;
  close.style.cssText = 'font:inherit; font-weight:700; padding:0.25rem 0.7rem; border-radius:0.2rem; border:2px solid rgba(0,0,0,0.35); background:#f0a830; color:#1a1612; cursor:pointer;';
  close.addEventListener('click', () => el.remove());
  el.append(span, close);
  document.body.append(el);
  return el;
}
