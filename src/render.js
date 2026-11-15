import { createHash } from 'node:crypto';
import ms from 'milsymbol';
import { Resvg } from '@resvg/resvg-js';
import { stats } from './model.js';
import { isIncomplete, nodeEvidence } from './evidence.js';

/**
 * 产品渲染：把一份编制文档渲染为同一份内容的 SVG 与 PNG。
 *
 * 渲染约束（全部在生成 SVG 之前施加，避免把浏览器/光栅化器拖进无界尺寸）：
 * - 图形最大宽 2400px、最大高 16000px，超出高度预算的节点在图中明确截断；
 * - 默认最多 200 个节点，超出时在图中明确写出 shown/total；
 * - 所有用户文本均作为文本节点转义，绝不插入用户提供的 SVG/foreignObject。
 */

const MAX_WIDTH = 2400;
const MAX_HEIGHT = 16000;
const DEFAULT_MAX_NODES = 200;
const ABSOLUTE_MAX_NODES = 2000;
const MAX_SCAN_NODES = 10000;

const INCOMPLETE_SUFFIX = ' · 数据不完整（含未知/歧义）';

function coverageSuffix(document) {
  try {
    return isIncomplete(stats(document.root).coverage) ? INCOMPLETE_SUFFIX : '';
  } catch {
    return '';
  }
}

/**
 * 原编辑器兵牌样式适配（editor 模式）。
 *
 * 布局、符号几何（120×120 兵牌 / 72×70 符号）、横纵混排、连接线、含下属角标、
 * 折叠与堆叠语义均参考本地 Army_Editor 1.8.0 快照：
 *   commit e5bd0eb288afec143dc9bf202f1aa16ee6ff07d5
 *   作者 BiliBili@勘茶Kchs_ 与 DeepSeek
 * 原仓库未见标准许可证；本工作台只做本地样式适配，不宣称获得再分发授权，
 * 也不声称本渲染与原站像素一致（字体、浏览器与缩放环境不同）。
 */
const EDITOR_NODE_W = 120;
const EDITOR_NODE_H = 120;
const EDITOR_HGAP = 10;
const EDITOR_VGAP = 20;
const EDITOR_VGAP_V = 16;
const EDITOR_SYM_W = 72;
const EDITOR_SYM_H = 70;
const EDITOR_TOP_PAD = 22;
const EDITOR_SYM_X = (EDITOR_NODE_W - EDITOR_SYM_W) / 2;
const EDITOR_SYM_Y = 16;
const EDITOR_INK = '#0a3d91';
const EDITOR_PAPER = '#dce8f7';
const EDITOR_BG = '#f8fafc';
const EDITOR_LINK = '#9db4d4';
const EDITOR_SIDE = 40;
// 标题 40 / meta 66 / 上限提示 88 / 详情 106 / 数据异常 124，分隔线 138，内容从 152 开始。
const EDITOR_HEADER = 152;
const EDITOR_FOOTER = 32;
const EDITOR_MIN_SCALE = 0.7;
const EDITOR_LABEL_LINES = 2;
const EDITOR_LABEL_COLS = 8;
// 原站兵牌：符号占 y=16..86，名称行盒从 88 开始。旧导出把首行基线放在 93 会压住
// 符号底部；改为 100/114（12px 字体 ascender ≈9、descender ≈3），仍留在 120px 卡片内。
const EDITOR_LABEL_FIRST_BASELINE = 100;
const EDITOR_LABEL_LINE_HEIGHT = 14;
const EDITOR_SIGNATURE_VERSION = 'editor-subtree-sha256-v1';
// 防御性上限：工作区模型限深 24，但 renderDocument 也可能被直接喂入外部树。
// 超过此深度的分支不递归布局，并在图中明确报告截断，避免栈溢出。
const MAX_EDITOR_TREE_DEPTH = 512;
const EDITOR_VERT_ECHELONS = new Set(['platoon', 'section', 'squad', 'team', 'individual']);
const EDITOR_ATTRIBUTION =
  '兵牌样式适配自 Army_Editor 1.8.0（BiliBili@勘茶Kchs_ 与 DeepSeek，commit e5bd0eb）；' +
  '原仓库未声明标准许可证，本图不是原站截图 · 军标 milsymbol（MIT）';

const PAD = 32;
const GUTTER = 18;
const CARD_W = 640;
const CARD_H = 60;
const ROW_GAP = 10;
const ROW_STEP = CARD_H + ROW_GAP;
const INDENT = 22;
const MAX_INDENT = 220;
const TREE_TOP = 132;
const FOOTER_H = 30;
const SYMBOL_W = 40;
const SYMBOL_H = 44;
const SYMBOL_X = 8;
const SYMBOL_Y = 8;

const FONT_STACK =
  "'Noto Sans CJK SC', 'Source Han Sans SC', 'Droid Sans Fallback', 'Noto Sans', sans-serif";

const ECHELON_LABEL = {
  K: '集团军',
  J: '军',
  I: '师',
  H: '旅',
  G: '团',
  F: '营',
  E: '连',
  D: '排',
  C: '分队',
  B: '班',
  A: '火力组',
  '-': '单兵',
};

// model.js 使用完整单词存储层级；渲染接口同时接受单词与单字母。
const ECHELON_CODE_BY_WORD = {
  army: 'K',
  corps: 'J',
  division: 'I',
  brigade: 'H',
  regiment: 'G',
  battalion: 'F',
  company: 'E',
  platoon: 'D',
  section: 'C',
  squad: 'B',
  team: 'A',
  individual: '-',
};

// 兵种 SIDC 事实表：来自原站 milsymbol-bridge.js 的 TYPE_SIDC / TYPE_MOB
// 调研快照（只取本项目需要的 27 个 type，不复制整份文件）。
// 15 位字母 SIDC = SFGP + 6 位功能码 + 第 11 位修饰 + 第 12 位（梯队或机动）+ ---。
// milsymbol 以第 12 位为 echelon/mobility，与桥接文件一致。
const TYPE_FUNCTION_ID = {
  infantry: 'UCI---',
  light_infantry: 'UCIL--',
  mech: 'UCII--',
  armor: 'UCA---',
  light_armor: 'UCATL-',
  heavy_armor: 'UCATH-',
  airborne: 'UCIA--',
  air_assault: 'UCIS--',
  mountain: 'UCIO--',
  recon: 'UCR---',
  recon_mech: 'UCRV--',
  wheeled_inf: 'UCIM--',
  artillery: 'UCF---',
  mlrs: 'UCFR--',
  mortar: 'UCFM--',
  anti_tank: 'UCAA--',
  aaa: 'UCD---',
  towed_w: 'UCF---',
  towed_t: 'UCF---',
  rotary: 'UCV---',
  fixedwing: 'UCVF--',
  attack_heli: 'UCVRA-',
  uav_unit: 'UCVU--',
  engineer: 'UCE---',
  signal: 'UUS---',
  medical: 'USM---',
  supply: 'USS---',
};

// 桥接文件里 towed_w / towed_t 固定带“牵引”机动修饰：第 11 位 M，第 12 位 S。
// 有梯队时梯队优先占用第 12 位（标准里两者共用同一位置）。
const TYPE_MOBILITY = {
  towed_w: 'MS',
  towed_t: 'MS',
};

// 原站确认的 8 个 ms_ 别名。其他 ms_* 名称不再猜测，走明确 fallback。
const MS_ALIAS_TYPE = {
  ms_sfgpuci: 'infantry',
  ms_sfgpucat: 'armor',
  ms_sfgpucf: 'artillery',
  ms_sfgpucr: 'recon',
  ms_sfgpuce: 'engineer',
  ms_sfgpuus: 'signal',
  ms_sfgpusm: 'medical',
  ms_sfgpuss: 'supply',
};

