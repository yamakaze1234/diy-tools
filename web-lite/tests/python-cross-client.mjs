// JSON bridge for the Python desktop's isolated cross-client integration test.
import {emptySync,syncCycle} from '../cloud-sync.mjs';
import {materialize,stageChanges} from '../cloud-adapter.mjs';
import {member,fakeCloud} from './cloud-fixture.mjs';

const copy=value=>structuredClone(value);
const readInput=async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;return JSON.parse(input);};
const mode=process.argv[2];
if(mode==='generate'){
 const cloud=fakeCloud();let sync=emptySync(member);
 const client={getSync:()=>sync,save:state=>{sync=copy(state);},call:cloud.call};
 await syncCycle({...client,upload:false});
 const before=materialize(sync),next=copy(before);
 next.configs.push({...copy(next.configs[0]),id:'web-python-copy',name:'网页新建配置'});
 next.templates.push({id:'web-python-template',shopId:'intel',name:'网页新建模板',configs:[copy(next.configs[0])]});
 stageChanges(before,next);client.save(next.cloudSync);await syncCycle(client);
 process.stdout.write(JSON.stringify({log:cloud.log}));
}else if(mode==='receive'){
 const {log}=await readInput();let sync=emptySync(member);
 const call=async request=>{
  if(request.action!=='sync.pull')throw Error('unexpected '+request.action);
  const headSeq=request.payload.headSeq??log.length;
  const changes=log.filter(row=>row.seq>request.payload.cursor&&row.seq<=headSeq).slice(0,3);
  const nextCursor=changes.at(-1)?.seq??request.payload.cursor;
  return {ok:true,changes,headSeq,nextCursor,hasMore:nextCursor<headSeq};
 };
 await syncCycle({getSync:()=>sync,save:state=>{sync=copy(state);},call,upload:false});
 const state=materialize(sync);
 process.stdout.write(JSON.stringify({configs:state.configs.map(row=>({id:row.id,name:row.name,workspaceOrder:row.workspaceOrder})),templates:state.templates.map(row=>({id:row.id,name:row.name}))}));
}else throw Error('expected generate or receive');
