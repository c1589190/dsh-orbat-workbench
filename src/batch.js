// Shared query/plan compiler for the ORBAT workbench. Both the web UI and the
// AI tools go through the same application actions, so this module never writes:
// it only produces an exact, revision-frozen transaction for commitPlan.
import {
  OrbatError,
  isPlainObject,
  mergeCustomValue,
  normalizeNodePatch,
} from './model.js';
import { EVIDENCE_STATUSES, normalizeNodeEvidence } from './evidence.js';

const STATUS_SET = new Set(EVIDENCE_STATUSES);
const MAX_SELECTION = 400;

function fail(code, message, details = {}) {
  throw new OrbatError(code, message, details);
}

function walk(node, path, callback) {
  callback(node, path);
  for (const child of node.children) walk(child, [...path, node.name], callback);
}

function requireSafeCount(value, field, { optional = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('invalid_number', `${field} 必须是非负安全整数`, { field, value });
  }
  return value;
}

function validateStatus(status, field) {
  if (status === undefined) return undefined;
  if (typeof status !== 'string' || !STATUS_SET.has(status)) {
    fail('invalid_evidence_status', `${field}.status 非法: ${String(status)}`, {
      field: `${field}.status`,
      value: status,
      allowed: EVIDENCE_STATUSES,
    });
  }
  return status;
}

function validateSource(source, status, field) {
  if (source === undefined) return undefined;
  if (status === undefined) {
    fail('invalid_evidence', `${field}.source 需要同时提供 status`, { field });
  }
  if (!isPlainObject(source)) {
    fail('invalid_evidence_source', `${field}.source 必须是普通对象`, { field });
  }
  // Reuse the model's validation by building a throwaway evidence record.
  normalizeNodeEvidence({
    orbat: { version: 1, personnel: { status, source } },
  });
  return source;
}

function normalizeOperation(operation) {
  if (!isPlainObject(operation)) fail('invalid_operation', 'operation 必须是普通对象');
  const kind = operation.kind;
  if (kind === 'personnel') {
    const mode = operation.mode === undefined ? 'set' : operation.mode;
    if (mode !== 'set' && mode !== 'delta') {
      fail('invalid_operation', 'personnel.mode 必须是 set 或 delta');
    }
    if (!Number.isSafeInteger(operation.value)) {
      fail('invalid_number', 'personnel.value 必须是安全整数');
    }
    if (mode === 'set' && operation.value < 0) {
      fail('invalid_number', 'personnel.value 不能为负');
    }
    const status = validateStatus(operation.status, 'personnel');
    const source = validateSource(operation.source, status, 'personnel');
    return { kind, mode, value: operation.value, status, source };
  }
  if (kind === 'equipment') {
    const mode = operation.mode === undefined ? 'upsert' : operation.mode;
    if (mode !== 'upsert' && mode !== 'remove') {
      fail('invalid_operation', 'equipment.mode 必须是 upsert 或 remove');
    }
    if (typeof operation.name !== 'string' || operation.name.trim() === '' ||
        operation.name.length > 200) {
      fail('invalid_operation', 'equipment.name 必须是非空字符串（≤200）');
    }
    const occurrence = operation.occurrence === undefined ? 0 : operation.occurrence;
    if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
      fail('invalid_operation', 'equipment.occurrence 必须是非负整数');
    }
    const count = requireSafeCount(operation.count, 'equipment.count', { optional: true });
    const countMax = requireSafeCount(operation.countMax, 'equipment.countMax', { optional: true });
    const status = validateStatus(operation.status, 'equipment');
    const source = validateSource(operation.source, status, 'equipment');
    return {
      kind,
      mode,
      name: operation.name.trim(),
      occurrence,
      count,
      countMax,
      status,
      source,
    };
  }
  if (kind === 'evidence') {
    if (operation.target !== 'personnel' && operation.target !== 'equipmentList') {
      fail('invalid_operation', 'evidence.target 必须是 personnel 或 equipmentList');
    }
    const status = validateStatus(operation.status, 'evidence');
    if (status === undefined) fail('invalid_evidence_status', 'evidence.status 缺失');
    const source = validateSource(operation.source, status, 'evidence');
    return { kind, target: operation.target, status, source };
  }
  if (kind === 'remark') {
    if (typeof operation.value !== 'string') {
      fail('invalid_operation', 'remark.value 必须是字符串');
    }
    const patch = normalizeNodePatch({ remark: operation.value });
    return { kind, value: patch.remark };
  }
  fail('invalid_operation', `不支持的批量操作: ${String(kind)}`, { kind });
}

