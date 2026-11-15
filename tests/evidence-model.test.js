import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OrbatError,
  normalizeNodePatch,
  normalizeRoot,
  stats,
} from '../src/model.js';
import {
  computeCoverage,
  isWorkbenchOrbat,
  nodeEvidence,
  normalizeItemEvidence,
  normalizeNodeEvidence,
} from '../src/evidence.js';

// Contract source: docs/superpowers/plans/2026-11-15-orbat-game-workflow.md
// "Common Contract" and Responsibility 1. This file is intentionally written
// before the production code and must fail on missing evidence behavior, not on
// a missing import or syntax error.
const EVIDENCE_STATUSES = Object.freeze([
  'actual',
  'standard',
  'estimate',
  'unknown',
  'legacy-ambiguous',
]);

const SOURCE = Object.freeze({
  title: '1988年苏军编制手册',
  url: 'https://example.test/source/1988',
  page: '12',
  date: '1988-06',
  method: '同型编制推定',
  note: '仅用于文游',
});

function unit(overrides = {}) {
  return {
    name: '第1营',
    type: 'infantry',
    echelon: 'battalion',
    personnel: 0,
    personnelMax: 0,
    equipment: [],
    children: [],
    ...overrides,
  };
}

function orbat(extra = {}) {
  return { version: 1, ...extra };
}

function statsWithCoverage(root) {
  const result = stats(root);
  assert.ok(
    result.coverage && typeof result.coverage === 'object',
    'stats() must add Common Contract coverage without removing legacy scalar fields',
  );
  assert.ok(result.coverage.personnel, 'stats().coverage.personnel is required');
  assert.ok(result.coverage.equipment, 'stats().coverage.equipment is required');
  return result;
}

function assertPersonnelCoverage(result, expected) {
  assert.deepEqual(result.coverage.personnel, expected);
}

function assertEquipmentCoverage(result, expected) {
  assert.deepEqual(result.coverage.equipment, expected);
}

function rejectsEvidence(fn, label) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(
        error instanceof OrbatError,
        `${label}: expected OrbatError, got ${error?.name}: ${error?.message}`,
      );
      return true;
    },
    label,
  );
}

test('explicit actual personnel zero is known, not unknown or legacy-ambiguous', () => {
  const normalized = normalizeRoot(unit({
    personnel: 0,
    personnelMax: 0,
    equipment: [{ name: '步枪', count: 0, orbat: { status: 'actual' } }],
    custom: {
      orbat: orbat({
        personnel: { status: 'actual', source: SOURCE },
      }),
    },
  }));

  assert.equal(normalized.custom.orbat.personnel.status, 'actual');
  assert.deepEqual(normalized.custom.orbat.personnel.source, SOURCE);
  assert.equal(normalized.equipment[0].orbat.status, 'actual');

  const result = statsWithCoverage(normalized);
  assert.equal(result.personnel, 0, 'legacy personnel scalar must remain unchanged');
  assertPersonnelCoverage(result, {
    known: 0,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 0,
  });
  assertEquipmentCoverage(result, {
    known: { 步枪: 0 },
    knownTotal: 0,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 0,
  });
});

test('unknown personnel zero is excluded from known and counted as unknown', () => {
  const result = statsWithCoverage(normalizeRoot(unit({
    personnel: 0,
    equipment: [{ name: '步枪', count: 5 }],
    custom: {
      orbat: orbat({ personnel: { status: 'unknown', source: SOURCE } }),
    },
  })));

  assert.equal(result.personnel, 0, 'legacy personnel scalar must remain unchanged');
  assertPersonnelCoverage(result, {
    known: 0,
    unknown: 1,
    estimated: 0,
    legacyAmbiguous: 0,
  });
  assertEquipmentCoverage(result, {
    known: { 步枪: 5 },
    knownTotal: 5,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 0,
  });
});

test('estimate personnel 10 contributes to both known and estimated', () => {
  const result = statsWithCoverage(normalizeRoot(unit({
    personnel: 10,
    equipment: [{ name: '步枪', count: 5 }],
    custom: {
      orbat: orbat({ personnel: { status: 'estimate', source: SOURCE } }),
    },
  })));

  assert.equal(result.personnel, 10);
  assertPersonnelCoverage(result, {
    known: 10,
    unknown: 0,
    estimated: 10,
    legacyAmbiguous: 0,
  });
});

