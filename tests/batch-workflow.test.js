import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../src/workspace.js';
import { createApplication } from '../src/application.js';
import { createToolDefinitions } from '../src/tools.js';

const HUMAN = { kind: 'human', name: 'tab-A' };
const AI = { kind: 'ai', name: 'agent-A', sessionId: 'session-A' };

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'orbat-batch-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspace = await Workspace.open(join(dir, 'data'));
  const app = createApplication(workspace, { artifactDir: join(dir, 'artifacts') });
  return { dir, workspace, app };
}

function unit(overrides = {}) {
  return {
    name: '第1营',
    type: 'infantry',
    echelon: 'battalion',
    personnel: 3,
    equipment: [],
    children: [],
    ...overrides,
  };
}

function bigRoot(count = 230) {
  return unit({
    name: '大营',
    children: Array.from({ length: count }, (_, index) => ({
      name: `${index + 1}班`,
      type: 'infantry',
      echelon: 'squad',
      personnel: 9,
      equipment: [{ name: '步枪', count: 8 }],
      children: [],
    })),
  });
}

async function createDoc(app, workspace, root = unit()) {
  const result = await app.dispatch('create', { name: '测试编制', root }, AI);
  assert.equal(result.ok, true);
  return result.document;
}

test('query paginates more than 200 matches and rejects stale cursors', async (t) => {
  const { workspace, app } = await setup(t);
  await createDoc(app, workspace, bigRoot());

  const first = await app.dispatch('query', { text: '班', limit: 200 }, AI);
  assert.equal(first.ok, true);
  assert.equal(first.total, 230);
  assert.equal(first.matches.length, 200);
  assert.equal(first.offset, 0);
  assert.equal(first.truncated, true);
  assert.match(first.nextCursor, /^\d+:200$/);

  const second = await app.dispatch('query', { text: '班', limit: 200, cursor: first.nextCursor }, AI);
  assert.equal(second.ok, true);
  assert.equal(second.matches.length, 30);
  assert.equal(second.offset, 200);
  assert.equal(second.truncated, false);
  assert.equal(second.nextCursor, null);

  await app.dispatch(
    'transaction',
    {
      edits: [{
        documentId: workspace.snapshot().documents[0].id,
        expectedRevision: 1,
        operations: [{ op: 'rename', name: '新名字' }],
      }],
    },
    HUMAN,
  );
  const stale = await app.dispatch('query', { text: '班', limit: 10, cursor: first.nextCursor }, AI);
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'stale_cursor');
  assert.equal(stale.error.details.sequence, 2);
});

test('plan previews exact diffs without writing anything', async (t) => {
  const { workspace, app } = await setup(t);
  const doc = await createDoc(app, workspace, bigRoot(3));
  const before = workspace.snapshot();

  const preview = await app.dispatch(
    'plan',
    {
      documentIds: [doc.id],
      select: { text: '班' },
      operation: { kind: 'personnel', mode: 'set', value: 10, status: 'estimate' },
      summary: '三班补到10人',
    },
    AI,
  );
  assert.equal(preview.ok, true);
  assert.equal(preview.plan.baseSequence, 1);
  assert.equal(preview.plan.summary, '三班补到10人');
  assert.equal(preview.plan.edits.length, 1);
  assert.equal(preview.plan.edits[0].expectedRevision, 1);
  assert.equal(preview.plan.edits[0].operations.length, 6);
  assert.equal(preview.diffs.filter((diff) => diff.field === 'personnel').length, 3);
  assert.equal(preview.diffs.filter((diff) => diff.field === 'custom').length, 3);
  assert.deepEqual(preview.stats.personnel, { before: 27, after: 30 });
  assert.deepEqual(workspace.snapshot(), before);
});

test('commitPlan applies the frozen plan and preserves unrelated custom data', async (t) => {
  const { workspace, app } = await setup(t);
  const doc = await createDoc(app, workspace, unit({
    name: '带资料营',
    personnel: 9,
    custom: { keep: '保留', orbat: { version: 1, equipmentList: { status: 'unknown' } } },
  }));
  const preview = await app.dispatch(
    'plan',
    {
      documentIds: [doc.id],
      select: { nodeIds: [doc.root.id] },
      operation: {
        kind: 'personnel',
        mode: 'delta',
        value: 1,
        status: 'estimate',
        source: { title: '测试来源' },
      },
    },
    AI,
  );
  assert.equal(preview.ok, true);

  const committed = await app.dispatch('commitPlan', { plan: preview.plan }, AI);
  assert.equal(committed.ok, true);
  assert.equal(committed.sequence, 2);
  const updated = workspace.snapshot().documents[0];
  assert.equal(updated.revision, 2);
  assert.equal(updated.root.personnel, 10);
  assert.equal(updated.root.custom.keep, '保留');
  assert.equal(updated.root.custom.orbat.equipmentList.status, 'unknown');
  assert.equal(updated.root.custom.orbat.personnel.status, 'estimate');
  assert.deepEqual(updated.root.custom.orbat.personnel.source, { title: '测试来源' });
});

