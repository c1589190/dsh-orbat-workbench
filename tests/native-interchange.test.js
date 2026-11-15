import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OrbatError, Workspace, WORKSPACE_FILE } from '../src/workspace.js';

const AI = Object.freeze({ kind: 'ai', name: '测试脚本' });

const DEFAULT_RESOURCES = Object.freeze({
  revision: 0,
  catalog: { version: 1, equip: {} },
  templates: { version: 1, items: {} },
});

function unit(overrides = {}) {
  return {
    name: '第1营',
    type: 'infantry',
    echelon: 'battalion',
    personnel: 3,
    personnelMax: 0,
    equipment: [],
    children: [],
    ...overrides,
  };
}

function evidenceTree() {
  return unit({
    name: '有资料营',
    custom: {
      orbat: {
        version: 1,
        personnel: { status: 'estimate', source: { title: '测试来源' } },
        equipmentList: { status: 'unknown' },
      },
    },
    equipment: [
      { name: '步枪', count: 12, orbat: { status: 'estimate', source: { title: '测试来源' } } },
    ],
  });
}

function catalogWithAlias() {
  return {
    version: 1,
    equip: {
      eq_1: {
        id: 'eq_1',
        name: '步枪',
        aliases: ['AK'],
        category: 'small_arms',
        stats: { damage: 3 },
      },
    },
  };
}

function templatesOne() {
  return {
    version: 1,
    items: { t1: { id: 't1', name: '模板', root: unit({ name: '模板营' }) } },
  };
}

function fixture(t) {
  return (async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'orbat-native-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const workspace = await Workspace.open(dir);
    return { dir, workspace };
  })();
}

function errCode(code) {
  return (error) => {
    assert.ok(error instanceof OrbatError, `expected OrbatError, got ${error}`);
    assert.equal(error.code, code, `expected code ${code}, got ${error.code}: ${error.message}`);
    return true;
  };
}

function errCodes(codes) {
  return (error) => {
    assert.ok(error instanceof OrbatError, `expected OrbatError, got ${error}`);
    assert.ok(
      codes.includes(error.code),
      `expected one of ${codes.join(',')}, got ${error.code}: ${error.message}`,
    );
    return true;
  };
}

function stripTimes(value) {
  if (Array.isArray(value)) return value.map(stripTimes);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'time') continue;
      result[key] = stripTimes(entry);
    }
    return result;
  }
  return value;
}

function collectNodeIds(root) {
  const ids = [];
  const walk = (node) => {
    ids.push(node.id);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return ids;
}

test('new workspaces persist version 2 with default resources and return defensive copies', async (t) => {
  const { dir, workspace } = await fixture(t);
  await workspace.create({ name: '示例', root: unit() }, AI);

  const state = JSON.parse(await readFile(path.join(dir, WORKSPACE_FILE), 'utf8'));
  assert.equal(state.version, 2);
  assert.deepEqual(state.resources, DEFAULT_RESOURCES);
  assert.deepEqual(workspace.resources(), DEFAULT_RESOURCES);

  const resources = workspace.resources();
  resources.catalog.equip.hack = { id: 'hack', name: '篡改' };
  resources.templates.items.hack = { id: 'hack', name: '篡改', root: unit() };
  resources.revision = 99;
  assert.deepEqual(workspace.resources(), DEFAULT_RESOURCES);
});

test('a version 1 workspace file migrates on open and upgrades on the next write', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'orbat-native-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    path.join(dir, WORKSPACE_FILE),
    JSON.stringify({ version: 1, sequence: 0, droppedThrough: 0, documents: [], changes: [] }),
    'utf8',
  );

  const workspace = await Workspace.open(dir);
  assert.deepEqual(workspace.resources(), DEFAULT_RESOURCES);
  await workspace.create({ name: '迁移后', root: unit() }, AI);

  const state = JSON.parse(await readFile(path.join(dir, WORKSPACE_FILE), 'utf8'));
  assert.equal(state.version, 2);
  assert.equal(state.documents.length, 1);
  assert.deepEqual(state.resources, DEFAULT_RESOURCES);
});

test('an unsupported workspace version is rejected without rewriting the file', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'orbat-native-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const original = JSON.stringify({
    version: 3,
    sequence: 0,
    droppedThrough: 0,
    documents: [],
    changes: [],
    resources: DEFAULT_RESOURCES,
  });
  await writeFile(path.join(dir, WORKSPACE_FILE), original, 'utf8');

  await assert.rejects(Workspace.open(dir), errCode('corrupt_workspace'));
  assert.equal(await readFile(path.join(dir, WORKSPACE_FILE), 'utf8'), original);
});

