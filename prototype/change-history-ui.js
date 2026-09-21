const types={configuration:'配置',component:'人工核算价',source:'输出源',template:'模板',settings:'店铺设置',gallery:'机箱图库',workspace_meta:'工作区'};
const fields={name:'名称',priceCents:'售价（分）',taxCents:'人工核算价（分）',couponCents:'优惠券（分）',parts:'配件列表',deletedAt:'删除时间',workspaceOrder:'排列顺序'};
export function changedFields(before,after){
 return [...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(k=>JSON.stringify(before?.[k])!==JSON.stringify(after?.[k]));
}
export function bindChangeHistory({api,flush,openDialog,esc,toast}){
 const date=value=>value?new Date(value).toLocaleString('zh-CN'):'未提供';
 const name=(type,id,data)=>`${types[type]||type} · ${data?.name||id}`;
 const value=v=>v===undefined?'（不存在）':JSON.stringify(v,null,2);
 const diff=(before,after)=>changedFields(before,after).map(k=>`<details><summary>${esc(fields[k]||k)}</summary><div class="change-values"><div><strong>修改前</strong><pre>${esc(value(before?.[k]))}</pre></div><div><strong>修改后</strong><pre>${esc(value(after?.[k]))}</pre></div></div></details>`).join('')||'<p>没有字段差异。</p>';
 const guard=fn=>async()=>{try{await fn();}catch(error){toast(error.message);const node=document.querySelector('#change-message');if(node)node.textContent=error.message;}};
 let active='local-history',before;
 let requestVersion=0;
 const open=guard(async()=>{await flush();active='local-history';before=undefined;await render();});
 async function render(){
  const version=++requestVersion;
  openDialog('修改与提交记录',`<p id="change-message" role="status">正在读取${active==='local-history'?'本机记录':'云端记录'}…</p><button id="changes-cancel">返回本机记录</button>`);
  document.getElementById('changes-cancel').onclick=open;
  let result;
  try{result=await api(active,before===undefined?{}:{before});}catch(error){if(version===requestVersion)throw error;return;}
  if(version!==requestVersion||!document.querySelector('#change-message'))return;
  const tabs=`<div class="history-tabs"><button id="changes-local" ${active==='local-history'?'class="primary"':''}>本机修改记录</button><button id="changes-compare" ${active==='compare'?'class="primary"':''}>本机 / 云端差异</button><button id="changes-cloud" ${active==='commits'?'class="primary"':''}>云端提交记录</button></div>`;
  let description,content;
  if(active==='local-history'){
   description='每次保存同步业务字段时记录修改编号、登录成员、本机时间和前后内容。记录从此功能启用后开始保留；本机保存不表示已经上传。ERP 成本和库存不在此同步变更记录范围内。';
   content=result.records.map(r=>`<section class="list-card change-record"><div><strong>本机修改 ${esc(r.id.slice(0,8))}</strong><p>本机时间：${esc(date(r.at))} · 修改人：${esc(r.actor.name||r.actor.memberId||r.actor.uid||'未记录')}</p><details><summary>${r.changes.length} 条变更 · 查看详情</summary><p>完整编号：${esc(r.id)}</p><p>成员 ID：${esc(r.actor.memberId||r.actor.uid||'未记录')}</p>${r.changes.map(c=>`<h4>${esc(name(c.type,c.id,c.after||c.before))}</h4>${diff(c.before,c.after)}`).join('')}</details></div></section>`).join('');
  }else if(active==='commits'){
   description='云端提交记录每周清理，保留最近 30 天；时间来自云端服务器。每条业务记录独立提交，一轮同步可能产生多条提交。其他成员暂显示成员 ID。查看不会执行同步。';
   content=result.records.map(r=>`<section class="list-card change-record"><div><strong>${esc(name(r.type,r.entityId,r.data))}</strong><p>提交 ${esc(r.id?.slice(0,8)||'编号未提供')} · 版本 ${r.version} · 云端序号 ${r.seq}</p><p>服务器时间：${esc(date(r.at))} · 提交人：${esc(r.actorName||r.actorId||'未提供')}</p><details><summary>查看提交内容和完整编号</summary><p>提交编号：${esc(r.id||'未提供')}</p><p>成员 ID：${esc(r.actorId||'未提供')}</p><pre>${esc(value(r.data))}</pre></details></div></section>`).join('');
  }else{
   description=`只读比较：上次同步基准、本机当前内容、云端快照（序号 ${result.headSeq}）。不会上传、覆盖本机或推进同步进度；比较后发生的新修改需重新刷新。`;
   content=result.records.map(r=>`<section class="list-card change-record"><div><strong>${esc(name(r.type,r.id,r.local||r.cloud))}</strong><p>${r.localChanged?'本机有修改':'本机未修改'} · ${r.cloudChanged?'云端有修改':'云端未修改'} · 基准版本 ${r.baseVersion} → 云端版本 ${r.cloudVersion}</p><p>${r.fields.length?'需处理冲突：'+esc(r.fields.map(k=>fields[k]||k).join('、')):'可按现有同步规则合并'}</p><details><summary>查看本机与云端字段差异</summary>${changedFields(r.local,r.cloud).map(k=>`<h4>${esc(fields[k]||k)}</h4><div class="change-values"><div><strong>同步基准</strong><pre>${esc(value(r.base?.[k]))}</pre></div><div><strong>本机当前</strong><pre>${esc(value(r.local?.[k]))}</pre></div><div><strong>云端当前</strong><pre>${esc(value(r.cloud?.[k]))}</pre></div></div>`).join('')}</details></div></section>`).join('');
  }
  openDialog('修改与提交记录',`${tabs}<p class="hint">${description}</p><p id="change-message" class="error" role="alert"></p>${content||'<p>暂无记录或差异。</p>'}<div class="actions"><button id="changes-refresh">刷新 / 返回最新</button>${result.nextBefore?'<button id="changes-older">更早记录</button>':''}</div>`);
  for(const [id,tab] of [['changes-local','local-history'],['changes-compare','compare'],['changes-cloud','commits']])document.getElementById(id).onclick=guard(async()=>{active=tab;before=undefined;await flush();await render();});
  document.getElementById('changes-refresh').onclick=guard(async()=>{before=undefined;await flush();await render();});
  document.getElementById('changes-older')?.addEventListener('click',guard(async()=>{before=result.nextBefore;await render();}));
 }
 return {open};
}
