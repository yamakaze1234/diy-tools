import {recentActivity,activityEntry} from '../activity.js';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID, createHash} from 'node:crypto';
import {clone, equal, mergeRecord, validateRecord, PROTOCOL_VERSION} from '../../shared/sync/protocol.mjs';

export class SyncStore {
  constructor(filename,{protocolVersion=1,validate=validateRecord,cloudPolicy=null}={}) {
    this.cloudPolicy=cloudPolicy;this.protocolVersion=protocolVersion;this.validate=validate;
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (type TEXT NOT NULL, id TEXT NOT NULL, base TEXT, version INTEGER NOT NULL DEFAULT 0, draft TEXT, conflict TEXT, PRIMARY KEY(type,id));
      CREATE TABLE IF NOT EXISTS outbox (mutation_id TEXT PRIMARY KEY, type TEXT NOT NULL, id TEXT NOT NULL, request TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, UNIQUE(type,id));
      CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, sha256 TEXT NOT NULL, content TEXT NOT NULL);`);
    if (!this.meta('deviceId')) this.setMeta('deviceId', randomUUID());
  }
  close() { this.db.close(); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); this.statusCache=null;throw e; } }
  meta(key) { const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key); return row ? JSON.parse(row.value) : undefined; }
  setMeta(key, value) { this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  bind(workspaceId, uid) {
    if (this.meta('workspaceId') && (this.meta('workspaceId') !== workspaceId || this.meta('uid') !== uid)) throw Error('此本地库已绑定其他成员或工作区，请使用独立数据目录');
    this.transaction(() => { this.setMeta('workspaceId', workspaceId); this.setMeta('uid', uid); });
  }
  switchMember(workspaceId, uid) {
    if (!workspaceId || !uid) throw Error('成员身份不完整');
    return this.transaction(() => {
      if (this.meta('workspaceId') && this.meta('workspaceId') !== workspaceId) throw Error('此账号不属于当前工作区，请使用当前工作区的成员账号');
      if (this.meta('uid') && this.meta('uid') !== uid) {
        const {pending, uncertain, conflicts} = this.status();
        if (pending || uncertain || conflicts) throw Error('原账号还有未同步修改或冲突，请先用原账号登录并完成同步，再切换账号');
        this.backup();
      }
      this.setMeta('workspaceId', workspaceId);
      this.setMeta('uid', uid);
    });
  }
  get(type,id) {
    const r = this.db.prepare('SELECT * FROM records WHERE type=? AND id=?').get(type,id);
    return r ? {...r, base: JSON.parse(r.base), draft: JSON.parse(r.draft), conflict: r.conflict ? JSON.parse(r.conflict) : null} : null;
  }
  list() { return this.db.prepare('SELECT * FROM records ORDER BY type,id').all().map(r=>({...r,base:JSON.parse(r.base),draft:JSON.parse(r.draft),conflict:r.conflict?JSON.parse(r.conflict):null})); }
  edit(type,id,data,expectedDraft) {
    this.validate(type,id,data);
    this.transaction(() => {
      const r = this.get(type,id);
      if(expectedDraft!==undefined){const merged=mergeRecord(expectedDraft,data,r?.draft??null);if(merged.fields.length)throw Error('此记录在编辑期间已变化，请保留输入并重新比较：'+merged.fields.join('、'));data=merged.value;this.validate(type,id,data);}
      this.db.prepare('INSERT INTO records(type,id,base,version,draft) VALUES (?,?,?,0,?) ON CONFLICT(type,id) DO UPDATE SET draft=excluded.draft').run(type,id,'null',JSON.stringify(data));
      // The draft itself is a durable pending operation; an immutable request is minted only at dispatch.
      if (!r) this.setMeta('lastEditAt', new Date().toISOString());
    });
  }
  editMany(changes,state) {
    return this.transaction(()=>{
      for(const c of changes){let data=c.data;const r=this.get(c.type,c.id);
        if(c.expectedDraft!==undefined&&r){const merged=mergeRecord(c.expectedDraft,data,r.draft);if(merged.fields.length)throw Object.assign(Error('编辑期间同一字段已变化：'+merged.fields.join('、')),{status:409});data=merged.value;}
        this.validate(c.type,c.id,data);
        this.db.prepare('INSERT INTO records(type,id,base,version,draft) VALUES (?,?,?,0,?) ON CONFLICT(type,id) DO UPDATE SET draft=excluded.draft').run(c.type,c.id,'null',JSON.stringify(data));
      }
      if(state)this.setMeta('workspaceState',typeof state==='function'?state():state);
    });
  }
  nextBatch(limit=50,maxBytes=210000){
    return this.transaction(()=>{
      let result=this.db.prepare('SELECT request FROM outbox ORDER BY rowid LIMIT ?').all(limit).map(r=>JSON.parse(r.request));
      if(result.length)return result;
      let bytes=0;
      const rows=this.db.prepare("SELECT * FROM records WHERE conflict IS NULL AND draft<>base ORDER BY CASE type WHEN 'erp_snapshot' THEN 1 WHEN 'workspace_meta' THEN 2 ELSE 0 END,type,id").all();
      for(const row of rows){if(row.type==='workspace_meta'&&this.db.prepare('SELECT 1 FROM records WHERE conflict IS NOT NULL LIMIT 1').get())continue;const data=JSON.parse(row.draft);if(equal(JSON.parse(row.base),data))continue;
        const request={protocolVersion:this.protocolVersion,action:'sync.push',requestId:randomUUID(),payload:{mutationId:randomUUID(),deviceId:this.meta('deviceId'),entityType:row.type,entityId:row.id,baseVersion:row.version,after:data}};
        const body=JSON.stringify(request);if(result.length&&(result.length>=limit||bytes+Buffer.byteLength(body)>maxBytes))break;
        this.db.prepare('INSERT INTO outbox(mutation_id,type,id,request) VALUES (?,?,?,?)').run(request.payload.mutationId,row.type,row.id,body);result.push(request);bytes+=Buffer.byteLength(body);
      }
      return result;
    });
  }
  nextRequest() {
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT request FROM outbox ORDER BY rowid LIMIT 1').get();
      if (existing) return JSON.parse(existing.request);
      const r = this.list().find(r => !r.conflict && !equal(r.base,r.draft));
      if (!r) return null;
      const payload = {mutationId:randomUUID(), deviceId:this.meta('deviceId'), entityType:r.type, entityId:r.id, baseVersion:r.version, after:r.draft};
      const request = {protocolVersion:this.protocolVersion, action:'sync.push', requestId:randomUUID(), payload};
      this.db.prepare('INSERT INTO outbox(mutation_id,type,id,request) VALUES (?,?,?,?)').run(payload.mutationId,r.type,r.id,JSON.stringify(request));
      return request;
    });
  }
  acknowledge(request, result) {
    this.transaction(()=>this.applyAcknowledgement(request,result));
  }
  acknowledgeBatch(requests,results){
    if(!Array.isArray(results)||results.length!==requests.length)throw Error('云端批次结果无效');
    this.transaction(()=>{for(let i=0;i<requests.length;i++)this.applyAcknowledgement(requests[i],results[i]);});
  }
  applyAcknowledgement(request,result){
      if(this.cloudPolicy)result=this.cloudPolicy.clean(result);
      const {entityType:type,entityId:id,mutationId,after} = request.payload, r = this.get(type,id);
      if (!r || !this.db.prepare('SELECT 1 FROM outbox WHERE mutation_id=?').get(mutationId)) throw Error('提交回执不属于本地队列');
      if (result.code === 'CONFLICT') {
        const remote=result.remote,merged=this.cloudPolicy&&remote?mergeRecord(r.base,r.draft,remote.data):null;
        if(merged&&!merged.fields.length)this.db.prepare('UPDATE records SET base=?,draft=?,version=?,conflict=NULL WHERE type=? AND id=?').run(JSON.stringify(remote.data),JSON.stringify(merged.value),remote.version,type,id);
        else this.db.prepare('UPDATE records SET conflict=? WHERE type=? AND id=?').run(JSON.stringify(result),type,id);
      } else if (result.ok && result.record) {
        const remote = result.record, merged = mergeRecord(after,r.draft,remote.data);
        const conflict = merged.fields.length ? JSON.stringify({code:'CONFLICT',fields:merged.fields,base:after,remote,local:r.draft}) : null;
        this.db.prepare('UPDATE records SET base=?,version=?,draft=?,conflict=? WHERE type=? AND id=?').run(JSON.stringify(remote.data),remote.version,JSON.stringify(merged.value),conflict,type,id);
      } else throw Error(result.message || result.code || '云端返回格式无效');
      this.db.prepare('DELETE FROM outbox WHERE mutation_id=?').run(mutationId);
  }
  applyPage(page) {
    this.transaction(() => {
      let cursor = this.meta('cursor') || 0;
      const activity=[];
      if (!page.ok || !Array.isArray(page.changes) || !Number.isSafeInteger(page.headSeq) || !Number.isSafeInteger(page.nextCursor) || page.headSeq < cursor) throw Error('同步分页格式无效');
      for (let change of page.changes) {
        if (change.seq !== cursor + 1 || change.seq > page.headSeq) throw Error('同步序号不连续，已保留游标');
        if(this.cloudPolicy){if(!this.cloudPolicy.keep(change.type)){cursor=change.seq;continue;}change={...change,data:this.cloudPolicy.clean(change.data)};}
        const r=this.get(change.type,change.id);
        if(this.protocolVersion===2){const entry=activityEntry(change.type,change.id,r?.base,change.data,{at:change.updatedAt,operator:change.updatedBy||'未知云端成员',origin:'cloud',eventId:'cloud:'+change.seq});if(entry)activity.push(entry);}
        if (this.db.prepare('SELECT 1 FROM outbox WHERE type=? AND id=?').get(change.type,change.id)) throw Error('先核实未确认提交，再拉取该记录');
        if (!r || change.version > r.version) {
          const merged = r ? mergeRecord(r.base,r.draft,change.data) : {value:change.data,fields:[]};
          const conflict = r?.conflict || (merged.fields.length ? {code:'CONFLICT',fields:merged.fields,base:r.base,local:r.draft,remote:change} : null);
          this.db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET base=excluded.base,version=excluded.version,draft=excluded.draft,conflict=excluded.conflict').run(change.type,change.id,JSON.stringify(change.data),change.version,JSON.stringify(merged.value),conflict?JSON.stringify(conflict):null);
        }
        cursor=change.seq;
      }
      if (page.nextCursor !== cursor || (page.hasMore && !page.changes.length)) throw Error('游标与分页结果不一致');
      if(activity.length)this.setMeta('activity',recentActivity([...activity,...(this.meta('activity')||[])]));
      this.setMeta('cursor',cursor);
    });
  }
  resolve(type,id,choice) {
    this.transaction(() => {
      const r=this.get(type,id); if (!r?.conflict) throw Error('冲突已变化，请刷新');
      const remote=r.conflict.remote;
      if (!remote) throw Error('缺少云端版本');
      const next=choice==='remote'?remote.data:choice==='local'?r.draft:choice;
      this.validate(type,id,next);
      this.db.prepare('UPDATE records SET base=?,version=?,draft=?,conflict=NULL WHERE type=? AND id=?').run(JSON.stringify(remote.data),remote.version,JSON.stringify(next),type,id);
    });
  }
  status() {
    const serial=this.db.prepare('SELECT total_changes() AS n').get().n+':'+this.db.prepare('PRAGMA data_version').get().data_version;
    if(this.statusCache?.serial===serial)return {...this.statusCache.value};
    const records=this.list();
    const value={workspaceId:this.meta('workspaceId')||null,uid:this.meta('uid')||null,deviceId:this.meta('deviceId'),cursor:this.meta('cursor')||0,pending:records.filter(r=>!equal(r.base,r.draft)).length,uncertain:this.db.prepare('SELECT count(*) AS n FROM outbox').get().n,conflicts:records.filter(r=>r.conflict).length};
    this.statusCache={serial,value};return {...value};
  }
  backup() {
    const content=JSON.stringify({format:1,protocolVersion:this.protocolVersion,enabled:!!this.meta('enabled'),workspaceState:this.meta('workspaceState'),workspaceId:this.meta('workspaceId'),uid:this.meta('uid'),cursor:this.meta('cursor')||0,records:this.list(),outbox:this.db.prepare('SELECT * FROM outbox').all()});
    const backup={id:randomUUID(),createdAt:new Date().toISOString(),sha256:createHash('sha256').update(content).digest('hex'),content};
    this.db.prepare('INSERT INTO backups VALUES (?,?,?,?)').run(backup.id,backup.createdAt,backup.sha256,content);return backup;
  }
  restore(backup) {
    if(this.list().length||this.meta('workspaceId'))throw Error('只能恢复到空白本地库');
    if(createHash('sha256').update(backup.content).digest('hex')!==backup.sha256)throw Error('备份哈希不匹配');
    const data=JSON.parse(backup.content);if(data.format!==1||!Array.isArray(data.records)||!Array.isArray(data.outbox)||!data.workspaceId||!data.uid)throw Error('备份格式无效');
    if((data.protocolVersion||1)!==this.protocolVersion)throw Error('备份协议与本地库不匹配');
    this.transaction(()=>{
      for(const r of data.records){this.validate(r.type,r.id,r.draft);this.db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?)').run(r.type,r.id,JSON.stringify(r.base),r.version,JSON.stringify(r.draft),r.conflict?JSON.stringify(r.conflict):null);}
      for(const o of data.outbox)this.db.prepare('INSERT INTO outbox VALUES (?,?,?,?,?)').run(o.mutation_id,o.type,o.id,o.request,o.attempts);
      this.setMeta('workspaceId',data.workspaceId);this.setMeta('uid',data.uid);this.setMeta('cursor',data.cursor);
      if(this.protocolVersion===2){this.setMeta('enabled',!!data.enabled);if(data.workspaceState)this.setMeta('workspaceState',data.workspaceState);}
    });
  }
}
