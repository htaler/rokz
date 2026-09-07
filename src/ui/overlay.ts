/**
 * Full-screen panels: the start menu, help, achievements and credits.
 *
 * These are drawn in the game's own vocabulary rather than as a modern menu
 * laid over it -- one monospaced grid, the CGA colours the game actually
 * writes in, CP437 block characters for the title, and a blinking block cursor
 * on the selected row. Kroz had exactly one typeface and sixteen colours; the
 * menus behave as though that were still true.
 */

import type { Achievements } from '../achievements.ts';

export type Screen = 'start' | 'help' | 'achievements' | 'about' | 'cheats';

/** ROKZ, set in the block characters a DOS title screen would have used. */
const TITLE = [
  '███   ██  █  █ ████',
  '█  █ █  █ █ █     █',
  '███  █  █ ██     █ ',
  '█ █  █  █ █ █   █  ',
  '█  █  ██  █  █ ████',
].join('\n');

/** What a panel shows. `build` is for content the simple forms cannot express. */
export interface Content {
  heading?: string;
  lines?: string[];
  grid?: [string, string][];
  menu?: MenuItem[];
  build?: (body: HTMLElement) => void;
}

export interface MenuItem {
  key: string;
  label: string;
  detail?: string;
  run: () => void;
}

export class Overlay {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private items: MenuItem[] = [];
  private cursor = 0;
  current: Screen | null = null;

  constructor(root: HTMLElement, body: HTMLElement) {
    this.root = root;
    this.body = body;
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  close(): void {
    this.current = null;
    this.items = [];
    this.root.hidden = true;
  }

  /** Move the selection, wrapping at both ends. */
  move(delta: number): void {
    if (!this.items.length) return;
    this.cursor = (this.cursor + delta + this.items.length) % this.items.length;
    this.paint();
  }

  /** Run the selected item, or the one whose access key was pressed. */
  activate(key?: string): boolean {
    if (!this.items.length) return false;
    const item = key
      ? this.items.find((i) => i.key.toLowerCase() === key.toLowerCase())
      : this.items[this.cursor];
    if (!item) return false;
    item.run();
    return true;
  }

  open(screen: Screen, content: Content): void {
    this.current = screen;
    this.items = content.menu ?? [];
    this.cursor = 0;
    this.root.hidden = false;
    this.render(screen, content);
  }

  private render(screen: Screen, content: Content): void {
    this.body.replaceChildren();

    if (screen === 'start') {
      const title = document.createElement('pre');
      title.className = 'title';
      title.textContent = TITLE;
      this.body.append(title);
    }

    const sub = document.createElement('div');
    sub.className = 'kicker';
    sub.textContent = content.heading ?? '';
    this.body.append(sub);

    for (const line of content.lines ?? []) {
      const p = document.createElement('p');
      p.textContent = line;
      this.body.append(p);
    }

    if (content.grid) {
      const table = document.createElement('dl');
      table.className = 'grid';
      for (const [term, def] of content.grid) {
        const dt = document.createElement('dt');
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.textContent = def;
        table.append(dt, dd);
      }
      this.body.append(table);
    }

    content.build?.(this.body);

    if (this.items.length) {
      const list = document.createElement('div');
      list.className = 'menu';
      this.items.forEach((item, i) => {
        const row = document.createElement('button');
        row.className = 'row';
        row.dataset['index'] = String(i);
        row.addEventListener('click', () => {
          this.cursor = i;
          item.run();
        });
        row.addEventListener('mousemove', () => {
          this.cursor = i;
          this.paint();
        });
        const mark = document.createElement('span');
        mark.className = 'mark';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = item.label;
        const detail = document.createElement('span');
        detail.className = 'detail';
        detail.textContent = item.detail ?? '';
        row.append(mark, label, detail);
        list.append(row);
      });
      this.body.append(list);
      this.paint();
    }

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = this.items.length
      ? 'Up and down to choose · Enter to select · Esc to close'
      : 'Esc to close';
    this.body.append(hint);
  }

  /** The cursor is a block character on the selected row, as a DOS menu had. */
  private paint(): void {
    this.body.querySelectorAll<HTMLElement>('.row').forEach((row, i) => {
      const on = i === this.cursor;
      row.classList.toggle('on', on);
      const mark = row.querySelector<HTMLElement>('.mark');
      if (mark) mark.textContent = on ? '█' : ' ';
    });
  }
}

export { TITLE };