test('standard personnel contributes to known but not estimated', () => {
  const result = statsWithCoverage(normalizeRoot(unit({
    personnel: 6,
    custom: {
      orbat: orbat({ personnel: { status: 'standard', source: SOURCE } }),
    },
  })));

  assertPersonnelCoverage(result, {
    known: 6,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 0,
  });
});

test('legacy zero without explicit evidence is ambiguous, never known or unknown', () => {
  const normalized = normalizeRoot(unit({
    personnel: 0,
    equipment: [{ name: '步枪', count: 5 }],
  }));
  assert.equal(Object.hasOwn(normalized, 'custom'), false);

  const result = statsWithCoverage(normalized);
  assert.equal(result.personnel, 0);
  assertPersonnelCoverage(result, {
    known: 0,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 1,
  });
  assertEquipmentCoverage(result, {
    known: { 步枪: 5 },
    knownTotal: 5,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 0,
  });
});

test('explicit legacy-ambiguous status counts as incomplete and stays out of known', () => {
  const result = statsWithCoverage(normalizeRoot(unit({
    personnel: 0,
    custom: {
      orbat: orbat({ personnel: { status: 'legacy-ambiguous' } }),
    },
  })));

  assertPersonnelCoverage(result, {
    known: 0,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 1,
  });
});

test('non-object legacy custom values are preserved, never converted into evidence metadata', () => {
  for (const legacyCustom of ['旧备注', 7, true, null]) {
    const normalized = normalizeRoot(unit({
      personnel: 0,
      custom: legacyCustom,
    }));
    assert.deepEqual(
      normalized.custom,
      legacyCustom,
      `custom ${JSON.stringify(legacyCustom)} must not be overwritten by an object`,
    );

    const result = statsWithCoverage(normalized);
    assertPersonnelCoverage(result, {
      known: 0,
      unknown: 0,
      estimated: 0,
      legacyAmbiguous: 1,
    });
  }
});

test('a foreign orbat custom namespace is preserved and not read as workbench evidence', () => {
  const foreign = { app: 'army-editor-extension', note: 'do-not-touch' };
  const normalized = normalizeRoot(unit({
    personnel: 0,
    custom: { orbat: foreign },
  }));

  assert.deepEqual(normalized.custom.orbat, foreign);
  const result = statsWithCoverage(normalized);
  assertPersonnelCoverage(result, {
    known: 0,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 1,
  });
});

test('every documented evidence status is accepted and preserved verbatim', () => {
  for (const status of EVIDENCE_STATUSES) {
    const normalized = normalizeRoot(unit({
      personnel: 0,
      custom: { orbat: orbat({ personnel: { status } }) },
    }));
    assert.equal(normalized.custom.orbat.personnel.status, status);
  }
});

test('subtree aggregation reports known 3 plus one unknown', () => {
  const normalized = normalizeRoot(unit({
    personnel: 3,
    equipment: [{ name: '步枪', count: 3 }],
    custom: {
      orbat: orbat({ personnel: { status: 'actual', source: SOURCE } }),
    },
    children: [
      unit({
        name: '第1连',
        echelon: 'company',
        personnel: 0,
        equipment: [{ name: '步枪', count: 2 }],
        custom: {
          orbat: orbat({ personnel: { status: 'unknown' } }),
        },
      }),
    ],
  }));

  const result = statsWithCoverage(normalized);
  assert.equal(result.personnel, 3, 'raw scalar totals still include the unknown placeholder 0');
  assertPersonnelCoverage(result, {
    known: 3,
    unknown: 1,
    estimated: 0,
    legacyAmbiguous: 0,
  });
  assertEquipmentCoverage(result, {
    known: { 步枪: 5 },
    knownTotal: 5,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 0,
  });
});

