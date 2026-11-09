/**
 * Small layout controls shared by both workspaces: collapsible sidebar
 * sections, the compact camera "View" menu, and the drag handle that resizes
 * the results panel. They change only what is shown, never the model.
 */
import { h } from './dom';
import { readKey, writeKey } from './storage';
import type { KeyValueStore } from './storage';

// ---- collapsible sidebar sections -------------------------------------------------------------------

export interface Collapsible {
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

/**
 * Turns a sidebar section (a <section> whose first child is its <h2>) into a section that folds:
 * the heading becomes a button (aria-expanded), everything after it goes into a body that hides.
 */
export function makeCollapsible(section: HTMLElement): Collapsible {
  const heading = section.querySelector(':scope > h2');
  if (!heading) throw new Error('A collapsible section needs an h2 as its first child.');
  const bodyId = `${heading.id || Math.random().toString(36).slice(2)}-body`;
  const body = h('div', { class: 'section-body', id: bodyId });
  while (heading.nextSibling) body.append(heading.nextSibling);
  section.append(body);
  const button = h('button', { type: 'button', class: 'section-toggle', 'aria-expanded': 'true', 'aria-controls': bodyId }, h('span', { class: 'section-chevron', 'aria-hidden': 'true' }, '▾'), ...Array.from(heading.childNodes));
  heading.replaceChildren(button);
  section.classList.add('collapsible');
  const setOpen = (open: boolean): void => {
    button.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    section.classList.toggle('folded', !open);
    (button.firstChild as HTMLElement).textContent = open ? '▾' : '▸';
  };
  button.addEventListener('click', () => setOpen(Boolean(body.hidden)));
  return { isOpen: () => !body.hidden, setOpen };
}

// ---- the camera "View" menu ------------------------------------------------------------------------------

export interface ViewChoice {
  /** Short text in the menu and on the button after choosing ("Plan", "3D SE"). */
  text: string;
  /** Accessible name (also what tests and scripts look for). */
  label: string;
  choose: () => void;
}

/**
 * One "View: … ▾" button that opens a small list of camera views (a disclosure, not a select, so
 * choosing the same view again re-applies it). Escape or a click elsewhere closes it.
 */
export function viewMenu(choices: readonly ViewChoice[], initial: string): HTMLElement {
  const listId = `view-menu-${Math.random().toString(36).slice(2, 8)}`;
  const toggle = h('button', { type: 'button', class: 'tool view-menu-button', 'aria-expanded': 'false', 'aria-controls': listId, 'data-role': 'view-menu-button', title: 'Camera views' }, `View: ${initial} ▾`);
  const items = choices.map((c) => {
    const b = h('button', { type: 'button', class: 'tool view-menu-item', 'aria-label': c.label }, c.text);
    b.addEventListener('click', () => {
      c.choose();
      toggle.textContent = `View: ${c.text} ▾`;
      setOpen(false);
      toggle.focus();
    });
    return b;
  });
  const list = h('div', { class: 'view-menu-list', id: listId, role: 'group', 'aria-label': 'Camera views', hidden: true }, ...items);
  const wrap = h('div', { class: 'view-menu' }, toggle, list);
  function setOpen(open: boolean): void {
    list.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', () => {
    setOpen(Boolean(list.hidden));
    if (!list.hidden) items[0]?.focus();
  });
  wrap.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      toggle.focus();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && at >= 0) {
      e.preventDefault();
      items[(at + 1) % items.length]?.focus();
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && at >= 0) {
      e.preventDefault();
      items[(at - 1 + items.length) % items.length]?.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (!list.hidden && !wrap.contains(e.target as Node)) setOpen(false);
  });
  return wrap;
}

// ---- resizing the results panel ---------------------------------------------------------------------

const MIN_RESULTS_PX = 90;
const STEP_PX = 24;

/**
 * A handle at the top edge of the results panel: drag it, or focus it and press the arrow keys, to
 * make the panel taller or shorter (Home restores the default). The height is kept for this viewer
 * in browser storage under `storageKey`. "Enlarge" still works on top of it.
 */
export function addResultsResizer(panel: HTMLElement, column: HTMLElement, storageKey: string, store: KeyValueStore | null): HTMLElement {
  const handle = h('div', { class: 'results-resizer', role: 'separator', tabindex: '0', 'aria-orientation': 'horizontal', 'aria-label': 'Resize the results panel (drag, or arrow keys up and down; Home restores the default)', 'data-role': 'results-resizer' });
  // While the workspace is hidden (not laid out yet) its height reads 0: then nothing caps the panel.
  const max = (): number => {
    const height = column.getBoundingClientRect().height;
    return height > 0 ? Math.max(MIN_RESULTS_PX, height * 0.75) : Number.POSITIVE_INFINITY;
  };
  const current = (): number => panel.getBoundingClientRect().height;
  /** A focusable separator announces its position: the panel height in pixels, between its limits. */
  function describe(): void {
    handle.setAttribute('aria-valuemin', String(MIN_RESULTS_PX));
    handle.setAttribute('aria-valuemax', String(Number.isFinite(max()) ? Math.round(max()) : 10000));
    handle.setAttribute('aria-valuenow', String(Math.round(Math.max(MIN_RESULTS_PX, Math.min(max(), current())))));
    handle.setAttribute('aria-valuetext', `results panel ${Math.round(current())} pixels high`);
  }
  function apply(px: number | null, remember = true): void {
    if (px === null) panel.style.removeProperty('--results-user-h');
    else panel.style.setProperty('--results-user-h', `${Math.round(Math.min(max(), Math.max(MIN_RESULTS_PX, px)))}px`);
    describe();
    if (remember) writeKey(store, storageKey, px === null ? '' : String(Math.round(px)));
    window.dispatchEvent(new Event('resize')); // the 3D view adapts to its new size
  }
  const saved = Number(readKey(store, storageKey));
  if (saved > 0) apply(saved, false);
  else describe();
  handle.addEventListener('focus', describe);
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') apply(current() + STEP_PX);
    else if (e.key === 'ArrowDown') apply(current() - STEP_PX);
    else if (e.key === 'Home') apply(null);
    else return;
    e.preventDefault();
  });
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = current();
    const move = (ev: PointerEvent): void => apply(startH + (startY - ev.clientY), false);
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      apply(startH + (startY - ev.clientY));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  panel.prepend(handle);
  return handle;
}
