export function skillQuery(text: string, caret = text.length): string | null {
  const match = /^\s*\/([a-z]*)$/i.exec(text.slice(0, caret));
  return match && !/\S/.test(text.slice(caret)) ? match[1].toLowerCase() : null;
}
export function commandKey(key: string, count: number, selected: number, composing = false): { handled: boolean; selected: number; confirm?: number; dismiss?: boolean } {
  if (composing || !count) return { handled: false, selected };
  if (key === "ArrowDown") return { handled: true, selected: (selected + 1) % count };
  if (key === "ArrowUp") return { handled: true, selected: (selected - 1 + count) % count };
  if (key === "Enter" || (key === "Tab" && count === 1)) return { handled: true, selected, confirm: count === 1 ? 0 : selected };
  if (key === "Escape") return { handled: true, selected, dismiss: true };
  return { handled: false, selected };
}