test('source totals are annotations and are never added to node or coverage totals', () => {
  const observedTotals = {
    personnel: 500,
    equipment: { 步枪: 99, 火炮: 12 },
  };
  const normalized = normalizeRoot(unit({
    personnel: 3,
    equipment: [{ name: '步枪', count: 2 }],
    custom: {
      orbat: orbat({
        personnel: { status: 'actual', source: SOURCE },
        observedTotals,
      }),
    },
    children: [
      unit({
        name: '第1连',
        echelon: 'company',
        personnel: 0,
        equipment: [{ name: '步枪', count: 1 }],
        custom: {
          orbat: orbat({ personnel: { status: 'unknown' } }),
        },
      }),
    ],
  }));

  const result = statsWithCoverage(normalized);
  assert.equal(result.personnel, 3, 'observedTotals.personnel must not be summed');
  assert.deepEqual(result.equipment, { 步枪: 3 });
  assert.equal(result.equipTotal, 3, 'observedTotals.equipment must not be summed');
  assertPersonnelCoverage(result, {
    known: 3,
    unknown: 1,
    estimated: 0,
    legacyAmbiguous: 0,
  });
  assert.deepEqual(normalized.custom.orbat.observedTotals, observedTotals);
});

test('equipment coverage counts unknown items and sums estimated quantities', () => {
  const normalized = normalizeRoot(unit({
    personnel: 10,
    equipment: [
      { name: '步枪', count: 0, orbat: { status: 'actual' } },
      { name: '机枪', count: 0, orbat: { status: 'unknown' } },
      { name: '火炮', count: 3, orbat: { status: 'estimate', source: SOURCE } },
      { name: '迫击炮', count: 2, orbat: { status: 'estimate' } },
      { name: '卡车', count: 10 },
      { name: '吉普', count: 0 },
    ],
  }));

  const result = statsWithCoverage(normalized);
  assert.deepEqual(result.equipment, {
    步枪: 0,
    机枪: 0,
    火炮: 3,
    迫击炮: 2,
    卡车: 10,
    吉普: 0,
  });
  assert.equal(result.equipTotal, 15);
  assertEquipmentCoverage(result, {
    known: { 步枪: 0, 火炮: 3, 迫击炮: 2, 卡车: 10 },
    knownTotal: 15,
    unknown: 1,
    estimated: 5,
    legacyAmbiguous: 1,
  });
  assertPersonnelCoverage(result, {
    known: 10,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 0,
  });
});

test('equipmentList.status unknown marks missing equipment as unknown, not empty', () => {
  const normalized = normalizeRoot(unit({
    personnel: 10,
    equipment: [],
    custom: {
      orbat: orbat({
        equipmentList: { status: 'unknown', source: SOURCE },
      }),
    },
  }));

  assert.deepEqual(normalized.custom.orbat.equipmentList.source, SOURCE);
  const result = statsWithCoverage(normalized);
  assertEquipmentCoverage(result, {
    known: {},
    knownTotal: 0,
    unknown: 1,
    estimated: 0,
    legacyAmbiguous: 0,
  });
  assertPersonnelCoverage(result, {
    known: 10,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 0,
  });
});

test('malformed evidence statuses fail closed on nodes, lists, items and patches', () => {
  const nodeCases = [
    ['personnel bogus status', unit({
      custom: { orbat: orbat({ personnel: { status: 'verified' } }) },
    })],
    ['personnel numeric status', unit({
      custom: { orbat: orbat({ personnel: { status: 1 } }) },
    })],
    ['equipmentList bogus status', unit({
      custom: { orbat: orbat({ equipmentList: { status: 'known' } }) },
    })],
    ['equipment item bogus status', unit({
      equipment: [{ name: '步枪', count: 0, orbat: { status: 'verified' } }],
    })],
    ['equipment item null status', unit({
      equipment: [{ name: '步枪', count: 0, orbat: { status: null } }],
    })],
  ];
  for (const [label, node] of nodeCases) {
    rejectsEvidence(() => normalizeRoot(node), label);
  }

  rejectsEvidence(
    () => normalizeNodePatch({
      custom: { orbat: orbat({ personnel: { status: 'verified' } }) },
    }),
    'patch personnel bogus status',
  );
  rejectsEvidence(
    () => normalizeNodePatch({
      equipment: [{ name: '步枪', count: 0, orbat: { status: 'verified' } }],
    }),
    'patch equipment item bogus status',
  );
});

