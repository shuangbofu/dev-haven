import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionAncestors, collectionForDocument, inCollection } from '../src/lib/knowledge-scope';
import { editorURL } from '../electron/editor-url';

test('knowledge navigation stays within the selected collection, not siblings or ancestors', () => {
  for (const target of ['工作/手册', '工作/手册/入门.md', '工作/手册/子目录/笔记.md']) assert.ok(inCollection('工作/手册', target));
  for (const target of ['工作', '工作/手册备份/笔记.md', '其他/笔记.md', '../工作/手册', '工作/手册/../外部.md', '工作\\手册\\笔记.md', '/工作/手册']) assert.equal(inCollection('工作/手册', target), false, target);
  assert.deepEqual(collectionAncestors('工作/手册', '工作/手册/子目录/更多'), ['工作/手册', '工作/手册/子目录', '工作/手册/子目录/更多']);
  assert.deepEqual(collectionAncestors('工作/手册', '其他/目录'), []);
});

test('recent documents resolve their own registered library; root documents do not expose other libraries', () => {
  assert.equal(collectionForDocument(['甲', '乙', '甲/子集合'], '甲/子集合/文档.md'), '甲/子集合');
  assert.equal(collectionForDocument(['甲', '乙'], '乙/文档.md'), '乙');
  assert.equal(collectionForDocument(['甲', '乙'], '根文档.md'), '');
  assert.equal(inCollection('', '根文档.md'), true);
  assert.equal(inCollection('', '乙/文档.md'), false);
});

test('editor URLs encode special characters and preserve POSIX, Windows drive and UNC paths', () => {
  assert.equal(editorURL('/home/example/my project/#notes', 'linux'), 'vscode://file/home/example/my%20project/%23notes');
  assert.equal(editorURL('/Users/example/中文', 'darwin'), 'vscode://file/Users/example/%E4%B8%AD%E6%96%87');
  assert.equal(editorURL('C:\\Users\\example\\my project', 'win32'), 'vscode://file/C:/Users/example/my%20project');
  assert.equal(editorURL('\\\\server\\share\\my project', 'win32'), 'vscode://file//server/share/my%20project');
});
