import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  OrbatError,
  MAX_OPERATIONS,
  NODE_FIELDS,
  assertSafeKeys,
  isPlainObject,
  normalizeNodePatch,
  normalizeRoot,
  stats,
  validateRoot,
} from './model.js';

export { OrbatError } from './model.js';

export const WORKSPACE_FILE = 'workspace.json';
export const HISTORY_LIMIT = 500;

const STATE_VERSION = 1;
const APP_NAME = '军队编制编辑器';
const MAX_DOCUMENT_NAME = 200;
const MAX_SUMMARY_LENGTH = 500;
const MAX_ACTOR_NAME = 100;
const MAX_SESSION_ID = 200;

function clone(value) {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

function emptyState() {
  return {
    version: STATE_VERSION,
    sequence: 0,
    droppedThrough: 0,
    documents: [],
    changes: [],
  };
}

function publicDocument(document) {
  return {
    id: document.id,
    name: document.name,
    revision: document.revision,
    root: clone(document.root),
  };
}

function normalizeActor(actor) {
  if (!isPlainObject(actor)) {
    throw new OrbatError('invalid_actor', 'actor 必须是普通对象', {});
  }
  if (actor.kind !== 'human' && actor.kind !== 'ai') {
    throw new OrbatError('invalid_actor', 'actor.kind 必须是 human 或 ai', {});
  }
  if (typeof actor.name !== 'string' || actor.name.trim() === '' ||
      actor.name.length > MAX_ACTOR_NAME) {
    throw new OrbatError('invalid_actor', 'actor.name 必须是非空字符串', {});
  }
  const normalized = { kind: actor.kind, name: actor.name.trim() };
  if (actor.sessionId !== undefined && actor.sessionId !== null) {
    if (typeof actor.sessionId !== 'string' ||
        actor.sessionId.length === 0 ||
        actor.sessionId.length > MAX_SESSION_ID) {
      throw new OrbatError('invalid_actor', 'actor.sessionId 必须是非空字符串', {});
    }
    normalized.sessionId = actor.sessionId;
  }
  return normalized;
}

function normalizeDocumentName(value) {
  if (typeof value !== 'string') {
    throw new OrbatError('invalid_name', '编制名称必须是字符串', {});
  }
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_DOCUMENT_NAME) {
    throw new OrbatError('invalid_name', `编制名称长度必须在 1-${MAX_DOCUMENT_NAME} 之间`, {});
  }
  return name;
}

function importDocumentName(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return normalizeDocumentName(candidate);
    }
  }
  return '导入编制';
}

function normalizeSummary(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') {
    throw new OrbatError('invalid_summary', 'summary 必须是字符串', {});
  }
  const summary = value.trim();
  if (summary.length === 0) return fallback;
  if (summary.length > MAX_SUMMARY_LENGTH) {
    throw new OrbatError('invalid_summary', `summary 长度不能超过 ${MAX_SUMMARY_LENGTH}`, {});
  }
  return summary;
}

function newDocumentId(usedIds) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = `d_${randomUUID()}`;
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
  throw new OrbatError('id_generation_failed', '无法生成唯一编制 id');
}

function notFound(kind, id) {
  return new OrbatError('not_found', `${kind} 不存在: ${id}`, { kind, id });
}

function conflictError(document, expectedRevision) {
  return new OrbatError(
    'CONFLICT',
    `修订冲突：编制「${document.name}」当前修订为 ${document.revision}`,
    {
      documentId: document.id,
      expectedRevision,
      actualRevision: document.revision,
      current: {
        id: document.id,
        name: document.name,
        revision: document.revision,
      },
    },
  );
}

function normalizeIndex(value, length) {
  if (value === undefined || value === null) return length;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > length) {
    throw new OrbatError('invalid_index', `索引必须是 0-${length} 之间的整数`, { value, length });
  }
  return value;
}