const FALLBACK_LABEL = {
  unknown: '符号未识别',
  invalidSidc: 'SIDC 无效',
  renderError: '符号渲染失败',
};

const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const XML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function cleanText(value) {
  return String(value ?? '').replace(XML_INVALID, '\uFFFD');
}

function escapeXml(value) {
  return cleanText(value).replace(/[&<>"']/g, (ch) => XML_ESCAPE[ch]);
}

function clipText(value, maxChars) {
  const chars = Array.from(cleanText(value));
  if (chars.length <= maxChars) return chars.join('');
  return chars.slice(0, Math.max(0, maxChars - 1)).join('') + '…';
}

function toCount(value) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function sumEquipment(equipment) {
  if (!Array.isArray(equipment)) return 0;
  let total = 0;
  for (const item of equipment) {
    if (!item || typeof item !== 'object') continue;
    total += toCount(item.count);
  }
  return total;
}

// 角标/标题里的装备上限沿用原站 computeStats 语义：countMax 缺省或为 0 时取 count。
function sumEquipmentMax(equipment) {
  if (!Array.isArray(equipment)) return 0;
  let total = 0;
  for (const item of equipment) {
    if (!item || typeof item !== 'object') continue;
    total += toCount(item.countMax) || toCount(item.count);
  }
  return total;
}

function roundCoord(value) {
  const rounded = Math.round(Number(value) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

// 原站 data.js DEFAULT_VERT_ECHELONS：排及以下默认纵向，其余横向。
// 节点显式保存的 layout 优先；缺失时按层级推导，绝不写回节点。
function editorLayoutOf(node) {
  if (node && node.layout === 'v') return 'v';
  if (node && node.layout === 'h') return 'h';
  const echelon = node && typeof node.echelon === 'string' ? node.echelon.trim().toLowerCase() : '';
  return EDITOR_VERT_ECHELONS.has(echelon) ? 'v' : 'h';
}

// 原站 newNode 默认 stack:true；显式 false 才展开相同兄弟。
function editorStackEnabled(node) {
  return !node || node.stack !== false;
}

// 堆叠指纹必须覆盖所有会影响画面/统计的字段，避免把“看起来一样”但数据不同的
// 单位错误合并。原站按 customName 才计 name，这里始终计入 name 更保守。
// 装备数组先按完整元组排序再 JSON 序列化：稳定、无控制字符分隔歧义。
function editorEquipmentSignature(equipment) {
  if (!Array.isArray(equipment)) return '[]';
  const items = [];
  for (const item of equipment) {
    if (!item || typeof item !== 'object') continue;
    const countMax = item.countMax === undefined || item.countMax === null
      ? null
      : toCount(item.countMax);
    items.push([String(item.name ?? ''), toCount(item.count), countMax]);
  }
  items.sort((left, right) => {
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
    if (left[1] !== right[1]) return left[1] - right[1];
    return String(left[2]).localeCompare(String(right[2]));
  });
  return JSON.stringify(items);
}

function editorCustomSignature(node) {
  if (!node || node.custom === undefined || node.custom === null) return '';
  try {
    return JSON.stringify(node.custom);
  } catch {
    return '[unserializable]';
  }
}

// 长度界定 + sha256 的子树指纹：每个字段写“字段名:UTF-8字节数:值;”，
// 再写子节点数量和每个固定 64 位 hex 子指纹。这样字段/子节点边界不可伪造，
// 且每层只保留 64 字节摘要，深树总内存 O(n) 而不是拼接整棵子树的 O(n²)。
function updateSignatureField(hash, name, value) {
  const text = String(value ?? '');
  hash.update(`${name}:${Buffer.byteLength(text, 'utf8')}:`);
  hash.update(text);
  hash.update(';');
}

function editorSignature(node, childSignatures) {
  const hash = createHash('sha256');
  hash.update(EDITOR_SIGNATURE_VERSION);
  hash.update(';');
  updateSignatureField(hash, 'type', node?.type);
  updateSignatureField(hash, 'echelon', node?.echelon);
  updateSignatureField(hash, 'name', node?.name);
  updateSignatureField(hash, 'mod', node?.mod);
  updateSignatureField(hash, 'remark', node?.remark);
  updateSignatureField(hash, 'badge', node?.badge);
  updateSignatureField(hash, 'personnel', toCount(node?.personnel));
  updateSignatureField(hash, 'personnelMax', toCount(node?.personnelMax));
  updateSignatureField(hash, 'equipment', editorEquipmentSignature(node?.equipment));
  updateSignatureField(hash, 'custom', editorCustomSignature(node));
  updateSignatureField(hash, 'layout', editorLayoutOf(node));
  updateSignatureField(hash, 'collapsed', node?.collapsed === true ? '1' : '0');
  updateSignatureField(hash, 'stack', editorStackEnabled(node) ? '1' : '0');
  updateSignatureField(hash, 'childCount', childSignatures.length);
  for (const childSignature of childSignatures) {
    updateSignatureField(hash, 'child', childSignature);
  }
  return hash.digest('hex');
}

// 自底向上算指纹；rows 已按前序排列，倒序保证子节点摘要先就绪。
function assignEditorSignatures(rows) {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    row.signature = editorSignature(row.node, row.children.map((child) => child.signature));
  }
}

function fmtNumber(value) {
  const number = toCount(value);
  if (number < 1000) return String(number);
  if (number < 10000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (number < 1000000) return `${Math.round(number / 1000)}k`;
  if (number < 1e9) return `${(number / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  return `${(number / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
}

function fmtRange(min, max) {
  const a = toCount(min);
  const b = toCount(max);
  return b > a ? `${fmtNumber(a)}-${fmtNumber(b)}` : fmtNumber(a);
}

// 逐个直属节点检查“上限非零且小于实际值”。不能只看聚合后的 min/max：
// 例如 root 100/80 + child 5/50 聚合后是 105-130，看起来完全合法。
// 这里只读数据并报告，绝不修正或写回。
function collectEditorDataAnomalies(rows) {
  const examples = [];
  let personnelCount = 0;
  let equipmentCount = 0;
  for (const row of rows) {
    const node = row.node;
    const nodeName = clipText(node?.name || '未命名节点', 10);
    if (row.ownPersonnelMax > 0 && row.ownPersonnelMax < row.ownPersonnel) {
      personnelCount += 1;
      if (examples.length < 3) {
        examples.push(
          `${nodeName} 人数上限 ${row.ownPersonnelMax} < 实际 ${row.ownPersonnel}`,
        );
      }
    }
    const equipment = Array.isArray(node?.equipment) ? node.equipment : [];
    for (const item of equipment) {
      if (!item || typeof item !== 'object') continue;
      const count = toCount(item.count);
      const countMax = toCount(item.countMax);
      if (countMax > 0 && countMax < count) {
        equipmentCount += 1;
        if (examples.length < 3) {
          examples.push(`${clipText(item.name || '装备', 10)} 上限 ${countMax} < 实际 ${count}`);
        }
      }
    }
  }
  return {
    total: personnelCount + equipmentCount,
    personnelCount,
    equipmentCount,
    examples,
  };
}

function normalizeMaxNodes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_MAX_NODES;
  return Math.min(ABSOLUTE_MAX_NODES, Math.max(1, Math.floor(number)));
}

function echelonInfo(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { code: '-', label: null, known: false };
  }
  const raw = value.trim();
  const upper = raw.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(ECHELON_LABEL, upper)) {
    return { code: upper, label: ECHELON_LABEL[upper], known: true };
  }
  const word = raw.toLowerCase().replace(/[\s_/-]+/g, '_');
  if (Object.prototype.hasOwnProperty.call(ECHELON_CODE_BY_WORD, word)) {
    const code = ECHELON_CODE_BY_WORD[word];
    return { code, label: ECHELON_LABEL[code], known: true };
  }
  return { code: '-', label: null, known: false };
}

function echelonText(value) {
  if (typeof value !== 'string' || value.trim() === '') return '层级未标';
  const info = echelonInfo(value);
  if (!info.known) return `层级未知 (${clipText(value, 4)})`;
  return info.code === '-' ? info.label : `${info.label} (${info.code})`;
}

function normalizeType(type) {
  if (typeof type !== 'string') return null;
  const raw = type.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(TYPE_FUNCTION_ID, raw)) return raw;
  if (Object.prototype.hasOwnProperty.call(MS_ALIAS_TYPE, raw)) return MS_ALIAS_TYPE[raw];
  return null;
}

function isKnownSidc(sidc) {
  return typeof sidc === 'string' && /^[A-Z0-9][A-Z0-9.-]{14}$/.test(sidc.toUpperCase());
}

function buildSidc(node) {
  const custom = node?.custom && typeof node.custom === 'object' ? node.custom.sidc : undefined;
  const customSidc = typeof custom === 'string' ? custom.trim() : '';
  if (customSidc) {
    if (!isKnownSidc(customSidc)) return { sidc: null, fallback: FALLBACK_LABEL.invalidSidc };
    const sidc = customSidc.toUpperCase();
    const echelon = echelonInfo(node?.echelon).code;
    if (echelon === '-') return { sidc, fallback: null };
    return { sidc: sidc.slice(0, 11) + echelon + sidc.slice(12), fallback: null };
  }
  const type = normalizeType(node?.type);
  if (!type) return { sidc: null, fallback: FALLBACK_LABEL.unknown };

  const echelon = echelonInfo(node?.echelon).code;
  const mobility = TYPE_MOBILITY[type] || '';
  let modifier11 = '-';
  let modifier12 = '-';
  if (echelon !== '-') {
    modifier12 = echelon;
  } else if (mobility) {
    modifier11 = mobility.charAt(0) || '-';
    modifier12 = mobility.charAt(1) || '-';
  }
  return {
    sidc: `SFGP${TYPE_FUNCTION_ID[type]}${modifier11}${modifier12}---`,
    fallback: null,
  };
}

function parseSymbolSvg(raw) {
  if (typeof raw !== 'string') return null;
  const match = /^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(raw.trim());
  if (!match) return null;
  const viewBox = /\bviewBox="([^"]+)"/.exec(match[1]);
  if (!viewBox || !/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/.test(viewBox[1])) return null;
  return { inner: match[2], viewBox: viewBox[1] };
}

