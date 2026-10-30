/** Fixed-cell rendering shared by the ANSI terminal and the inspectable preview. */
export const palette = {
  bg: '#000000', panel: '#151515', selected: '#33240e', border: '#414141',
  text: '#ffffff', muted: '#a3a3a3', accent: '#ff9900', green: '#8fd6ad',
  amber: '#f6cf65', red: '#ff8585', blue: '#a8b5c8',
};
export type Tone = keyof typeof palette;
export interface Cell { char: string; fg: Tone; bg: Tone; bold: boolean }

// Labels from configuration must never become terminal commands or change cell width.
export function safeText(value: string): string {
  return value.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '')
    .replace(/\u202f/g, ' ')
    .replace(/[^\x20-\x7e\u00a0-\u024f\u2500-\u259f\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u203a\u2190-\u2193]/gu, '?');
}
export class Screen {
  readonly cells: Cell[][];
  constructor(readonly width: number, readonly height: number) {
    this.cells = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ char: ' ', fg: 'text', bg: 'bg', bold: false })));
  }
  text(x: number, y: number, value: string, fg: Tone = 'text', bold = false, limit = this.width - x): void {
    for (const [i, char] of [...safeText(value)].slice(0, Math.max(0, limit)).entries()) {
      const cell = this.cells[y]?.[x + i];
      if (cell) Object.assign(cell, { char, fg, bold });
    }
  }
  fill(x: number, y: number, width: number, height: number, bg: Tone): void {
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
      const cell = this.cells[row]?.[col]; if (cell) cell.bg = bg;
    }
  }
  box(x: number, y: number, width: number, height: number, title = ''): void {
    this.fill(x, y, width, height, 'panel');
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
      const cell = this.cells[row]?.[col]; if (cell) Object.assign(cell, { char: ' ', fg: 'text', bold: false });
    }
    this.text(x, y, '╭' + '─'.repeat(Math.max(0, width - 2)) + '╮', 'border');
    this.text(x, y + height - 1, '╰' + '─'.repeat(Math.max(0, width - 2)) + '╯', 'border');
    for (let row = y + 1; row < y + height - 1; row++) { this.text(x, row, '│', 'border'); this.text(x + width - 1, row, '│', 'border'); }
    if (title) this.text(x + 2, y, ` ${title} `, 'muted', false, width - 4);
  }
  plain(): string { return this.cells.map(row => row.map(c => c.char).join('')).join('\n'); }
  ansi(): string {
    const rgb = (tone: Tone) => palette[tone].slice(1).match(/../g)!.map(v => parseInt(v, 16)).join(';');
    let style = '';
    return this.cells.map(row => row.map(c => {
      const next = `${c.fg}/${c.bg}/${c.bold}`;
      const code = next === style ? '' : `\x1b[0;${c.bold ? '1;' : ''}38;2;${rgb(c.fg)};48;2;${rgb(c.bg)}m`;
      style = next; return code + c.char;
    }).join('')).join('\r\n') + '\x1b[0m';
  }
}