function findNode(root, id) {
  if (root.id === id) return { node: root, parent: null, index: -1 };
  for (let index = 0; index < root.children.length; index += 1) {
    const child = root.children[index];
    if (child.id === id) return { node: child, parent: root, index };
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function isDescendant(node, id) {
  if (node.id === id) return true;
  for (const child of node.children) {
    if (isDescendant(child, id)) return true;
  }
  return false;
}

function applyOperations(document, operations, documentId, diffs) {
  for (const operation of operations) {
    if (!isPlainObject(operation) || typeof operation.op !== 'string') {
      throw new OrbatError('invalid_operation', 'operation 必须是含 op 的普通对象', {});
    }
    switch (operation.op) {
      case 'update': {
        if (typeof operation.nodeId !== 'string' || operation.nodeId.length === 0) {
          throw new OrbatError('invalid_operation', 'update 需要 nodeId', {});
        }
        const found = findNode(document.root, operation.nodeId);
        if (!found) throw notFound('node', operation.nodeId);
        const patch = normalizeNodePatch(operation.fields, { echelon: found.node.echelon });
        for (const key of Object.keys(patch)) {
          const after = patch[key];
          if (key === 'custom' && after === undefined) {
            if (Object.hasOwn(found.node, 'custom')) {
              diffs.push({
                documentId,
                nodeId: operation.nodeId,
                field: 'custom',
                before: clone(found.node.custom),
                after: null,
              });
              delete found.node.custom;
            }
            continue;
          }
          const before = key === 'custom' && !Object.hasOwn(found.node, 'custom')
            ? null
            : found.node[key];
          if (!isDeepStrictEqual(before, after)) {
            found.node[key] = after;
            diffs.push({
              documentId,
              nodeId: operation.nodeId,
              field: key,
              before: clone(before),
              after: clone(after),
            });
          }
        }
        break;
      }
      case 'add': {
        if (typeof operation.parentId !== 'string' || operation.parentId.length === 0) {
          throw new OrbatError('invalid_operation', 'add 需要 parentId', {});
        }
        const parent = findNode(document.root, operation.parentId);
        if (!parent) throw notFound('node', operation.parentId);
        const node = normalizeRoot(operation.node);
        const index = normalizeIndex(operation.index, parent.node.children.length);
        parent.node.children.splice(index, 0, node);
        diffs.push({
          documentId,
          nodeId: node.id,
          field: '$node',
          before: null,
          after: clone(node),
        });
        break;
      }
      case 'remove': {
        if (typeof operation.nodeId !== 'string' || operation.nodeId.length === 0) {
          throw new OrbatError('invalid_operation', 'remove 需要 nodeId', {});
        }
        if (operation.nodeId === document.root.id) {
          throw new OrbatError('root_protected', '不能删除根节点', { nodeId: operation.nodeId });
        }
        const found = findNode(document.root, operation.nodeId);
        if (!found) throw notFound('node', operation.nodeId);
        const removed = found.parent.children.splice(found.index, 1)[0];
        diffs.push({
          documentId,
          nodeId: removed.id,
          field: '$node',
          before: clone(removed),
          after: null,
        });
        break;
      }
      case 'move': {
        if (typeof operation.nodeId !== 'string' || operation.nodeId.length === 0) {
          throw new OrbatError('invalid_operation', 'move 需要 nodeId', {});
        }
        if (typeof operation.parentId !== 'string' || operation.parentId.length === 0) {
          throw new OrbatError('invalid_operation', 'move 需要 parentId', {});
        }
        if (operation.nodeId === document.root.id) {
          throw new OrbatError('root_protected', '不能移动根节点', { nodeId: operation.nodeId });
        }
        const found = findNode(document.root, operation.nodeId);
        if (!found) throw notFound('node', operation.nodeId);
        const target = findNode(document.root, operation.parentId);
        if (!target) throw notFound('node', operation.parentId);
        if (isDescendant(found.node, target.node.id)) {
          throw new OrbatError('cycle', '不能把节点移动到自身或后代节点下', {
            nodeId: operation.nodeId,
            parentId: operation.parentId,
          });
        }
        const oldParentId = found.parent.id;
        const oldIndex = found.index;
        found.parent.children.splice(found.index, 1);
        const index = normalizeIndex(operation.index, target.node.children.length);
        target.node.children.splice(index, 0, found.node);
        if (oldParentId !== target.node.id) {
          diffs.push({
            documentId,
            nodeId: operation.nodeId,
            field: 'parentId',
            before: oldParentId,
            after: target.node.id,
          });
        }
        if (oldParentId !== target.node.id || oldIndex !== index) {
          diffs.push({
            documentId,
            nodeId: operation.nodeId,
            field: 'index',
            before: oldIndex,
            after: index,
          });
        }
        break;
      }
      case 'replace': {
        if (!isPlainObject(operation.root)) {
          throw new OrbatError('invalid_operation', 'replace 需要 root 对象', {});
        }
        const after = normalizeRoot(operation.root);
        const before = clone(document.root);
        document.root = after;
        diffs.push({
          documentId,
          nodeId: after.id,
          field: '$node',
          before,
          after: clone(after),
        });
        break;
      }
      case 'rename': {
        const name = normalizeDocumentName(operation.name);
        const before = document.name;
        if (before !== name) {
          document.name = name;
          diffs.push({
            documentId,
            nodeId: null,
            field: 'name',
            before,
            after: name,
          });
        }
        break;
      }
      default:
        throw new OrbatError('invalid_operation', `不支持的操作: ${operation.op}`, {
          op: operation.op,
        });
    }
  }
}

function assertNoCustomEquipment(equip) {
  if (equip === undefined || equip === null) return;
  if (Array.isArray(equip)) {
    if (equip.length === 0) return;
  } else if (isPlainObject(equip)) {
    if (Object.keys(equip).length === 0) return;
  } else {
    throw new OrbatError('invalid_payload', 'equip 必须是空对象或空数组', {});
  }
  throw new OrbatError(
    'unsupported_equipment',
    '暂不支持非空的自定义装备表 equip；节点内 equipment 暂不受影响',
    {},
  );
}

const EXPORT_NODE_KEYS = new Set([...NODE_FIELDS, 'id']);
const EXPORT_EQUIPMENT_KEYS = new Set(['name', 'count', 'countMax', 'id']);

function exportNode(node) {
  const result = {
    name: node.name,
    type: node.type,
    echelon: node.echelon,
    personnel: node.personnel,
    personnelMax: node.personnelMax,
    equipment: node.equipment.map((item) => {
      const equipment = { name: item.name, count: item.count };
      if (item.countMax !== undefined) equipment.countMax = item.countMax;
      for (const key of Object.keys(item)) {
        if (EXPORT_EQUIPMENT_KEYS.has(key)) continue;
        equipment[key] = clone(item[key]);
      }
      return equipment;
    }),
    children: node.children.map(exportNode),
    customName: node.customName,
    layout: node.layout,
    collapsed: node.collapsed,
    stack: node.stack,
    remark: node.remark,
    mod: node.mod,
  };
  if (node.custom !== undefined) result.custom = clone(node.custom);
  for (const key of Object.keys(node)) {
    if (EXPORT_NODE_KEYS.has(key)) continue;
    result[key] = clone(node[key]);
  }
  return result;
}

function setOwn(object, key, value) {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function uniqueSaveName(name, saves) {
  if (!Object.hasOwn(saves, name)) return name;
  const suffix = /^(.*) \((\d+)\)$/.exec(name);
  const stem = suffix ? suffix[1] : name;
  let index = suffix ? Number(suffix[2]) + 1 : 2;
  let candidate = `${stem} (${index})`;
  while (Object.hasOwn(saves, candidate)) {
    index += 1;
    candidate = `${stem} (${index})`;
  }
  return candidate;
}

function corruptWorkspace(message, details = {}) {
  return new OrbatError('corrupt_workspace', message, details);
}

function isSafeCounter(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseState(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw corruptWorkspace('工作区文件不是合法 JSON', { reason: error.message });
  }
  if (!isPlainObject(raw)) throw corruptWorkspace('工作区文件根必须是对象');
  assertSafeKeys(raw, 'workspace');
  if (raw.version !== STATE_VERSION) {
    throw corruptWorkspace(`不支持的工作区版本: ${String(raw.version)}`, { version: raw.version });
  }
  if (!isSafeCounter(raw.sequence)) throw corruptWorkspace('sequence 非法');
  if (!Array.isArray(raw.documents)) throw corruptWorkspace('documents 必须是数组');
  if (!Array.isArray(raw.changes)) throw corruptWorkspace('changes 必须是数组');
  if (raw.changes.length > HISTORY_LIMIT) {
    throw corruptWorkspace('changes 数量超过历史保留上限', { length: raw.changes.length });
  }
  const droppedThrough = raw.droppedThrough === undefined ? 0 : raw.droppedThrough;
  if (!isSafeCounter(droppedThrough) || droppedThrough > raw.sequence) {
    throw corruptWorkspace('droppedThrough 非法');
  }

  const seenDocumentIds = new Set();
  const documents = [];
  for (const document of raw.documents) {
    if (!isPlainObject(document)) throw corruptWorkspace('document 必须是对象');
    if (typeof document.id !== 'string' || document.id.length === 0 ||
        seenDocumentIds.has(document.id)) {
      throw corruptWorkspace('document.id 缺失或重复', { id: document.id });
    }
    seenDocumentIds.add(document.id);
    if (typeof document.name !== 'string' || document.name.trim() === '') {
      throw corruptWorkspace('document.name 非法', { id: document.id });
    }
    if (!isSafeCounter(document.revision) || document.revision < 1) {
      throw corruptWorkspace('document.revision 非法', { id: document.id });
    }
    try {
      validateRoot(document.root, { requireIds: true });
    } catch (error) {
      throw corruptWorkspace('document.root 非法', {
        id: document.id,
        cause: error instanceof OrbatError ? error.code : String(error),
        message: error.message,
      });
    }
    documents.push({
      id: document.id,
      name: document.name,
      revision: document.revision,
      root: document.root,
    });
  }

  let previousSequence = 0;
  const changes = [];
  for (const change of raw.changes) {
    if (!isPlainObject(change)) throw corruptWorkspace('change 必须是对象');
    if (!isSafeCounter(change.sequence) ||
        change.sequence <= previousSequence ||
        change.sequence > raw.sequence) {
      throw corruptWorkspace('change.sequence 非法', { sequence: change.sequence });
    }
    previousSequence = change.sequence;
    if (typeof change.time !== 'string' || change.time.length === 0) {
      throw corruptWorkspace('change.time 非法', { sequence: change.sequence });
    }
    if (!isPlainObject(change.actor) ||
        (change.actor.kind !== 'human' && change.actor.kind !== 'ai') ||
        typeof change.actor.name !== 'string') {
      throw corruptWorkspace('change.actor 非法', { sequence: change.sequence });
    }
    if (!Array.isArray(change.documents) || !Array.isArray(change.diffs)) {
      throw corruptWorkspace('change 结构非法', { sequence: change.sequence });
    }
    changes.push(change);
  }

  return {
    version: STATE_VERSION,
    sequence: raw.sequence,
    droppedThrough,
    documents,
    changes,
  };
}

function stateFromDisk(text) {
  return parseState(text);
}

export class Workspace {
  #directory;
  #file;
  #state;
  #listeners = new Set();
  #queue = Promise.resolve();

  constructor(directory, file, state) {
    this.#directory = directory;
    this.#file = file;
    this.#state = state;
  }

  static async open(directory) {
    if (typeof directory !== 'string' || directory.trim() === '') {
      throw new OrbatError('invalid_request', 'directory 必须是非空字符串', {});
    }
    const resolved = path.resolve(directory);
    try {
      await mkdir(resolved, { recursive: true });
    } catch (error) {
      throw new OrbatError('open_failed', `无法创建工作区目录: ${error.message}`, {
        cause: error.code ?? null,
      });
    }
    const file = path.join(resolved, WORKSPACE_FILE);
    let state;
    try {
      const text = await readFile(file, 'utf8');
      state = stateFromDisk(text);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        state = emptyState();
      } else if (error instanceof OrbatError) {
        throw error;
      } else {
        throw new OrbatError('open_failed', `无法读取工作区: ${error.message}`, {
          cause: error.code ?? null,
        });
      }
    }
    return new Workspace(resolved, file, state);
  }

  #enqueue(task) {
    const run = this.#queue.then(task);
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }

  #buildState(documents, sequence, change) {
    const changes = [...this.#state.changes, change];
    let droppedThrough = this.#state.droppedThrough;
    while (changes.length > HISTORY_LIMIT) {
      const dropped = changes.shift();
      droppedThrough = dropped.sequence;
    }
    return {
      version: STATE_VERSION,
      sequence,
      droppedThrough,
      documents,
      changes,
    };
  }

  async #persist(state) {
    const payload = JSON.stringify(state);
    const temp = path.join(
      this.#directory,
      `.${WORKSPACE_FILE}.${process.pid}.${randomUUID()}.tmp`,
    );
    let handle = null;
    try {
      handle = await open(temp, 'wx', 0o600);
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temp, this.#file);
    } catch (error) {
      if (handle) {
        try {
          await handle.close();
        } catch {
          // Best effort only.
        }
      }
      try {
        await rm(temp, { force: true });
      } catch {
        // Best effort only.
      }
      throw new OrbatError('persistence_failed', `工作区保存失败: ${error.message}`, {
        cause: error.code ?? null,
      });
    }
  }

  #notify(change) {
    if (this.#listeners.size === 0) return;
    for (const listener of [...this.#listeners]) {
      const event = {
        sequence: change.sequence,
        change: clone(change),
        documents: this.#state.documents.map(publicDocument),
        snapshot: this.snapshot(),
      };
      try {
        listener(event);
      } catch {
        // A subscriber must never break a committed write.
      }
    }
  }

  snapshot() {
    return {
      sequence: this.#state.sequence,
      documents: this.#state.documents.map(publicDocument),
      changes: this.#state.changes.map((change) => clone(change)),
    };
  }

  async create(input, actor) {
    const normalizedActor = normalizeActor(actor);
    if (!isPlainObject(input)) {
      throw new OrbatError('invalid_request', 'create 参数必须是普通对象', {});
    }
    const root = normalizeRoot(input.root);
    const name = input.name === undefined || input.name === null
      ? importDocumentName(root.name, '新编制')
      : normalizeDocumentName(input.name);
    const summary = normalizeSummary(input.summary, `创建编制「${name}」`);

    return this.#enqueue(async () => {
      const sequence = this.#state.sequence + 1;
      const usedIds = new Set(this.#state.documents.map((document) => document.id));
      const document = { id: newDocumentId(usedIds), name, revision: 1, root };
      const change = {
        sequence,
        time: nowIso(),
        actor: normalizedActor,
        summary,
        documents: [{ id: document.id, beforeRevision: 0, afterRevision: 1 }],
        diffs: [],
      };
      const nextState = this.#buildState([...this.#state.documents, document], sequence, change);
      await this.#persist(nextState);
      this.#state = nextState;
      this.#notify(change);
      return {
        ok: true,
        document: publicDocument(document),
        sequence,
        change: clone(change),
      };
    });
  }

  async transaction(input, actor) {
    const normalizedActor = normalizeActor(actor);
    if (!isPlainObject(input)) {
      throw new OrbatError('invalid_request', 'transaction 参数必须是普通对象', {});
    }
    if (!Array.isArray(input.edits) || input.edits.length === 0) {
      throw new OrbatError('invalid_request', 'transaction.edits 必须是非空数组', {});
    }

    let operationCount = 0;
    const edits = input.edits.map((edit, index) => {
      if (!isPlainObject(edit)) {
        throw new OrbatError('invalid_request', `edits[${index}] 必须是普通对象`, { index });
      }
      if (typeof edit.documentId !== 'string' || edit.documentId.length === 0) {
        throw new OrbatError('invalid_request', `edits[${index}].documentId 非法`, { index });
      }
      if (typeof edit.expectedRevision !== 'number' ||
          !Number.isSafeInteger(edit.expectedRevision) ||
          edit.expectedRevision < 1) {
        throw new OrbatError('invalid_request', `edits[${index}].expectedRevision 非法`, { index });
      }
      if (!Array.isArray(edit.operations)) {
        throw new OrbatError('invalid_request', `edits[${index}].operations 必须是数组`, { index });
      }
      operationCount += edit.operations.length;
      return {
        documentId: edit.documentId,
        expectedRevision: edit.expectedRevision,
        operations: edit.operations,
      };
    });
    if (operationCount > MAX_OPERATIONS) {
      throw new OrbatError('too_many_operations', `事务操作数超过 ${MAX_OPERATIONS}`, {
        operations: operationCount,
        max: MAX_OPERATIONS,
      });
    }
    const summary = normalizeSummary(input.summary, `批量修改 ${edits.length} 个编制`);

    return this.#enqueue(async () => {
      const originals = new Map(this.#state.documents.map((document) => [document.id, document]));
      const working = new Map();

      for (const edit of edits) {
        const original = originals.get(edit.documentId);
        if (!original) throw notFound('document', edit.documentId);
        if (original.revision !== edit.expectedRevision) {
          throw conflictError(original, edit.expectedRevision);
        }
        let entry = working.get(edit.documentId);
        if (entry?.deleted) {
          throw new OrbatError('invalid_operation', '同一事务中不能继续修改已删除的编制', {
            documentId: edit.documentId,
          });
        }
        const deleteOperation = edit.operations.find(
          (operation) => isPlainObject(operation) && operation.op === 'deleteDocument',
        );
        if (deleteOperation) {
          if (edit.operations.length !== 1) {
            throw new OrbatError('invalid_operation', 'deleteDocument 必须是该 edit 的唯一操作', {
              documentId: edit.documentId,
            });
          }
          if (entry) {
            throw new OrbatError('invalid_operation', '同一事务中不能既修改又删除同一编制', {
              documentId: edit.documentId,
            });
          }
          working.set(edit.documentId, {
            document: clone(original),
            beforeRevision: original.revision,
            diffs: [],
            deleted: true,
          });
          continue;
        }
        if (!entry) {
          entry = {
            document: clone(original),
            beforeRevision: original.revision,
            diffs: [],
            deleted: false,
          };
          working.set(edit.documentId, entry);
        }
        applyOperations(entry.document, edit.operations, edit.documentId, entry.diffs);
      }

      const changedDocuments = [];
      const changeDocuments = [];
      const diffs = [];
      for (const [id, entry] of working) {
        if (entry.deleted) {
          changeDocuments.push({
            id,
            beforeRevision: entry.beforeRevision,
            afterRevision: null,
          });
          continue;
        }
        validateRoot(entry.document.root, { requireIds: true });
        entry.document.revision = entry.beforeRevision + 1;
        changedDocuments.push(entry.document);
        changeDocuments.push({
          id,
          beforeRevision: entry.beforeRevision,
          afterRevision: entry.document.revision,
        });
        diffs.push(...entry.diffs);
      }

      const nextDocuments = [];
      for (const document of this.#state.documents) {
        const entry = working.get(document.id);
        if (!entry) {
          nextDocuments.push(document);
        } else if (!entry.deleted) {
          nextDocuments.push(entry.document);
        }
      }

      const sequence = this.#state.sequence + 1;
      const change = {
        sequence,
        time: nowIso(),
        actor: normalizedActor,
        summary,
        documents: changeDocuments,
        diffs,
      };
      const nextState = this.#buildState(nextDocuments, sequence, change);
      await this.#persist(nextState);
      this.#state = nextState;
      this.#notify(change);
      return {
        ok: true,
        documents: changedDocuments.map(publicDocument),
        sequence,
        change: clone(change),
      };
    });
  }

  async import(payload, actor) {
    const normalizedActor = normalizeActor(actor);
    let source = payload;
    if (typeof source === 'string') {
      try {
        source = JSON.parse(source);
      } catch (error) {
        throw new OrbatError('invalid_payload', '导入内容不是合法 JSON', {
          reason: error.message,
        });
      }
    }
    if (!isPlainObject(source)) {
      throw new OrbatError('invalid_payload', '导入内容必须是 JSON 对象', {});
    }
    assertSafeKeys(source, 'payload');

    const inputs = [];
    if (source.kind === 'mil-org') {
      assertNoCustomEquipment(source.equip);
      if (!isPlainObject(source.data)) {
        throw new OrbatError('invalid_payload', 'mil-org.data 必须是编制树', {});
      }
      inputs.push({
        name: importDocumentName(source.name, source.data.name, '导入编制'),
        root: source.data,
      });
    } else if (source.kind === 'mil-bundle') {
      assertNoCustomEquipment(source.equip);
      if (!isPlainObject(source.saves)) {
        throw new OrbatError('invalid_payload', 'mil-bundle.saves 必须是对象', {});
      }
      assertSafeKeys(source.saves, 'saves');
      const names = Object.keys(source.saves);
      if (names.length === 0) {
        throw new OrbatError('invalid_payload', 'mil-bundle.saves 不能为空', {});
      }
      for (const name of names) {
        const save = source.saves[name];
        let root = save;
        if (isPlainObject(save) && Object.hasOwn(save, 'data')) {
          assertSafeKeys(save, `saves.${name}`);
          root = save.data;
        }
        if (!isPlainObject(root)) {
          throw new OrbatError('invalid_payload', `saves.${name} 必须是编制树或含 data 的对象`, {
            name,
          });
        }
        inputs.push({ name: normalizeDocumentName(name), root });
      }
    } else if (source.kind === undefined) {
      inputs.push({
        name: importDocumentName(source.name, '导入编制'),
        root: source,
      });
    } else {
      throw new OrbatError('invalid_payload', `不支持的导入 kind: ${String(source.kind)}`, {
        kind: source.kind,
      });
    }

    // Normalization is intentionally done before the write lock. It validates
    // every tree and regenerates all external ids; no state is touched yet.
    const normalizedInputs = inputs.map(({ name, root }) => ({
      name,
      root: normalizeRoot(root),
    }));

    return this.#enqueue(async () => {
      const usedIds = new Set(this.#state.documents.map((document) => document.id));
      const documents = normalizedInputs.map(({ name, root }) => ({
        id: newDocumentId(usedIds),
        name,
        revision: 1,
        root,
      }));
      const sequence = this.#state.sequence + 1;
      const change = {
        sequence,
        time: nowIso(),
        actor: normalizedActor,
        summary: `导入 ${documents.length} 份编制`,
        documents: documents.map((document) => ({
          id: document.id,
          beforeRevision: 0,
          afterRevision: 1,
        })),
        diffs: [],
      };
      const nextState = this.#buildState([...this.#state.documents, ...documents], sequence, change);
      await this.#persist(nextState);
      this.#state = nextState;
      this.#notify(change);
      return {
        ok: true,
        documents: documents.map(publicDocument),
        sequence,
        change: clone(change),
      };
    });
  }

  export(documentIds, format = 'mil-org') {
    if (format === undefined) format = 'mil-org';
    if (format !== 'mil-org' && format !== 'mil-bundle') {
      throw new OrbatError('invalid_format', 'format 必须是 mil-org 或 mil-bundle', { format });
    }
    if (!Array.isArray(documentIds)) {
      throw new OrbatError('invalid_request', 'documentIds 必须是数组', {});
    }
    if (documentIds.length === 0) {
      throw new OrbatError('export_selection', '至少选择一份编制', {});
    }
    const ids = [];
    const seen = new Set();
    for (const id of documentIds) {
      if (typeof id !== 'string' || id.length === 0) {
        throw new OrbatError('invalid_request', 'documentIds 只能包含非空字符串', {});
      }
      if (seen.has(id)) {
        throw new OrbatError('export_selection', 'documentIds 不能重复', { documentId: id });
      }
      seen.add(id);
      ids.push(id);
    }
    if (format === 'mil-org' && ids.length !== 1) {
      throw new OrbatError('export_selection', 'mil-org 只能导出单份编制', {
        count: ids.length,
      });
    }

    const byId = new Map(this.#state.documents.map((document) => [document.id, document]));
    const documents = ids.map((id) => {
      const document = byId.get(id);
      if (!document) throw notFound('document', id);
      return document;
    });
    // Upstream io.js/store.js uses epoch milliseconds for file/save times.
    const time = Date.now();

    if (format === 'mil-org') {
      const document = documents[0];
      const aggregate = stats(document.root);
      return {
        kind: 'mil-org',
        version: 1,
        app: APP_NAME,
        time,
        name: document.name,
        personnel: aggregate.personnel,
        equipTotal: aggregate.equipTotal,
        data: exportNode(document.root),
      };
    }

    const saves = {};
    for (const document of documents) {
      const aggregate = stats(document.root);
      const key = uniqueSaveName(document.name, saves);
      setOwn(saves, key, {
        data: exportNode(document.root),
        time,
        personnel: aggregate.personnel,
        equipTotal: aggregate.equipTotal,
      });
    }
    return {
      kind: 'mil-bundle',
      version: 1,
      app: APP_NAME,
      time,
      saves,
      equip: {},
    };
  }

  changes(since = 0, limit = 50) {
    if (since === undefined) since = 0;
    if (limit === undefined) limit = 50;
    if (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0) {
      throw new OrbatError('invalid_request', 'since 必须是非负整数', { since });
    }
    if (typeof limit !== 'number' ||
        !Number.isSafeInteger(limit) ||
        limit < 1) {
      throw new OrbatError('invalid_request', 'limit 必须是正整数', { limit });
    }
    const matching = this.#state.changes.filter((change) => change.sequence > since);
    const page = matching.slice(0, limit).map((change) => clone(change));
    const latestSequence = this.#state.sequence;
    return {
      changes: page,
      nextCursor: page.length > 0
        ? page[page.length - 1].sequence
        : Math.max(since, latestSequence),
      latestSequence,
      truncated: since < this.#state.droppedThrough,
      hasMore: matching.length > limit,
    };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new OrbatError('invalid_listener', 'listener 必须是函数', {});
    }
    this.#listeners.add(listener);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.#listeners.delete(listener);
    };
  }
}
