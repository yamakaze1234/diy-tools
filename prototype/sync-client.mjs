import {randomUUID} from 'node:crypto';
export class SyncClient {
  constructor(store, call) { this.store=store;this.call=call;this.running=null;this.lastError=null;this.lastSyncedAt=null; }
  async cycle() {
    if (this.running) return this.running;
    this.running=this.run().finally(()=>{this.running=null;});return this.running;
  }
  async run() {
    try {
      // Every request is persisted before transport; retry uses exactly the same mutationId and body.
      for(let n=0;n<100;n++) {
        const req=this.store.nextRequest();if(!req)break;
        const result=await this.call(req);this.store.acknowledge(req,result);
      }
      if(this.store.status().uncertain)throw Error('提交结果待确认');
      let headSeq;
      for(let n=0;n<1000;n++) {
        const page=await this.call({protocolVersion:1,action:'sync.pull',requestId:randomUUID(),payload:{cursor:this.store.meta('cursor')||0,...(headSeq===undefined?{}:{headSeq}),limit:100}});
        if(!page.ok)throw Error(page.message||page.code||'拉取失败');
        headSeq??=page.headSeq;this.store.applyPage(page);
        if(!page.hasMore){this.lastError=null;this.lastSyncedAt=new Date().toISOString();return this.status();}
      }
      throw Error('本轮分页达到上限，下次从已确认游标继续');
    } catch(e) { this.lastError=e.message;throw e; }
  }
  status(){return {...this.store.status(),running:!!this.running,lastError:this.lastError,lastSyncedAt:this.lastSyncedAt};}
}