function renderFallbackSymbol() {
  return [
    `<rect x="0.5" y="0.5" width="${SYMBOL_W - 1}" height="${SYMBOL_H - 1}" rx="3"`,
    ' fill="#fff" stroke="#b04a3a" stroke-dasharray="4 3" stroke-width="1"/>',
    `<text x="${SYMBOL_W / 2}" y="${SYMBOL_H / 2 + 6}" text-anchor="middle"`,
    ` font-family="${FONT_STACK}" font-size="17" fill="#b04a3a">?</text>`,
  ].join('');
}

function renderSymbol(node) {
  const resolved = buildSidc(node);
  if (!resolved.sidc) {
    return { markup: renderFallbackSymbol(), sidc: null, fallback: resolved.fallback };
  }
  try {
    const symbol = new ms.Symbol(resolved.sidc, { size: 24, padding: 0, infoFields: false });
    const parsed = parseSymbolSvg(symbol.asSVG());
    if (!parsed) {
      return { markup: renderFallbackSymbol(), sidc: null, fallback: FALLBACK_LABEL.renderError };
    }
    const markup = [
      `<svg x="${SYMBOL_X}" y="${SYMBOL_Y}" width="${SYMBOL_W}" height="${SYMBOL_H}"`,
      ` viewBox="${parsed.viewBox}" preserveAspectRatio="xMidYMid meet">`,
      parsed.inner,
      '</svg>',
    ].join('');
    return { markup, sidc: resolved.sidc, fallback: null };
  } catch {
    return { markup: renderFallbackSymbol(), sidc: null, fallback: FALLBACK_LABEL.renderError };
  }
}

function fallbackText(node, fallback) {
  if (fallback === FALLBACK_LABEL.invalidSidc) return FALLBACK_LABEL.invalidSidc;
  if (fallback === FALLBACK_LABEL.renderError) return FALLBACK_LABEL.renderError;
  const type = typeof node?.type === 'string' ? clipText(node.type, 18) : '';
  return type ? `未知符号：${type}` : '未知符号';
}

function findNode(root, nodeId) {
  const stack = [root];
  const seen = new Set();
  let scanned = 0;
  while (stack.length && scanned < MAX_SCAN_NODES) {
    const node = stack.pop();
    scanned += 1;
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (String(node.id) === String(nodeId)) return node;
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      if (scanned + stack.length >= MAX_SCAN_NODES) break;
      stack.push(children[i]);
    }
  }
  return null;
}

function collectRows(root) {
  const rows = [];
  const seen = new Set();
  let scanLimited = false;
  let structureIssues = false;
  const stack = [{ node: root, depth: 0, parent: null }];

  while (stack.length) {
    if (rows.length >= MAX_SCAN_NODES) {
      scanLimited = true;
      break;
    }
    const item = stack.pop();
    const node = item.node;
    if (!node || typeof node !== 'object' || seen.has(node)) {
      structureIssues = true;
      continue;
    }
    seen.add(node);
    const row = {
      node,
      depth: item.depth,
      parent: item.parent,
      children: [],
      ownPersonnel: toCount(node.personnel),
      ownPersonnelMax: toCount(node.personnelMax),
      ownEquipment: sumEquipment(node.equipment),
      ownEquipmentMax: sumEquipmentMax(node.equipment),
      subPersonnel: 0,
      subPersonnelMax: 0,
      subEquipment: 0,
      subEquipmentMax: 0,
      subtreeNodes: 0,
      signature: '',
    };
    rows.push(row);
    if (item.parent) item.parent.children.push(row);
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      // 在把子节点压栈之前就限制总扫描量，避免一个超大 children 数组先耗尽内存。
      if (rows.length + stack.length >= MAX_SCAN_NODES) {
        scanLimited = true;
        break;
      }
      stack.push({ node: children[i], depth: item.depth + 1, parent: row });
    }
  }
  if (stack.length > 0) scanLimited = true;

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    let personnel = row.ownPersonnel;
    let personnelMax = row.ownPersonnelMax;
    let equipment = row.ownEquipment;
    let equipmentMax = row.ownEquipmentMax;
    let nodes = 1;
    for (const child of row.children) {
      personnel += child.subPersonnel;
      personnelMax += child.subPersonnelMax;
      equipment += child.subEquipment;
      equipmentMax += child.subEquipmentMax;
      nodes += child.subtreeNodes;
    }
    row.subPersonnel = personnel;
    row.subPersonnelMax = personnelMax;
    row.subEquipment = equipment;
    row.subEquipmentMax = equipmentMax;
    row.subtreeNodes = nodes;
  }

  return { rows, rootRow: rows[0] ?? null, scanLimited, structureIssues };
}