test('updateResources persists catalog and templates and guards its own revision', async (t) => {
  const { dir, workspace } = await fixture(t);
  const result = await workspace.updateResources(
    {
      expectedRevision: 0,
      catalog: catalogWithAlias(),
      templates: templatesOne(),
      summary: '初始化资料库',
    },
    AI,
  );

  assert.equal(result.ok, true);
  assert.equal(result.resources.revision, 1);
  assert.equal(result.sequence, 1);
  assert.equal(result.change.summary, '初始化资料库');
  assert.deepEqual(result.change.actor, AI);

  const reopened = await Workspace.open(dir);
  assert.deepEqual(reopened.resources().catalog, catalogWithAlias());
  assert.equal(reopened.resources().templates.items.t1.name, '模板');
  assert.equal(reopened.resources().templates.items.t1.root.name, '模板营');

  await assert.rejects(
    workspace.updateResources({ expectedRevision: 0, catalog: catalogWithAlias() }, AI),
    errCode('resource_conflict'),
  );
  assert.equal(workspace.resources().revision, 1);
  assert.equal(workspace.snapshot().sequence, 1);
});

test('updateResources validates catalog and templates atomically', async (t) => {
  const { workspace } = await fixture(t);
  const before = workspace.snapshot();
  assert.equal(workspace.resources().revision, 0);

  const invalidCatalogs = [
    { version: 2, equip: {} },
    { version: 1, equip: { eq_1: { id: 'eq_1', name: '' } } },
    {
      version: 1,
      equip: {
        eq_1: { id: 'eq_1', name: '同名' },
        eq_2: { id: 'eq_2', name: '同名' },
      },
    },
    {
      version: 1,
      equip: { eq_1: { id: 'eq_1', name: '步枪', stats: { speed: Infinity } } },
    },
    JSON.parse(
      '{"version":1,"equip":{"eq_1":{"id":"eq_1","name":"步枪","stats":{"__proto__":{"x":1}}}}}',
    ),
  ];
  for (const catalog of invalidCatalogs) {
    await assert.rejects(
      workspace.updateResources({ expectedRevision: 0, catalog }, AI),
      errCodes(['invalid_catalog', 'forbidden_key', 'catalog_conflict']),
    );
    assert.equal(workspace.resources().revision, 0);
    assert.deepEqual(workspace.snapshot(), before);
  }

  await assert.rejects(
    workspace.updateResources(
      {
        expectedRevision: 0,
        templates: {
          version: 1,
          items: { t1: { id: 't1', name: '坏模板', root: unit({ type: 'bogus' }) } },
        },
      },
      AI,
    ),
    errCode('invalid_templates'),
  );
  assert.equal(workspace.resources().revision, 0);
  assert.deepEqual(workspace.snapshot(), before);
});

test('native export preserves document identity, evidence, catalog and templates', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '原生导出', root: evidenceTree() }, AI);
  await workspace.updateResources(
    { expectedRevision: 0, catalog: catalogWithAlias(), templates: templatesOne() },
    AI,
  );

  const native = workspace.exportNative([created.document.id]);
  assert.equal(native.kind, 'orbat-native');
  assert.equal(native.version, 1);
  assert.equal(native.sequence, workspace.snapshot().sequence);
  assert.equal(native.documents.length, 1);
  const doc = native.documents[0];
  assert.equal(doc.id, created.document.id);
  assert.equal(doc.name, '原生导出');
  assert.equal(doc.revision, 1);
  assert.equal(doc.root.id, created.document.root.id);
  assert.deepEqual(doc.root.custom, created.document.root.custom);
  assert.deepEqual(doc.root.equipment[0].orbat, { status: 'estimate', source: { title: '测试来源' } });
  assert.deepEqual(native.catalog, catalogWithAlias());
  assert.equal(native.templates.items.t1.name, '模板');

  const all = workspace.exportNative();
  assert.equal(all.documents.length, 1);
});