test('malformed source objects fail closed instead of being preserved as evidence', () => {
  const invalidSources = [
    ['array source', []],
    ['string source', 'manual'],
    ['numeric title', { title: 42 }],
    ['numeric url', { url: 123 }],
    ['numeric page', { page: 12 }],
    ['numeric date', { date: 1988 }],
    ['object method', { method: {} }],
    ['array note', { note: [] }],
  ];
  for (const [label, source] of invalidSources) {
    rejectsEvidence(
      () => normalizeRoot(unit({
        custom: {
          orbat: orbat({ personnel: { status: 'estimate', source } }),
        },
      })),
      `personnel ${label}`,
    );
  }

  rejectsEvidence(
    () => normalizeRoot(unit({
      equipment: [{
        name: '步枪',
        count: 1,
        orbat: { status: 'actual', source: { title: 42 } },
      }],
    })),
    'equipment item numeric source title',
  );
  rejectsEvidence(
    () => normalizeRoot(unit({
      custom: { orbat: orbat({ equipmentList: { status: 'unknown', source: [] } }) },
    })),
    'equipmentList array source',
  );
});

test('unrelated custom and equipment item data survive evidence normalization and patching', () => {
  const custom = {
    keep: '保留',
    nested: { a: 1, b: [null, 'x'] },
    orbat: orbat({
      personnel: { status: 'estimate', source: SOURCE },
      observedTotals: { personnel: 120 },
    }),
  };
  const normalized = normalizeRoot(unit({
    personnel: 4,
    equipment: [{
      name: '步枪',
      count: 4,
      make: '自制',
      note: null,
      orbat: { status: 'estimate', source: SOURCE },
    }],
    custom,
  }));

  assert.equal(normalized.custom.keep, '保留');
  assert.deepEqual(normalized.custom.nested, custom.nested);
  assert.deepEqual(normalized.custom.orbat.personnel.source, SOURCE);
  assert.deepEqual(normalized.custom.orbat.observedTotals, { personnel: 120 });
  assert.equal(normalized.equipment[0].make, '自制');
  assert.equal(normalized.equipment[0].note, null);
  assert.equal(normalized.equipment[0].orbat.status, 'estimate');

  const patch = normalizeNodePatch({
    custom: {
      keep: '保留',
      orbat: orbat({
        personnel: { status: 'actual', source: SOURCE },
      }),
    },
    equipment: [{
      name: '步枪',
      count: 2,
      make: '自制',
      orbat: { status: 'unknown' },
    }],
  });
  assert.equal(patch.custom.keep, '保留');
  assert.deepEqual(patch.custom.orbat.personnel.source, SOURCE);
  assert.equal(patch.equipment[0].make, '自制');
  assert.equal(patch.equipment[0].orbat.status, 'unknown');
});

test('unannotated empty equipment lists are legacy-ambiguous while explicit actual empty lists are known empty', () => {
  const unlabelled = statsWithCoverage(normalizeRoot(unit({
    personnel: 7,
    equipment: [],
  })));
  assert.deepEqual(unlabelled.equipment, {}, 'legacy scalar aggregate must stay empty');
  assert.equal(unlabelled.equipTotal, 0);
  assertEquipmentCoverage(unlabelled, {
    known: {},
    knownTotal: 0,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 1,
  });

  const explicitActualEmpty = statsWithCoverage(normalizeRoot(unit({
    personnel: 7,
    equipment: [],
    custom: {
      orbat: orbat({
        equipmentList: { status: 'actual', source: SOURCE },
      }),
    },
  })));
  assert.deepEqual(explicitActualEmpty.equipment, {});
  assert.equal(explicitActualEmpty.equipTotal, 0);
  assertEquipmentCoverage(explicitActualEmpty, {
    known: {},
    knownTotal: 0,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 0,
  });
});

