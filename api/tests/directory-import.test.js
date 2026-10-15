import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTORY_IMPORT_JS, DIRECTORY_IMPORT_HTML } from '../src/directory-import-assets.js';
test('browser importer parses as JavaScript',()=>assert.doesNotThrow(()=>new Function(DIRECTORY_IMPORT_JS)));
test('import page includes confirmation',()=>assert.match(DIRECTORY_IMPORT_HTML,/id="commit"/));
test('importer selects canonical sheet',()=>assert.match(DIRECTORY_IMPORT_JS,/xl\/worksheets\/sheet1\.xml/));
test('importer sends batches to server',()=>assert.match(DIRECTORY_IMPORT_JS,/entries\/batch/));
