import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendEquipmentItem,
  coverageSummary,
  editEquipmentItem,
  planStaleDocuments,
  planSummary,
  removeEquipmentItem,
  setPersonnelEvidence,
} from '../src/client-policy.js';

test('coverage summary flags unknown and ambiguous quantities as incomplete', () => {
  assert.deepEqual(coverageSummary({
    coverage: {
      personnel: { known: 10, unknown: 0, estimated: 0, legacyAmbiguous: 0 },
      equipment: { known: {}, knownTotal: 0, unknown: 0, estimated: 0, legacyAmbiguous: 0 },
    },
  }), { incomplete: false, unknown: 0, ambiguous: 0, estimated: 0, text: '已知 · 估计 0' });
  const incomplete = coverageSummary({
    coverage: {
      personnel: { known: 10, unknown: 1, estimated: 2, legacyAmbiguous: 3 },
      equipment: { known: {}, knownTotal: 0, unknown: 4, estimated: 5, legacyAmbiguous: 6 },
    },
  });
  assert.equal(incomplete.incomplete, true);
  assert.equal(incomplete.unknown, 5);
  assert.equal(incomplete.ambiguous, 9);
  assert.equal(incomplete.estimated, 7);
  assert.match(incomplete.text, /未知 5/);
  assert.equal(coverageSummary(undefined).incomplete, false);
});

test('structured equipment edits preserve unrelated item fields', () => {
  const equipment = [
    { name: '步枪', count: 5, make: '旧厂', orbat: { status: 'estimate', source: { title: '来源' } } },
    { name: '卡车', count: 2, note: '保留' },
  ];
  const renamed = editEquipmentItem(equipment, 0, { count: 9 });
  assert.equal(renamed[0].count, 9);
  assert.equal(renamed[0].make, '旧厂');
  assert.equal(renamed[0].orbat.source.title, '来源');
  assert.deepEqual(equipment[0], {
    name: '步枪', count: 5, make: '旧厂', orbat: { status: 'estimate', source: { title: '来源' } },
  });

  const cleared = editEquipmentItem(equipment, 0, { orbat: null });
  assert.equal(Object.hasOwn(cleared[0], 'orbat'), false);
  assert.equal(cleared[0].make, '旧厂');

  const appended = appendEquipmentItem(equipment, { name: '迫击炮', count: 2 });
  assert.equal(appended.length, 3);
  assert.equal(appended[2].name, '迫击炮');
  const removed = removeEquipmentItem(equipment, 1);
  assert.deepEqual(removed.map((item) => item.name), ['步枪']);
});

test('personnel evidence edits keep unrelated custom and can delete the record', () => {
  const custom = {
    keep: '保留',
    orbat: {
      version: 1,
      equipmentList: { status: 'unknown' },
      personnel: { status: 'estimate', source: { title: '旧' } },
    },
  };
  const next = setPersonnelEvidence(custom, 'actual', { title: '新', url: 'https://example.test' });
  assert.equal(next.keep, '保留');
  assert.equal(next.orbat.equipmentList.status, 'unknown');
  assert.equal(next.orbat.personnel.status, 'actual');
  assert.equal(next.orbat.personnel.source.title, '新');
  assert.equal(custom.orbat.personnel.status, 'estimate', 'input is not mutated');

  const removed = setPersonnelEvidence(custom, '', undefined);
  assert.equal(removed.orbat.personnel, undefined);
  assert.equal(removed.orbat.equipmentList.status, 'unknown');
});

test('plan staleness compares frozen expected revisions with current documents', () => {
  const plan = {
    edits: [
      { documentId: 'd1', expectedRevision: 2 },
      { documentId: 'd2', expectedRevision: 5 },
    ],
  };
  const stale = planStaleDocuments(plan, [
    { id: 'd1', revision: 2 },
    { id: 'd2', revision: 6 },
  ]);
  assert.deepEqual(stale, [{ documentId: 'd2', expectedRevision: 5, revision: 6 }]);
  assert.deepEqual(planStaleDocuments(plan, [{ id: 'd1', revision: 2 }, { id: 'd2', revision: 5 }]), []);
  assert.deepEqual(planStaleDocuments(null, []), []);
});

test('plan summary reports selected nodes, diffs and personnel totals', () => {
  const summary = planSummary({
    plan: { edits: [{ operations: [{}, {}] }, { operations: [{}] }] },
    stats: { selectedNodes: 3, personnel: { before: 27, after: 30 } },
    diffs: [{}, {}, {}],
    warnings: [{ code: 'equipment-missing' }],
  });
  assert.deepEqual(summary, {
    documents: 2,
    operations: 3,
    selectedNodes: 3,
    diffs: 3,
    personnelBefore: 27,
    personnelAfter: 30,
    warnings: 1,
  });
});