function selectVisible(rootRow, limit) {
  const selected = [];
  let renderableCount = 0;
  const stack = [rootRow];
  while (stack.length) {
    const row = stack.pop();
    renderableCount += 1;
    if (selected.length < limit) selected.push(row);
    if (row.node.collapsed === true && row.children.length > 0) continue;
    for (let i = row.children.length - 1; i >= 0; i -= 1) stack.push(row.children[i]);
  }
  return { selected, renderableCount };
}

function estimateWidth(text, size) {
  return Array.from(cleanText(text)).length * size;
}

function nodeX(row) {
  return PAD + GUTTER + Math.min(row.depth * INDENT, MAX_INDENT);
}

function renderNodeCard(row, index) {
  const x = nodeX(row);
  const y = TREE_TOP + index * ROW_STEP;
  const node = row.node;
  const symbol = renderSymbol(node);
  const name = escapeXml(clipText(node?.name || '未命名节点', 26));
  const echelons = escapeXml(echelonText(node?.echelon));
  const evidence = nodeEvidence(node);
  const personnelUnknown = ['unknown', 'legacy-ambiguous'].includes(evidence?.personnel?.status);
  const stats = escapeXml(
    `本级 ${personnelUnknown ? '?' : row.ownPersonnel} 人 · 子树 ${row.subPersonnel} 人 · 装备 ${row.ownEquipment} 件`,
  );
  const isRoot = row.depth === 0;
  const border = isRoot ? '#2f4a6d' : '#b6bdc9';
  const borderWidth = isRoot ? 2 : 1;
  const sidcAttr = symbol.sidc ? ` data-sidc="${escapeXml(symbol.sidc)}"` : '';
  const warning = symbol.fallback
    ? [
        `<text x="${CARD_W - 10}" y="57" text-anchor="end" font-family="${FONT_STACK}"`,
        ` font-size="9.5" fill="#b04a3a">${escapeXml(fallbackText(node, symbol.fallback))}</text>`,
      ].join('')
    : '';

  return [
    `<g class="node" transform="translate(${x} ${y})"${sidcAttr}>`,
    `<rect x="0.5" y="0.5" width="${CARD_W - 1}" height="${CARD_H - 1}" rx="6"`,
    ` fill="#ffffff" stroke="${border}" stroke-width="${borderWidth}"/>`,
    symbol.markup,
    `<text x="56" y="23" font-family="${FONT_STACK}" font-size="15.5" font-weight="700" fill="#1c2430">${name}</text>`,
    `<text x="${CARD_W - 10}" y="22" text-anchor="end" font-family="${FONT_STACK}" font-size="10.5" fill="#5b6b7c">${echelons}</text>`,
    `<text x="56" y="43" font-family="${FONT_STACK}" font-size="12" fill="#44505f">${stats}</text>`,
    warning,
    '</g>',
  ].join('');
}

function renderConnectors(selected) {
  const selectedSet = new Set(selected);
  const indexOf = new Map(selected.map((row, index) => [row, index]));
  const parts = [];

  for (const row of selected) {
    const children = row.children.filter((child) => selectedSet.has(child));
    if (children.length === 0) continue;
    const parentIndex = indexOf.get(row);
    const parentX = nodeX(row);
    const parentY = TREE_TOP + parentIndex * ROW_STEP;
    const trunkX = parentX - 12;
    const startY = parentY + CARD_H / 2;
    let lastY = startY;
    for (const child of children) {
      lastY = Math.max(lastY, TREE_TOP + indexOf.get(child) * ROW_STEP + CARD_H / 2);
    }
    if (lastY <= startY) continue;
    parts.push(
      `<path d="M${parentX} ${startY} H${trunkX} V${lastY}" fill="none" stroke="#8d99a8" stroke-width="1.25"/>`,
    );
    for (const child of children) {
      const childY = TREE_TOP + indexOf.get(child) * ROW_STEP + CARD_H / 2;
      const childX = nodeX(child);
      parts.push(
        `<path d="M${trunkX} ${childY} H${childX}" fill="none" stroke="#8d99a8" stroke-width="1.25"/>`,
      );
    }
  }

  return `<g id="links">${parts.join('')}</g>`;
}

function encodePng(svg, width, height) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'original' },
    background: '#f6f7f9',
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Noto Sans CJK SC',
    },
  });
  const image = resvg.render();
  if (image.width !== width || image.height !== height) {
    // 尺寸必须与 SVG 完全一致，PNG 只是同一份内容的位图副本。
    throw new Error(`渲染尺寸不一致：SVG ${width}x${height}，PNG ${image.width}x${image.height}`);
  }
  return image.asPng();
}

function renderListDocument(document, options = {}) {
  if (!document || typeof document !== 'object') {
    throw new TypeError('renderDocument 需要编制文档对象');
  }
  if (!document.root || typeof document.root !== 'object') {
    throw new TypeError('编制文档缺少 root 节点');
  }
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw new TypeError('renderDocument 的 options 必须是对象');
  }

  const maxNodes = normalizeMaxNodes(options.maxNodes);
  const focusRequested =
    options.nodeId !== undefined && options.nodeId !== null && String(options.nodeId) !== '';

  let scopeRootNode = document.root;
  let focusNode = null;
  if (focusRequested) {
    focusNode = findNode(document.root, options.nodeId);
    if (!focusNode) {
      throw new Error(`未知的节点 ID：${cleanText(options.nodeId)}`);
    }
    scopeRootNode = focusNode;
  }

  const scope = collectRows(scopeRootNode);
  if (!scope.rootRow) {
    throw new TypeError('编制文档的 root 节点不可渲染');
  }

  const total = scope.rows.length;
  const rowCapacity = Math.max(1, Math.floor((MAX_HEIGHT - TREE_TOP - FOOTER_H) / ROW_STEP));
  const limit = Math.min(maxNodes, rowCapacity);
  const { selected, renderableCount } = selectVisible(scope.rootRow, limit);

  const shown = selected.length;
  const truncated = shown < renderableCount || scope.scanLimited;
  const collapsedHidden = Math.max(0, total - renderableCount);

  const title = clipText(document?.name || '未命名编制', 40);
  const revision =
    document?.revision === undefined || document?.revision === null ? '-' : document.revision;
  const meta = clipText(
    `修订 ${clipText(revision, 24)} · 节点 ${total} 个 · 总人数 ${scope.rootRow.subPersonnel} 人 · ` +
      `装备 ${scope.rootRow.subEquipment} 件${coverageSuffix(document)}`,
    200,
  );

  const notices = [];
  if (scope.scanLimited) {
    notices.push(
      `扫描上限：文档节点超过 ${MAX_SCAN_NODES} 个，图中显示 ${shown} / ${total} 个已扫描节点。`,
    );
  }
  if (truncated && !scope.scanLimited) {
    notices.push(
      `已截断：图中显示 ${shown} / ${total} 个节点（maxNodes=${maxNodes}，像素上限 ${MAX_WIDTH}×${MAX_HEIGHT}）。`,
    );
  }
  if (focusNode) {
    notices.push(`聚焦子树：${clipText(focusNode.name || '未命名节点', 30)}`);
  }
  if (collapsedHidden > 0) {
    notices.push(`已折叠 ${collapsedHidden} 个节点未展开（总数 ${total}，图中 ${shown}）`);
  }
  if (scope.structureIssues) {
    notices.push('检测到重复节点引用，已跳过重复部分。');
  }
  const limitLine = notices.filter((text) => /^(已截断|扫描上限)/.test(text)).join(' ');
  const detailLine = notices.filter((text) => !/^(已截断|扫描上限)/.test(text)).join(' · ');

  const maxDepth = selected.reduce((depth, row) => Math.max(depth, row.depth), 0);
  const layoutWidth = PAD * 2 + GUTTER + Math.min(maxDepth * INDENT, MAX_INDENT) + CARD_W;
  const noticeWidth =
    PAD * 2 +
    Math.max(estimateWidth(limitLine, 12), estimateWidth(detailLine, 12), 0);
  const width = Math.ceil(
    Math.min(
      MAX_WIDTH,
      Math.max(
        layoutWidth,
        PAD * 2 + estimateWidth(title, 22),
        PAD * 2 + estimateWidth(meta, 13),
        noticeWidth,
      ),
    ),
  );
  const height = TREE_TOP + shown * ROW_STEP + FOOTER_H;

  const cards = selected.map((row, index) => renderNodeCard(row, index)).join('');
  const connectors = renderConnectors(selected);
  const noticeText = [
    limitLine
      ? `<text x="${PAD}" y="90" font-family="${FONT_STACK}" font-size="12" fill="#a33b2e">${escapeXml(limitLine)}</text>`
      : '',
    detailLine
      ? `<text x="${PAD}" y="108" font-family="${FONT_STACK}" font-size="12" fill="#4a5563">${escapeXml(detailLine)}</text>`
      : '',
  ].join('');

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT_STACK}" data-mode="list">`,
    '<rect width="100%" height="100%" fill="#f6f7f9"/>',
    `<text x="${PAD}" y="44" font-family="${FONT_STACK}" font-size="22" font-weight="700" fill="#14202e">${escapeXml(title)}</text>`,
    `<text x="${PAD}" y="69" font-family="${FONT_STACK}" font-size="13" fill="#4a5563">${escapeXml(meta)}</text>`,
    noticeText,
    `<path d="M${PAD} 122 H${width - PAD}" stroke="#d5dae1" stroke-width="1"/>`,
    connectors,
    `<g id="nodes">${cards}</g>`,
    `<text x="${PAD}" y="${height - 11}" font-family="${FONT_STACK}" font-size="10" fill="#7a8594">${escapeXml('标准军标 milsymbol（MIT） · 树状布局自绘 · 用户文本已转义')}</text>`,
    '</svg>',
  ].join('');

  const png = encodePng(svg, width, height);

  return {
    svg,
    png,
    width,
    height,
    shown,
    total,
    truncated,
    mode: 'list',
    cards: shown,
    scale: 1,
  };
}