test('a stale plan fails as a whole without partial writes', async (t) => {
  const { workspace, app } = await setup(t);
  const doc = await createDoc(app, workspace, bigRoot(2));
  const preview = await app.dispatch(
    'plan',
    { documentIds: [doc.id], select: { text: '班' }, operation: { kind: 'personnel', mode: 'set', value: 10 } },
    AI,
  );
  assert.equal(preview.ok, true);

  await app.dispatch(
    'transaction',
    {
      edits: [{
        documentId: doc.id,
        expectedRevision: 1,
        operations: [{ op: 'update', nodeId: doc.root.children[0].id, fields: { name: '人类改名' } }],
      }],
    },
    HUMAN,
  );
  const before = workspace.snapshot();
  const result = await app.dispatch('commitPlan', { plan: preview.plan }, AI);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONFLICT');
  assert.deepEqual(workspace.snapshot(), before);
  assert.equal(workspace.snapshot().documents[0].root.children[0].name, '人类改名');
});

test('commitPlan guards read-only source documents atomically', async (t) => {
  const { workspace, app } = await setup(t);
  const target = await createDoc(app, workspace, unit({ name: '目标' }));
  const source = await app.dispatch('create', { name: '来源', root: unit({ name: '来源营' }) }, AI);
  const sourceId = source.document.id;

  const preview = await app.dispatch(
    'plan',
    {
      documentIds: [target.id],
      select: { nodeIds: [target.root.id] },
      operation: { kind: 'remark', value: '批量备注' },
    },
    AI,
  );
  assert.equal(preview.ok, true);
  preview.plan.guards = [{ documentId: sourceId, expectedRevision: 1 }];

  await app.dispatch(
    'transaction',
    {
      edits: [{
        documentId: sourceId,
        expectedRevision: 1,
        operations: [{ op: 'rename', name: '来源已改' }],
      }],
    },
    HUMAN,
  );
  const before = workspace.snapshot();
  const result = await app.dispatch('commitPlan', { plan: preview.plan }, AI);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONFLICT');
  assert.deepEqual(workspace.snapshot(), before);
  assert.equal(workspace.snapshot().documents.find((doc) => doc.id === target.id).root.remark, '');
});

test('equipment upsert keeps other items and their extra fields', async (t) => {
  const { workspace, app } = await setup(t);
  const doc = await createDoc(app, workspace, unit({
    name: '装备营',
    equipment: [
      { name: '步枪', count: 5, make: '旧厂' },
      { name: '卡车', count: 2, note: '保留' },
    ],
  }));

  const preview = await app.dispatch(
    'plan',
    {
      documentIds: [doc.id],
      select: { nodeIds: [doc.root.id] },
      operation: {
        kind: 'equipment',
        mode: 'upsert',
        name: '步枪',
        count: 9,
        status: 'actual',
        source: { title: '清点' },
      },
    },
    AI,
  );
  assert.equal(preview.ok, true);
  const committed = await app.dispatch('commitPlan', { plan: preview.plan }, AI);
  assert.equal(committed.ok, true);

  const equipment = workspace.snapshot().documents[0].root.equipment;
  assert.equal(equipment.length, 2);
  assert.equal(equipment[0].name, '步枪');
  assert.equal(equipment[0].count, 9);
  assert.equal(equipment[0].make, '旧厂');
  assert.equal(equipment[0].orbat.status, 'actual');
  assert.deepEqual(equipment[0].orbat.source, { title: '清点' });
  assert.deepEqual(equipment[1], { name: '卡车', count: 2, note: '保留' });
});

test('equipment remove targets one occurrence and missing names only warn', async (t) => {
  const { workspace, app } = await setup(t);
  const doc = await createDoc(app, workspace, unit({
    name: '多条目营',
    equipment: [
      { name: '步枪', count: 5 },
      { name: '步枪', count: 7, make: '第二支' },
    ],
  }));

  const preview = await app.dispatch(
    'plan',
    {
      documentIds: [doc.id],
      select: { nodeIds: [doc.root.id] },
      operation: { kind: 'equipment', mode: 'remove', name: '步枪', occurrence: 1 },
    },
    AI,
  );
  assert.equal(preview.ok, true);
  assert.equal(preview.warnings.length, 0);
  const committed = await app.dispatch('commitPlan', { plan: preview.plan }, AI);
  assert.equal(committed.ok, true);
  const equipment = workspace.snapshot().documents[0].root.equipment;
  assert.equal(equipment.length, 1);
  assert.equal(equipment[0].count, 5);

  const missing = await app.dispatch(
    'plan',
    {
      documentIds: [doc.id],
      select: { nodeIds: [doc.root.id] },
      operation: { kind: 'equipment', mode: 'remove', name: '不存在' },
    },
    AI,
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'no_changes');
});

