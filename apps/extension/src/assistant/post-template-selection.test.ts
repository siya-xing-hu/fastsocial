import assert from 'node:assert/strict';
import test from 'node:test';
import { freezePostTemplateSelection, showPostTemplateSelection, validatePostTemplateSelection } from './post-template-selection.ts';

const first = { id: 'first', revision: 'r1', name: '第一份模板', updatedAt: '2026-10-23T00:00:00.000Z' };
const second = { id: 'second', revision: 'r2', name: '第二份模板', updatedAt: '2026-10-23T00:00:00.000Z' };
const selection = (template = first) => ({ id: template.id, revision: template.revision });

test('the post template selector follows explicit post and inferred post continuation only', () => {
  assert.equal(showPostTemplateSelection('post'), true);
  assert.equal(showPostTemplateSelection(undefined, 'post'), true);
  for (const skill of ['summary', 'reply'] as const) assert.equal(showPostTemplateSelection(skill, 'post'), false);
  assert.equal(showPostTemplateSelection(undefined, 'summary'), false);
  assert.equal(showPostTemplateSelection(), false);
});

test('a send freezes only id and revision before asynchronous work and preserves no selection', async () => {
  const catalog = [{ ...first, content: 'Template body must not enter the chat request' }, { ...second }];
  let selected = selection();
  const frozen = freezePostTemplateSelection(selected, catalog, 'post');
  const pending = Promise.resolve().then(() => frozen);
  selected = selection(second);
  catalog[0].revision = 'edited-during-page-read';
  assert.deepEqual(await pending, { id: 'first', revision: 'r1' });
  assert.deepEqual(Object.keys(frozen!).sort(), ['id', 'revision']);
  assert.equal(freezePostTemplateSelection(undefined, catalog, 'post'), undefined);
});

test('retry uses the original frozen reference and never a newly selected or default template', () => {
  const original = { postTemplate: { id: first.id, revision: first.revision } };
  assert.deepEqual(freezePostTemplateSelection(selection(second), [first, second], 'post', original), original.postTemplate);
  const frozen = freezePostTemplateSelection(selection(second), [first, second], undefined, original)!;
  original.postTemplate.id = second.id;
  assert.deepEqual(frozen, { id: first.id, revision: first.revision });
  assert.equal(freezePostTemplateSelection(selection(second), [first, second], 'post', {}), undefined);
});

test('explicit other skills omit templates while inferred requests may carry a frozen reference', () => {
  for (const skill of ['summary', 'reply'] as const)
    assert.equal(freezePostTemplateSelection({ id: 'deleted', revision: 'old' }, [], skill), undefined);
  assert.deepEqual(freezePostTemplateSelection(selection(), [first]), selection());
});

test('explicit post rejects missing, offline and changed templates without switching versions', () => {
  assert.throws(() => freezePostTemplateSelection(selection(), [], 'post'), /已失效/);
  assert.throws(() => freezePostTemplateSelection(selection(), undefined, 'post'), /无法读取/);
  const frozen = freezePostTemplateSelection(selection(), [first], 'post')!;
  assert.throws(() => validatePostTemplateSelection(frozen, [{ ...first, revision: 'changed' }]), /已更新/);
  assert.throws(() => validatePostTemplateSelection(frozen, [second]), /已失效/);
  assert.throws(() => freezePostTemplateSelection(selection(second), [{ ...first, revision: 'changed' }, second], 'post', { postTemplate: frozen }), /已更新/);
  assert.deepEqual(frozen, { id: first.id, revision: first.revision });
});

test('inferred chat can reach routing with an obsolete reference while inferred post retains that exact reference for server validation', () => {
  const original = selection();
  for (const catalog of [[], [{ ...first, revision: 'new-revision' }], undefined]) {
    const requestSelection = freezePostTemplateSelection(original, catalog);
    assert.deepEqual(requestSelection, original, 'do not prevent classification or silently drop the original template');
    assert.notEqual(requestSelection, original, 'the in-flight selection is an independent snapshot');
    assert.throws(() => validatePostTemplateSelection(requestSelection, catalog), /已失效|无法读取|已更新/, 'an actual post must still reject the same invalid reference');
    const retrySelection = freezePostTemplateSelection(selection(second), catalog, undefined, { postTemplate: original });
    assert.deepEqual(retrySelection, original, 'a retry keeps the old revision even when the current selection changed');
  }
});

test('a selection with no saved revision requires explicit recovery rather than inventing a new version', () => {
  assert.throws(() => freezePostTemplateSelection({ id: first.id, revision: '' }, [first]), /版本.*重新选择/);
  assert.equal(freezePostTemplateSelection({ id: first.id, revision: '' }, [first], 'summary'), undefined);
});