// ============================================================================
// editor 模式：原编辑器兵牌风格。
// 只读节点数据；布局状态全部放在本函数创建的包装对象上，绝不写回调用方对象。
// ============================================================================

function renderEditorSymbol(node) {
  const resolved = buildSidc(node);
  if (!resolved.sidc) {
    return { markup: renderEditorFallbackSymbol(), sidc: null, fallback: resolved.fallback };
  }
  try {
    const symbol = new ms.Symbol(resolved.sidc, {
      size: 100,
      padding: 0,
      infoFields: false,
      fillColor: EDITOR_PAPER,
      frameColor: EDITOR_INK,
      iconColor: EDITOR_INK,
      strokeWidth: 4,
    });
    const parsed = parseSymbolSvg(symbol.asSVG());
    if (!parsed) {
      return { markup: renderEditorFallbackSymbol(), sidc: null, fallback: FALLBACK_LABEL.renderError };
    }
    const markup = [
      `<svg x="${EDITOR_SYM_X}" y="${EDITOR_SYM_Y}" width="${EDITOR_SYM_W}" height="${EDITOR_SYM_H}"`,
      ` viewBox="${parsed.viewBox}" preserveAspectRatio="xMidYMid meet" class="symbol-svg">`,
      parsed.inner,
      '</svg>',
    ].join('');
    return { markup, sidc: resolved.sidc, fallback: null };
  } catch {
    return { markup: renderEditorFallbackSymbol(), sidc: null, fallback: FALLBACK_LABEL.renderError };
  }
}

// 与 editor 模式同一坐标：符号 72×70 位于兵牌顶部，框高 48 + 22 的顶部文字区。
function renderEditorFallbackSymbol() {
  return [
    `<svg x="${EDITOR_SYM_X}" y="${EDITOR_SYM_Y}" width="${EDITOR_SYM_W}" height="${EDITOR_SYM_H}"`,
    ' viewBox="0 0 72 70" class="symbol-svg">',
    `<rect x="0.5" y="${EDITOR_TOP_PAD + 0.5}" width="71" height="47" rx="3"`,
    ' fill="#ffffff" stroke="#b04a3a" stroke-dasharray="4 3" stroke-width="1"/>',
    `<text x="36" y="${EDITOR_TOP_PAD + 29}" text-anchor="middle"`,
    ` font-family="${FONT_STACK}" font-size="18" fill="#b04a3a">?</text>`,
    '</svg>',
  ].join('');
}

function editorLabelLines(name) {
  let chars = Array.from(cleanText(name || '未命名节点'));
  const maxChars = EDITOR_LABEL_LINES * EDITOR_LABEL_COLS;
  if (chars.length > maxChars) {
    chars = chars.slice(0, maxChars - 1);
    chars.push('…');
  }
  const lines = [];
  for (let i = 0; i < chars.length && lines.length < EDITOR_LABEL_LINES; i += EDITOR_LABEL_COLS) {
    lines.push(chars.slice(i, i + EDITOR_LABEL_COLS).join(''));
  }
  return lines;
}

function estimateBadgeWidth(text) {
  let width = 12;
  for (const character of Array.from(text)) {
    width += (character.codePointAt(0) || 0) > 0x2e80 ? 8.6 : 5.6;
  }
  return Math.min(112, Math.ceil(width));
}

function renderEditorBadge(kind, prefix, valueText, y) {
  const text = `${prefix} ${valueText}`;
  const width = estimateBadgeWidth(text);
  const fill = kind === 'personnel' ? EDITOR_INK : '#8a4b16';
  return [
    `<g class="badge badge-${kind}" data-value="${escapeXml(valueText)}">`,
    `<rect x="2" y="${y}" width="${width}" height="14" rx="7" fill="${fill}" fill-opacity="0.92"/>`,
    `<text x="${2 + width / 2}" y="${y + 10.5}" text-anchor="middle" font-family="${FONT_STACK}"`,
    ` font-size="9" font-weight="600" fill="#ffffff">${escapeXml(text)}</text>`,
    '</g>',
  ].join('');
}

function renderEditorBadges(row) {
  let y = 2;
  let markup = '';
  const evidence = nodeEvidence(row.node);
  const personnelUnknown = ['unknown', 'legacy-ambiguous'].includes(evidence?.personnel?.status);
  if (personnelUnknown) {
    markup += renderEditorBadge('personnel', '人', '?', y);
    y += 16;
  } else if (row.subPersonnel > 0 || row.subPersonnelMax > 0) {
    markup += renderEditorBadge('personnel', '人', fmtRange(row.subPersonnel, row.subPersonnelMax), y);
    y += 16;
  }
  if (row.subEquipment > 0 || row.subEquipmentMax > 0) {
    markup += renderEditorBadge('equipment', '装', fmtRange(row.subEquipment, row.subEquipmentMax), y);
  }
  return markup;
}