test('equipment.known aggregates known and estimated names and excludes unknown and ambiguous placeholders', () => {
  const result = statsWithCoverage(normalizeRoot(unit({
    personnel: 10,
    equipment: [
      { name: '步枪', count: 120 },
      { name: '步枪', count: 30, orbat: { status: 'actual', source: SOURCE } },
      { name: '步枪', count: 10, orbat: { status: 'estimate', source: SOURCE } },
      { name: '机枪', count: 99, orbat: { status: 'unknown' } },
      { name: '机枪', count: 88, orbat: { status: 'legacy-ambiguous' } },
      { name: '火炮', count: 8, orbat: { status: 'standard' } },
      { name: '吉普', count: 0 },
      { name: '卡车', count: 0, orbat: { status: 'actual' } },
    ],
  })));

  assert.deepEqual(result.equipment, {
    步枪: 160,
    机枪: 187,
    火炮: 8,
    吉普: 0,
    卡车: 0,
  }, 'legacy scalar equipment sums must keep every recorded count');
  assert.equal(result.equipTotal, 355);

  assertEquipmentCoverage(result, {
    known: { 步枪: 160, 火炮: 8, 卡车: 0 },
    knownTotal: 168,
    unknown: 1,
    estimated: 10,
    legacyAmbiguous: 2,
  });
});

test('stats normalizes a model-legal raw tree with missing fields instead of throwing TypeError or producing NaN', () => {
  const raw = {
    name: '缺字段营',
    type: 'infantry',
    echelon: 'battalion',
    children: [
      { name: '缺字段连', type: 'infantry', echelon: 'company' },
    ],
  };

  let result;
  assert.doesNotThrow(() => {
    result = stats(raw);
  }, 'stats must normalize a tree that validateRoot accepts');

  assert.equal(result.personnel, 0);
  assert.equal(result.personnelMax, 0);
  assert.deepEqual(result.equipment, {});
  assert.equal(result.equipTotal, 0);
  assert.equal(result.nodes, 2);
  for (const value of [result.personnel, result.personnelMax, result.equipTotal, result.nodes]) {
    assert.ok(Number.isFinite(value), `stats must not expose NaN, got ${value}`);
  }
  assertPersonnelCoverage(result, {
    known: 0,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 2,
  });
  assertEquipmentCoverage(result, {
    known: {},
    knownTotal: 0,
    unknown: 0,
    estimated: 0,
    legacyAmbiguous: 2,
  });
});

test('arbitrary custom namespaces and extra equipment item fields survive normalization and patching', () => {
  const custom = {
    freeform: '任意',
    nested: { list: [1, 'x', null, { deep: true }] },
    orbat: orbat({
      personnel: { status: 'estimate', source: SOURCE },
      customTag: '保留标签',
      observedTotals: { personnel: 120, extra: { a: 1 } },
      equipmentList: { status: 'actual', source: SOURCE },
    }),
  };
  const item = {
    name: '步枪',
    count: 4,
    countMax: 8,
    make: '自制',
    note: null,
    nested: { serial: 'A-1', tags: ['x', 2] },
    orbat: { status: 'actual', source: SOURCE },
  };

  const normalized = normalizeRoot(unit({
    personnel: 4,
    equipment: [item],
    custom,
  }));
  assert.deepEqual(normalized.custom, custom);
  assert.deepEqual(normalized.equipment[0], item);
  assert.equal(normalized.custom.orbat.customTag, '保留标签');

  const patch = normalizeNodePatch({
    custom: {
      freeform: ['保留', { k: 'v' }],
      orbat: orbat({
        personnel: { status: 'actual', source: SOURCE },
        customTag: '补丁保留',
        observedTotals: { note: 'annotation' },
      }),
    },
    equipment: [{
      name: '机枪',
      count: 2,
      make: '外购',
      note: '保持',
      nested: { serial: 'B-2' },
      orbat: { status: 'unknown', source: SOURCE },
    }],
  });
  assert.deepEqual(patch.custom.freeform, ['保留', { k: 'v' }]);
  assert.equal(patch.custom.orbat.customTag, '补丁保留');
  assert.deepEqual(patch.custom.orbat.observedTotals, { note: 'annotation' });
  assert.equal(patch.equipment[0].make, '外购');
  assert.equal(patch.equipment[0].note, '保持');
  assert.equal(patch.equipment[0].nested.serial, 'B-2');
  assert.equal(patch.equipment[0].orbat.status, 'unknown');
  assert.deepEqual(patch.equipment[0].orbat.source, SOURCE);
});

