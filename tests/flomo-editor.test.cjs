const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../extension/flomo-editor-tools');

test('tag completion follows the caret and replaces only the active token', () => {
  const body = '前文 #清单/旧标签 后文 #保留';
  const cursor = body.indexOf('/旧');
  assert.deepEqual(E.tagContext(body, cursor), { start: 3, end: 10, query: '清单' });
  const result = E.tag(body, cursor, cursor, '清单/复盘');
  assert.equal(result.value, '前文 #清单/复盘 后文 #保留');
  assert.equal(result.value.slice(0, result.start), '前文 #清单/复盘 ');
  assert.equal(E.tagContext('正文 #', 4).query, '');
  assert.equal(E.tagContext('正文 #已结束 ', 8), null);
  assert.equal(E.tagContext('正文#清', 4).query, '清');
  assert.equal(E.tagContext('#已写#', 4).query, '');
  assert.equal(E.tagContext('#标签，正文', 6), null);
  assert.equal(E.tagContext('#标签', 1, 3), null);
  assert.equal(E.tag('想法：#清', 5, 5, '清单/复盘').value, '想法：#清单/复盘 ');
});

test('suggestions rank usage and recency only within active notes of the supplied library', () => {
  const tags = [{id:'a',path:'清单/复盘'}, {id:'b',path:'01月'}, {id:'c',path:'02月'}, {id:'d',path:'Prompt/阅读'}];
  const note = (tagIds, updatedAt, extra={}) => ({tagIds, updatedAt, ...extra});
  const notes = [note(['a','a'],'2026-10-01'),note(['a'],'2026-10-02'),note(['b'],'2026-10-07'),note(['c'],'2026-10-09',{deletedAt:'2026-10-10'}),note(['c'],'2026-10-11',{purgedAt:'2026-10-11'})];
  const groups = E.tagSuggestions(tags, notes);
  assert.deepEqual(groups[0].tags.map(t=>[t.id,t.count]), [['a',2],['b',1]]);
  assert.deepEqual(groups[1].tags.map(t=>t.id), ['b','a']);
  assert.deepEqual(E.tagSuggestions(tags,notes,'0')[0].tags.map(t=>t.id), ['b','c']);
  assert.equal(E.tagSuggestions(tags,notes,'复盘')[0].tags[0].path, '清单/复盘');
  assert.equal(E.tagSuggestions(tags,notes,'prompt')[0].tags[0].id, 'd');
  assert.equal(E.tagSuggestions(tags,notes,'未出现')[0].tags.length, 0);
  assert.equal(E.tagSuggestions(tags,[])[0].tags.length, 4);
  assert.deepEqual(E.tagSuggestions([],notes)[0].tags, []);
});
