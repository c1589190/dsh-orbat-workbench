import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSkillProvider} from '../src/skills.js';

test('provider discovers a batch and loads fresh bodies from each skill directory',async t=>{
  const root=await mkdtemp(join(tmpdir(),'orbat-skills-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const name of ['historical-orbat','fictional-orbat']){
    await mkdir(join(root,name));await writeFile(join(root,name,'SKILL.md'),`---\nname: ${name}\ndescription: Use when creating ${name}.\n---\nFirst body`);
  }
  const abort=new AbortController();t.after(()=>abort.abort());
  const provider=createSkillProvider([root],{signal:abort.signal,invalidate(){}},{watch:false});
  const listed=await provider.list({});assert.equal(listed.candidates.length,2);
  const candidate=listed.candidates.find(c=>c.name==='historical-orbat');
  assert.equal((await provider.get(candidate,{})).content,'First body');
  await writeFile(join(root,'historical-orbat','SKILL.md'),'---\nname: historical-orbat\ndescription: Use when history matters.\n---\nChanged body');
  assert.equal((await provider.get(candidate,{})).content,'Changed body');
});
test('provider refuses relative roots and omits invalid frontmatter names',async t=>{
  assert.throws(()=>createSkillProvider(['relative'],{signal:new AbortController().signal,invalidate(){}},{watch:false}),/absolute/);
  const root=await mkdtemp(join(tmpdir(),'orbat-skills-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'broken'));await writeFile(join(root,'broken','SKILL.md'),'---\nname: INVALID Name\ndescription: missing\n---\nbody');
  const provider=createSkillProvider([root],{signal:new AbortController().signal,invalidate(){}},{watch:false});
  assert.equal((await provider.list({})).candidates.length,0);
});
