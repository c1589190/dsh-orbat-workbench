import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDocument } from '../src/render.js';

/**
 * 原编辑器兵牌风格（editor 模式）的真实渲染器测试。
 *
 * 视觉依据：Army_Editor 1.8.0（commit e5bd0eb288afec143dc9bf202f1aa16ee6ff07d5，
 * 作者 BiliBili@勘茶Kchs_ 与 DeepSeek；原仓库未见标准许可证，本工作台不声称获得
 * 再分发授权）。这里只验证本工作台服务端渲染的布局/角标/截断语义，不声称像素一致。
 */

function node(id, fields = {}) {
  return {
    id,
    name: id,
    type: 'infantry',
    echelon: 'battalion',
    personnel: 0,
    personnelMax: 0,
    equipment: [],
    children: [],
    ...fields,
  };
}

function doc(root, extra = {}) {
  return {
    id: 'doc-1',
    name: '原编辑器样式测试编制',
    revision: 7,
    root,
    ...extra,
  };
}

function pngSize(buffer) {
  assert.ok(Buffer.isBuffer(buffer), 'png must be a Buffer');
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function frame(result) {
  const match = /<g id="content" transform="translate\((-?[\d.]+) (-?[\d.]+)\)(?: scale\(([\d.]+)\))?">/.exec(
    result.svg,
  );
  assert.ok(match, 'editor SVG must have a content transform group');
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    scale: match[3] === undefined ? 1 : Number(match[3]),
  };
}

function nodesOf(result) {
  const positions = new Map();
  const pattern = /<g class="node" data-node-id="([^"]*)"[^>]*transform="translate\((-?[\d.]+) (-?[\d.]+)\)"/g;
  for (const match of result.svg.matchAll(pattern)) {
    positions.set(match[1], { x: Number(match[2]), y: Number(match[3]) });
  }
  return positions;
}

function pathSegments(result) {
  const match = /<g id="links"><path d="([^"]*)"/.exec(result.svg);
  assert.ok(match, 'editor SVG must contain a link path');
  const segments = [];
  const pattern = /M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)/g;
  for (const part of match[1].matchAll(pattern)) {
    segments.push({
      from: { x: Number(part[1]), y: Number(part[2]) },
      to: { x: Number(part[3]), y: Number(part[4]) },
    });
  }
  return segments;
}

function close(a, b) {
  return Math.abs(a - b) <= 0.05;
}

function hasSegment(segments, from, to) {
  return segments.some(
    (segment) =>
      close(segment.from.x, from.x) &&
      close(segment.from.y, from.y) &&
      close(segment.to.x, to.x) &&
      close(segment.to.y, to.y),
  );
}

function absoluteNode(result, position) {
  const content = frame(result);
  return {
    x: content.x + content.scale * position.x,
    y: content.y + content.scale * position.y,
    width: content.scale * 120,
    height: content.scale * 120,
  };
}

function assertNodesInsideCanvas(result) {
  const content = frame(result);
  const nodes = nodesOf(result);
  assert.ok(nodes.size > 0);
  for (const [id, position] of nodes) {
    const box = absoluteNode(result, position);
    assert.ok(box.x >= -0.01, `${id} 左边界越界: ${box.x}`);
    assert.ok(box.y >= -0.01, `${id} 上边界越界: ${box.y}`);
    assert.ok(box.x + box.width <= result.width + 0.01, `${id} 右边界越界`);
    assert.ok(box.y + box.height <= result.height + 0.01, `${id} 下边界越界`);
  }
  assert.ok(content.scale > 0 && content.scale <= 1);
}

function wideDoc() {
  const battalions = [];
  for (let b = 1; b <= 18; b += 1) {
    const companies = [];
    for (let c = 1; c <= 12; c += 1) {
      companies.push(
        node(`b${b}c${c}`, {
          name: `第${b}营第${c}连`,
          echelon: 'company',
          layout: 'h',
          personnel: 90,
        }),
      );
    }
    battalions.push(
      node(`b${b}`, {
        name: `第${b}合成营`,
        echelon: 'battalion',
        layout: 'h',
        personnel: 300,
        children: companies,
      }),
    );
  }
  return doc(
    node('root', { name: '第一合成旅', echelon: 'brigade', layout: 'h', personnel: 200, children: battalions }),
  );
}