test('an out-of-range personnel delta and a no-op plan are rejected without writes', async (t) => {
  const { workspace, app } = await setup(t);
  const doc = await createDoc(app, workspace, unit({ name: '人数营', personnel: 2 }));
  const before = workspace.snapshot();

  const negative = await app.dispatch(
    'plan',
    {
      documentIds: [doc.id],
      select: { nodeIds: [doc.root.id] },
      operation: { kind: 'personnel', mode: 'delta', value: -3 },
    },
    AI,
  );
  assert.equal(negative.ok, false);
  assert.equal(negative.error.code, 'invalid_number');

  const same = await app.dispatch(
    'plan',
    {
      documentIds: [doc.id],
      select: { nodeIds: [doc.root.id] },
      operation: { kind: 'personnel', mode: 'set', value: 2 },
    },
    AI,
  );
  assert.equal(same.ok, false);
  assert.equal(same.error.code, 'no_changes');
  assert.deepEqual(workspace.snapshot(), before);
});

test('templates clone with fresh ids and an optional rename', async (t) => {
  const { workspace, app } = await setup(t);
  const doc = await createDoc(app, workspace, unit({ name: '模板使用营' }));
  const resources = await app.dispatch(
    'updateResources',
    {
      expectedRevision: 0,
      templates: {
        version: 1,
        items: {
          t1: {
            id: 't1',
            name: '步兵班',
            root: { name: '班', type: 'infantry', echelon: 'squad', personnel: 9, children: [] },
          },
        },
      },
    },
    AI,
  );
  assert.equal(resources.ok, true);

  const result = await app.dispatch(
    'transaction',
    {
      edits: [{
        documentId: doc.id,
        expectedRevision: 1,
        operations: [
          { op: 'template', parentId: doc.root.id, templateId: 't1', name: '第2班' },
        ],
      }],
    },
    AI,
  );
  assert.equal(result.ok, true);
  const added = workspace.snapshot().documents[0].root.children[0];
  assert.equal(added.name, '第2班');
  assert.equal(added.personnel, 9);
  assert.equal(added.customName, true);
  assert.notEqual(added.id, undefined);
  assert.equal(workspace.resources().templates.items.t1.root.name, '班');
});

test('mergeCustom preserves unrelated data and fails closed on incompatible custom', async (t) => {
  const { workspace, app } = await setup(t);
  const doc = await createDoc(app, workspace, unit({
    name: '资料营',
    custom: { keep: 1, orbat: { version: 1, equipmentList: { status: 'actual' } } },
  }));

  const merged = await app.dispatch(
    'transaction',
    {
      edits: [{
        documentId: doc.id,
        expectedRevision: 1,
        operations: [{
          op: 'mergeCustom',
          nodeId: doc.root.id,
          fields: { custom: { orbat: { personnel: { status: 'estimate' } } } },
        }],
      }],
    },
    AI,
  );
  assert.equal(merged.ok, true);
  const custom = workspace.snapshot().documents[0].root.custom;
  assert.equal(custom.keep, 1);
  assert.equal(custom.orbat.equipmentList.status, 'actual');
  assert.equal(custom.orbat.personnel.status, 'estimate');

  const second = await createDoc(app, workspace, { ...unit({ name: '坏资料营' }), custom: '旧字符串' });
  const failed = await app.dispatch(
    'transaction',
    {
      edits: [{
        documentId: second.id,
        expectedRevision: 1,
        operations: [{
          op: 'mergeCustom',
          nodeId: second.root.id,
          fields: { custom: { orbat: { personnel: { status: 'actual' } } } },
        }],
      }],
    },
    AI,
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'custom_conflict');
});

test('application state exposes resources and the export tool reports compatibility losses', async (t) => {
  const { app } = await setup(t);
  await app.dispatch('create', { name: '导出营', root: unit({ name: '导出营' }) }, AI);
  const doc = await app.dispatch('resources', {}, AI);
  assert.equal(doc.ok, true);
  assert.deepEqual(doc.catalog, { version: 1, equip: {} });
  assert.deepEqual(doc.templates, { version: 1, items: {} });

  const state = app.state();
  assert.ok(state.resources);
  assert.equal(state.resources.revision, 0);

  const exported = await app.dispatch(
    'export',
    { documentIds: [state.documents[0].id], format: 'mil-org' },
    AI,
  );
  assert.equal(exported.ok, true);
  assert.ok(Array.isArray(exported.lossReport));
  assert.ok(exported.lossReport.some((loss) => loss.code === 'internal-node-ids'));
});

test('tools expose plan, commit and resources with the same behavior', async (t) => {
  const { workspace, app } = await setup(t);
  await createDoc(app, workspace, bigRoot(2));
  const tools = createToolDefinitions(app);
  const plan = tools.find((tool) => tool.name === 'orbat_plan');
  const commit = tools.find((tool) => tool.name === 'orbat_commit');
  assert.ok(plan && commit);

  const preview = await plan.execute(
    {
      select: { text: '班' },
      operation: { kind: 'personnel', mode: 'delta', value: 1 },
      summary: '工具批量加人',
    },
    { agent: { id: 'test-agent' }, signal: new AbortController().signal },
  );
  assert.equal(preview.ok, true);
  const result = await commit.execute(
    { plan: preview.plan },
    { agent: { id: 'test-agent' }, signal: new AbortController().signal },
  );
  assert.equal(result.ok, true);
  assert.equal(workspace.snapshot().documents[0].root.children[0].personnel, 10);
});