function renderEditorStackCount(groupSize) {
  if (groupSize <= 1) return '';
  const text = `×${groupSize}`;
  const width = Math.max(20, Array.from(text).length * 6 + 10);
  const right = EDITOR_SYM_X + EDITOR_SYM_W + 9;
  return [
    `<g class="stack-count" data-count="${groupSize}">`,
    `<rect x="${roundCoord(right - width)}" y="79" width="${width}" height="14" rx="7" fill="#2563eb"/>`,
    `<text x="${roundCoord(right - width / 2)}" y="89.5" text-anchor="middle" font-family="${FONT_STACK}"`,
    ` font-size="10" font-weight="800" fill="#ffffff">${escapeXml(text)}</text>`,
    '</g>',
  ].join('');
}

function renderEditorMod(node, baseline = 20) {
  if (!node || typeof node.mod !== 'string' || node.mod === '') return '';
  const mark = node.mod === '+' ? '+' : '−';
  return [
    `<text class="mod-mark" x="${EDITOR_SYM_X + EDITOR_SYM_W + 8}" y="${baseline}" text-anchor="middle"`,
    ` font-family="${FONT_STACK}" font-size="17" font-weight="900" fill="${EDITOR_INK}">`,
    escapeXml(mark),
    '</text>',
  ].join('');
}

// 静态 SVG 里保留原站折叠按钮的“+”：只挂在“自身折叠且确实有下属”的节点上。
// 叶子没有按钮，因此与折叠节点一眼可分；全局隐藏数量仍由标题区提示保留。
function renderEditorCollapseMarker(row) {
  const node = row.node;
  if (!node || node.collapsed !== true || row.children.length === 0) return '';
  const hidden = Math.max(0, row.subtreeNodes - 1);
  return [
    `<g class="collapse-marker" data-hidden="${hidden}" transform="translate(104 10)">`,
    `<title>${escapeXml(`折叠：${hidden} 个下属未显示`)}</title>`,
    '<circle r="8" fill="#d97706" stroke="#ffffff" stroke-width="1.5"/>',
    `<text x="0" y="4.5" text-anchor="middle" font-family="${FONT_STACK}" font-size="13" font-weight="700" fill="#ffffff">+</text>`,
    '</g>',
  ].join('');
}

function renderEditorRemark(node) {
  if (!node || typeof node.remark !== 'string' || node.remark.trim() === '') return '';
  return [
    '<g class="remark-icon">',
    `<title>${escapeXml(clipText(node.remark, 120))}</title>`,
    '<text x="116" y="116" text-anchor="end" font-family="' + FONT_STACK + '"',
    ' font-size="9" fill="#6b7280">注</text>',
    '</g>',
  ].join('');
}

function renderEditorNode(vnode, index) {
  const row = vnode.row;
  const node = row.node;
  const symbol = renderEditorSymbol(node);
  const id = node && node.id !== undefined && node.id !== null ? String(node.id) : `node-${index}`;
  const sidcAttr = symbol.sidc ? ` data-sidc="${escapeXml(symbol.sidc)}"` : '';
  const fallbackAttr = symbol.fallback
    ? ` data-fallback="${escapeXml(fallbackText(node, symbol.fallback))}"`
    : '';
  const echelonAttr = node && node.echelon !== undefined && node.echelon !== null
    ? escapeXml(String(node.echelon))
    : '';
  const collapsedAttr = node && node.collapsed === true ? ' data-collapsed="true"' : '';
  const collapseMarker = renderEditorCollapseMarker(row);
  const layers = vnode.groupSize > 1
    ? [
        `<g class="stack-layer l2" transform="translate(10 10)">${symbol.markup}</g>`,
        `<g class="stack-layer l1" transform="translate(5 5)">${symbol.markup}</g>`,
      ].join('')
    : '';
  const labels = editorLabelLines(node && node.name)
    .map(
      (line, lineIndex) =>
        `<text class="label-line" x="${EDITOR_NODE_W / 2}" y="${EDITOR_LABEL_FIRST_BASELINE + lineIndex * EDITOR_LABEL_LINE_HEIGHT}" text-anchor="middle"` +
        ` font-family="${FONT_STACK}" font-size="12" font-weight="500" fill="#1e293b">${escapeXml(line)}</text>`,
    )
    .join('');

  return [
    `<g class="node" data-node-id="${escapeXml(id)}" data-depth="${row.depth}"`,
    ` data-layout="${vnode.layout}" data-echelon="${echelonAttr}"${collapsedAttr}${sidcAttr}${fallbackAttr}`,
    ` transform="translate(${roundCoord(vnode.left)} ${roundCoord(vnode.y)})">`,
    layers,
    `<g class="symbol">${symbol.markup}</g>`,
    renderEditorBadges(row),
    labels,
    renderEditorStackCount(vnode.groupSize),
    collapseMarker,
    renderEditorMod(node, collapseMarker ? 33 : 20),
    renderEditorRemark(node),
    '</g>',
  ].join('');
}

// 包装对象：只在本次渲染里保存 box/cx/y，不污染编制节点。
function buildEditorVisibleTree(row, depth, state) {
  const vnode = { row, groupSize: 1, children: [] };
  const node = row.node;
  if (!node || node.collapsed === true) return vnode;
  if (depth >= MAX_EDITOR_TREE_DEPTH) {
    state.depthLimited = true;
    return vnode;
  }

  const groups = [];
  if (editorStackEnabled(node)) {
    const bySignature = new Map();
    for (const child of row.children) {
      const existing = bySignature.get(child.signature);
      if (existing) {
        existing.groupSize += 1;
      } else {
        const group = { row: child, groupSize: 1, children: [] };
        bySignature.set(child.signature, group);
        groups.push(group);
      }
    }
  } else {
    for (const child of row.children) groups.push({ row: child, groupSize: 1, children: [] });
  }
  for (const group of groups) {
    group.children = buildEditorVisibleTree(group.row, depth + 1, state).children;
  }
  vnode.children = groups;
  return vnode;
}

// 只统计“被折叠隐藏”的节点数，与深度/预算截断区分开，避免提示互相混淆。
function countCollapsedHidden(rootRow) {
  let hidden = 0;
  const stack = [rootRow];
  while (stack.length) {
    const row = stack.pop();
    const node = row.node;
    if (node && node.collapsed === true) {
      hidden += row.subtreeNodes - 1;
      continue;
    }
    for (const child of row.children) stack.push(child);
  }
  return hidden;
}

function editorCountCards(vnode) {
  let count = 1;
  for (const child of vnode.children) count += editorCountCards(child);
  return count;
}

// shown 统计“实际被表现的节点数”：一个 ×N 堆叠格不仅代表 N 个本节点，也代表
// N 份完全相同的后代子树。因此后代的计数必须乘以所有祖先堆叠倍率（嵌套相乘），
// 不能只加一次 groupSize。折叠/预算未绘制的分支不在 vnode.children 里，自然不计。
function editorRepresentedNodes(vnode, ancestorCopies = 1) {
  const copies = ancestorCopies * vnode.groupSize;
  let count = copies;
  for (const child of vnode.children) count += editorRepresentedNodes(child, copies);
  return count;
}

// 堆叠提示里的“共代表 N 个节点”同样要覆盖堆叠子树的后代：
// 例如 ×2 排各带一个班，代表的是 2 个排 + 2 个班。
function editorStackStats(vnode, stats = { groups: 0, nodes: 0 }, ancestorCopies = 1, insideStack = false) {
  const copies = ancestorCopies * vnode.groupSize;
  const stackedHere = vnode.groupSize > 1;
  if (stackedHere) stats.groups += 1;
  if (insideStack || stackedHere) stats.nodes += copies;
  for (const child of vnode.children) {
    editorStackStats(child, stats, copies, insideStack || stackedHere);
  }
  return stats;
}

