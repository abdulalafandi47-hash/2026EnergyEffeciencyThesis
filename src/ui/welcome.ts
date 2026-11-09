/**
 * The first-visit WELCOME dialog: what the program does, how to start, and its
 * main limits. It is shown once (remembered in browser storage) and can be
 * reopened with the "Help" button in the top bar.
 */
import { h } from './dom';

export interface WelcomeActions {
  onExample: () => void;
  onBlank: () => void;
  onWall: () => void;
  /** Called whenever the dialog closes (by a choice, the close button or Escape). */
  onClose?: () => void;
}

export interface Welcome {
  element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const LIMITATIONS_URL = 'https://github.com/abdulalafandi47-hash/2026EnergyEffeciencyThesis/blob/master/docs/limitations.md';

/** The main limits, in the words of docs/limitations.md (short form). */
export const WELCOME_LIMITS: readonly string[] = [
  'Steady state only: constant temperatures, one-dimensional heat flow through each element on its own. No hourly weather, no cooling or heating load, no annual energy use.',
  'The building is a simplified single-storey, single-zone box. Ground-contact floors, solar gains, thermal bridges and ventilation are not calculated.',
  'Built-in material values are illustrative demonstration numbers, not approved Cypriot design values. Window and door values must come from your own documented sources.',
  'Surface-resistance presets have not been checked against ISO 6946. Nothing here is a compliance check.',
];

export function createWelcome(actions: WelcomeActions): Welcome {
  let lastFocus: Element | null = null;
  const limits = h('div', { class: 'welcome-limits', id: 'welcome-limits', hidden: true },
    h('ul', {}, ...WELCOME_LIMITS.map((l) => h('li', {}, l))),
    h('p', {}, 'The complete list, with an id for each limitation: ', h('a', { href: LIMITATIONS_URL, target: '_blank', rel: 'noopener noreferrer' }, 'docs/limitations.md'), ' (opens on GitHub).'),
  );
  const choice = (text: string, role: string, detail: string, onClick: () => void, cls = ''): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: `welcome-choice ${cls}`, 'data-role': role }, h('strong', {}, text), h('span', {}, detail));
    b.addEventListener('click', () => {
      close();
      onClick();
    });
    return b;
  };
  const limitsButton = h('button', { type: 'button', class: 'link-button', 'aria-expanded': 'false', 'aria-controls': 'welcome-limits', 'data-role': 'welcome-limits-toggle' }, 'Read the limitations first');
  limitsButton.addEventListener('click', () => {
    const show = limits.hidden;
    limits.hidden = !show;
    limitsButton.setAttribute('aria-expanded', String(show));
  });
  const closeButton = h('button', { type: 'button', class: 'tool welcome-close', 'aria-label': 'Close the welcome', 'data-role': 'welcome-close' }, '✕');
  closeButton.addEventListener('click', () => close());
  const panel = h(
    'div',
    { class: 'welcome-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'welcome-title', 'aria-describedby': 'welcome-intro' },
    closeButton,
    h('h2', { id: 'welcome-title' }, 'Building Thermal Simulator'),
    h('p', { id: 'welcome-intro' },
      'Build walls, roofs, floors, windows and doors of a simple house and see, in 3D, how much heat passes through each element under one constant condition (steady state). ',
      'It is part of a Civil and Environmental Engineering thesis on how insulation, thermal mass, solar gains and the building envelope influence cooling demand in Cyprus; the later stages (Cyprus weather, solar gains, dynamic behaviour, cooling demand) are not built yet.'),
    h('div', { class: 'welcome-choices' },
      choice('Load the example house', 'welcome-example', 'An illustrative house to explore and edit. Not a real or verified building.', actions.onExample, 'primary'),
      choice('Start a blank project', 'welcome-blank', 'An empty house: add walls, roof, floor, windows and doors yourself.', actions.onBlank),
      choice('Single-wall calculator', 'welcome-wall', 'One multilayer wall in detail: temperatures, comparisons, reports.', actions.onWall),
    ),
    limitsButton,
    limits,
    h('p', { class: 'note' }, 'Your work is kept in this browser between visits; download project files to keep or share it. "Help" in the top bar opens this page again.'),
  );
  const element = h('div', { class: 'welcome-backdrop', hidden: true, 'data-role': 'welcome' }, panel);
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    // Keep the keyboard inside the dialog while it is open.
    if (e.key === 'Tab') {
      const focusable = [...panel.querySelectorAll<HTMLElement>('button, a[href]')].filter((el) => !el.closest('[hidden]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  });
  element.addEventListener('click', (e) => {
    if (e.target === element) close(); // a click outside the panel
  });

  function open(): void {
    lastFocus = document.activeElement;
    element.hidden = false;
    (panel.querySelector('[data-role="welcome-example"]') as HTMLElement | null)?.focus();
  }
  function close(): void {
    if (element.hidden) return;
    element.hidden = true;
    if (lastFocus instanceof HTMLElement && lastFocus.isConnected) lastFocus.focus();
    actions.onClose?.();
  }
  return { element, open, close, isOpen: () => !element.hidden };
}