function evidenceRecord(kind, status, source) {
  const record = { status };
  if (source !== undefined) record.source = source;
  return { orbat: { version: 1, [kind]: record } };
}

function matchingEntries(documents, select = {}) {
  if (!isPlainObject(select)) fail('invalid_request', 'select 必须是普通对象');
  const text = select.text === undefined ? undefined : String(select.text).toLocaleLowerCase();
  const nodeIds = select.nodeIds === undefined ? null : new Set(select.nodeIds);
  if (nodeIds) {
    if (!Array.isArray(select.nodeIds) || select.nodeIds.some((id) => typeof id !== 'string')) {
      fail('invalid_request', 'select.nodeIds 必须是字符串数组');
    }
  }
  const entries = [];
  for (const document of documents) {
    walk(document.root, [], (node, path) => {
      if (text !== undefined && !node.name.toLocaleLowerCase().includes(text)) return;
      if (select.type !== undefined && node.type !== select.type) return;
      if (select.echelon !== undefined && node.echelon !== select.echelon) return;
      if (nodeIds && !nodeIds.has(node.id)) return;
      entries.push({
        documentId: document.id,
        documentName: document.name,
        revision: document.revision,
        node,
        path: [...path, node.name],
      });
    });
  }
  return entries;
}

export function queryNodes({ documents, select = {}, limit = 100, cursor, sequence }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    fail('invalid_request', 'limit 必须在 1–200', { limit });
  }
  const entries = matchingEntries(documents, select);
  let offset = 0;
  if (cursor !== undefined && cursor !== null) {
    if (typeof cursor !== 'string') fail('invalid_request', 'cursor 必须是字符串');
    const match = /^(\d+):(\d+)$/.exec(cursor);
    if (!match) fail('invalid_request', 'cursor 格式非法', { cursor });
    const cursorSequence = Number(match[1]);
    offset = Number(match[2]);
    if (cursorSequence !== sequence) {
      fail('stale_cursor', '工作区已变化，请从第一页重新查询', {
        cursorSequence,
        sequence,
      });
    }
  }
  const page = entries.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    ok: true,
    sequence,
    matches: page.map((entry) => ({
      documentId: entry.documentId,
      documentName: entry.documentName,
      revision: entry.revision,
      node: { ...entry.node, children: undefined },
      path: entry.path,
    })),
    total: entries.length,
    offset,
    nextCursor: nextOffset < entries.length ? `${sequence}:${nextOffset}` : null,
    truncated: nextOffset < entries.length,
  };
}