function editorPrune(vnode, remaining) {
  if (remaining.left <= 0) return null;
  const copy = { row: vnode.row, groupSize: vnode.groupSize, children: [] };
  remaining.left -= 1;
  for (const child of vnode.children) {
    if (remaining.left <= 0) break;
    const pruned = editorPrune(child, remaining);
    if (pruned) copy.children.push(pruned);
  }
  return copy;
}

function pruneEditorTree(vnode, budget) {
  return editorPrune(vnode, { left: Math.max(1, Math.floor(budget)) });
}

function computeEditorBox(vnode) {
  vnode.layout = editorLayoutOf(vnode.row.node);
  if (vnode.children.length === 0) {
    vnode.boxW = EDITOR_NODE_W;
    vnode.boxH = EDITOR_NODE_H;
    return;
  }
  if (vnode.layout === 'v') {
    let maxWidth = EDITOR_NODE_W;
    let totalHeight = EDITOR_NODE_H;
    for (const child of vnode.children) {
      computeEditorBox(child);
      maxWidth = Math.max(maxWidth, child.boxW);
      totalHeight += EDITOR_VGAP_V + child.boxH;
    }
    vnode.boxW = maxWidth;
    vnode.boxH = totalHeight;
    return;
  }
  let totalWidth = 0;
  let maxHeight = 0;
  for (const child of vnode.children) {
    computeEditorBox(child);
    totalWidth += child.boxW;
    maxHeight = Math.max(maxHeight, child.boxH);
  }
  totalWidth += (vnode.children.length - 1) * EDITOR_HGAP;
  vnode.boxW = Math.max(EDITOR_NODE_W, totalWidth);
  vnode.boxH = EDITOR_NODE_H + EDITOR_VGAP + maxHeight;
}

function assignEditorPositions(vnode, left, top) {
  vnode.cx = left + vnode.boxW / 2;
  vnode.y = top;
  vnode.left = vnode.cx - EDITOR_NODE_W / 2;
  if (vnode.children.length === 0) return;
  if (vnode.layout === 'v') {
    let childTop = top + EDITOR_NODE_H + EDITOR_VGAP_V;
    for (const child of vnode.children) {
      assignEditorPositions(child, vnode.cx - child.boxW / 2, childTop);
      childTop += child.boxH + EDITOR_VGAP_V;
    }
    return;
  }
  const totalWidth =
    vnode.children.reduce((sum, child) => sum + child.boxW, 0) +
    (vnode.children.length - 1) * EDITOR_HGAP;
  let childLeft = vnode.cx - totalWidth / 2;
  const childTop = top + EDITOR_NODE_H + EDITOR_VGAP;
  for (const child of vnode.children) {
    assignEditorPositions(child, childLeft, childTop);
    childLeft += child.boxW + EDITOR_HGAP;
  }
}

function renderEditorLinks(root) {
  const parts = [];
  const add = (fromX, fromY, toX, toY) => {
    parts.push(`M${roundCoord(fromX)} ${roundCoord(fromY)} L${roundCoord(toX)} ${roundCoord(toY)}`);
  };
  const walk = (vnode) => {
    if (vnode.children.length === 0) return;
    const bottom = vnode.y + EDITOR_NODE_H;
    if (vnode.layout === 'v') {
      for (const child of vnode.children) add(vnode.cx, bottom, vnode.cx, child.y);
    } else {
      const midY = bottom + EDITOR_VGAP / 2;
      add(vnode.cx, bottom, vnode.cx, midY);
      const first = vnode.children[0];
      const last = vnode.children[vnode.children.length - 1];
      add(first.cx, midY, last.cx, midY);
      for (const child of vnode.children) add(child.cx, midY, child.cx, child.y);
    }
    for (const child of vnode.children) walk(child);
  };
  walk(root);
  return [
    '<g id="links">',
    `<path d="${parts.join(' ')}" fill="none" stroke="${EDITOR_LINK}" stroke-width="2"`,
    ' stroke-linecap="square" stroke-linejoin="miter"/>',
    '</g>',
  ].join('');
}

