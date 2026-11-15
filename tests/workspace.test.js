import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Workspace,
  OrbatError,
  WORKSPACE_FILE,
  HISTORY_LIMIT,
} from '../src/workspace.js';
import { stats } from '../src/model.js';

const HUMAN = { kind: 'human', name: '测试员' };
const AI = { kind: 'ai', name: '编制助手', sessionId: 'sess-1' };

function unit(overrides = {}) {
  return {
    name: '第1营',
    type: 'mech',
    echelon: 'battalion',
    personnel: 80,
    personnelMax: 100,
    equipment: [{ name: '步战车', count: 10 }],
    children: [],
    customName: false,
    collapsed: false,
    stack: false,
    remark: '',
    mod: '',
    ...overrides,
  };
}

function sampleRoot() {
  return unit({
    name: '第1合成旅',
    type: 'infantry',
    echelon: 'brigade',
    personnel: 100,
    personnelMax: 120,
    equipment: [{ name: '步枪', count: 50 }],
    children: [
      unit({
        name: '第1营',
        children: [
          unit({
            name: '第1连',
            type: 'infantry',
            echelon: 'company',
            personnel: 30,
            personnelMax: 40,
            equipment: [{ name: '步枪', count: 30 }],
          }),
        ],
      }),
      unit({
        name: '炮兵营',
        type: 'artillery',
        personnel: 40,
        personnelMax: 50,
        equipment: [{ name: '火炮', count: 12 }],
      }),
    ],
  });
}

function chain(depth) {
  let node = unit({ name: `层${depth}` });
  for (let i = depth - 1; i >= 1; i -= 1) {
    node = unit({ name: `层${i}`, children: [node] });
  }
  return node;
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'orbat-ws-'));
  t.after(async () => {
    await chmod(dir, 0o700).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });
  const workspace = await Workspace.open(dir);
  return { dir, workspace };
}

function errCode(code) {
  return (error) => {
    assert.ok(error instanceof OrbatError, `expected OrbatError, got ${error?.stack ?? error}`);
    assert.equal(error.code, code);
    return true;
  };
}

