/**
 * Undo and redo for an editor whose state is an immutable value (a wall draft,
 * a building project). Each change records the state BEFORE it. Consecutive
 * typing in a field counts as one step, so one undo takes back a whole word
 * or number, not a single character.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastWasTyping = false;
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly limit = 100,
    /** Typing changes closer together than this (ms) are merged into one step. */
    private readonly mergeMs = 1000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Records that the state changed from `before`. `typing` = the change came from typing in a field;
   * typing that follows typing within `mergeMs` joins the same step.
   */
  record(before: T, typing: boolean): void {
    const at = this.now();
    const merge = typing && this.lastWasTyping && at - this.lastAt < this.mergeMs && this.past.length > 0;
    if (!merge) {
      this.past.push(before);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.lastWasTyping = typing;
    this.lastAt = at;
  }

  /** The state to go back to (given the current one, which becomes redoable), or null. */
  undo(current: T): T | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(current);
    this.lastWasTyping = false;
    return previous;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    this.lastWasTyping = false;
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.lastWasTyping = false;
  }
}

/** True when a key event is the undo or redo shortcut (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y). */
export function undoShortcut(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.shiftKey) return 'redo';
  return null;
}

/**
 * Text fields have their own undo for the text being typed; the editor's undo shortcut applies
 * everywhere else (buttons, lists, the 3D view).
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && ['text', 'search', 'number', ''].includes(target.type);
}
