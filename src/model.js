import { randomUUID } from 'node:crypto';
import {
  computeCoverage,
  normalizeItemEvidence,
  normalizeNodeEvidence,
} from './evidence.js';

export const MAX_NODES = 2000;
export const MAX_DEPTH = 24;
export const MAX_OPERATIONS = 1000;

export class OrbatError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'OrbatError';
    this.code = code;
    this.details = details && typeof details === 'object' ? details : {};
  }
}

// Authoritative legacy keys from the upstream site:
// /tmp/army-editor-survey-rmr1y7lv/data.js:7-44.
const CANONICAL_TYPE_LIST = [
  'infantry',
  'light_infantry',
  'mech',
  'armor',
  'light_armor',
  'heavy_armor',
  'airborne',
  'air_assault',
  'mountain',
  'recon',
  'recon_mech',
  'wheeled_inf',
  'artillery',
  'mlrs',
  'mortar',
  'anti_tank',
  'aaa',
  'towed_w',
  'towed_t',
  'rotary',
  'fixedwing',
  'attack_heli',
  'uav_unit',
  'engineer',
  'signal',
  'medical',
  'supply',
];

export const CANONICAL_TYPES = Object.freeze(CANONICAL_TYPE_LIST);

export const TYPE_LABELS = Object.freeze({
  infantry: '步兵',
  light_infantry: '轻步兵',
  mech: '机步',
  armor: '装甲',
  light_armor: '轻型装甲',
  heavy_armor: '重型装甲',
  airborne: '空降',
  air_assault: '空中突击',
  mountain: '山地',
  recon: '侦察',
  recon_mech: '侦察（机械）',
  wheeled_inf: '摩托化步兵',
  artillery: '炮兵',
  mlrs: '多管火箭炮',
  mortar: '迫击炮',
  anti_tank: '反坦克',
  aaa: '防空',
  towed_w: '轮式牵引炮',
  towed_t: '履带牵引炮',
  rotary: '旋翼航空',
  fixedwing: '固定翼航空',
  attack_heli: '攻击直升机',
  uav_unit: '无人机部队',
  engineer: '工兵',
  signal: '通讯',
  medical: '医疗',
  supply: '补给',
});

// Only ms_* keys confirmed in the upstream ms-catalog/milsymbol bridge.
// No generated or guessed aliases are accepted.
const MS_ALIASES = Object.freeze({
  ms_sfgpuci: 'infantry',
  ms_sfgpucat: 'armor',
  ms_sfgpucf: 'artillery',
  ms_sfgpucr: 'recon',
  ms_sfgpuce: 'engineer',
  ms_sfgpuus: 'signal',
  ms_sfgpusm: 'medical',
  ms_sfgpuss: 'supply',
});

export const TYPE_ALIASES = MS_ALIASES;
export const TYPES = Object.freeze([...CANONICAL_TYPE_LIST, ...Object.keys(MS_ALIASES)]);
const TYPE_SET = new Set(TYPES);

export const ECHELONS = Object.freeze([
  'army',
  'corps',
  'division',
  'brigade',
  'regiment',
  'battalion',
  'company',
  'platoon',
  'section',
  'squad',
  'team',
  'individual',
]);

export const ECHELON_LABELS = Object.freeze({
  army: '集团军',
  corps: '军',
  division: '师',
  brigade: '旅',
  regiment: '团',
  battalion: '营',
  company: '连',
  platoon: '排',
  section: '分队',
  squad: '班',
  team: '火力组',
  individual: '单兵',
});

const ECHELON_SET = new Set(ECHELONS);

// Upstream layout values are exactly h/v. Old nodes without a layout use v for
// these lower echelons and h otherwise (data.js DEFAULT_VERT_ECHELONS, model.js
// newNode/deserializeOrg).
export const LAYOUTS = Object.freeze(['h', 'v']);
const LAYOUT_SET = new Set(LAYOUTS);
export const DEFAULT_VERT_ECHELONS = Object.freeze([
  'platoon',
  'section',
  'squad',
  'team',
  'individual',
]);
const VERT_ECHELON_SET = new Set(DEFAULT_VERT_ECHELONS);

export function defaultLayout(echelon) {
  return VERT_ECHELON_SET.has(echelon) ? 'v' : 'h';
}

export const NODE_FIELDS = Object.freeze([
  'name',
  'type',
  'echelon',
  'personnel',
  'personnelMax',
  'equipment',
  'children',
  'customName',
  'layout',
  'collapsed',
  'stack',
  'remark',
  'mod',
  'custom',
]);

