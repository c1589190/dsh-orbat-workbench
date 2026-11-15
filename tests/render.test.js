import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDocument } from '../src/render.js';
import { TYPES } from '../src/model.js';

function doc(root, extra = {}) {
  return {
    id: 'doc-1',
    name: '陆军第一合成旅编制',
    revision: 7,
    root,
    ...extra,
  };
}

function node(id, fields = {}) {
  return {
    id,
    name: id,
    type: 'infantry',
    echelon: 'F',
    personnel: 0,
    personnelMax: 0,
    equipment: [],
    children: [],
    ...fields,
  };
}

function pngSize(buffer) {
  assert.ok(Buffer.isBuffer(buffer), 'png must be a Buffer');
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('renders a document to one SVG plus a matching PNG', () => {
  const root = node('root', {
    name: '第一合成旅',
    type: 'armor',
    echelon: 'H',
    personnel: 200,
    children: [
      node('b1', { name: '第一合成营', echelon: 'F', personnel: 300 }),
      node('b2', { name: '第二合成营', echelon: 'F', personnel: 250 }),
    ],
  });

  const result = renderDocument(doc(root), { mode: 'list' });

  assert.equal(typeof result.svg, 'string');
  assert.match(result.svg, /^<svg\b/);
  assert.ok(result.svg.includes('陆军第一合成旅编制'));
  assert.ok(result.svg.includes('修订'));
  assert.ok(result.svg.includes('7'));
  assert.equal(result.shown, 3);
  assert.equal(result.total, 3);
  assert.equal(result.truncated, false);
  assert.ok(Number.isInteger(result.width) && result.width > 0);
  assert.ok(Number.isInteger(result.height) && result.height > 0);
  assert.ok(result.width <= 2400);
  assert.ok(result.height <= 16000);

  const size = pngSize(result.png);
  assert.equal(size.width, result.width);
  assert.equal(size.height, result.height);
});

test('shows personnel per level separately from subtree totals', () => {
  const root = node('root', {
    name: '第一合成旅',
    echelon: 'H',
    personnel: 100,
    equipment: [
      { name: '指挥车', count: 3 },
      { name: '步枪', count: 20 },
    ],
    children: [
      node('b1', {
        name: '第一合成营',
        echelon: 'F',
        personnel: 300,
        equipment: [{ name: '步战车', count: 30 }],
        children: [node('c1', { name: '第一连', echelon: 'E', personnel: 120 })],
      }),
      node('b2', { name: '第二合成营', echelon: 'F', personnel: 250 }),
    ],
  });

  const result = renderDocument(doc(root), { mode: 'list' });

  assert.equal(result.total, 4);
  assert.equal(result.shown, 4);
  // 本级人数与子树合计人数必须同时出现且可区分。
  assert.match(result.svg, /本级 300 人/);
  assert.match(result.svg, /子树 420 人/);
  assert.match(result.svg, /本级 120 人/);
  // 标题区：总人数、装备总数、节点总数。
  assert.match(result.svg, /总人数 770 人/);
  assert.match(result.svg, /装备 53 件/);
  assert.match(result.svg, /节点 4 个/);
  // 节点名称与层级必须出现。
  assert.ok(result.svg.includes('第一合成营'));
  assert.match(result.svg, /营/);
});

function wideDoc() {
  const battalions = [];
  for (let b = 1; b <= 18; b += 1) {
    const companies = [];
    for (let c = 1; c <= 12; c += 1) {
      companies.push(node(`b${b}c${c}`, { name: `第${b}营第${c}连`, echelon: 'E', personnel: 90 }));
    }
    battalions.push(node(`b${b}`, { name: `第${b}合成营`, echelon: 'F', personnel: 300, children: companies }));
  }
  return doc(node('root', { name: '第一合成旅', echelon: 'H', personnel: 200, children: battalions }));
}

test('truncates a large tree explicitly with consistent shown/total', () => {
  const input = wideDoc();
  const result = renderDocument(input, { mode: 'list', maxNodes: 60 });
  const total = 1 + 18 + 18 * 12;

  assert.equal(result.total, total);
  assert.equal(result.shown, 60);
  assert.equal(result.truncated, true);
  assert.match(result.svg, /已截断/);
  assert.ok(result.svg.includes(String(total)));
  assert.ok(result.svg.includes('60'));
  assert.ok(result.width <= 2400);
  assert.ok(result.height <= 16000);
  const count = (result.svg.match(/class="node"/g) || []).length;
  assert.equal(count, 60);
  assert.deepEqual(pngSize(result.png), { width: result.width, height: result.height });
});

test('defaults to 200 nodes and never silently drops the rest', () => {
  const input = wideDoc();
  const result = renderDocument(input, { mode: 'list' });

  assert.equal(result.total, 235);
  assert.equal(result.shown, 200);
  assert.equal(result.truncated, true);
  assert.match(result.svg, /已截断/);
});

test('keeps the bitmap inside the pixel caps even when maxNodes is huge', () => {
  const input = wideDoc();
  const result = renderDocument(input, { mode: 'list', maxNodes: 100000 });

  assert.ok(result.shown < result.total);
  assert.equal(result.truncated, true);
  assert.ok(result.width <= 2400);
  assert.ok(result.height <= 16000);
  assert.match(result.svg, /已截断/);
});

test('counts collapsed descendants but renders only the visible node', () => {
  const children = [1, 2, 3, 4, 5].map((i) => node(`c${i}`, { personnel: 10 }));
  const root = node('root', { name: '缩编旅', echelon: 'H', personnel: 50, collapsed: true, children });
  const result = renderDocument(doc(root), { mode: 'list' });

  assert.equal(result.total, 6);
  assert.equal(result.shown, 1);
  assert.equal(result.truncated, false);
  assert.match(result.svg, /已折叠 5 个节点/);
});

test('focuses on one subtree and rejects an unknown nodeId', () => {
  const branchA = node('a', {
    name: '第一营',
    echelon: 'F',
    personnel: 100,
    children: [
      node('a1', { name: '一连', echelon: 'E', personnel: 50 }),
      node('a2', { name: '二连', echelon: 'E', personnel: 40 }),
    ],
  });
  const branchB = node('b', { name: '第二营', echelon: 'F', personnel: 80 });
  const input = doc(node('root', { name: '第一旅', echelon: 'H', personnel: 20, children: [branchA, branchB] }));

  const focused = renderDocument(input, { mode: 'list', nodeId: 'a' });
  assert.equal(focused.total, 3);
  assert.equal(focused.shown, 3);
  assert.equal(focused.truncated, false);
  assert.match(focused.svg, /聚焦/);
  assert.ok(focused.svg.includes('第一营'));
  assert.ok(focused.svg.includes('一连'));
  assert.ok(!focused.svg.includes('第二营'));

  assert.throws(
    () => renderDocument(input, { mode: 'list', nodeId: 'does-not-exist' }),
    /未知.*节点|nodeId/i,
  );
});

test('escapes every user text and never emits user markup', () => {
  const root = node('root', {
    name: '一营</text><foreignObject><img src=x></foreignObject>',
    echelon: '"><script>',
    personnel: 10,
    children: [
      node('c1', {
        name: 'A&B <script>alert(1)</script>',
        type: 'space_marines',
        equipment: [{ name: '</g><script>bad()</script>', count: 2 }],
      }),
    ],
  });
  const input = doc(root, {
    name: 'A&B <script>alert(1)</script>',
    revision: '<img src=x onerror=alert(1)>',
  });

  const result = renderDocument(input, { mode: 'list' });

  assert.ok(!result.svg.includes('<script'));
  assert.ok(!result.svg.includes('<foreignObject'));
  assert.ok(!result.svg.includes('<img'));
  assert.ok(!result.svg.includes('onerror="'));
  // 恶意字符只能以文本实体出现，不能被解析成标签/属性。
  assert.ok(result.svg.includes('&lt;script&gt;'));
  assert.ok(result.svg.includes('A&amp;B'));
  assert.ok(result.svg.includes('&lt;foreignObject&gt;'));
  assert.ok(result.svg.includes('&lt;img src=x'));
  assert.ok(result.svg.includes('未知符号：space_marines'));
});

test('renders standard symbols for every legacy type', () => {
  const expected = {
    infantry: 'SFGPUCI----F---',
    armor: 'SFGPUCA----F---',
    engineer: 'SFGPUCE----F---',
    mech: 'SFGPUCII---F---',
    artillery: 'SFGPUCF----F---',
    signal: 'SFGPUUS----F---',
    medical: 'SFGPUSM----F---',
    supply: 'SFGPUSS----F---',
    recon: 'SFGPUCR----F---',
    mortar: 'SFGPUCFM---F---',
    anti_tank: 'SFGPUCAA---F---',
  };
  for (const [type, sidc] of Object.entries(expected)) {
    const result = renderDocument(doc(node('n', { name: `${type} unit`, type, echelon: 'F' })), { mode: 'list' });
    assert.ok(result.svg.includes(`data-sidc="${sidc}"`), `${type} should use ${sidc}`);
    assert.ok(!result.svg.includes('符号未识别'), `${type} must not fall back`);
    assert.ok(result.png.length > 1000);
  }
});

test('maps the eight confirmed ms_ sidc aliases onto their canonical types', () => {
  const aliases = {
    ms_sfgpuci: 'infantry',
    ms_sfgpucat: 'armor',
    ms_sfgpucf: 'artillery',
    ms_sfgpucr: 'recon',
    ms_sfgpuce: 'engineer',
    ms_sfgpuus: 'signal',
    ms_sfgpusm: 'medical',
    ms_sfgpuss: 'supply',
  };
  for (const [alias, canonical] of Object.entries(aliases)) {
    const aliasDoc = doc(node('n', { name: '同一单位', type: alias, echelon: 'E', personnel: 10 }));
    const canonicalDoc = doc(node('n', { name: '同一单位', type: canonical, echelon: 'E', personnel: 10 }));
    const fromAlias = renderDocument(aliasDoc, { mode: 'list' });
    const fromCanonical = renderDocument(canonicalDoc, { mode: 'list' });
    assert.equal(fromAlias.svg, fromCanonical.svg, `${alias} must equal ${canonical}`);
  }
});

test('uses a valid custom 15-char SIDC and rejects an invalid one with text', () => {
  const good = renderDocument(
    doc(node('n', { name: '定制符号', type: 'custom', custom: { sidc: 'SFGPUCI----F---' } })), { mode: 'list' },
  );
  assert.ok(good.svg.includes('data-sidc="SFGPUCI----F---"'));

  const bad = renderDocument(
    doc(node('n', { name: '坏符号', type: 'custom', custom: { sidc: 'SFGPUCI"><script>' } })), { mode: 'list' },
  );
  assert.ok(bad.svg.includes('SIDC 无效'));
  assert.ok(!bad.svg.includes('<script'));
});

test('falls back explicitly for an unknown type and never fakes a symbol', () => {
  const result = renderDocument(doc(node('n', { name: '未知部队', type: 'star_fleet' })), { mode: 'list' });
  assert.match(result.svg, /未知符号：star_fleet/);
  assert.ok(!result.svg.includes('data-sidc='));
});

test('keeps long titles and names inside the width cap', () => {
  const longName = '超长名称'.repeat(40);
  const chain = [];
  let parent = null;
  for (let i = 0; i < 30; i += 1) {
    const current = node(`n${i}`, {
      name: i === 0 ? longName : `第${i}层`,
      echelon: 'F',
      personnel: 1,
    });
    if (parent) parent.children.push(current);
    else chain.push(current);
    parent = current;
  }
  const result = renderDocument(doc(chain[0], { name: longName }), { mode: 'list' });

  assert.ok(result.width <= 2400);
  assert.ok(result.height <= 16000);
  assert.ok(result.svg.includes('…'));
  assert.equal(result.total, 30);
  assert.equal(result.shown, 30);
  assert.deepEqual(pngSize(result.png), { width: result.width, height: result.height });
});

test('treats invalid maxNodes safely instead of dropping the tree', () => {
  const input = doc(node('root', { name: '旅', echelon: 'H', personnel: 1, children: [node('c', { personnel: 1 })] }));
  const result = renderDocument(input, { mode: 'list', maxNodes: 0 });
  assert.equal(result.total, 2);
  assert.equal(result.shown, 2);
  assert.equal(result.truncated, false);
});

test('keeps SVG and PNG dimensions identical to the returned size', () => {
  const result = renderDocument(doc(node('root', { name: '旅', type: 'armor', echelon: 'H', personnel: 10 })), { mode: 'list' });
  assert.ok(result.svg.includes(`width="${result.width}"`));
  assert.ok(result.svg.includes(`height="${result.height}"`));
  assert.deepEqual(pngSize(result.png), { width: result.width, height: result.height });
});

test('accepts the model word echelons and maps them to SIDC letters', () => {
  const cases = {
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
  for (const [word, code] of Object.entries(cases)) {
    const result = renderDocument(
      doc(node('n', { name: `${word} unit`, type: 'infantry', echelon: word })), { mode: 'list' },
    );
    const expected = `SFGPUCI----${code}---`;
    assert.ok(result.svg.includes(`data-sidc="${expected}"`), `${word} should map to ${code}`);
    assert.ok(!result.svg.includes('层级未知'), `${word} should be a known echelon`);
  }
  assert.ok(
    renderDocument(doc(node('n', { echelon: 'battalion' })), { mode: 'list' }).svg.includes('营 (F)'),
  );
  assert.ok(
    renderDocument(doc(node('n', { echelon: 'individual' })), { mode: 'list' }).svg.includes('单兵'),
  );
});

test('rejects unknown echelons without inventing a level', () => {
  const result = renderDocument(doc(node('n', { echelon: 'banana' })), { mode: 'list' });
  assert.match(result.svg, /层级未知/);
  assert.ok(result.svg.includes('data-sidc="SFGPUCI--------"'));
});

test('applies the node echelon to a custom 15-char SIDC like the editor bridge', () => {
  const overridden = renderDocument(
    doc(node('n', {
      name: '定制符号',
      type: 'custom',
      custom: { sidc: 'SFGPUCI----B---' },
      echelon: 'company',
    })), { mode: 'list' },
  );
  assert.ok(overridden.svg.includes('data-sidc="SFGPUCI----E---"'));

  const kept = renderDocument(
    doc(node('n', {
      name: '定制符号',
      type: 'custom',
      custom: { sidc: 'SFGPUCI----B---' },
      echelon: 'individual',
    })), { mode: 'list' },
  );
  assert.ok(kept.svg.includes('data-sidc="SFGPUCI----B---"'));
});

test('renders the new editor-catalog types with their exact upstream SIDCs', () => {
  const expected = {
    light_infantry: 'SFGPUCIL---F---',
    light_armor: 'SFGPUCATL--F---',
    heavy_armor: 'SFGPUCATH--F---',
    mountain: 'SFGPUCIO---F---',
    recon_mech: 'SFGPUCRV---F---',
    wheeled_inf: 'SFGPUCIM---F---',
    mlrs: 'SFGPUCFR---F---',
    attack_heli: 'SFGPUCVRA--F---',
    uav_unit: 'SFGPUCVU---F---',
  };
  for (const [type, sidc] of Object.entries(expected)) {
    const result = renderDocument(doc(node('n', { name: `${type} unit`, type, echelon: 'F' })), { mode: 'list' });
    assert.ok(result.svg.includes(`data-sidc="${sidc}"`), `${type} should use ${sidc}`);
    assert.ok(!result.svg.includes('符号未识别'), `${type} must not fall back`);
    assert.ok(result.png.length > 1000);
  }
});

test('writes the editor towed mobility into SIDC positions 11-12 when no echelon is set', () => {
  for (const type of ['towed_w', 'towed_t']) {
    const noEchelon = renderDocument(doc(node('n', { name: type, type, echelon: '' })), { mode: 'list' });
    assert.ok(
      noEchelon.svg.includes('data-sidc="SFGPUCF---MS---"'),
      `${type} without echelon should carry mobility MS`,
    );

    const withEchelon = renderDocument(doc(node('n', { name: type, type, echelon: 'company' })), { mode: 'list' });
    assert.ok(
      withEchelon.svg.includes('data-sidc="SFGPUCF----E---"'),
      `${type} echelon should win over mobility`,
    );
  }
});

test('treats prototype-property names as unknown, not as lookups', () => {
  const weirdType = renderDocument(doc(node('n', { name: '怪类型', type: 'constructor' })), { mode: 'list' });
  assert.match(weirdType.svg, /未知符号：constructor/);
  assert.ok(!weirdType.svg.includes('data-sidc='));

  const weirdEchelon = renderDocument(doc(node('n', { name: '怪层级', type: 'infantry', echelon: '__proto__' })), { mode: 'list' });
  assert.match(weirdEchelon.svg, /层级未知/);
  assert.ok(weirdEchelon.svg.includes('data-sidc="SFGPUCI--------"'));
});

test('renders every one of the 27 agreed core types without a fallback', () => {
  const coreTypes = [
    'infantry', 'light_infantry', 'mech', 'armor', 'light_armor', 'heavy_armor',
    'airborne', 'air_assault', 'mountain', 'recon', 'recon_mech', 'wheeled_inf',
    'artillery', 'mlrs', 'mortar', 'anti_tank', 'aaa', 'towed_w', 'towed_t',
    'rotary', 'fixedwing', 'attack_heli', 'uav_unit', 'engineer', 'signal',
    'medical', 'supply',
  ];
  const failures = [];
  for (const type of coreTypes) {
    const result = renderDocument(doc(node('n', { name: `类型 ${type}`, type, echelon: 'battalion' })), { mode: 'list' });
    if (!result.svg.includes('data-sidc=')) failures.push(`${type}: no sidc`);
    if (/未知符号|SIDC 无效|符号渲染失败/.test(result.svg)) failures.push(`${type}: fallback`);
  }
  assert.deepEqual(failures, []);
});

test('reports the scan cap instead of walking an unbounded document', () => {
  const root = node('root', { name: '巨型编制', echelon: 'H' });
  for (let i = 0; i < 10500; i += 1) root.children.push(node(`x${i}`, { name: `单位${i}`, personnel: 1 }));
  const result = renderDocument(root.children.length ? doc(root) : doc(root), { mode: 'list' });
  assert.equal(result.truncated, true);
  assert.ok(result.shown < result.total);
  assert.match(result.svg, /扫描上限/);
  assert.ok(result.width <= 2400);
  assert.ok(result.height <= 16000);
});

test('resolves every type in the shared core catalog in one render', () => {
  const root = node('root', { name: '目录覆盖', type: 'infantry', echelon: 'brigade' });
  for (const type of TYPES) {
    root.children.push(node(`n-${type}`, { name: type, type, echelon: 'battalion' }));
  }
  const result = renderDocument(doc(root), { mode: 'list' });

  assert.equal(result.total, TYPES.length + 1);
  assert.equal(result.shown, TYPES.length + 1);
  assert.ok(!/未知符号|SIDC 无效|符号渲染失败/.test(result.svg));
  assert.equal((result.svg.match(/class="node"/g) || []).length, TYPES.length + 1);
  assert.equal((result.svg.match(/data-sidc=/g) || []).length, TYPES.length + 1);
});
