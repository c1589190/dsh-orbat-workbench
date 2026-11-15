import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

async function read(relative) {
  return readFile(new URL(relative, ROOT), 'utf8');
}

test('packaged skill covers the complete game-ORBAT workflow', async () => {
  const skill = await read('skills/orbat-workbench/SKILL.md');
  assert.match(skill, /^---\nname: orbat-workbench\n/m);
  for (const required of [
    'orbat_plan',
    'orbat_commit',
    'orbat_resources',
    'orbat_update_resources',
    'mergeCustom',
    'template',
    'custom.orbat',
    'observedTotals',
    'legacy-ambiguous',
    'knownTotal',
    'lossReport',
    'exportNative',
    'read_image',
  ]) {
    assert.ok(skill.includes(required), `skill is missing ${required}`);
  }
  assert.ok(skill.includes('不要') && skill.includes('【示意】'));
  assert.ok(skill.includes('不要把') || skill.includes('不要声称'), 'skill must warn against overclaiming');
});

test('tool protocol no longer advertises removed equipment-library rejection', async () => {
  const tools = await read('docs/TOOLS.md');
  const readme = await read('README.md');
  assert.equal(tools.includes('拒绝非空自定义装备库'), false);
  assert.equal(readme.includes('非空自定义装备库明确拒绝'), false);
  assert.ok(tools.includes('orbat_plan'));
  assert.ok(tools.includes('lossReport'));
  assert.ok(tools.includes('stale_cursor'));
  assert.ok(readme.includes('原生完整备份'));
});