export const UPDATABLE_FIELDS = Object.freeze([
  'name',
  'type',
  'echelon',
  'personnel',
  'personnelMax',
  'equipment',
  'customName',
  'layout',
  'collapsed',
  'stack',
  'remark',
  'mod',
  'custom',
]);
const UPDATABLE_SET = new Set(UPDATABLE_FIELDS);

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const KNOWN_NODE_KEYS = new Set([
  'id',
  'name',
  'type',
  'echelon',
  'personnel',
  'personnelMax',
  'equipment',
  'children',
  'customName',
  'layout',
  'collapsed',
  'stack',
  'remark',
  'mod',
  'custom',
]);

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertSafeKeys(value, label = 'object') {
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw new OrbatError('forbidden_key', `${label} 含禁止的键 ${key}`, { key, label });
    }
  }
}

export function isValidType(type) {
  return typeof type === 'string' && TYPE_SET.has(type);
}

export function canonicalType(type) {
  if (typeof type !== 'string') return null;
  if (TYPE_ALIASES[type]) return TYPE_ALIASES[type];
  if (CANONICAL_TYPES.includes(type)) return type;
  return null;
}

function normalizeType(value) {
  if (!isValidType(value)) {
    throw new OrbatError('invalid_type', `非法兵种类型: ${String(value)}`, { value });
  }
  return value;
}

function normalizeEchelon(value) {
  if (typeof value !== 'string' || !ECHELON_SET.has(value)) {
    throw new OrbatError('invalid_echelon', `非法编制层级: ${String(value)}`, { value });
  }
  return value;
}

function normalizeLayout(value, echelon) {
  if (value === undefined || value === null || value === '') return defaultLayout(echelon);
  if (typeof value !== 'string' || !LAYOUT_SET.has(value)) {
    throw new OrbatError('invalid_layout', `非法布局: ${String(value)}`, { value });
  }
  return value;
}

function normalizeText(value, field, { defaultValue = '', max = 200 } = {}) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'string') {
    throw new OrbatError('invalid_text', `${field} 必须是字符串`, { field });
  }
  if (value.length > max) {
    throw new OrbatError('invalid_text', `${field} 长度不能超过 ${max}`, { field, maxLength: max });
  }
  return value;
}

function normalizeCount(value, field, defaultValue = 0) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new OrbatError('invalid_number', `${field} 必须是非负安全整数`, { field, value });
  }
  return value;
}

function normalizeBoolean(value, field, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'boolean') {
    throw new OrbatError('invalid_boolean', `${field} 必须是布尔值`, { field, value });
  }
  return value;
}

const KNOWN_EQUIPMENT_KEYS = new Set(['name', 'count', 'countMax']);

function normalizeEquipment(value, label = 'equipment') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new OrbatError('invalid_equipment', `${label} 必须是数组`, { field: label });
  }
  return value.map((entry, index) => {
    const at = `${label}[${index}]`;
    if (!isPlainObject(entry)) {
      throw new OrbatError('invalid_equipment', `${at} 必须是普通对象`, { field: at });
    }
    assertSafeKeys(entry, at);
    if (typeof entry.name !== 'string' || entry.name.trim() === '') {
      throw new OrbatError('invalid_equipment', `${at}.name 必须是非空字符串`, { field: `${at}.name` });
    }
    if (entry.name.length > 200) {
      throw new OrbatError('invalid_equipment', `${at}.name 过长`, { field: `${at}.name` });
    }
    const normalized = {
      name: entry.name,
      count: normalizeCount(entry.count, `${at}.count`),
    };
    if (entry.countMax !== undefined && entry.countMax !== null) {
      normalized.countMax = normalizeCount(entry.countMax, `${at}.countMax`);
    }
    for (const key of Object.keys(entry)) {
      if (KNOWN_EQUIPMENT_KEYS.has(key)) continue;
      const extra = normalizeCustom(entry[key]);
      if (extra !== undefined) normalized[key] = extra;
    }
    // Equipment evidence is the versionless `item.orbat:{status,source}` shape;
    // malformed records fail closed instead of hiding an unknown quantity.
    return normalizeItemEvidence(normalized, at);
  });
}

const MAX_CUSTOM_DEPTH = 50;
const MAX_CUSTOM_CHILDREN = 5000;
const MAX_CUSTOM_STRING = 10000;
const MAX_CUSTOM_NODES = 20000;

