import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {changesBetween} from './workspace-records.mjs';
const digest=text=>createHash('sha256').update(text).digest('hex');
export class VersionHistory{
 constructor(filename,{limit=100}={}){this.limit=limit;this.db=new DatabaseSync(filename);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY, scope TEXT NOT NULL, at TEXT NOT NULL, revision INTEGER NOT NULL, reason TEXT NOT NULL, hash TEXT NOT NULL, content TEXT NOT NULL)');}
 close(){this.db.close();}
 record(state,scope,reason='保存工作台'){
  const content=JSON.stringify(state),hash=digest(content);
  if(this.db.prepare('SELECT hash FROM versions WHERE scope=? ORDER BY rowid DESC LIMIT 1').get(scope)?.hash===hash)return;
  this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?,?)').run(randomUUID(),scope,new Date().toISOString(),state.revision||0,reason,hash,content);this.db.prepare('DELETE FROM versions WHERE scope=? AND id NOT IN (SELECT id FROM versions WHERE scope=? ORDER BY rowid DESC LIMIT ?)').run(scope,scope,this.limit);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 list(scope){return this.db.prepare('SELECT id,at,revision,reason FROM versions WHERE scope=? ORDER BY rowid DESC LIMIT ?').all(scope,this.limit);}
 get(id,scope){const r=this.db.prepare('SELECT * FROM versions WHERE id=? AND scope=?').get(id,scope);if(!r)throw Error('历史版本不存在或不属于当前工作区');if(digest(r.content)!==r.hash)throw Error('历史版本校验失败');return {...r,state:JSON.parse(r.content)};}
 preview(id,scope,current){const r=this.get(id,scope);if((r.state.erpSync?.scope||'unbound')!==(current.erpSync?.scope||'unbound'))throw Error('该版本属于不同库存来源，不能整库还原');const changes=changesBetween(current,r.state);return {id:r.id,at:r.at,revision:r.revision,hash:r.hash,baseRevision:current.revision,changes:changes.map(c=>({type:c.type,id:c.id,name:c.data.name||c.id,before:c.expectedDraft??null,after:c.data})),counts:changes.reduce((a,c)=>(a[c.type]=(a[c.type]||0)+1,a),{})};}
}