// --- Prototype-chain safety ------------------------------------------------
// Common Contract: "All fields and outputs must guard unsafe keys". Evidence
// helpers and coverage must only read OWN `orbat` properties. An `orbat`
// reached through the prototype chain is unrelated data: it must never be
// validated, returned or aggregated.
//
// `Object.create({ orbat })` exercises inheritance from a non-`Object.prototype`
// prototype. `withInheritedOrbat` additionally exercises the prototype-pollution
// shape (plain object inheriting `orbat` from `Object.prototype` itself), which a
// strict `isPlainObject` gate alone does not stop. The own-property controls keep
// each test from passing vacuously against a helper that always says "no evidence".

function withInheritedOrbat(value, fn) {
  Object.defineProperty(Object.prototype, 'orbat', {
    configurable: true,
    enumerable: false,
    writable: true,
    value,
  });
  try {
    return fn();
  } finally {
    delete Object.prototype.orbat;
  }
}

test('isWorkbenchOrbat only treats an own versioned orbat namespace as workbench evidence', () => {
  assert.equal(
    isWorkbenchOrbat({ orbat: { version: 1 } }),
    true,
    'own-property control: a plain workbench orbat namespace is evidence',
  );
  assert.equal(
    isWorkbenchOrbat(Object.create({ orbat: { version: 1 } })),
    false,
    'an orbat namespace inherited from a custom prototype is not workbench evidence',
  );
  assert.equal(
    withInheritedOrbat({ version: 1 }, () => isWorkbenchOrbat({})),
    false,
    'an orbat namespace inherited from Object.prototype is not workbench evidence',
  );
});

test('normalizeNodeEvidence ignores inherited orbat evidence instead of validating it', () => {
  const inherited = Object.create({
    orbat: { version: 1, personnel: { status: 'bogus-status' } },
  });
  assert.equal(
    normalizeNodeEvidence(inherited),
    inherited,
    'a custom object with only an inherited orbat namespace must be returned untouched',
  );

  assert.doesNotThrow(
    () => withInheritedOrbat(
      { version: 1, personnel: { status: 'bogus-status' } },
      () => normalizeNodeEvidence({}),
    ),
    'an orbat namespace inherited from Object.prototype must not be validated as evidence',
  );
});

test('nodeEvidence returns null for orbat inherited through the prototype chain', () => {
  assert.equal(
    nodeEvidence({ custom: Object.create({ orbat: { version: 1 } }) }),
    null,
    'an orbat namespace inherited from a custom prototype is not node evidence',
  );
  assert.equal(
    withInheritedOrbat({ version: 1 }, () => nodeEvidence({ custom: {} })),
    null,
    'an orbat namespace inherited from Object.prototype is not node evidence',
  );
});

test('normalizeItemEvidence ignores inherited item evidence instead of validating it', () => {
  const entry = Object.create({ orbat: { status: 'bogus-status' } });
  let result;
  assert.doesNotThrow(() => {
    result = normalizeItemEvidence(entry);
  }, 'an inherited item orbat must not be validated');
  assert.equal(result, entry, 'an item with only an inherited orbat must be returned untouched');

  const plain = withInheritedOrbat(
    { status: 'bogus-status' },
    () => normalizeItemEvidence({ name: '步枪', count: 5 }),
  );
  assert.deepEqual(
    plain,
    { name: '步枪', count: 5 },
    'an item orbat inherited from Object.prototype must not be validated',
  );
});

test('computeCoverage ignores inherited equipment item evidence', () => {
  const item = Object.assign(
    Object.create({ orbat: { status: 'unknown' } }),
    { name: '步枪', count: 5 },
  );
  const root = { personnel: 0, equipment: [item], children: [] };

  let coverage;
  assert.doesNotThrow(() => {
    coverage = computeCoverage(root);
  }, 'computeCoverage must accept a raw tree whose item orbat is only inherited');
  assert.equal(
    coverage.equipment.unknown,
    0,
    'inherited item orbat.status must not count the item as unknown',
  );
  assert.equal(
    coverage.equipment.estimated,
    0,
    'inherited item orbat.status must not count the item as estimated',
  );
  assert.equal(
    coverage.equipment.legacyAmbiguous,
    0,
    'inherited item orbat.status must not make the item legacy-ambiguous',
  );
});