export function compilePlan({
  documents,
  sequence,
  select = {},
  operation,
  summary,
  maxNodes = MAX_SELECTION,
}) {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 1000) {
    fail('invalid_request', 'maxNodes 必须在 1–1000', { maxNodes });
  }
  const normalized = normalizeOperation(operation);
  const entries = matchingEntries(documents, select);
  if (entries.length === 0) {
    fail('empty_selection', '没有匹配的节点', { select });
  }
  if (entries.length > maxNodes) {
    fail('too_many_matches', `匹配到 ${entries.length} 个节点，超过上限 ${maxNodes}`, {
      total: entries.length,
      maxNodes,
    });
  }

  const edits = new Map();
  const diffs = [];
  const warnings = [];
  let operations = 0;
  let personnelBefore = 0;
  let personnelAfter = 0;

  for (const entry of entries) {
    const node = entry.node;
    personnelBefore += node.personnel;
    const ops = [];
    let afterPersonnel = node.personnel;

    if (normalized.kind === 'personnel') {
      const next = normalized.mode === 'delta'
        ? node.personnel + normalized.value
        : normalized.value;
      if (!Number.isSafeInteger(next) || next < 0) {
        fail('invalid_number', `节点 ${node.name} 的直属人数会变成非法值 ${next}`, {
          nodeId: node.id,
          value: next,
        });
      }
      afterPersonnel = next;
      if (next !== node.personnel) {
        ops.push({ op: 'update', nodeId: node.id, fields: { personnel: next } });
        diffs.push({
          documentId: entry.documentId,
          nodeId: node.id,
          field: 'personnel',
          before: node.personnel,
          after: next,
        });
      }
      if (normalized.status !== undefined) {
        const patch = evidenceRecord('personnel', normalized.status, normalized.source);
        let merged;
        try {
          merged = mergeCustomValue(node.custom, patch);
        } catch (error) {
          throw new OrbatError('custom_conflict', `节点 ${node.name}: ${error.message}`, {
            nodeId: node.id,
          });
        }
        ops.push({ op: 'mergeCustom', nodeId: node.id, fields: { custom: patch } });
        diffs.push({
          documentId: entry.documentId,
          nodeId: node.id,
          field: 'custom',
          before: node.custom === undefined ? null : JSON.parse(JSON.stringify(node.custom)),
          after: JSON.parse(JSON.stringify(merged)),
        });
      }
    } else if (normalized.kind === 'equipment') {
      const items = JSON.parse(JSON.stringify(node.equipment));
      let foundIndex = -1;
      let seen = 0;
      for (let index = 0; index < items.length; index += 1) {
        if (items[index].name !== normalized.name) continue;
        if (seen === normalized.occurrence) {
          foundIndex = index;
          break;
        }
        seen += 1;
      }
      if (normalized.mode === 'remove') {
        if (foundIndex === -1) {
          warnings.push({
            code: 'equipment-missing',
            documentId: entry.documentId,
            nodeId: node.id,
            name: normalized.name,
          });
        } else {
          items.splice(foundIndex, 1);
          const patch = normalizeNodePatch({ equipment: items });
          ops.push({ op: 'update', nodeId: node.id, fields: { equipment: patch.equipment } });
          diffs.push({
            documentId: entry.documentId,
            nodeId: node.id,
            field: 'equipment',
            before: JSON.parse(JSON.stringify(node.equipment)),
            after: JSON.parse(JSON.stringify(patch.equipment)),
          });
        }
      } else {
        const nextItem = foundIndex === -1
          ? { name: normalized.name, count: normalized.count ?? 0 }
          : { ...items[foundIndex] };
        if (foundIndex === -1) items.push(nextItem);
        else items[foundIndex] = nextItem;
        if (normalized.count !== undefined) nextItem.count = normalized.count;
        if (normalized.countMax !== undefined) nextItem.countMax = normalized.countMax;
        if (normalized.status !== undefined) {
          nextItem.orbat = { status: normalized.status };
          if (normalized.source !== undefined) nextItem.orbat.source = normalized.source;
        }
        const patch = normalizeNodePatch({ equipment: items });
        ops.push({ op: 'update', nodeId: node.id, fields: { equipment: patch.equipment } });
        diffs.push({
          documentId: entry.documentId,
          nodeId: node.id,
          field: 'equipment',
          before: JSON.parse(JSON.stringify(node.equipment)),
          after: JSON.parse(JSON.stringify(patch.equipment)),
        });
      }
    } else if (normalized.kind === 'evidence') {
      const patch = evidenceRecord(normalized.target, normalized.status, normalized.source);
      let merged;
      try {
        merged = mergeCustomValue(node.custom, patch);
      } catch (error) {
        throw new OrbatError('custom_conflict', `节点 ${node.name}: ${error.message}`, {
          nodeId: node.id,
        });
      }
      ops.push({ op: 'mergeCustom', nodeId: node.id, fields: { custom: patch } });
      diffs.push({
        documentId: entry.documentId,
        nodeId: node.id,
        field: 'custom',
        before: node.custom === undefined ? null : JSON.parse(JSON.stringify(node.custom)),
        after: JSON.parse(JSON.stringify(merged)),
      });
    } else if (normalized.kind === 'remark') {
      if (node.remark !== normalized.value) {
        ops.push({ op: 'update', nodeId: node.id, fields: { remark: normalized.value } });
        diffs.push({
          documentId: entry.documentId,
          nodeId: node.id,
          field: 'remark',
          before: node.remark,
          after: normalized.value,
        });
      }
    }

    personnelAfter += afterPersonnel;
    if (ops.length === 0) continue;
    let edit = edits.get(entry.documentId);
    if (!edit) {
      edit = {
        documentId: entry.documentId,
        expectedRevision: entry.revision,
        operations: [],
      };
      edits.set(entry.documentId, edit);
    }
    edit.operations.push(...ops);
    operations += ops.length;
  }

  if (edits.size === 0) {
    fail('no_changes', '选中节点的值已经与目标一致', { selected: entries.length });
  }

  return {
    plan: {
      edits: [...edits.values()],
      summary: summary === undefined || summary === null
        ? `批量修改 ${entries.length} 个节点`
        : summary,
      baseSequence: sequence,
    },
    diffs,
    stats: {
      selectedNodes: entries.length,
      operations,
      documents: edits.size,
      personnel: { before: personnelBefore, after: personnelAfter },
    },
    warnings,
  };
}