function normalizeCustom(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const seen = new WeakSet();
  let nodes = 0;

  const walk = (current, at, depth) => {
    if (depth > MAX_CUSTOM_DEPTH) {
      throw new OrbatError('invalid_custom', `${at} 嵌套过深`, { field: at, maxDepth: MAX_CUSTOM_DEPTH });
    }
    nodes += 1;
    if (nodes > MAX_CUSTOM_NODES) {
      throw new OrbatError('invalid_custom', `${at} 过大`, { field: at, maxNodes: MAX_CUSTOM_NODES });
    }
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'string') {
      if (current.length > MAX_CUSTOM_STRING) {
        throw new OrbatError('invalid_custom', `${at} 字符串过长`, { field: at });
      }
      return current;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new OrbatError('invalid_custom', `${at} 必须是有限数字`, { field: at });
      }
      return current;
    }
    if (typeof current !== 'object') {
      throw new OrbatError('invalid_custom', `${at} 不是 JSON 值`, { field: at });
    }
    if (seen.has(current)) {
      throw new OrbatError('invalid_custom', `${at} 存在循环引用`, { field: at });
    }
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        if (current.length > MAX_CUSTOM_CHILDREN) {
          throw new OrbatError('invalid_custom', `${at} 数组过大`, { field: at });
        }
        return current.map((item, index) => walk(item, `${at}[${index}]`, depth + 1));
      }
      if (!isPlainObject(current)) {
        throw new OrbatError('invalid_custom', `${at} 必须是普通对象`, { field: at });
      }
      assertSafeKeys(current, at);
      const keys = Object.keys(current);
      if (keys.length > MAX_CUSTOM_CHILDREN) {
        throw new OrbatError('invalid_custom', `${at} 对象过大`, { field: at });
      }
      const output = {};
      for (const key of keys) {
        output[key] = walk(current[key], `${at}.${key}`, depth + 1);
      }
      return output;
    } finally {
      seen.delete(current);
    }
  };

  return walk(value, 'custom', 0);
}

function newNodeId(seen) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = `n_${randomUUID()}`;
    if (!seen.has(id)) {
      seen.add(id);
      return id;
    }
  }
  throw new OrbatError('id_generation_failed', '无法生成唯一节点 id');
}

function normalizeNode(input, context, depth) {
  if (depth > context.maxDepth) {
    throw new OrbatError('depth_exceeded', `节点深度超过 ${context.maxDepth}`, {
      depth,
      maxDepth: context.maxDepth,
    });
  }
  if (!isPlainObject(input)) {
    throw new OrbatError('invalid_node', '节点必须是普通对象', { depth });
  }
  context.count += 1;
  if (context.count > context.maxNodes) {
    throw new OrbatError('node_limit_exceeded', `节点总数超过 ${context.maxNodes}`, {
      maxNodes: context.maxNodes,
    });
  }
  context.depth = Math.max(context.depth, depth);
  assertSafeKeys(input, 'node');

  let externalId;
  if (Object.hasOwn(input, 'id')) {
    if (typeof input.id !== 'string' || input.id.length === 0) {
      throw new OrbatError('invalid_id', '节点 id 必须是非空字符串', { value: input.id });
    }
    externalId = input.id;
    if (context.seen.has(externalId)) {
      throw new OrbatError('duplicate_id', `重复节点 id: ${externalId}`, { id: externalId });
    }
    context.seen.add(externalId);
  }

  let id;
  if (context.mode === 'preserve') {
    if (!externalId) {
      throw new OrbatError('invalid_id', '持久化节点缺少 id', { depth });
    }
    id = externalId;
  } else if (context.mode === 'validate') {
    id = externalId;
  } else {
    id = newNodeId(context.seen);
  }

  const type = normalizeType(input.type);
  const echelon = normalizeEchelon(input.echelon);
  const name = normalizeText(input.name, 'name', { max: 200 });
  const personnel = normalizeCount(input.personnel, 'personnel');
  const personnelMax = normalizeCount(input.personnelMax, 'personnelMax');
  const equipment = normalizeEquipment(input.equipment, 'equipment');

  const rawChildren = input.children === undefined ? [] : input.children;
  if (!Array.isArray(rawChildren)) {
    throw new OrbatError('invalid_children', 'children 必须是数组', { field: 'children' });
  }

  // Validate the versioned workbench evidence namespace (if any) after the
  // generic safe-JSON pass. Foreign/legacy custom values pass through untouched.
  const custom = normalizeNodeEvidence(normalizeCustom(input.custom), 'custom');
  const node = {
    id,
    name,
    type,
    echelon,
    personnel,
    personnelMax,
    equipment,
    children: [],
    customName: normalizeBoolean(input.customName, 'customName'),
    layout: normalizeLayout(input.layout, echelon),
    collapsed: normalizeBoolean(input.collapsed, 'collapsed'),
    stack: normalizeBoolean(input.stack, 'stack'),
    remark: normalizeText(input.remark, 'remark', { max: 2000 }),
    mod: normalizeText(input.mod, 'mod', { max: 2000 }),
  };
  if (custom !== undefined) node.custom = custom;
  // The upstream site may add fields that are not in the documented schema.
  // Preserve safe JSON values instead of silently discarding them so import and
  // export remain round-trip safe.
  for (const key of Object.keys(input)) {
    if (KNOWN_NODE_KEYS.has(key)) continue;
    const extra = normalizeCustom(input[key]);
    if (extra !== undefined) node[key] = extra;
  }
  node.children = rawChildren.map((child) => normalizeNode(child, context, depth + 1));
  return node;
}

