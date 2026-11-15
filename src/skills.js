import {readdir,readFile,stat} from 'node:fs/promises';
import {watch as watchDirectory} from 'node:fs';
import {isAbsolute,join,resolve,sep} from 'node:path';
import {parse as parseYaml} from 'yaml';

/** A separately named provider; never replaces the profile's filesystem provider. */
export function createSkillProvider(roots,control,{watch=true,warn=()=>{}}={}) {
  if(!Array.isArray(roots)||roots.length<1||roots.length>16||!roots.every(r=>typeof r==='string'&&isAbsolute(r)))throw new Error('skill roots must be 1–16 absolute directories');
  roots=[...new Set(roots.map(r=>resolve(r)))];
  const known=new Map();
  if(watch)for(const root of roots){
    try {
      const watcher=watchDirectory(root,{recursive:true,signal:control.signal},()=>control.invalidate());
      watcher.on('error',error=>warn('Skill watch: '+error.message));
    }catch(error){warn('Skill watch unavailable: '+root+' · '+error.message);}
  }
  async function load(path,signal){
    signal?.throwIfAborted();const info=await stat(path);
    if(!info.isFile()||info.size>256*1024)throw new Error('Skill exceeds 256 KiB or is not a file');
    const raw=await readFile(path,{encoding:'utf8',signal});
    const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
    if(!match)throw new Error('Skill requires YAML frontmatter');
    const meta=parseYaml(match[1]);
    if(!meta||typeof meta.name!=='string'||!/^[a-z][a-z0-9-]{0,79}$/.test(meta.name)||typeof meta.description!=='string'||!meta.description.trim()||meta.description.length>1024)throw new Error('Invalid skill name or description');
    for(const flag of ['disable-model-invocation','user-invocable'])if(meta[flag]!==undefined&&typeof meta[flag]!=='boolean')throw new Error('Skill invocation flags must be boolean');
    return {meta,content:raw.slice(match[0].length).trim()};
  }
  return {
    name:'orbat-workbench-skills',
    async list(options={}){
      options.signal?.throwIfAborted();const candidates=[];let complete=true;known.clear();
      for(let rank=0;rank<roots.length;rank++){
        const root=roots[rank];let entries;
        try{entries=await readdir(root,{withFileTypes:true});}catch(error){warn('Skill directory: '+error.message);complete=false;continue;}
        if(entries.length>1000){warn('Skill directory exceeds 1000 entries');complete=false;continue;}
        for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
          if(entry.isSymbolicLink())continue;
          const path=entry.isDirectory()?join(root,entry.name,'SKILL.md'):entry.isFile()&&entry.name.endsWith('.md')?join(root,entry.name):null;
          if(!path)continue;
          try{
            const {meta}=await load(path,options.signal);
            if(known.has(meta.name))continue;
            known.set(meta.name,path);
            const resourcePath=entry.isDirectory()?join(root,entry.name):root;
            candidates.push({name:meta.name,description:meta.description,source:rank===0?'bundled':'custom',provider:'orbat-workbench-skills',rank:rank===0?600:300,
              invocation:{modelInvocable:meta['disable-model-invocation']!==true,userInvocable:meta['user-invocable']!==false},
              resourceBase:{kind:'directory',path:resourcePath.split(sep).join('/')},path,locator:path});
          }catch(error){if(error.name==='AbortError')throw error;if(error.code!=='ENOENT')warn('Skill omitted '+path+': '+error.message);}
        }
      }
      return {candidates,complete};
    },
    async get(candidate,options={}){
      if(known.get(candidate.name)!==candidate.locator)return undefined;
      const {meta,content}=await load(candidate.locator,options.signal);
      if(meta.name!==candidate.name){control.invalidate();return undefined;}
      const {rank:_rank,locator:_locator,...summary}=candidate;
      return {...summary,description:meta.description,content};
    },
  };
}