test('defaults to editor mode and keeps list mode available explicitly', () => {
  const input = doc(node('root', { name: '测试旅', echelon: 'brigade', personnel: 10 }));
  const defaulted = renderDocument(input);
  const editor = renderDocument(input, { mode: 'editor' });
  const list = renderDocument(input, { mode: 'list' });

  assert.equal(defaulted.svg, editor.svg, '缺省模式必须是 editor');
  assert.match(editor.svg, /data-mode="editor"/);
  assert.match(list.svg, /data-mode="list"/);
  assert.match(editor.svg, /id="content"/);
  assert.ok(!list.svg.includes('id="content"'), 'list 模式必须保持原列表布局');
  assert.notEqual(editor.svg, list.svg);
  assert.equal(defaulted.shown, 1);
  assert.equal(defaulted.total, 1);

  assert.throws(() => renderDocument(input, { mode: 'print' }), /mode/);
  assert.throws(() => renderDocument(input, { mode: null }), /mode/);
});

test('rows carry upstream attribution and do not claim a standard license', () => {
  const result = renderDocument(doc(node('root', { name: '测试旅' })));
  assert.ok(result.svg.includes('勘茶Kchs_'), 'must preserve upstream author');
  assert.ok(result.svg.includes('DeepSeek'), 'must preserve upstream co-author');
  assert.ok(result.svg.includes('e5bd0eb'), 'must preserve upstream commit');
  assert.ok(result.svg.includes('未声明标准许可证'), 'must state no standard license');
  assert.ok(result.svg.includes('milsymbol'));
});

test('mixes horizontal and vertical child layouts exactly like the upstream box model', () => {
  const a = node('a', {
    name: '第一营',
    layout: 'v',
    children: [
      node('a1', { name: '一连', echelon: 'company' }),
      node('a2', { name: '二连', echelon: 'company' }),
    ],
  });
  // 不写 layout 时按上游默认：旅/营默认横向，排及以下默认纵向。
  const b = node('b', { name: '第二营' });
  const root = node('root', { name: '第一旅', echelon: 'brigade', children: [a, b] });
  const result = renderDocument(doc(root));

  assert.equal(result.total, 5);
  assert.equal(result.shown, 5);
  const nodes = nodesOf(result);
  assert.equal(nodes.size, 5);
  const rootNode = nodes.get('root');
  const aNode = nodes.get('a');
  const bNode = nodes.get('b');
  const a1Node = nodes.get('a1');
  const a2Node = nodes.get('a2');

  // 横向兄弟：同顶、间隔 10px（节点宽 120）。
  assert.ok(close(aNode.y, bNode.y));
  assert.ok(close(bNode.x - (aNode.x + 120), 10));
  // 横向父节点与子节点之间留 20px。
  assert.ok(close(aNode.y - (rootNode.y + 120), 20));
  // 纵向子节点：同列、间隔 16px。
  assert.ok(close(a1Node.x, a2Node.x));
  assert.ok(close(a1Node.x, aNode.x), '纵向子节点与父节点同列');
  assert.ok(close(a2Node.y - (a1Node.y + 120), 16));
  assert.ok(close(a1Node.y - (aNode.y + 120), 16));

  const rootCx = rootNode.x + 60;
  const aCx = aNode.x + 60;
  const bCx = bNode.x + 60;
  const rootBottom = rootNode.y + 120;
  const midY = rootBottom + 10;
  const segments = pathSegments(result);
  // 横向：父中心 -> 母线，母线连接首末子节点，再落到每个子节点顶部。
  assert.ok(hasSegment(segments, { x: rootCx, y: rootBottom }, { x: rootCx, y: midY }));
  assert.ok(hasSegment(segments, { x: aCx, y: midY }, { x: bCx, y: midY }));
  assert.ok(hasSegment(segments, { x: aCx, y: midY }, { x: aCx, y: aNode.y }));
  assert.ok(hasSegment(segments, { x: bCx, y: midY }, { x: bCx, y: bNode.y }));
  // 纵向：父中心垂直向下连到每个子节点。
  assert.ok(hasSegment(segments, { x: aCx, y: aNode.y + 120 }, { x: aCx, y: a1Node.y }));
  assert.ok(hasSegment(segments, { x: aCx, y: aNode.y + 120 }, { x: aCx, y: a2Node.y }));

  assert.ok(result.width <= 2400);
  assert.ok(result.height <= 16000);
  assert.deepEqual(pngSize(result.png), { width: result.width, height: result.height });
});