function normalizeTree(root, {
  mode = 'fresh',
  maxNodes = MAX_NODES,
  maxDepth = MAX_DEPTH,
} = {}) {
  const context = {
    mode,
    maxNodes,
    maxDepth,
    seen: new Set(),
    count: 0,
    depth: 0,
  };
  const normalized = normalizeNode(root, context, 1);
  return { root: normalized, nodes: context.count, depth: context.depth };
}

/**
 * Validate and clone a tree while assigning fresh internal ids.
 * External ids in the input are checked for duplicates but never preserved.
 */
export function normalizeRoot(root, { maxNodes = MAX_NODES, maxDepth = MAX_DEPTH } = {}) {
  return normalizeTree(root, { mode: 'fresh', maxNodes, maxDepth }).root;
}

/**
 * Validate a tree without exposing a normalized clone. By default external ids
 * may be absent; with requireIds=true every node must already carry a unique id
 * (used when reopening persisted workspace state).
 */
export function validateRoot(root, {
  requireIds = false,
  maxNodes = MAX_NODES,
  maxDepth = MAX_DEPTH,
} = {}) {
  const result = normalizeTree(root, {
    mode: requireIds ? 'preserve' : 'validate',
    maxNodes,
    maxDepth,
  });
  return { ok: true, nodes: result.nodes, depth: result.depth };
}

/**
 * Validate a partial node update and return a cloned normalized patch.
 * `custom: null` is represented by an own key with value undefined so the
 * caller can distinguish "delete custom" from "not provided".
 */
export function normalizeNodePatch(fields, { echelon } = {}) {
  if (!isPlainObject(fields)) {
    throw new OrbatError('invalid_field', 'fields 必须是普通对象', { field: 'fields' });
  }
  assertSafeKeys(fields, 'fields');
  const patch = {};
  for (const key of Object.keys(fields)) {
    if (!UPDATABLE_SET.has(key)) {
      throw new OrbatError('invalid_field', `字段 ${key} 不允许直接更新`, { field: key });
    }
    const value = fields[key];
    switch (key) {
      case 'name':
        patch.name = normalizeText(value, 'name', { max: 200 });
        break;
      case 'type':
        patch.type = normalizeType(value);
        break;
      case 'echelon':
        patch.echelon = normalizeEchelon(value);
        break;
      case 'personnel':
        patch.personnel = normalizeCount(value, 'personnel');
        break;
      case 'personnelMax':
        patch.personnelMax = normalizeCount(value, 'personnelMax');
        break;
      case 'equipment':
        patch.equipment = normalizeEquipment(value, 'equipment');
        break;
      case 'customName':
        patch.customName = normalizeBoolean(value, 'customName');
        break;
      case 'layout':
        patch.layout = normalizeLayout(value, echelon);
        break;
      case 'collapsed':
        patch.collapsed = normalizeBoolean(value, 'collapsed');
        break;
      case 'stack':
        patch.stack = normalizeBoolean(value, 'stack');
        break;
      case 'remark':
        patch.remark = normalizeText(value, 'remark', { max: 2000 });
        break;
      case 'mod':
        patch.mod = normalizeText(value, 'mod', { max: 2000 });
        break;
      case 'custom': {
        const custom = normalizeNodeEvidence(normalizeCustom(value), 'custom');
        patch.custom = custom === null ? undefined : custom;
        break;
      }
      default:
        throw new OrbatError('invalid_field', `字段 ${key} 不允许直接更新`, { field: key });
    }
  }
  return patch;
}

/**
 * Recursively aggregate personnel and equipment counts. Personnel is the sum of
 * the direct personnel fields on every node in the tree (not just the root).
 */
export function stats(root) {
  validateRoot(root);
  const result = {
    personnel: 0,
    personnelMax: 0,
    equipment: {},
    equipTotal: 0,
    nodes: 0,
  };

  const walk = (node) => {
    result.nodes += 1;
    result.personnel += node.personnel;
    result.personnelMax += node.personnelMax;
    for (const item of node.equipment) {
      const previous = Object.hasOwn(result.equipment, item.name)
        ? result.equipment[item.name]
        : 0;
      Object.defineProperty(result.equipment, item.name, {
        value: previous + item.count,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      result.equipTotal += item.count;
    }
    for (const child of node.children) walk(child);
  };

  walk(root);
  // Additive completeness annotation: legacy scalar fields above stay exactly
  // as before, so old callers and exports keep working unchanged.
  result.coverage = computeCoverage(root);
  return result;
}