test('native merge import into a fresh workspace preserves ids, revisions and resources', async (t) => {
  const source = await fixture(t);
  const created = await source.workspace.create({ name: '来源', root: evidenceTree() }, AI);
  await source.workspace.updateResources(
    { expectedRevision: 0, catalog: catalogWithAlias(), templates: templatesOne() },
    AI,
  );
  const native = source.workspace.exportNative();
  assert.ok(Array.isArray(native.changes) && native.changes.length > 0);

  const target = await fixture(t);
  const result = await target.workspace.importNative(native, {}, AI);
  assert.ok(result.losses.some((loss) => loss.code === 'history-ignored'));
  assert.equal(result.ok, true);
  assert.equal(result.sequence, 1);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].id, created.document.id);
  assert.equal(result.documents[0].revision, 1);
  assert.equal(result.idMap.documents[created.document.id], created.document.id);

  const state = await Workspace.open(target.dir);
  assert.deepEqual(state.snapshot().documents[0], result.documents[0]);
  assert.deepEqual(state.resources().catalog, catalogWithAlias());
  assert.equal(state.resources().templates.items.t1.root.name, '模板营');
  assert.equal(
    state.resources().templates.items.t1.root.id,
    native.templates.items.t1.root.id,
    'template node ids survive a native round-trip',
  );
  const oldIds = collectNodeIds(native.documents[0].root);
  const newIds = collectNodeIds(state.snapshot().documents[0].root);
  assert.deepEqual(newIds, oldIds);
  for (const id of oldIds) assert.equal(result.idMap.nodes[id], id);
});

test('native clone import regenerates ids and returns a complete mapping', async (t) => {
  const source = await fixture(t);
  await source.workspace.create({ name: '克隆来源', root: evidenceTree() }, AI);
  const native = source.workspace.exportNative();
  const payloadBefore = JSON.stringify(native);

  const target = await fixture(t);
  const result = await target.workspace.importNative(native, { mode: 'clone' }, AI);
  assert.equal(JSON.stringify(native), payloadBefore, 'clone import must not mutate the payload');
  assert.notEqual(result.documents[0].id, native.documents[0].id);
  assert.equal(result.documents[0].name, '克隆来源');
  assert.equal(result.documents[0].revision, 1);
  assert.equal(result.idMap.documents[native.documents[0].id], result.documents[0].id);

  const oldIds = collectNodeIds(native.documents[0].root);
  const newIds = collectNodeIds(result.documents[0].root);
  assert.equal(newIds.length, oldIds.length);
  assert.equal(new Set(newIds).size, newIds.length);
  for (const oldId of oldIds) {
    const mapped = result.idMap.nodes[oldId];
    assert.ok(mapped, `missing node mapping for ${oldId}`);
    assert.notEqual(mapped, oldId);
    assert.ok(newIds.includes(mapped));
  }
  assert.ok(result.losses.some((loss) => loss.code === 'identity-remapped'));
});

test('native merge import rejects any identity conflict atomically', async (t) => {
  const target = await fixture(t);
  const existing = await target.workspace.create({ name: '已有', root: unit() }, AI);
  const native = target.workspace.exportNative();
  native.documents.push({
    id: 'd_extra',
    name: '额外',
    revision: 1,
    root: { ...unit(), id: 'n_extra_root' },
  });
  const before = target.workspace.snapshot();
  const resourcesBefore = target.workspace.resources();

  await assert.rejects(
    target.workspace.importNative(native, {}, AI),
    errCode('conflict'),
  );
  assert.deepEqual(target.workspace.snapshot(), before);
  assert.deepEqual(target.workspace.resources(), resourcesBefore);
  assert.equal(target.workspace.snapshot().documents.length, 1);
  assert.equal(target.workspace.snapshot().documents[0].id, existing.document.id);
});

test('native import rejects malformed payloads atomically', async (t) => {
  const { workspace } = await fixture(t);
  const before = workspace.snapshot();
  const goodNative = () => ({
    kind: 'orbat-native',
    version: 1,
    sequence: 0,
    documents: [{ id: 'd_1', name: '甲', revision: 1, root: { ...unit(), id: 'n_1' } }],
    catalog: { version: 1, equip: {} },
    templates: { version: 1, items: {} },
  });

  const cases = [
    [{ ...goodNative(), kind: 'mil-org' }, ['invalid_payload']],
    [{ ...goodNative(), version: 2 }, ['invalid_payload']],
    [{ ...goodNative(), documents: [] }, ['invalid_payload']],
    [
      {
        ...goodNative(),
        documents: [
          { id: 'd_same', name: '甲', revision: 1, root: { ...unit(), id: 'n_a' } },
          { id: 'd_same', name: '乙', revision: 1, root: { ...unit(), id: 'n_b' } },
        ],
      },
      ['invalid_payload'],
    ],
    [
      {
        ...goodNative(),
        documents: [{ id: 'd_bad', name: '丙', revision: 0, root: { ...unit(), id: 'n_c' } }],
      },
      ['invalid_payload'],
    ],
    [
      {
        ...goodNative(),
        documents: [{ id: 'd_no_ids', name: '丁', revision: 1, root: unit() }],
      },
      ['invalid_payload'],
    ],
  ];
  for (const [payload, codes] of cases) {
    await assert.rejects(workspace.importNative(payload, {}, AI), errCodes(codes));
    assert.deepEqual(workspace.snapshot(), before);
  }
  await assert.rejects(
    workspace.importNative(goodNative(), { mode: 'replace' }, AI),
    errCodes(['invalid_request']),
  );
  assert.deepEqual(workspace.snapshot(), before);
});