test('badges show subtree personnel and equipment totals, including ranges', () => {
  const a = node('a', {
    name: '第一营',
    personnel: 100,
    equipment: [{ name: '步枪', count: 3 }],
    layout: 'h',
    children: [
      node('a1', {
        name: '一连',
        personnel: 50,
        equipment: [{ name: '步枪', count: 1 }],
      }),
    ],
  });
  const b = node('b', {
    name: '第二营',
    personnel: 250,
    personnelMax: 300,
    equipment: [{ name: '步战车', count: 2, countMax: 4 }],
  });
  const root = node('root', {
    name: '第一旅',
    echelon: 'brigade',
    personnel: 10,
    equipment: [{ name: '指挥车', count: 2 }],
    layout: 'h',
    children: [a, b],
  });

  const result = renderDocument(doc(root));
  assert.equal(result.total, 4);
  // 根节点角标含全部下属：10 + 100 + 50 + 250 人，2 + 3 + 1 + 2 件。
  assert.ok(result.svg.includes('人 410'), 'root badge must include descendants');
  assert.ok(result.svg.includes('装 8'));
  assert.ok(result.svg.includes('class="badge badge-personnel" data-value="410"'));
  // 中间节点角标含其子树：100 + 50 人，3 + 1 件。
  assert.ok(result.svg.includes('人 150'));
  assert.ok(result.svg.includes('装 4'));
  // 区间：personnelMax / countMax 大于最小时显示 min-max。
  assert.ok(result.svg.includes('人 250-300'));
  assert.ok(result.svg.includes('装 2-4'));
  // 标题区统计仍是一份完整小计，而不是重复累加本级。
  assert.ok(result.svg.includes('节点 4 个'));
  assert.ok(result.svg.includes('总人数 410 人'));
  assert.ok(result.svg.includes('装备 8-10 件'), 'equipment range must include countMax');
});

test('escapes every editor text and never emits user markup', () => {
  const root = node('root', {
    name: '一营</text><foreignObject><img src=x></foreignObject>'.repeat(2),
    echelon: '"><script>',
    remark: '</g><img src=x onerror=alert(1)>',
    layout: 'h',
    personnel: 10,
    children: [
      node('c1', {
        name: 'A&B <script>alert(1)</script>',
        type: 'space_marines',
        echelon: '"><script>',
        mod: '</g><script>',
      }),
    ],
  });
  const result = renderDocument(doc(root, {
    name: '一营</text><foreignObject>',
    revision: '<img src=x onerror=alert(1)>',
  }));

  assert.ok(!result.svg.includes('<script'));
  assert.ok(!result.svg.includes('<foreignObject'));
  assert.ok(!result.svg.includes('<img'));
  assert.ok(!result.svg.includes('onerror="'));
  assert.ok(result.svg.includes('&lt;script&gt;'));
  assert.ok(result.svg.includes('A&amp;B'));
  assert.ok(result.svg.includes('&lt;foreignObject&gt;'));
  assert.ok(result.svg.includes('&lt;img src=x'));
  assert.ok(result.svg.includes('data-fallback="未知符号：space_marines"'));
  assert.ok(result.svg.includes('…'), 'truncated labels must be marked with an ellipsis');
});

test('collapsed nodes render alone, count their descendants, and still show their stats', () => {
  const children = [1, 2, 3, 4, 5].map((i) => node(`c${i}`, { name: `第${i}班`, personnel: 10 }));
  const root = node('root', {
    name: '缩编连',
    echelon: 'company',
    personnel: 50,
    layout: 'h',
    collapsed: true,
    children,
  });
  const result = renderDocument(doc(root));

  assert.equal(result.total, 6);
  assert.equal(result.shown, 1);
  assert.equal(result.truncated, false);
  assert.ok(result.svg.includes('已折叠 5 个节点'));
  assert.equal((result.svg.match(/<g class="node"/g) || []).length, 1);
  // 折叠不能隐藏数据：角标仍显示含下属的 50 + 5×10 人。
  assert.ok(result.svg.includes('人 100'));
});

