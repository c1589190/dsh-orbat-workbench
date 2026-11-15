import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoot } from '../src/model.js';
import { renderDocument } from '../src/render.js';

function document(rootOverrides = {}, name = '近卫第12坦克团') {
  const root = normalizeRoot({
    name,
    type: 'armor',
    echelon: 'regiment',
    personnel: 0,
    equipment: [],
    children: [],
    ...rootOverrides,
  });
  return { id: 'd_1', name, revision: 1, root };
}

function completeEvidence() {
  return {
    orbat: {
      version: 1,
      personnel: { status: 'actual' },
      equipmentList: { status: 'actual' },
    },
  };
}

test('a complete organization renders without an incomplete marker', () => {
  const doc = document({
    personnel: 120,
    custom: completeEvidence(),
    children: [
      {
        name: '第1坦克营',
        type: 'armor',
        echelon: 'battalion',
        personnel: 40,
        custom: completeEvidence(),
        children: [],
      },
    ],
  });
  const editor = renderDocument(doc, { mode: 'editor' });
  assert.equal(editor.svg.includes('数据不完整'), false);
  const list = renderDocument(doc, { mode: 'list' });
  assert.equal(list.svg.includes('数据不完整'), false);
});

test('unknown or legacy-ambiguous quantities mark the totals incomplete in both modes', () => {
  const doc = document({
    personnel: 0,
    custom: {
      orbat: {
        version: 1,
        personnel: { status: 'unknown' },
        equipmentList: { status: 'actual' },
      },
    },
    children: [
      {
        name: '第1坦克营',
        type: 'armor',
        echelon: 'battalion',
        personnel: 0,
        children: [],
      },
    ],
  });
  const editor = renderDocument(doc, { mode: 'editor' });
  assert.ok(editor.svg.includes('数据不完整'), 'editor header must disclose incomplete totals');
  const list = renderDocument(doc, { mode: 'list' });
  assert.ok(list.svg.includes('数据不完整'), 'list header must disclose incomplete totals');
});

test('an unknown personnel node is not drawn as a confirmed zero', () => {
  const doc = document({
    personnel: 50,
    custom: completeEvidence(),
    equipment: [{ name: '坦克', count: 31 }],
    children: [
      {
        name: '未知人数营',
        type: 'armor',
        echelon: 'battalion',
        personnel: 0,
        custom: {
          orbat: {
            version: 1,
            personnel: { status: 'unknown' },
            equipmentList: { status: 'actual' },
          },
        },
        equipment: [],
        children: [],
      },
    ],
  });
  const editor = renderDocument(doc, { mode: 'editor' });
  assert.ok(
    editor.svg.includes('人 ?') || editor.svg.includes('本级 ? 人'),
    'unknown direct personnel must render as ? not 0',
  );
  const list = renderDocument(doc, { mode: 'list' });
  assert.ok(list.svg.includes('本级 ? 人'), 'list mode must also show unknown as ?');
});

test('node names are rendered exactly, with no inserted 示意 labels', () => {
  const doc = document({ personnel: 10, custom: completeEvidence() });
  const svg = renderDocument(doc, { mode: 'editor' }).svg;
  assert.ok(svg.includes('近卫第12坦克团'));
  assert.equal(svg.includes('【示意】'), false);
  assert.equal(svg.includes('示意'), false);
});
