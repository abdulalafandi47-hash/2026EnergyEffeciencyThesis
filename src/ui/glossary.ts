/**
 * Short explanations of the quantities on screen, shown by a small "?" button
 * next to each. One wording for the whole program (wall and building), kept in
 * line with docs/equations-and-assumptions.md and docs/building-envelope.md.
 */
import { h } from './dom';

export type GlossaryTerm = 'u-value' | 'r-value' | 'heat-flow' | 'heat-flux' | 'r-si' | 'r-se';

export const GLOSSARY: Record<GlossaryTerm, { title: string; text: string }> = {
  'u-value': {
    title: 'U-value (thermal transmittance), W/(m²·K)',
    text: 'How much heat passes through 1 m² of an element for each kelvin of temperature difference between the air on its two sides, surface resistances included. Lower is better insulation. U = 1 / R_total.',
  },
  'r-value': {
    title: 'R-value (thermal resistance), m²·K/W',
    text: 'How strongly something resists heat flow. One homogeneous layer: R = d / λ (thickness ÷ conductivity). Resistances in series add up; R_total also includes the two surface resistances. Higher is better insulation.',
  },
  'heat-flow': {
    title: 'Heat flow Q̇ (heat-transfer rate), W',
    text: 'The heat passing through the whole element every second: Q̇ = U · A · ΔT. In the building totals a positive value means heat leaving the conditioned zone and a negative value heat entering it. Steady state: constant temperatures.',
  },
  'heat-flux': {
    title: 'Heat flux q, W/m²',
    text: 'Heat flow per square metre: q = Q̇ / A = U · ΔT. In steady state the same flux crosses every layer of the element. Useful for comparing elements of different sizes.',
  },
  'r-si': {
    title: 'Internal surface resistance R_si, m²·K/W',
    text: 'The resistance of the thin layer of indoor air at the inside surface (convection and radiation). It depends on the direction of heat flow: presets 0.13 (horizontal), 0.10 (upwards), 0.17 (downwards). Not yet checked against ISO 6946.',
  },
  'r-se': {
    title: 'External surface resistance R_se, m²·K/W',
    text: 'The resistance of the air film at the outside surface, smaller because of wind: preset 0.04. Next to an unconditioned (indoor) space this program uses the internal value on both sides. Not yet checked against ISO 6946.',
  },
};

let popover: HTMLElement | null = null;
let owner: HTMLButtonElement | null = null;

function closePopover(): void {
  if (!popover || popover.hidden) return;
  popover.hidden = true;
  owner?.setAttribute('aria-expanded', 'false');
  owner = null;
}

/** The single shared explanation box (created on first use). */
function ensurePopover(): HTMLElement {
  if (popover && popover.isConnected) return popover;
  popover = h('div', { class: 'help-pop', id: 'help-pop', role: 'note', hidden: true, 'data-role': 'help-pop' });
  document.body.append(popover);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popover && !popover.hidden) {
      const back = owner;
      closePopover();
      back?.focus();
    }
  });
  document.addEventListener('click', (e) => {
    const target = e.target as Node | null;
    if (popover && !popover.hidden && target && !popover.contains(target) && !(target instanceof Element && target.closest('.help-tip'))) closePopover();
  });
  return popover;
}

/** A small "?" button that shows the explanation of `term` next to it. */
export function helpTip(term: GlossaryTerm): HTMLButtonElement {
  const entry = GLOSSARY[term];
  const button = h('button', { type: 'button', class: 'help-tip', 'aria-label': `What is this? ${entry.title}`, 'aria-expanded': 'false', 'aria-controls': 'help-pop', 'data-term': term }, '?');
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = ensurePopover();
    if (owner === button && !pop.hidden) return closePopover();
    owner?.setAttribute('aria-expanded', 'false');
    owner = button;
    pop.replaceChildren(h('strong', {}, entry.title), h('p', {}, entry.text));
    pop.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    // Below the button, kept inside the window.
    const r = button.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
    const below = r.bottom + 6;
    pop.style.top = `${below + pop.offsetHeight > window.innerHeight ? Math.max(8, r.top - pop.offsetHeight - 6) : below}px`;
  });
  return button;
}