test('stacks identical siblings with an explicit ×N badge and keeps distinct units apart', () => {
  const squad = { type: 'infantry', echelon: 'squad', personnel: 10, equipment: [{ name: '步枪', count: 10 }] };
  const makeDoc = (stack, names = ['第一班', '第一班', '第一班', '第二班'], stats = [10, 10, 10, 10]) => {
    const children = names.map((name, index) =>
      node(`c${index}`, { ...squad, name, personnel: stats[index] }),
    );
    return doc(
      node('root', {
        name: '缩编连',
        echelon: 'company',
        personnel: 5,
        layout: 'h',
        stack,
        children,
      }),
    );
  };

  const stacked = renderDocument(makeDoc(true));
  assert.equal(stacked.total, 5);
  // 3 个完全相同的班合并为 1 格，但它们的 3 个节点仍算作“已展示”。
  assert.equal(stacked.cards, 3);
  assert.equal(stacked.shown, 5);
  assert.equal(stacked.truncated, false);
  assert.equal((stacked.svg.match(/<g class="node"/g) || []).length, 3);
  assert.ok(stacked.svg.includes('×3'));
  assert.equal((stacked.svg.match(/class="stack-layer/g) || []).length, 2);
  assert.ok(stacked.svg.includes('人 45'), 'stacked parent still shows descendant statistics');
  assert.equal((stacked.svg.match(/第一班/g) || []).length, 1);

  // stack 未显式设置时按上游 newNode 默认 true。
  const implicitStack = renderDocument(makeDoc(undefined));
  assert.equal(implicitStack.cards, 3);
  assert.equal(implicitStack.shown, 5);
  assert.ok(implicitStack.svg.includes('×3'));

  const expanded = renderDocument(makeDoc(false));
  assert.equal(expanded.cards, 5);
  assert.equal(expanded.shown, 5);
  assert.equal((expanded.svg.match(/<g class="node"/g) || []).length, 5);
  assert.ok(!expanded.svg.includes('×3'));
  assert.ok(!expanded.svg.includes('class="stack-layer'));

  // 名称不同：即使其它字段一致也不能被堆叠隐藏。
  const distinctNames = renderDocument(makeDoc(true, ['一班', '二班'], [10, 10]));
  assert.equal(distinctNames.cards, 3);
  assert.equal(distinctNames.shown, 3);
  assert.ok(!distinctNames.svg.includes('×2'));

  // 人数不同：同样不能堆叠（指纹包含统计字段）。
  const distinctStats = renderDocument(makeDoc(true, ['第一班', '第一班'], [10, 11]));
  assert.equal(distinctStats.cards, 3);
  assert.equal(distinctStats.shown, 3);
  assert.ok(!distinctStats.svg.includes('×2'));
});

test('multiplies descendants by their stacked ancestor so shown reflects real units', () => {
  const squadFields = {
    name: '第一班',
    type: 'infantry',
    echelon: 'squad',
    personnel: 10,
    equipment: [{ name: '步枪', count: 10 }],
  };
  const platoon = (id) =>
    node(id, {
      name: '第一排',
      echelon: 'platoon',
      layout: 'v',
      personnel: 20,
      children: [node(`${id}s`, squadFields)],
    });
  const input = doc(
    node('root', {
      name: '堆叠连',
      echelon: 'company',
      layout: 'h',
      personnel: 10,
      children: [platoon('p1'), platoon('p2')],
    }),
  );

  const result = renderDocument(input);
  assert.equal(result.total, 5, 'root + 2 identical platoons + 2 identical squads');
  assert.equal(result.cards, 3, 'one root card, one ×2 platoon card, one squad card');
  assert.equal(result.shown, 5, 'both platoons AND both squads are represented');
  assert.equal(result.truncated, false);
  assert.ok(result.svg.includes('×2'));
  assert.ok(result.svg.includes('共代表 4 个节点'), 'stack notice must include multiplied descendants');
});

test('multiplies nested stack multiplicities instead of adding them once', () => {
  const squad = (id) => node(id, { name: '第一班', echelon: 'squad', personnel: 10 });
  const platoon = (id) =>
    node(id, {
      name: '第一排',
      echelon: 'platoon',
      layout: 'v',
      personnel: 20,
      children: [squad(`${id}s1`), squad(`${id}s2`), squad(`${id}s3`)],
    });
  const input = doc(
    node('root', {
      name: '嵌套堆叠连',
      echelon: 'company',
      layout: 'h',
      personnel: 10,
      children: [platoon('p1'), platoon('p2')],
    }),
  );

  const result = renderDocument(input);
  assert.equal(result.total, 9, 'root + 2 platoons + 2×3 squads');
  assert.equal(result.cards, 3, 'root + one ×2 platoon card + one ×3 squad card');
  assert.equal(result.shown, 9, 'nested multiplicity is 2 × 3, not 2 + 3');
  assert.equal(result.truncated, false);
  assert.ok(result.svg.includes('×2'));
  assert.ok(result.svg.includes('×3'));
  assert.ok(result.svg.includes('共代表 8 个节点'), 'platoon ×2 plus squad 2×3');
});

test('excludes collapsed and budget-pruned descendants from shown', () => {
  const makeDoc = (collapsed) =>
    doc(
      node('root', {
        name: '折叠/预算连',
        echelon: 'company',
        layout: 'h',
        personnel: 10,
        children: ['p1', 'p2'].map((id) =>
          node(id, {
            name: '第一排',
            echelon: 'platoon',
            layout: 'v',
            personnel: 20,
            collapsed,
            children: [node(`${id}s`, { name: '第一班', echelon: 'squad', personnel: 10 })],
          }),
        ),
      }),
    );

  // 折叠：只显示根 + ×2 排；两个班被折叠隐藏，不应计入 shown，也不应算截断。
  const collapsed = renderDocument(makeDoc(true));
  assert.equal(collapsed.total, 5);
  assert.equal(collapsed.cards, 2);
  assert.equal(collapsed.shown, 3);
  assert.equal(collapsed.truncated, false);
  assert.ok(collapsed.svg.includes('已折叠 2 个节点'));

  // 预算截断：maxNodes=2 只画根 + ×2 排；班虽可见但未绘制，不计入 shown。
  const pruned = renderDocument(makeDoc(false), { mode: 'editor', maxNodes: 2 });
  assert.equal(pruned.total, 5);
  assert.equal(pruned.cards, 2);
  assert.equal(pruned.shown, 3);
  assert.equal(pruned.truncated, true);
  assert.match(pruned.svg, /已截断/);
  assert.ok(!pruned.svg.includes('已折叠'));
});

test('honours maxNodes, reports real shown/total, and never paints nodes outside the canvas', () => {
  const input = wideDoc();
  const result = renderDocument(input, { mode: 'editor', maxNodes: 60 });
  const rendered = nodesOf(result);

  assert.equal(result.total, 235);
  assert.equal(result.shown, rendered.size, 'distinct names must map one node per card');
  assert.ok(result.shown < result.total);
  assert.equal(result.truncated, true);
  assert.ok(result.cards <= 60);
  assert.match(result.svg, /已截断/);
  assert.ok(result.svg.includes('60'));
  assert.ok(result.width <= 2400);
  assert.ok(result.height <= 16000);
  assertNodesInsideCanvas(result);
  assert.deepEqual(pngSize(result.png), { width: result.width, height: result.height });

  const hugeBudget = renderDocument(input, { mode: 'editor', maxNodes: 100000 });
  assert.equal(hugeBudget.truncated, true);
  assert.ok(hugeBudget.shown < hugeBudget.total);
  assert.ok(hugeBudget.width <= 2400);
  assert.ok(hugeBudget.height <= 16000);
  assertNodesInsideCanvas(hugeBudget);

  const defaulted = renderDocument(input);
  assert.equal(defaulted.total, 235);
  assert.equal(defaulted.truncated, true);
  assert.ok(defaulted.shown < defaulted.total);
  assert.match(defaulted.svg, /已截断/);
  assert.ok(defaulted.width <= 2400);
  assert.ok(defaulted.height <= 16000);
  assertNodesInsideCanvas(defaulted);

  // maxNodes 在像素上限之前先截断：60 个纵向兄弟，只画 10 格。
  const tall = node('root', {
    name: '纵向连',
    echelon: 'company',
    layout: 'v',
    children: Array.from({ length: 60 }, (_, i) =>
      node(`v${i}`, { name: `第${i}排`, echelon: 'platoon' }),
    ),
  });
  const budgeted = renderDocument(doc(tall), { mode: 'editor', maxNodes: 10 });
  assert.equal(budgeted.total, 61);
  assert.equal(budgeted.cards, 10);
  assert.equal(budgeted.shown, 10);
  assert.equal(budgeted.truncated, true);
  assert.match(budgeted.svg, /已截断/);
  assertNodesInsideCanvas(budgeted);
});

test('scales complete content proportionally when it stays readable', () => {
  const wide = node('root', {
    name: '宽横队',
    echelon: 'company',
    layout: 'h',
    children: Array.from({ length: 24 }, (_, i) =>
      node(`w${i}`, { name: `第${i}班`, echelon: 'squad' }),
    ),
  });
  const widthScaled = renderDocument(doc(wide));

  assert.equal(widthScaled.total, 25);
  assert.equal(widthScaled.shown, 25);
  assert.equal(widthScaled.truncated, false);
  assert.ok(widthScaled.scale < 1);
  assert.ok(widthScaled.scale >= 0.7, 'scaling must not fall below the readable threshold');
  assert.match(widthScaled.svg, /已等比缩放/);
  assert.ok(widthScaled.width <= 2400);
  assert.ok(widthScaled.height <= 16000);
  assertNodesInsideCanvas(widthScaled);
  assert.deepEqual(pngSize(widthScaled.png), { width: widthScaled.width, height: widthScaled.height });

  const tall = node('root', {
    name: '深纵列',
    echelon: 'company',
    layout: 'v',
    children: Array.from({ length: 120 }, (_, i) =>
      node(`t${i}`, { name: `第${i}班`, echelon: 'squad' }),
    ),
  });
  const heightScaled = renderDocument(doc(tall));
  assert.equal(heightScaled.total, 121);
  assert.equal(heightScaled.shown, 121);
  assert.equal(heightScaled.truncated, false);
  assert.ok(heightScaled.scale < 1);
  assert.ok(heightScaled.scale >= 0.7);
  assert.ok(heightScaled.width <= 2400);
  assert.ok(heightScaled.height <= 16000);
  assertNodesInsideCanvas(heightScaled);
});

test('focuses on one subtree in editor mode and rejects unknown node ids', () => {
  const branchA = node('a', {
    name: '第一营',
    layout: 'v',
    personnel: 100,
    children: [
      node('a1', { name: '一连', echelon: 'company', personnel: 50 }),
      node('a2', { name: '二连', echelon: 'company', personnel: 40 }),
    ],
  });
  const branchB = node('b', { name: '第二营', personnel: 80 });
  const input = doc(
    node('root', { name: '第一旅', echelon: 'brigade', layout: 'h', personnel: 20, children: [branchA, branchB] }),
  );

  const focused = renderDocument(input, { mode: 'editor', nodeId: 'a' });
  assert.equal(focused.total, 3);
  assert.equal(focused.shown, 3);
  assert.equal(focused.truncated, false);
  assert.match(focused.svg, /聚焦/);
  assert.ok(focused.svg.includes('第一营'));
  assert.ok(focused.svg.includes('一连'));
  assert.ok(!focused.svg.includes('第二营'));

  assert.throws(
    () => renderDocument(input, { mode: 'editor', nodeId: 'does-not-exist' }),
    /未知.*节点|nodeId/i,
  );
});

test('never mutates the caller document while laying out a frozen tree', () => {
  const deepFreeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
  };
  const input = deepFreeze(doc(
    node('root', {
      name: '冻结旅',
      echelon: 'brigade',
      layout: 'h',
      personnel: 10,
      equipment: [{ name: '指挥车', count: 1 }],
      remark: '只读',
      children: [
        node('a', { name: '第一营', layout: 'v', personnel: 20 }),
        node('b', { name: '第二营', layout: 'h', personnel: 30 }),
      ],
    }),
  ));
  const before = JSON.stringify(input);

  const result = renderDocument(input);
  assert.equal(JSON.stringify(input), before, 'renderer must not mutate the document');
  assert.equal(Object.hasOwn(input.root, '_boxW'), false);
  assert.equal(Object.hasOwn(input.root, 'cx'), false);
  assert.equal(Object.hasOwn(input.root, 'y'), false);
  assert.equal(result.total, 3);
});

test('guards against pathologically deep raw trees instead of overflowing the stack', () => {
  let root = node('n0', { name: '第0层', echelon: 'squad', layout: 'v' });
  let cursor = root;
  for (let i = 1; i < 600; i += 1) {
    const child = node(`n${i}`, { name: `第${i}层`, echelon: 'squad', layout: 'v' });
    cursor.children.push(child);
    cursor = child;
  }

  const result = renderDocument(doc(root), { mode: 'editor', maxNodes: 5 });
  assert.equal(result.total, 600);
  assert.equal(result.cards, 5);
  assert.equal(result.shown, 5);
  assert.equal(result.truncated, true);
  assert.match(result.svg, /已截断/);
  assert.ok(result.width <= 2400);
  assert.ok(result.height <= 16000);
  assert.equal((result.svg.match(/<g class="node"/g) || []).length, 5);
});

test('marks collapsed nodes with a visible + and keeps the global hidden count', () => {
  const collapsed = node('a', {
    name: '第一排',
    echelon: 'platoon',
    layout: 'v',
    collapsed: true,
    children: [
      node('a1', { name: '一班', echelon: 'squad', personnel: 10 }),
      node('a2', { name: '二班', echelon: 'squad', personnel: 10 }),
    ],
  });
  const leaf = node('b', { name: '第二排', echelon: 'platoon' });
  const root = node('root', {
    name: '第一旅',
    echelon: 'brigade',
    layout: 'h',
    children: [collapsed, leaf],
  });

  const result = renderDocument(doc(root));
  const markers = [
    ...result.svg.matchAll(
      /<g class="collapse-marker" data-hidden="(\d+)" transform="translate\((-?[\d.]+) (-?[\d.]+)\)"/g,
    ),
  ];
  assert.equal(markers.length, 1, 'only the collapsed parent gets a marker; leaves do not');
  assert.equal(markers[0][1], '2', 'marker carries this node hidden-descendant count');
  const markerX = Number(markers[0][2]);
  const markerY = Number(markers[0][3]);
  assert.ok(markerX + 8 <= 120, 'marker must stay inside the 120px card horizontally');
  assert.ok(markerY - 8 >= 0, 'marker must stay inside the 120px card vertically');
  assert.ok(markerY + 8 <= 120);
  assert.ok(result.svg.includes('>+</text>'), 'collapsed state must be visually a +');
  assert.ok(result.svg.includes('data-collapsed="true"'));
  assert.equal((result.svg.match(/class="collapse-marker"/g) || []).length, 1);
  assert.ok(result.svg.includes('已折叠 2 个节点'), 'global hidden count must stay in the notice');
});

test('reports direct personnel and equipment cap anomalies without changing data', () => {
  const input = doc(
    node('root', {
      name: '异常营',
      echelon: 'battalion',
      layout: 'h',
      personnel: 100,
      personnelMax: 80,
      children: [
        // 这个节点的 max 会把聚合后 max 抬高到 130，从而掩盖 root 的 80 < 100。
        node('ok', { name: '超额连', personnel: 5, personnelMax: 50 }),
        node('eq', {
          name: '装备连',
          equipment: [
            { name: '步枪', count: 10, countMax: 8 },
            { name: '火炮', count: 2, countMax: 0 },
          ],
        }),
      ],
    }),
  );
  const before = JSON.stringify(input);
  const result = renderDocument(input);

  assert.equal(JSON.stringify(input), before, 'anomaly reporting must not modify data');
  assert.match(result.svg, /class="notice notice-anomaly"/);
  assert.ok(result.svg.includes('数据异常：2 项'));
  assert.ok(result.svg.includes('人数上限 80 &lt; 实际 100'));
  assert.ok(result.svg.includes('步枪 上限 8 &lt; 实际 10'));
  assert.ok(!result.svg.includes('火炮 上限'), 'countMax=0 means no cap, not an anomaly');
  // 聚合 meta 会显示 105-130，看起来合法；异常提示必须来自逐节点直属检查。
  assert.ok(result.svg.includes('总人数 105-130 人'));
});

test('keeps two-line names below the symbol and inside the 120px card', () => {
  const labelYs = (svg) =>
    [...svg.matchAll(/<text class="label-line"[^>]*\by="(-?[\d.]+)"/g)].map((match) =>
      Number(match[1]),
    );

  const long = renderDocument(
    doc(node('long', { name: '超长名称'.repeat(6), echelon: 'company', layout: 'h' })),
  );
  const longYs = labelYs(long.svg);
  assert.equal(longYs.length, 2);
  // 符号底部 = 16 + 70 = 86；12px 字体的近似 ascender 按 9px 计。
  assert.ok(longYs[0] - 9 >= 86, 'first line glyph must start below the symbol');
  assert.deepEqual(longYs, [100, 114]);
  assert.ok(longYs[1] + 3 <= 120, 'second line descender must stay inside the card');

  const short = renderDocument(
    doc(node('short', { name: '短名', echelon: 'company', layout: 'h' })),
  );
  const shortYs = labelYs(short.svg);
  assert.equal(shortYs.length, 1);
  assert.equal(shortYs[0], 100);
  assert.ok(shortYs[0] - 9 >= 86);
});

test('uses length-framed fingerprints so separator characters cannot forge a stack', () => {
  // 旧实现用 \u0001 拼接字段：A 的 name 里带 \u0001，恰好与 B 的 name+mod 产生同一串。
  const forged = node('a', {
    name: 'X\u0001Y',
    mod: '',
    type: 'infantry',
    echelon: 'squad',
    layout: 'h',
  });
  const shifted = node('b', {
    name: 'X',
    // name+mod 的字段边界被  移位：旧实现会得到与 forged 完全相同的串。
    mod: 'Y\u0001',
    type: 'infantry',
    echelon: 'squad',
    layout: 'h',
  });
  const input = doc(
    node('root', {
      name: '分隔符根',
      echelon: 'company',
      layout: 'h',
      stack: true,
      children: [forged, shifted],
    }),
  );

  const result = renderDocument(input);
  assert.equal(result.total, 3);
  assert.equal(result.cards, 3, 'two different units must not collapse into one card');
  assert.equal(result.shown, 3);
  assert.ok(!result.svg.includes('×2'));
});

test('stacks identical deep subtrees with bounded subtree fingerprints', () => {
  const chain = (prefix) => {
    let head = node(`${prefix}0`, { name: '深单位', echelon: 'platoon', layout: 'v', personnel: 1 });
    let cursor = head;
    for (let i = 1; i < 600; i += 1) {
      const child = node(`${prefix}${i}`, {
        name: '深单位',
        echelon: 'platoon',
        layout: 'v',
        personnel: 1,
      });
      cursor.children.push(child);
      cursor = child;
    }
    return head;
  };
  const input = doc(
    node('root', {
      name: '双深树',
      echelon: 'company',
      layout: 'h',
      children: [chain('a'), chain('b')],
    }),
  );

  const result = renderDocument(input, { mode: 'editor', maxNodes: 20 });
  assert.equal(result.total, 1201, 'root + 2 × 600 identical deep chains');
  assert.equal(result.cards, 20);
  assert.equal(result.shown, 39, 'root + 19 visible levels × 2 identical copies');
  assert.equal(result.truncated, true);
  assert.ok(result.svg.includes('×2'));
  assert.ok(result.width <= 2400);
  assert.ok(result.height <= 16000);
});