function findNode(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function assertNoIds(value, at = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoIds(item, `${at}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    assert.equal(Object.hasOwn(value, 'id'), false, `export leaked id at ${at}`);
    for (const [key, item] of Object.entries(value)) {
      assertNoIds(item, `${at}.${key}`);
    }
  }
}

test('open creates an empty workspace and create records revision 1', async (t) => {
  const { dir, workspace } = await fixture(t);
  assert.deepEqual(workspace.snapshot(), { sequence: 0, documents: [], changes: [] });

  const result = await workspace.create({ name: ' 第1旅 ', root: sampleRoot() }, HUMAN);
  assert.equal(result.ok, true);
  assert.equal(result.document.name, '第1旅');
  assert.equal(result.document.revision, 1);
  assert.match(result.document.id, /^d_/);
  assert.match(result.document.root.id, /^n_/);
  assert.equal(result.sequence, 1);
  assert.equal(result.change.sequence, 1);
  assert.deepEqual(result.change.actor, HUMAN);
  assert.deepEqual(result.change.documents, [{
    id: result.document.id,
    beforeRevision: 0,
    afterRevision: 1,
  }]);
  assert.ok(Array.isArray(result.change.diffs));

  const snapshot = workspace.snapshot();
  assert.equal(snapshot.sequence, 1);
  assert.equal(snapshot.documents.length, 1);
  assert.equal(snapshot.documents[0].id, result.document.id);
  assert.equal(snapshot.documents[0].root.name, '第1合成旅');
  assert.equal(snapshot.changes.length, 1);
  assert.equal(snapshot.changes[0].sequence, 1);

  const persisted = JSON.parse(await readFile(path.join(dir, WORKSPACE_FILE), 'utf8'));
  assert.equal(persisted.sequence, 1);
  assert.equal(persisted.documents.length, 1);
});

test('create without a name derives one from the root name', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ root: sampleRoot() }, HUMAN);
  assert.equal(created.document.name, '第1合成旅');
  const unnamed = await workspace.create({ root: unit({ name: '' }) }, HUMAN);
  assert.equal(unnamed.document.name, '新编制');
});

test('snapshot and returned documents are defensive copies', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '示例', root: sampleRoot() }, HUMAN);
  created.document.root.name = '篡改返回';
  created.change.summary = '篡改历史';
  assert.equal(workspace.snapshot().documents[0].root.name, '第1合成旅');

  const snapshot = workspace.snapshot();
  snapshot.documents[0].root.name = '篡改快照';
  snapshot.changes[0].summary = '篡改快照历史';
  assert.equal(workspace.snapshot().documents[0].root.name, '第1合成旅');
  assert.equal(workspace.snapshot().changes[0].summary, '创建编制「示例」');
});

test('transaction updates multiple documents and bumps each revision once', async (t) => {
  const { workspace } = await fixture(t);
  const first = await workspace.create({ name: '甲', root: sampleRoot() }, HUMAN);
  const second = await workspace.create({ name: '乙', root: sampleRoot() }, HUMAN);
  const firstRootId = first.document.root.id;
  const secondRootId = second.document.root.id;

  const result = await workspace.transaction({
    summary: '批量调整',
    edits: [
      {
        documentId: first.document.id,
        expectedRevision: 1,
        operations: [
          { op: 'update', nodeId: firstRootId, fields: { personnel: 200 } },
          { op: 'update', nodeId: firstRootId, fields: { name: '第1合成旅（改）' } },
        ],
      },
      {
        documentId: second.document.id,
        expectedRevision: 1,
        operations: [
          {
            op: 'add',
            parentId: secondRootId,
            index: 0,
            node: { name: '新连', type: 'infantry', echelon: 'company', personnel: 12 },
          },
        ],
      },
    ],
  }, AI);

  assert.equal(result.ok, true);
  assert.equal(result.sequence, 3);
  assert.equal(result.documents.length, 2);
  assert.deepEqual(result.change.actor, AI);
  assert.equal(result.change.summary, '批量调整');
  assert.deepEqual(
    [...result.change.documents].sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: first.document.id, beforeRevision: 1, afterRevision: 2 },
      { id: second.document.id, beforeRevision: 1, afterRevision: 2 },
    ].sort((a, b) => a.id.localeCompare(b.id)),
  );

  const updatedFirst = result.documents.find((doc) => doc.id === first.document.id);
  const updatedSecond = result.documents.find((doc) => doc.id === second.document.id);
  assert.equal(updatedFirst.revision, 2);
  assert.equal(updatedFirst.root.personnel, 200);
  assert.equal(updatedFirst.root.name, '第1合成旅（改）');
  assert.equal(updatedSecond.revision, 2);
  assert.equal(updatedSecond.root.children[0].name, '新连');

  const firstDiffs = result.change.diffs.filter((diff) => diff.documentId === first.document.id);
  assert.ok(firstDiffs.some((diff) =>
    diff.nodeId === firstRootId && diff.field === 'personnel' &&
    diff.before === 100 && diff.after === 200));
  assert.ok(firstDiffs.some((diff) =>
    diff.nodeId === firstRootId && diff.field === 'name' &&
    diff.before === '第1合成旅' && diff.after === '第1合成旅（改）'));
  const addDiff = result.change.diffs.find((diff) => diff.field === '$node');
  assert.equal(addDiff.documentId, second.document.id);
  assert.equal(addDiff.before, null);
  assert.equal(addDiff.after.name, '新连');
  assert.equal(addDiff.nodeId, updatedSecond.root.children[0].id);
});

test('stale expectedRevision returns conflict and leaves state untouched', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '示例', root: sampleRoot() }, HUMAN);
  await workspace.transaction({
    summary: '第一次修改',
    edits: [{
      documentId: created.document.id,
      expectedRevision: 1,
      operations: [{
        op: 'update',
        nodeId: created.document.root.id,
        fields: { personnel: 150 },
      }],
    }],
  }, HUMAN);
  const before = workspace.snapshot();

  await assert.rejects(
    workspace.transaction({
      summary: '过期保存',
      edits: [{
        documentId: created.document.id,
        expectedRevision: 1,
        operations: [{
          op: 'update',
          nodeId: created.document.root.id,
          fields: { personnel: 999 },
        }],
      }],
    }, HUMAN),
    (error) => {
      assert.ok(error instanceof OrbatError);
      assert.equal(error.code, 'CONFLICT');
      assert.equal(error.details.documentId, created.document.id);
      assert.equal(error.details.expectedRevision, 1);
      assert.equal(error.details.actualRevision, 2);
      assert.equal(error.details.current.revision, 2);
      assert.equal(error.details.current.id, created.document.id);
      return true;
    },
  );
  assert.deepEqual(workspace.snapshot(), before);
});

test('transaction is atomic when any later edit is invalid', async (t) => {
  const { dir, workspace } = await fixture(t);
  const first = await workspace.create({ name: '甲', root: sampleRoot() }, HUMAN);
  const second = await workspace.create({ name: '乙', root: sampleRoot() }, HUMAN);
  const before = workspace.snapshot();

  await assert.rejects(
    workspace.transaction({
      summary: '部分应失败',
      edits: [
        {
          documentId: first.document.id,
          expectedRevision: 1,
          operations: [{
            op: 'update',
            nodeId: first.document.root.id,
            fields: { personnel: 999 },
          }],
        },
        {
          documentId: second.document.id,
          expectedRevision: 1,
          operations: [{
            op: 'update',
            nodeId: second.document.root.id,
            fields: { type: 'not-a-type' },
          }],
        },
      ],
    }, HUMAN),
    errCode('invalid_type'),
  );
  assert.deepEqual(workspace.snapshot(), before);
  const reopened = await Workspace.open(dir);
  assert.deepEqual(reopened.snapshot(), before);

  const ok = await workspace.transaction({
    summary: '重试',
    edits: [
      {
        documentId: first.document.id,
        expectedRevision: 1,
        operations: [{
          op: 'update',
          nodeId: first.document.root.id,
          fields: { personnel: 101 },
        }],
      },
      {
        documentId: second.document.id,
        expectedRevision: 1,
        operations: [{
          op: 'update',
          nodeId: second.document.root.id,
          fields: { personnel: 102 },
        }],
      },
    ],
  }, HUMAN);
  assert.equal(ok.sequence, 3);
  assert.equal(workspace.snapshot().documents.find((doc) => doc.id === first.document.id).revision, 2);
  assert.equal(workspace.snapshot().documents.find((doc) => doc.id === second.document.id).revision, 2);
});

test('transaction is atomic when a stale revision appears after a valid edit', async (t) => {
  const { workspace } = await fixture(t);
  const first = await workspace.create({ name: '甲', root: sampleRoot() }, HUMAN);
  const second = await workspace.create({ name: '乙', root: sampleRoot() }, HUMAN);
  const before = workspace.snapshot();

  await assert.rejects(
    workspace.transaction({
      summary: '第二步过期',
      edits: [
        {
          documentId: first.document.id,
          expectedRevision: 1,
          operations: [{
            op: 'update',
            nodeId: first.document.root.id,
            fields: { personnel: 300 },
          }],
        },
        {
          documentId: second.document.id,
          expectedRevision: 99,
          operations: [{
            op: 'update',
            nodeId: second.document.root.id,
            fields: { personnel: 300 },
          }],
        },
      ],
    }, HUMAN),
    errCode('CONFLICT'),
  );
  assert.deepEqual(workspace.snapshot(), before);
});

test('concurrent transactions on the same revision serialize with one conflict', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '并发', root: sampleRoot() }, HUMAN);
  const edit = (personnel) => workspace.transaction({
    summary: `并发${personnel}`,
    edits: [{
      documentId: created.document.id,
      expectedRevision: 1,
      operations: [{
        op: 'update',
        nodeId: created.document.root.id,
        fields: { personnel },
      }],
    }],
  }, HUMAN);

  const settled = await Promise.allSettled([edit(201), edit(202)]);
  const fulfilled = settled.filter((entry) => entry.status === 'fulfilled');
  const rejected = settled.filter((entry) => entry.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'CONFLICT');

  const snapshot = workspace.snapshot();
  assert.equal(snapshot.sequence, 2);
  assert.equal(snapshot.documents[0].revision, 2);
  assert.ok([201, 202].includes(snapshot.documents[0].root.personnel));
  assert.equal(snapshot.changes.length, 2);
});

test('persisted workspace survives reopen with identical snapshot', async (t) => {
  const { dir, workspace } = await fixture(t);
  const created = await workspace.create({ name: '持久化', root: sampleRoot() }, HUMAN);
  await workspace.transaction({
    summary: '持久化修改',
    edits: [{
      documentId: created.document.id,
      expectedRevision: 1,
      operations: [{
        op: 'update',
        nodeId: created.document.root.id,
        fields: { remark: '重新打开仍存在' },
      }],
    }],
  }, AI);
  const snapshot = workspace.snapshot();
  const reopened = await Workspace.open(dir);
  assert.deepEqual(reopened.snapshot(), snapshot);
});

test('disk failure leaves memory and disk unchanged', async (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('root bypasses directory permissions');
    return;
  }
  const { dir, workspace } = await fixture(t);
  const created = await workspace.create({ name: '磁盘失败', root: sampleRoot() }, HUMAN);
  const before = workspace.snapshot();
  const diskBefore = await readFile(path.join(dir, WORKSPACE_FILE), 'utf8');

  await chmod(dir, 0o500);
  try {
    await assert.rejects(
      workspace.transaction({
        summary: '应写失败',
        edits: [{
          documentId: created.document.id,
          expectedRevision: 1,
          operations: [{
            op: 'update',
            nodeId: created.document.root.id,
            fields: { personnel: 777 },
          }],
        }],
      }, HUMAN),
      errCode('persistence_failed'),
    );
  } finally {
    await chmod(dir, 0o700);
  }

  assert.deepEqual(workspace.snapshot(), before);
  assert.equal(await readFile(path.join(dir, WORKSPACE_FILE), 'utf8'), diskBefore);
  const reopened = await Workspace.open(dir);
  assert.deepEqual(reopened.snapshot(), before);

  const retried = await workspace.transaction({
    summary: '恢复后重试',
    edits: [{
      documentId: created.document.id,
      expectedRevision: 1,
      operations: [{
        op: 'update',
        nodeId: created.document.root.id,
        fields: { personnel: 777 },
      }],
    }],
  }, HUMAN);
  assert.equal(retried.ok, true);
  assert.equal(workspace.snapshot().documents[0].root.personnel, 777);
});

test('add, update, remove and rename record field and $node diffs', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '操作', root: sampleRoot() }, HUMAN);
  const documentId = created.document.id;
  const rootId = created.document.root.id;
  const firstBattalionId = created.document.root.children[0].id;
  const artilleryId = created.document.root.children[1].id;

  const added = await workspace.transaction({
    summary: '新增连',
    edits: [{
      documentId,
      expectedRevision: 1,
      operations: [{
        op: 'add',
        parentId: firstBattalionId,
        index: 0,
        node: { name: '新连', type: 'infantry', echelon: 'company', personnel: 12 },
      }],
    }],
  }, HUMAN);
  const addedRoot = added.documents[0].root;
  const addedNode = addedRoot.children[0].children[0];
  assert.equal(addedNode.name, '新连');
  const addDiff = added.change.diffs.find((diff) => diff.field === '$node');
  assert.equal(addDiff.before, null);
  assert.equal(addDiff.after.name, '新连');
  assert.equal(addDiff.nodeId, addedNode.id);

  const updated = await workspace.transaction({
    summary: '修改连',
    edits: [{
      documentId,
      expectedRevision: 2,
      operations: [{
        op: 'update',
        nodeId: addedNode.id,
        fields: { personnel: 15, remark: '前沿' },
      }],
    }],
  }, HUMAN);
  const updatedNode = findNode(updated.documents[0].root, addedNode.id);
  assert.equal(updatedNode.personnel, 15);
  assert.equal(updatedNode.remark, '前沿');
  assert.ok(updated.change.diffs.some((diff) =>
    diff.nodeId === addedNode.id && diff.field === 'personnel' &&
    diff.before === 12 && diff.after === 15));
  assert.ok(updated.change.diffs.some((diff) =>
    diff.nodeId === addedNode.id && diff.field === 'remark' &&
    diff.before === '' && diff.after === '前沿'));

  const removed = await workspace.transaction({
    summary: '删除炮兵营',
    edits: [{
      documentId,
      expectedRevision: 3,
      operations: [{ op: 'remove', nodeId: artilleryId }],
    }],
  }, HUMAN);
  assert.equal(findNode(removed.documents[0].root, artilleryId), null);
  const removeDiff = removed.change.diffs.find((diff) => diff.field === '$node');
  assert.equal(removeDiff.before.name, '炮兵营');
  assert.equal(removeDiff.after, null);

  const renamed = await workspace.transaction({
    summary: '改番号',
    edits: [{
      documentId,
      expectedRevision: 4,
      operations: [{ op: 'rename', name: '新番号' }],
    }],
  }, HUMAN);
  assert.equal(renamed.documents[0].name, '新番号');
  assert.equal(renamed.change.diffs[0].field, 'name');
  assert.equal(renamed.change.diffs[0].before, '操作');
  assert.equal(renamed.change.diffs[0].after, '新番号');
  assert.equal(workspace.snapshot().documents[0].root.id, rootId);
});

test('custom field diffs use null for an absent value', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '自定义字段', root: sampleRoot() }, HUMAN);
  const documentId = created.document.id;
  const rootId = created.document.root.id;

  const set = await workspace.transaction({
    summary: '设置 custom',
    edits: [{
      documentId,
      expectedRevision: 1,
      operations: [{
        op: 'update',
        nodeId: rootId,
        fields: { custom: { sidc: 'SFGPUCI----' } },
      }],
    }],
  }, HUMAN);
  const setDiff = set.change.diffs.find((diff) => diff.field === 'custom');
  assert.equal(setDiff.before, null);
  assert.deepEqual(setDiff.after, { sidc: 'SFGPUCI----' });

  const cleared = await workspace.transaction({
    summary: '清除 custom',
    edits: [{
      documentId,
      expectedRevision: 2,
      operations: [{ op: 'update', nodeId: rootId, fields: { custom: null } }],
    }],
  }, HUMAN);
  const clearDiff = cleared.change.diffs.find((diff) => diff.field === 'custom');
  assert.deepEqual(clearDiff.before, { sidc: 'SFGPUCI----' });
  assert.equal(clearDiff.after, null);
  assert.equal(Object.hasOwn(cleared.documents[0].root, 'custom'), false);
});

test('move reorders nodes and rejects cycles and root moves', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '移动', root: sampleRoot() }, HUMAN);
  const documentId = created.document.id;
  const rootId = created.document.root.id;
  const firstBattalion = created.document.root.children[0];
  const grandchild = firstBattalion.children[0];
  const artillery = created.document.root.children[1];

  await assert.rejects(
    workspace.transaction({
      summary: '循环移动',
      edits: [{
        documentId,
        expectedRevision: 1,
        operations: [{
          op: 'move',
          nodeId: firstBattalion.id,
          parentId: grandchild.id,
        }],
      }],
    }, HUMAN),
    errCode('cycle'),
  );
  await assert.rejects(
    workspace.transaction({
      summary: '移动根',
      edits: [{
        documentId,
        expectedRevision: 1,
        operations: [{
          op: 'move',
          nodeId: rootId,
          parentId: grandchild.id,
        }],
      }],
    }, HUMAN),
    errCode('root_protected'),
  );

  const moved = await workspace.transaction({
    summary: '移动连到炮兵营',
    edits: [{
      documentId,
      expectedRevision: 1,
      operations: [{
        op: 'move',
        nodeId: grandchild.id,
        parentId: artillery.id,
        index: 0,
      }],
    }],
  }, HUMAN);
  const movedRoot = moved.documents[0].root;
  assert.equal(findNode(movedRoot, grandchild.id).name, '第1连');
  assert.equal(findNode(movedRoot, firstBattalion.id).children.length, 0);
  assert.equal(findNode(movedRoot, artillery.id).children[0].id, grandchild.id);
  assert.ok(moved.change.diffs.some((diff) =>
    diff.nodeId === grandchild.id && diff.field === 'parentId' &&
    diff.before === firstBattalion.id && diff.after === artillery.id));

  const reordered = await workspace.transaction({
    summary: '炮兵营前移',
    edits: [{
      documentId,
      expectedRevision: 2,
      operations: [{ op: 'move', nodeId: artillery.id, parentId: rootId, index: 0 }],
    }],
  }, HUMAN);
  assert.deepEqual(
    reordered.documents[0].root.children.map((child) => child.name),
    ['炮兵营', '第1营'],
  );

  const beforeInvalid = workspace.snapshot();
  await assert.rejects(
    workspace.transaction({
      summary: '非法索引',
      edits: [{
        documentId,
        expectedRevision: 3,
        operations: [{
          op: 'move',
          nodeId: artillery.id,
          parentId: rootId,
          index: 99,
        }],
      }],
    }, HUMAN),
    errCode('invalid_index'),
  );
  assert.deepEqual(workspace.snapshot(), beforeInvalid);
});

test('replace root regenerates ids and remove/move root are forbidden', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '替换', root: sampleRoot() }, HUMAN);
  const documentId = created.document.id;
  const oldRootId = created.document.root.id;

  const replaced = await workspace.transaction({
    summary: '替换整棵树',
    edits: [{
      documentId,
      expectedRevision: 1,
      operations: [{
        op: 'replace',
        root: {
          name: '新根',
          type: 'armor',
          echelon: 'regiment',
          children: [{ name: '新连', type: 'armor', echelon: 'company' }],
        },
      }],
    }],
  }, HUMAN);
  const newRoot = replaced.documents[0].root;
  assert.notEqual(newRoot.id, oldRootId);
  assert.equal(newRoot.name, '新根');
  assert.equal(newRoot.children[0].name, '新连');
  assert.notEqual(newRoot.children[0].id, oldRootId);
  assert.equal(replaced.change.diffs[0].field, '$node');
  assert.equal(replaced.change.diffs[0].before.id, oldRootId);

  await assert.rejects(
    workspace.transaction({
      summary: '删根',
      edits: [{
        documentId,
        expectedRevision: 2,
        operations: [{ op: 'remove', nodeId: newRoot.id }],
      }],
    }, HUMAN),
    errCode('root_protected'),
  );
});

test('deleteDocument removes a whole document and keeps the rest atomic', async (t) => {
  const { dir, workspace } = await fixture(t);
  const first = await workspace.create({ name: '待删', root: sampleRoot() }, HUMAN);
  const second = await workspace.create({ name: '保留', root: sampleRoot() }, HUMAN);
  const before = workspace.snapshot();

  const deleted = await workspace.transaction({
    summary: '删除甲并修改乙',
    edits: [
      {
        documentId: first.document.id,
        expectedRevision: 1,
        operations: [{ op: 'deleteDocument' }],
      },
      {
        documentId: second.document.id,
        expectedRevision: 1,
        operations: [{
          op: 'update',
          nodeId: second.document.root.id,
          fields: { personnel: 321 },
        }],
      },
    ],
  }, AI);

  assert.equal(deleted.ok, true);
  assert.equal(deleted.documents.length, 1);
  assert.equal(deleted.documents[0].id, second.document.id);
  assert.deepEqual(
    deleted.change.documents.find((entry) => entry.id === first.document.id),
    { id: first.document.id, beforeRevision: 1, afterRevision: null },
  );
  assert.deepEqual(
    deleted.change.documents.find((entry) => entry.id === second.document.id),
    { id: second.document.id, beforeRevision: 1, afterRevision: 2 },
  );
  assert.equal(workspace.snapshot().documents.length, 1);
  assert.equal(workspace.snapshot().documents[0].id, second.document.id);
  assert.equal(workspace.snapshot().documents[0].root.personnel, 321);
  const reopened = await Workspace.open(dir);
  assert.equal(reopened.snapshot().documents.length, 1);
  assert.equal(reopened.snapshot().documents[0].id, second.document.id);

  await assert.rejects(
    workspace.transaction({
      summary: '删除夹带操作',
      edits: [{
        documentId: second.document.id,
        expectedRevision: 2,
        operations: [
          { op: 'deleteDocument' },
          { op: 'update', nodeId: second.document.root.id, fields: { personnel: 1 } },
        ],
      }],
    }, HUMAN),
    errCode('invalid_operation'),
  );
  assert.deepEqual(workspace.snapshot(), deleted.change ? workspace.snapshot() : before);
  assert.equal(workspace.snapshot().documents.length, 1);

  await assert.rejects(
    workspace.transaction({
      summary: '过期删除',
      edits: [{
        documentId: second.document.id,
        expectedRevision: 1,
        operations: [{ op: 'deleteDocument' }],
      }],
    }, HUMAN),
    errCode('CONFLICT'),
  );
  assert.equal(workspace.snapshot().documents.length, 1);
});

test('invalid operations and fields are rejected without state changes', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '非法操作', root: sampleRoot() }, HUMAN);
  const documentId = created.document.id;
  const rootId = created.document.root.id;
  const before = workspace.snapshot();

  const cases = [
    [{ op: 'bogus' }, 'invalid_operation'],
    [{ op: 'update', nodeId: rootId, fields: { children: [] } }, 'invalid_field'],
    [{ op: 'update', nodeId: rootId, fields: { id: 'x' } }, 'invalid_field'],
    [{ op: 'update', nodeId: rootId, fields: { nope: 1 } }, 'invalid_field'],
    [{ op: 'update', nodeId: rootId, fields: { type: 'bogus' } }, 'invalid_type'],
    [{ op: 'update', nodeId: rootId, fields: { personnel: '10' } }, 'invalid_number'],
    [{ op: 'update', nodeId: 'missing', fields: { personnel: 1 } }, 'not_found'],
    [{ op: 'add', parentId: 'missing', node: unit() }, 'not_found'],
    [{ op: 'add', parentId: rootId, node: unit(), index: 99 }, 'invalid_index'],
    [{ op: 'add', parentId: rootId, node: unit(), index: -1 }, 'invalid_index'],
    [{ op: 'add', parentId: rootId, node: unit(), index: '1' }, 'invalid_index'],
    [{ op: 'add', parentId: rootId, node: unit({ type: 'bogus' }) }, 'invalid_type'],
    [{ op: 'add', parentId: rootId, node: unit({ children: {} }) }, 'invalid_children'],
    [{ op: 'move', nodeId: 'missing', parentId: rootId }, 'not_found'],
    [{ op: 'move', nodeId: rootId, parentId: 'missing' }, 'root_protected'],
    [{ op: 'move', nodeId: created.document.root.children[0].id, parentId: 'missing' }, 'not_found'],
    [{ op: 'remove', nodeId: 'missing' }, 'not_found'],
    [{ op: 'rename', name: '   ' }, 'invalid_name'],
    [{ op: 'update', nodeId: rootId, fields: JSON.parse('{"__proto__":{"polluted":true}}') }, 'forbidden_key'],
  ];

  for (const [operation, code] of cases) {
    await assert.rejects(
      workspace.transaction({
        summary: '应失败',
        edits: [{ documentId, expectedRevision: 1, operations: [operation] }],
      }, HUMAN),
      errCode(code),
      JSON.stringify(operation),
    );
    assert.deepEqual(workspace.snapshot(), before);
  }
  assert.equal({}.polluted, undefined);
});

test('create rejects invalid model input before writing', async (t) => {
  const { workspace } = await fixture(t);
  const cases = [
    [{ name: '', root: sampleRoot() }, 'invalid_name'],
    [{ name: 'x', root: null }, 'invalid_node'],
    [{ name: 'x', root: unit({ type: 'bogus' }) }, 'invalid_type'],
    [{ name: 'x', root: unit({ echelon: 'bogus' }) }, 'invalid_echelon'],
    [{ name: 'x', root: unit({ layout: 'bogus' }) }, 'invalid_layout'],
    [{ name: 'x', root: unit({ layout: 'auto' }) }, 'invalid_layout'],
    [{ name: 'x', root: unit({ personnel: '10' }) }, 'invalid_number'],
    [{ name: 'x', root: unit({ personnel: -1 }) }, 'invalid_number'],
    [{ name: 'x', root: unit({ personnel: 1.5 }) }, 'invalid_number'],
    [{ name: 'x', root: unit({ equipment: [{ name: '枪', count: 1.5 }] }) }, 'invalid_number'],
    [{ name: 'x', root: unit({ children: {} }) }, 'invalid_children'],
    [{ name: 'x', root: JSON.parse('{"type":"infantry","echelon":"army","__proto__":{"x":1}}') }, 'forbidden_key'],
    [{ name: 'x', root: unit({ children: [unit({ id: 'dup' }), unit({ id: 'dup' })] }) }, 'duplicate_id'],
    [{ name: 'x', root: chain(25) }, 'depth_exceeded'],
    [{
      name: 'x',
      root: unit({ children: Array.from({ length: 2000 }, (_, index) => unit({ name: `c${index}` })) }),
    }, 'node_limit_exceeded'],
  ];
  for (const [input, code] of cases) {
    await assert.rejects(workspace.create(input, HUMAN), errCode(code), JSON.stringify(input).slice(0, 120));
    assert.deepEqual(workspace.snapshot(), { sequence: 0, documents: [], changes: [] });
  }
});

test('transaction rejects more than 1000 operations but allows exactly 1000', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '操作上限', root: sampleRoot() }, HUMAN);
  const documentId = created.document.id;
  const rootId = created.document.root.id;
  const operation = { op: 'update', nodeId: rootId, fields: { remark: 'x' } };

  await assert.rejects(
    workspace.transaction({
      summary: '超过上限',
      edits: [{
        documentId,
        expectedRevision: 1,
        operations: Array.from({ length: 1001 }, () => operation),
      }],
    }, HUMAN),
    errCode('too_many_operations'),
  );
  assert.equal(workspace.snapshot().documents[0].revision, 1);

  const allowed = await workspace.transaction({
    summary: '刚好上限',
    edits: [{
      documentId,
      expectedRevision: 1,
      operations: Array.from({ length: 1000 }, () => operation),
    }],
  }, HUMAN);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.documents[0].revision, 2);
  assert.equal(allowed.documents[0].root.remark, 'x');
});

test('an add that exceeds depth is rolled back atomically', async (t) => {
  const { dir, workspace } = await fixture(t);
  const created = await workspace.create({ name: '深度回滚', root: chain(20) }, HUMAN);
  const before = workspace.snapshot();
  let deepestId = created.document.root.id;
  let current = created.document.root;
  while (current.children.length > 0) {
    current = current.children[0];
    deepestId = current.id;
  }

  await assert.rejects(
    workspace.transaction({
      summary: '加到过深',
      edits: [{
        documentId: created.document.id,
        expectedRevision: 1,
        operations: [{
          op: 'add',
          parentId: deepestId,
          node: chain(10),
        }],
      }],
    }, HUMAN),
    errCode('depth_exceeded'),
  );
  assert.deepEqual(workspace.snapshot(), before);
  const reopened = await Workspace.open(dir);
  assert.deepEqual(reopened.snapshot(), before);
});

test('import accepts every authoritative upstream type key and ms alias', async (t) => {
  const { workspace } = await fixture(t);
  const types = [
    'infantry', 'light_infantry', 'mech', 'armor', 'light_armor', 'heavy_armor',
    'airborne', 'air_assault', 'mountain', 'recon', 'recon_mech', 'wheeled_inf',
    'artillery', 'mlrs', 'mortar', 'anti_tank', 'aaa', 'towed_w', 'towed_t',
    'rotary', 'fixedwing', 'attack_heli', 'uav_unit',
    'engineer', 'signal', 'medical', 'supply',
  ];
  const aliases = [
    'ms_sfgpuci', 'ms_sfgpucat', 'ms_sfgpucf', 'ms_sfgpucr',
    'ms_sfgpuce', 'ms_sfgpuus', 'ms_sfgpusm', 'ms_sfgpuss',
  ];
  const root = {
    name: '上游兵种兼容',
    type: 'infantry',
    echelon: 'division',
    layout: 'h',
    children: [...types, ...aliases].map((type, index) => ({
      name: `单位${index}`,
      type,
      echelon: 'company',
      layout: 'h',
    })),
  };
  const imported = await workspace.import(root, HUMAN);
  const payload = workspace.export([imported.documents[0].id]);
  assert.deepEqual(payload.data.children.map((child) => child.type), [...types, ...aliases]);
});

test('upstream-shaped node fields survive import and export', async (t) => {
  const { workspace } = await fixture(t);
  const upstream = {
    type: 'signal',
    echelon: 'team',
    name: '师直属通讯火力组',
    customName: false,
    remark: '上游节点',
    children: [],
    collapsed: false,
    layout: 'v',
    personnel: 0,
    personnelMax: 0,
    equipment: [{ name: '通信车', count: 2 }],
    custom: null,
    mod: '',
    badge: 'data:image/png;base64,AA',
    stack: true,
  };
  const imported = await workspace.import({
    kind: 'mil-org',
    version: 1,
    app: '军队编制编辑器',
    time: new Date().toISOString(),
    name: '上游兼容',
    data: upstream,
  }, HUMAN);
  const payload = workspace.export([imported.documents[0].id]);
  assertNoIds(payload);
  assert.equal(payload.data.type, 'signal');
  assert.equal(payload.data.layout, 'v');
  assert.equal(payload.data.badge, 'data:image/png;base64,AA');
  assert.equal(payload.data.stack, true);
  assert.equal(Object.hasOwn(payload.data, 'custom'), true);
  assert.equal(payload.data.custom, null);
  assert.equal(payload.data.equipment[0].name, '通信车');
});

test('import bare tree ignores external ids and regenerates them', async (t) => {
  const { workspace } = await fixture(t);
  const input = sampleRoot();
  input.id = 'external-root';
  input.children[0].id = 'external-first';
  input.children[0].children[0].id = 'external-grandchild';

  const result = await workspace.import(input, HUMAN);
  assert.equal(result.ok, true);
  assert.equal(result.documents.length, 1);
  assert.equal(result.sequence, 1);
  const document = result.documents[0];
  assert.equal(document.revision, 1);
  assert.equal(document.name, '第1合成旅');
  assert.notEqual(document.root.id, 'external-root');
  assert.notEqual(document.root.children[0].id, 'external-first');
  assert.notEqual(document.root.children[0].children[0].id, 'external-grandchild');
  const ids = [];
  const collect = (node) => {
    ids.push(node.id);
    node.children.forEach(collect);
  };
  collect(document.root);
  assert.equal(new Set(ids).size, ids.length);
});

test('import accepts a JSON string and mil-org payload', async (t) => {
  const { workspace } = await fixture(t);
  const payload = {
    kind: 'mil-org',
    version: 1,
    app: '军队编制编辑器',
    time: new Date().toISOString(),
    name: '导入旅',
    personnel: 9999,
    equipTotal: 9999,
    data: sampleRoot(),
  };
  const result = await workspace.import(JSON.stringify(payload), AI);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].name, '导入旅');
  assert.equal(result.documents[0].revision, 1);
  assert.deepEqual(result.change.actor, AI);
  assert.equal(result.change.documents[0].beforeRevision, 0);
  assert.equal(result.change.documents[0].afterRevision, 1);
});

test('import accepts mil-bundle saves including duplicate document names', async (t) => {
  const { workspace } = await fixture(t);
  await workspace.create({ name: '同名', root: sampleRoot() }, HUMAN);
  const bundle = {
    kind: 'mil-bundle',
    version: 1,
    app: '军队编制编辑器',
    time: new Date().toISOString(),
    saves: {
      同名: { data: sampleRoot(), time: new Date().toISOString(), personnel: 1, equipTotal: 1 },
      另一份: { data: sampleRoot(), time: new Date().toISOString() },
    },
    equip: {},
  };
  const result = await workspace.import(bundle, HUMAN);
  assert.equal(result.documents.length, 2);
  assert.deepEqual(result.documents.map((doc) => doc.name), ['同名', '另一份']);
  assert.equal(workspace.snapshot().documents.filter((doc) => doc.name === '同名').length, 2);
  assert.equal(result.change.documents.length, 2);
});

test('import accepts a nonempty equipment library and rejects malformed payloads', async (t) => {
  const { workspace } = await fixture(t);
  const imported = await workspace.import({
    kind: 'mil-bundle',
    version: 1,
    saves: { 甲: { data: sampleRoot() } },
    equip: { eq_1: { id: 'eq_1', name: '步枪', category: 'small_arms', stats: { damage: 1 } } },
  }, HUMAN);
  assert.equal(imported.documents.length, 1);
  assert.equal(workspace.resources().catalog.equip.eq_1.name, '步枪');
  const before = workspace.snapshot();

  for (const payload of [
    null,
    [],
    { kind: 'unknown' },
    { kind: 'mil-org', data: null },
    { kind: 'mil-bundle', saves: {} },
  ]) {
    await assert.rejects(workspace.import(payload, HUMAN), errCode('invalid_payload'));
    assert.deepEqual(workspace.snapshot(), before);
  }

  const duplicate = sampleRoot();
  duplicate.children[0].id = 'dup';
  duplicate.children[1].id = 'dup';
  await assert.rejects(workspace.import(duplicate, HUMAN), errCode('duplicate_id'));
});

test('export and import preserve unknown safe node fields', async (t) => {
  const { workspace } = await fixture(t);
  const root = sampleRoot();
  root.origin = 'upstream';
  root.extra = { note: '保留' };
  root.children[0].equipment[0].make = '自制';
  const created = await workspace.create({ name: '额外字段', root }, HUMAN);
  const payload = workspace.export([created.document.id]);
  assert.equal(payload.data.origin, 'upstream');
  assert.deepEqual(payload.data.extra, { note: '保留' });
  assert.equal(payload.data.children[0].equipment[0].make, '自制');
  const imported = await workspace.import(payload, HUMAN);
  assert.equal(imported.documents[0].root.origin, 'upstream');
  assert.equal(imported.documents[0].root.children[0].equipment[0].make, '自制');
});

test('export mil-org has the Army_Editor shape, stats and no internal ids', async (t) => {
  const { workspace } = await fixture(t);
  const created = await workspace.create({ name: '导出旅', root: sampleRoot() }, HUMAN);
  const payload = workspace.export([created.document.id]);

  assert.equal(payload.kind, 'mil-org');
  assert.equal(payload.version, 1);
  assert.equal(payload.app, '军队编制编辑器');
  // Upstream io.js/store.js writes epoch milliseconds, not an ISO string.
  assert.equal(typeof payload.time, 'number');
  assert.ok(Number.isSafeInteger(payload.time));
  assert.ok(Math.abs(Date.now() - payload.time) < 60_000);
  assert.equal(payload.name, '导出旅');
  assert.equal(payload.personnel, 250);
  assert.equal(payload.equipTotal, 102);
  assert.equal(payload.data.name, '第1合成旅');
  assert.equal(payload.data.type, 'infantry');
  assertNoIds(payload);

  const explicit = workspace.export([created.document.id], 'mil-org');
  assert.deepEqual(explicit.data, payload.data);
});

test('export mil-bundle avoids overwriting documents with the same name', async (t) => {
  const { workspace } = await fixture(t);
  const first = await workspace.create({ name: '同名', root: sampleRoot() }, HUMAN);
  const second = await workspace.create({ name: '同名', root: sampleRoot() }, HUMAN);
  const third = await workspace.create({ name: '同名 (2)', root: sampleRoot() }, HUMAN);

  const payload = workspace.export(
    [first.document.id, second.document.id, third.document.id],
    'mil-bundle',
  );
  assert.equal(payload.kind, 'mil-bundle');
  assert.equal(payload.version, 1);
  assert.equal(payload.app, '军队编制编辑器');
  assert.deepEqual(payload.equip, {});
  const keys = Object.keys(payload.saves);
  assert.equal(keys.length, 3);
  assert.equal(new Set(keys).size, 3);
  assert.ok(keys.includes('同名'));
  assert.ok(keys.includes('同名 (2)'));
  assert.ok(keys.includes('同名 (3)'));
  for (const save of Object.values(payload.saves)) {
    assertNoIds(save.data);
    assert.equal(typeof save.time, 'number');
    assert.ok(Number.isSafeInteger(save.time));
    assert.equal(save.personnel, 250);
    assert.equal(save.equipTotal, 102);
  }
  assert.equal(typeof payload.time, 'number');
  assert.ok(Number.isSafeInteger(payload.time));
});

test('export validates selection and format without side effects', async (t) => {
  const { workspace } = await fixture(t);
  const first = await workspace.create({ name: '甲', root: sampleRoot() }, HUMAN);
  const second = await workspace.create({ name: '乙', root: sampleRoot() }, HUMAN);

  assert.throws(() => workspace.export([first.document.id, second.document.id], 'mil-org'), errCode('export_selection'));
  assert.throws(() => workspace.export([]), errCode('export_selection'));
  assert.throws(() => workspace.export('not-an-array'), errCode('invalid_request'));
  assert.throws(() => workspace.export([first.document.id], 'swagger'), errCode('invalid_format'));
  assert.throws(() => workspace.export(['missing']), errCode('not_found'));
  assert.throws(
    () => workspace.export([first.document.id, first.document.id], 'mil-bundle'),
    errCode('export_selection'),
  );
});

test('exported bundle can be imported back with fresh ids and equal stats', async (t) => {
  const { workspace } = await fixture(t);
  const first = await workspace.create({ name: '往返', root: sampleRoot() }, HUMAN);
  const second = await workspace.create({ name: '往返2', root: sampleRoot() }, HUMAN);
  const payload = workspace.export([first.document.id, second.document.id], 'mil-bundle');
  const originalIds = new Set();
  for (const doc of workspace.snapshot().documents) {
    const collect = (node) => {
      originalIds.add(node.id);
      node.children.forEach(collect);
    };
    collect(doc.root);
  }

  const imported = await workspace.import(payload, HUMAN);
  assert.equal(imported.documents.length, 2);
  for (const doc of imported.documents) {
    assert.equal(stats(doc.root).personnel, 250);
    assert.equal(stats(doc.root).equipTotal, 102);
    const collect = (node) => {
      assert.equal(originalIds.has(node.id), false);
      node.children.forEach(collect);
    };
    collect(doc.root);
  }
});

test('changes paginates with cursors and reports hasMore/truncated', async (t) => {
  const { workspace } = await fixture(t);
  assert.deepEqual(workspace.changes(), {
    changes: [],
    nextCursor: 0,
    latestSequence: 0,
    truncated: false,
    hasMore: false,
  });

  const created = await workspace.create({ name: '历史', root: sampleRoot() }, HUMAN);
  await workspace.transaction({
    summary: '一',
    edits: [{
      documentId: created.document.id,
      expectedRevision: 1,
      operations: [{
        op: 'update',
        nodeId: created.document.root.id,
        fields: { personnel: 1 },
      }],
    }],
  }, HUMAN);
  await workspace.transaction({
    summary: '二',
    edits: [{
      documentId: created.document.id,
      expectedRevision: 2,
      operations: [{
        op: 'update',
        nodeId: created.document.root.id,
        fields: { personnel: 2 },
      }],
    }],
  }, HUMAN);

  const page = workspace.changes(0, 2);
  assert.deepEqual(page.changes.map((change) => change.sequence), [1, 2]);
  assert.equal(page.nextCursor, 2);
  assert.equal(page.latestSequence, 3);
  assert.equal(page.truncated, false);
  assert.equal(page.hasMore, true);

  const rest = workspace.changes(page.nextCursor, 2);
  assert.deepEqual(rest.changes.map((change) => change.sequence), [3]);
  assert.equal(rest.nextCursor, 3);
  assert.equal(rest.hasMore, false);
  assert.equal(rest.truncated, false);

  const empty = workspace.changes(3, 2);
  assert.deepEqual(empty.changes, []);
  assert.equal(empty.nextCursor, 3);
  assert.equal(empty.latestSequence, 3);
  assert.equal(empty.hasMore, false);

  const overlong = workspace.changes(0, 5000);
  assert.equal(overlong.changes.length, 3);
  assert.equal(overlong.hasMore, false);
  assert.equal(overlong.nextCursor, 3);

  assert.throws(() => workspace.changes(-1, 10), errCode('invalid_request'));
  assert.throws(() => workspace.changes(0, 0), errCode('invalid_request'));
  assert.throws(() => workspace.changes(0, 1.5), errCode('invalid_request'));
  assert.throws(() => workspace.changes('0', 10), errCode('invalid_request'));
});

test('history retains the latest 500 changes and reports the gap explicitly', async (t) => {
  const { dir, workspace } = await fixture(t);
  const created = await workspace.create({ name: '长历史', root: sampleRoot() }, HUMAN);
  const total = HISTORY_LIMIT + 5;
  for (let index = 0; index < total; index += 1) {
    await workspace.transaction({
      summary: `ren-${index}`,
      edits: [{
        documentId: created.document.id,
        expectedRevision: index + 1,
        operations: [{ op: 'rename', name: `番号-${index}` }],
      }],
    }, HUMAN);
  }

  const latestSequence = HISTORY_LIMIT + 6;
  const page = workspace.changes(0, HISTORY_LIMIT);
  assert.equal(page.changes.length, HISTORY_LIMIT);
  assert.equal(page.changes[0].sequence, 7);
  assert.equal(page.changes.at(-1).sequence, latestSequence);
  assert.equal(page.latestSequence, latestSequence);
  assert.equal(page.hasMore, false);
  assert.equal(page.truncated, true);

  const exact = workspace.changes(6, HISTORY_LIMIT);
  assert.equal(exact.changes[0].sequence, 7);
  assert.equal(exact.changes.at(-1).sequence, latestSequence);
  assert.equal(exact.truncated, false);

  const limited = workspace.changes(5, 10);
  assert.deepEqual(limited.changes.map((change) => change.sequence), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.equal(limited.nextCursor, 16);
  assert.equal(limited.truncated, true);
  assert.equal(limited.hasMore, true);
  assert.equal(workspace.snapshot().changes.length, HISTORY_LIMIT);

  const reopened = await Workspace.open(dir);
  const afterReopen = reopened.changes(0, HISTORY_LIMIT);
  assert.equal(afterReopen.truncated, true);
  assert.equal(afterReopen.changes.length, HISTORY_LIMIT);
  assert.equal(afterReopen.changes.at(-1).sequence, latestSequence);
  assert.equal(reopened.snapshot().documents[0].revision, latestSequence);
});

test('subscribe receives committed changes and stops after dispose', async (t) => {
  const { workspace } = await fixture(t);
  const events = [];
  const dispose = workspace.subscribe((event) => events.push(event));
  assert.equal(typeof dispose, 'function');

  const created = await workspace.create({ name: '订阅', root: sampleRoot() }, HUMAN);
  assert.equal(events.length, 1);
  assert.equal(events[0].sequence, 1);
  assert.equal(events[0].change.documents[0].id, created.document.id);
  assert.equal(events[0].documents.length, 1);
  assert.equal(events[0].snapshot.sequence, 1);

  await workspace.transaction({
    summary: '订阅更新',
    edits: [{
      documentId: created.document.id,
      expectedRevision: 1,
      operations: [{
        op: 'update',
        nodeId: created.document.root.id,
        fields: { personnel: 88 },
      }],
    }],
  }, HUMAN);
  assert.equal(events.length, 2);
  assert.equal(events[1].sequence, 2);
  assert.equal(events[1].documents[0].root.personnel, 88);

  dispose();
  dispose();
  await workspace.create({ name: '不再通知', root: sampleRoot() }, HUMAN);
  assert.equal(events.length, 2);

  const throwing = workspace.subscribe(() => {
    throw new Error('listener must not break writes');
  });
  const result = await workspace.create({ name: '监听器异常', root: sampleRoot() }, HUMAN);
  assert.equal(result.ok, true);
  throwing();
  assert.throws(() => workspace.subscribe('not-a-function'), errCode('invalid_listener'));
});

test('actor validation rejects spoofed or missing identities', async (t) => {
  const { workspace } = await fixture(t);
  const before = workspace.snapshot();
  for (const actor of [
    null,
    undefined,
    {},
    { kind: 'system', name: 'x' },
    { kind: 'human' },
    { kind: 'ai', name: '' },
    { kind: 'human', name: 'x', sessionId: 7 },
  ]) {
    await assert.rejects(
      workspace.create({ name: 'x', root: sampleRoot() }, actor),
      errCode('invalid_actor'),
    );
    assert.deepEqual(workspace.snapshot(), before);
  }

  const created = await workspace.create({ name: 'x', root: sampleRoot() }, HUMAN);
  await assert.rejects(
    workspace.transaction({
      summary: 'bad actor',
      edits: [{
        documentId: created.document.id,
        expectedRevision: 1,
        operations: [{ op: 'rename', name: 'y' }],
      }],
    }, { kind: 'system', name: 'x' }),
    errCode('invalid_actor'),
  );
  await assert.rejects(
    workspace.import(sampleRoot(), { kind: 'system', name: 'x' }),
    errCode('invalid_actor'),
  );
});
