/** Generic snapshot-based undo/redo with a memory ceiling. */

export interface HistoryEntry<T> {
  label: string;
  state: T;
}

export class History<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private limit: number;
  onChange?: () => void;

  constructor(limit = 40) {
    this.limit = limit;
  }

  /** Record the state *before* a mutation. */
  push(label: string, state: T): void {
    this.past.push({ label, state });
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
    this.onChange?.();
  }

  undo(current: T): HistoryEntry<T> | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push({ label: entry.label, state: current });
    this.onChange?.();
    return entry;
  }

  redo(current: T): HistoryEntry<T> | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push({ label: entry.label, state: current });
    this.onChange?.();
    return entry;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoLabel(): string { return this.past.at(-1)?.label ?? ''; }
  get redoLabel(): string { return this.future.at(-1)?.label ?? ''; }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
    this.onChange?.();
  }
}
