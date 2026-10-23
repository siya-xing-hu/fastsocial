/** Read only explicit response wrappers; callers still validate the business schema. */
export function parseAIJson(raw: string): unknown {
  const content = stripLeadingThinking(raw);
  try { return JSON.parse(content); } catch { /* A single fenced document may follow ordinary prose. */ }
  const body = fencedBody(content, ['', 'json'], true);
  if (body === null) throw new Error('AI 返回内容不是有效 JSON');
  return JSON.parse(body);
}

/** A classifier must return one explicit choice, never a keyword inside an explanation. */
export function parseAIChoice<T extends string>(raw: string, choices: readonly T[], field?: string): T | null {
  try {
    const content = stripLeadingThinking(raw);
    const choice = (value: unknown): T | null => {
      if (typeof value !== 'string') return null;
      const normalized = value.trim().replace(/^\//, '').toLowerCase();
      return choices.find(item => item.toLowerCase() === normalized) ?? null;
    };
    const decodedChoice = (value: unknown, source: string): T | null => {
      if (typeof value === 'string') return choice(value);
      // Checking the source too prevents duplicate field names from silently choosing the last value.
      const singleStringField = /^\{\s*"(?:[^"\\]|\\.)*"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}$/;
      if (field && value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1
        && Object.hasOwn(value, field) && singleStringField.test(source))
        return choice((value as Record<string, unknown>)[field]);
      return null;
    };
    const bare = choice(content);
    if (bare !== null) return bare;
    const inline = /^`([^`\r\n]+)`$/.exec(content);
    if (inline) return choice(inline[1]);
    try { return decodedChoice(JSON.parse(content), content); } catch { /* Try one complete code block. */ }
    const body = fencedBody(content, ['', 'json', 'text'], false);
    if (body === null) return null;
    const fencedChoice = choice(body);
    if (fencedChoice !== null) return fencedChoice;
    try { return decodedChoice(JSON.parse(body), body); } catch { return null; }
  } catch { return null; }
}

function stripLeadingThinking(raw: string): string {
  const content = raw.trim();
  if (!/^<think>/i.test(content)) return content;
  const thought = /^<think>([\s\S]*?)<\/think>/i.exec(content);
  if (!thought || /<\/?think\b/i.test(thought[1]!)) throw new Error('AI 思考标签未完整闭合');
  return content.slice(thought[0].length).trim();
}

function fencedBody(content: string, labels: readonly string[], allowProse: boolean): string | null {
  const opening = content.indexOf('```'), closing = content.lastIndexOf('```');
  if (opening < 0 || closing <= opening) return null;
  const before = content.slice(0, opening).trim(), after = content.slice(closing + 3).trim();
  if (!allowProse && (before || after)) return null;
  for (const outside of [before, after]) {
    // Structural fragments, another fence or an extra explicit JSON value are ambiguous.
    if (/[{}\[\]]|`{3,}|~{3,}|<\/?think\b/i.test(outside)) return null;
    for (const line of outside.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
      if (line.startsWith('"')) return null;
      try { JSON.parse(line); return null; } catch { /* Ordinary explanatory text is allowed. */ }
    }
  }
  const fenced = content.slice(opening + 3, closing).trim();
  for (const label of labels.filter(Boolean)) {
    // Preserve explicit inline fences too: ```json {...}``` and ```{...}\n```.
    const marker = label === 'json' ? /^json(?=\s|[\[{"\d-]|true|false|null|$)/i : /^text(?=\s|$)/i;
    const match = marker.exec(fenced);
    if (match) return fenced.slice(match[0].length).trim();
  }
  return labels.includes('') ? fenced : null;
}
