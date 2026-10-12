import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const problems = [];
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) { await inspect(file); continue; }
    if (!file.endsWith('.vue')) continue;
    const source = await readFile(file, 'utf8');
    const report = (index, reason) => problems.push(`${relative(root, file)}:${source.slice(0, index).split('\n').length}: ${reason}`);
    for (const match of source.matchAll(/<(button|ActionButton|input)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)) {
      const tag = match[0];
      if (match[1] === 'ActionButton') {
        if (!/\s:?(?:label)="[^"\s][^"]*"/.test(tag)) report(match.index, '操作按钮必须提供 label，用于悬停提示和无障碍名称。');
        if (/\s(?:show-label|showLabel)\b/.test(tag)) report(match.index, '操作按钮只显示图标，移除 show-label。');
      } else if (match[1] === 'input') {
        if (/\stype="(?:button|submit|reset)"/.test(tag)) report(match.index, '操作按钮使用 ActionButton。');
      } else if (!['ActionButton.vue', 'ToggleSwitch.vue'].includes(entry.name)) {
        if (!/\sdata-ui="(?:navigation|choice|shortcut)"/.test(tag)) report(match.index, '操作使用 ActionButton；导航、选择项、Skill 快捷卡片必须显式标注 data-ui。');
        if (!/\s:?title="[^"]+"/.test(tag)) report(match.index, '保留文字的导航或选择项也需要 title 提示。');
      }
    }
  }
}
await inspect(join(root, 'apps/extension/src'));
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
else console.log('UI conventions passed: icon actions, labels, and explicit navigation/choice/shortcut controls.');
