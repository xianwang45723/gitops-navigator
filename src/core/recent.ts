/** The bits of vscode.Memento we use, so this stays testable without VS Code. */
export interface Store {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

const KEY = 'gitopsNav.recent';

/** Most-recently-opened Go to items, newest first. */
export class Recent {
  constructor(private store: Store, private max = 10) {}

  list(): string[] {
    return this.store.get<string[]>(KEY, []);
  }

  async touch(id: string) {
    await this.store.update(KEY, [id, ...this.list().filter((x) => x !== id)].slice(0, this.max));
  }

  /** `items` split into recent (newest first) and the rest (original order). */
  split<T>(items: T[], idOf: (item: T) => string): { recent: T[]; rest: T[] } {
    const rank = new Map(this.list().map((id, i) => [id, i]));
    const recent = items.filter((i) => rank.has(idOf(i))).sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!);
    return { recent, rest: items.filter((i) => !rank.has(idOf(i))) };
  }
}