test('exportCompatible returns the payload plus a deterministic loss report', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '兼容导出', root: evidenceTree() }, AI);
  await workspace.updateResources(
    { expectedRevision: 0, catalog: catalogWithAlias(), templates: templatesOne() },
    AI,
  );

  const compatible = workspace.exportCompatible([created.document.id], 'mil-org');
  assert.deepEqual(
    stripTimes(compatible.payload),
    stripTimes(workspace.export([created.document.id], 'mil-org')),
  );
  assert.equal(Object.hasOwn(compatible.payload, 'losses'), false);
  const codes = compatible.losses.map((loss) => loss.code);
  for (const code of [
    'internal-node-ids',
    'extension-metadata',
    'templates',
    'equipment-catalog',
  ]) {
    assert.ok(codes.includes(code), `missing loss code ${code}: ${codes.join(',')}`);
  }
  assert.deepEqual(
    workspace.exportCompatible([created.document.id], 'mil-org').losses,
    compatible.losses,
  );
});

test('mil-bundle compatibility export carries the catalog and reports only aliases', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '兼容包', root: evidenceTree() }, AI);
  await workspace.updateResources(
    { expectedRevision: 0, catalog: catalogWithAlias() },
    AI,
  );

  const compatible = workspace.exportCompatible([created.document.id], 'mil-bundle');
  assert.deepEqual(
    stripTimes(compatible.payload),
    stripTimes(workspace.export([created.document.id], 'mil-bundle')),
  );
  assert.equal(compatible.payload.equip.eq_1.name, '步枪');
  assert.equal(compatible.payload.equip.eq_1.stats.damage, 3);
  const codes = compatible.losses.map((loss) => loss.code);
  assert.ok(!codes.includes('equipment-catalog'));
  assert.ok(codes.includes('equipment-aliases'));
});

test('import accepts a nonempty upstream equipment library and persists it', async (t) => {
  const { dir, workspace } = await fixture(t);
  const payload = {
    kind: 'mil-bundle',
    version: 1,
    saves: { 甲: { data: unit() } },
    equip: {
      eq_9: {
        id: 'eq_9',
        name: '机枪',
        category: 'small_arms',
        stats: { range: 800 },
      },
    },
  };
  const result = await workspace.import(payload, AI);
  assert.equal(result.documents.length, 1);

  const reopened = await Workspace.open(dir);
  const catalog = reopened.resources().catalog;
  assert.equal(catalog.equip.eq_9.name, '机枪');
  assert.deepEqual(catalog.equip.eq_9.stats, { range: 800 });
  assert.equal(reopened.resources().revision, 1);
});

test('import rejects an equipment name or alias collision atomically', async (t) => {
  const { workspace } = await fixture(t);
  await workspace.updateResources(
    { expectedRevision: 0, catalog: catalogWithAlias() },
    AI,
  );
  const before = workspace.snapshot();
  const resourcesBefore = workspace.resources();

  const payload = {
    kind: 'mil-bundle',
    version: 1,
    saves: { 乙: { data: unit() } },
    equip: { eq_2: { id: 'eq_2', name: '步枪', stats: { damage: 4 } } },
  };
  await assert.rejects(workspace.import(payload, AI), errCode('catalog_conflict'));
  assert.deepEqual(workspace.snapshot(), before);
  assert.deepEqual(workspace.resources(), resourcesBefore);
});

test('import rejects unsafe equipment stats atomically', async (t) => {
  const { workspace } = await fixture(t);
  const before = workspace.snapshot();
  const payload = {
    kind: 'mil-bundle',
    version: 1,
    saves: { 丙: { data: unit() } },
    equip: { eq_3: { id: 'eq_3', name: '火炮', stats: { speed: Infinity } } },
  };
  await assert.rejects(workspace.import(payload, AI), errCode('invalid_catalog'));
  assert.deepEqual(workspace.snapshot(), before);
});