function renderEditorDocument(document, options = {}) {
  const maxNodes = normalizeMaxNodes(options.maxNodes);
  const focusRequested =
    options.nodeId !== undefined && options.nodeId !== null && String(options.nodeId) !== '';

  let scopeRootNode = document.root;
  let focusNode = null;
  if (focusRequested) {
    focusNode = findNode(document.root, options.nodeId);
    if (!focusNode) {
      throw new Error(`未知的节点 ID：${cleanText(options.nodeId)}`);
    }
    scopeRootNode = focusNode;
  }

  const scope = collectRows(scopeRootNode);
  if (!scope.rootRow) {
    throw new TypeError('编制文档的 root 节点不可渲染');
  }
  assignEditorSignatures(scope.rows);

  const total = scope.rows.length;
  const treeState = { depthLimited: false };
  const fullTree = buildEditorVisibleTree(scope.rootRow, 0, treeState);
  const cardsTotal = editorCountCards(fullTree);
  const collapseHidden = countCollapsedHidden(scope.rootRow);

  const availableWidth = MAX_WIDTH - EDITOR_SIDE * 2;
  const availableHeight = MAX_HEIGHT - EDITOR_HEADER - EDITOR_FOOTER;
  const fitsAt = (width, height, scale) =>
    width * scale <= availableWidth + 0.01 && height * scale <= availableHeight + 0.01;

  // maxNodes 限制实际绘制的兵牌格数（渲染/位图成本）；×N 堆叠每格代表多个节点，
  // shown 报告真实代表的节点数，因此合法堆叠时 shown 可能大于 maxNodes，但绝不隐藏数据。
  const budgetTree = cardsTotal > maxNodes ? pruneEditorTree(fullTree, maxNodes) : fullTree;
  const budgetCards = Math.min(cardsTotal, maxNodes);
  computeEditorBox(budgetTree);

  let finalTree = budgetTree;
  let scale = 1;
  if (!fitsAt(budgetTree.boxW, budgetTree.boxH, 1)) {
    const needed = Math.min(
      availableWidth / Math.max(1, budgetTree.boxW),
      availableHeight / Math.max(1, budgetTree.boxH),
    );
    // 只在字号仍可读时等比缩放；否则保留 1:1 并显式截断，绝不静默画到画布外。
    const downscale = Math.floor(needed * 10000) / 10000;
    if (downscale >= EDITOR_MIN_SCALE) {
      scale = downscale;
    } else {
      let low = 1;
      let high = budgetCards;
      let best = null;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = pruneEditorTree(fullTree, middle);
        computeEditorBox(candidate);
        if (fitsAt(candidate.boxW, candidate.boxH, 1)) {
          best = candidate;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      finalTree = best || pruneEditorTree(fullTree, 1);
      computeEditorBox(finalTree);
      scale = 1;
    }
  }

  computeEditorBox(finalTree);
  assignEditorPositions(finalTree, 0, 0);

  const contentWidth = finalTree.boxW;
  const contentHeight = finalTree.boxH;
  const drawnWidth = Math.ceil(contentWidth * scale);
  const drawnHeight = Math.ceil(contentHeight * scale);
  const cards = editorCountCards(finalTree);
  const shown = editorRepresentedNodes(finalTree);
  const truncated = cards < cardsTotal || scope.scanLimited || treeState.depthLimited;
  const stackStats = editorStackStats(finalTree);

  const title = clipText(document?.name || '未命名编制', 40);
  const revision =
    document?.revision === undefined || document?.revision === null ? '-' : document.revision;
  const meta = clipText(
    `修订 ${clipText(revision, 24)} · 节点 ${total} 个 · 总人数 ${fmtRange(scope.rootRow.subPersonnel, scope.rootRow.subPersonnelMax)} 人 · ` +
      `装备 ${fmtRange(scope.rootRow.subEquipment, scope.rootRow.subEquipmentMax)} 件 · 原编辑器兵牌${coverageSuffix(document)}`,
    220,
  );

  const anomalies = collectEditorDataAnomalies(scope.rows);
  let anomalyText = '';
  if (anomalies.total > 0) {
    anomalyText = clipText(
      `数据异常：${anomalies.total} 项上限小于实际值（人数 ${anomalies.personnelCount} 项、装备 ${anomalies.equipmentCount} 项）：` +
        `${anomalies.examples.join('；')}${anomalies.total > anomalies.examples.length ? ' 等' : ''}。` +
        '未修改数据，请核对直属值。',
      160,
    );
  }

  let limitLine = '';
  if (scope.scanLimited) {
    limitLine = `扫描上限：文档节点超过 ${MAX_SCAN_NODES} 个，图中显示 ${shown} / ${total} 个已扫描节点。`;
  }
  if (truncated && !scope.scanLimited) {
    limitLine = `已截断：图中显示 ${shown} / ${total} 个节点（绘制 ${cards} 张兵牌；maxNodes=${maxNodes} 张兵牌，画布 ${MAX_WIDTH}×${MAX_HEIGHT}）。`;
  } else if (truncated && scope.scanLimited) {
    limitLine += ` 已截断：绘制 ${cards} 张兵牌，maxNodes=${maxNodes}。`;
  }

  // 缩放/深度这类“没有丢内容但改变了呈现”的提示优先，避免被更长的折叠说明挤掉。
  const details = [];
  if (scale < 1) {
    details.push(
      `已等比缩放至 ${Math.round(scale * 100)}% 以完整放入 ${MAX_WIDTH}×${MAX_HEIGHT} 画布（字号随图缩放）`,
    );
  }
  if (treeState.depthLimited) {
    details.push(`深度上限：只展开前 ${MAX_EDITOR_TREE_DEPTH} 层节点，更深的节点未绘制。`);
  }
  if (focusNode) details.push(`聚焦子树：${clipText(focusNode.name || '未命名节点', 30)}`);
  if (collapseHidden > 0) {
    details.push(`已折叠 ${collapseHidden} 个节点未展开（总数 ${total}，图中 ${shown}）`);
  }
  if (stackStats.groups > 0) {
    details.push(
      `堆叠：${stackStats.groups} 组相同节点合并为 ${stackStats.groups} 张兵牌，共代表 ${stackStats.nodes} 个节点（maxNodes 按兵牌格计）`,
    );
  }
  if (scope.structureIssues) details.push('检测到重复节点引用，已跳过重复部分。');
  const limitText = clipText(limitLine, 160);
  const detailText = clipText(details.join(' · '), 160);

  const estimatedWidth = Math.max(
    EDITOR_SIDE * 2 + estimateWidth(title, 22),
    EDITOR_SIDE * 2 + estimateWidth(meta, 13),
    limitText ? EDITOR_SIDE * 2 + estimateWidth(limitText, 12) : 0,
    detailText ? EDITOR_SIDE * 2 + estimateWidth(detailText, 12) : 0,
    anomalyText ? EDITOR_SIDE * 2 + estimateWidth(anomalyText, 12) : 0,
  );
  const width = Math.min(
    MAX_WIDTH,
    Math.max(760, EDITOR_SIDE * 2 + drawnWidth, estimatedWidth),
  );
  const height = EDITOR_HEADER + drawnHeight + EDITOR_FOOTER;
  if (width > MAX_WIDTH || height > MAX_HEIGHT) {
    throw new Error(`渲染尺寸超出上限：${width}x${height}`);
  }

  const contentX = (width - drawnWidth) / 2;
  const contentY = EDITOR_HEADER;
  const scaleAttr = scale === 1 ? '' : ` scale(${scale})`;
  const flattened = [];
  const flatten = (vnode) => {
    flattened.push(vnode);
    for (const child of vnode.children) flatten(child);
  };
  flatten(finalTree);
  const cardsMarkup = flattened.map((vnode, index) => renderEditorNode(vnode, index)).join('');
  const footerMaxChars = Math.max(20, Math.floor((width - EDITOR_SIDE * 2) / 5.2));
  const footer = clipText(EDITOR_ATTRIBUTION, footerMaxChars);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT_STACK}" data-mode="editor">`,
    `<rect width="100%" height="100%" fill="${EDITOR_BG}"/>`,
    `<text class="title" x="${EDITOR_SIDE}" y="40" font-family="${FONT_STACK}" font-size="22" font-weight="700" fill="#14202e">${escapeXml(title)}</text>`,
    `<text class="meta" x="${EDITOR_SIDE}" y="66" font-family="${FONT_STACK}" font-size="13" fill="#4a5563">${escapeXml(meta)}</text>`,
    limitText
      ? `<text class="notice notice-limit" x="${EDITOR_SIDE}" y="88" font-family="${FONT_STACK}" font-size="12" fill="#a33b2e">${escapeXml(limitText)}</text>`
      : '',
    detailText
      ? `<text class="notice notice-detail" x="${EDITOR_SIDE}" y="106" font-family="${FONT_STACK}" font-size="12" fill="#4a5563">${escapeXml(detailText)}</text>`
      : '',
    anomalyText
      ? `<text class="notice notice-anomaly" x="${EDITOR_SIDE}" y="124" font-family="${FONT_STACK}" font-size="12" fill="#b45309">${escapeXml(anomalyText)}</text>`
      : '',
    `<path d="M${EDITOR_SIDE} 138 H${width - EDITOR_SIDE}" stroke="#d5dae1" stroke-width="1"/>`,
    `<g id="content" transform="translate(${roundCoord(contentX)} ${roundCoord(contentY)})${scaleAttr}">`,
    renderEditorLinks(finalTree),
    `<g id="nodes">${cardsMarkup}</g>`,
    '</g>',
    `<text class="attribution" x="${EDITOR_SIDE}" y="${height - 10}" font-family="${FONT_STACK}" font-size="8.5" fill="#7a8594">${escapeXml(footer)}</text>`,
    '</svg>',
  ].join('');

  const png = encodePng(svg, width, height);

  return {
    svg,
    png,
    width,
    height,
    shown,
    total,
    truncated,
    mode: 'editor',
    cards,
    scale,
  };
}

const RENDER_MODES = new Set(['editor', 'list']);

/**
 * 把编制渲染为同一份内容的 SVG 与 PNG。
 *
 * @param {object} document 编制文档（只读）
 * @param {{mode?: 'editor'|'list', nodeId?: string, maxNodes?: number}} [options]
 *   mode 缺省为 editor（原编辑器兵牌样式）；list 保留旧列表渲染。
 */
export function renderDocument(document, options = {}) {
  if (!document || typeof document !== 'object') {
    throw new TypeError('renderDocument 需要编制文档对象');
  }
  if (!document.root || typeof document.root !== 'object') {
    throw new TypeError('编制文档缺少 root 节点');
  }
  if (options === undefined) options = {};
  if (options === null || typeof options !== 'object') {
    throw new TypeError('renderDocument 的 options 必须是对象');
  }
  const mode = options.mode === undefined ? 'editor' : options.mode;
  if (!RENDER_MODES.has(mode)) {
    throw new Error('mode 必须是 editor 或 list');
  }
  return mode === 'list'
    ? renderListDocument(document, options)
    : renderEditorDocument(document, options);
}
