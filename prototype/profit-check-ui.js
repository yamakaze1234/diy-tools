import {isLegacyTemplateConfig} from './template-library.js';
import {mountProfitScope} from './profit-scope.js';
export function openProfitCheck({openDialog,request,save,shopId,configs,selected,esc,toast,locate}){
 const all=configs().filter(c=>!c.deletedAt&&!c.emptyLinkDraft&&!isLegacyTemplateConfig(c));
 const allowed=new Set(all.map(c=>c.id)),initial=selected().filter(c=>allowed.has(c.id));
 const selection=new Set(initial.length?initial.map(c=>c.id):all.map(c=>c.id));
 const fmt=n=>n==null?'—':`${n<0?'-':''}¥${(Math.abs(n)/100).toFixed(2)}`;
 const output=()=>document.querySelector('#profit-output');
 const show=report=>{
  const rows=report.results.filter(r=>r.shop_id===shopId()&&allowed.has(r.config_id)),abnormal=rows.filter(r=>!r.valid||r.loss||r.changed);
  const missing=r=>!r.valid&&(!/到手价|分期|数量无效/.test(r.reason||'')||/成本|含税价/.test(r.reason||''));
  const categories={missing:abnormal.filter(missing),profit:abnormal.filter(r=>!missing(r))};
  const count=items=>new Set(items.map(r=>r.config_id)).size;
  let category=categories.profit.length?'profit':'missing';
  output().innerHTML=`<p class="hint">已检测 ${new Set(rows.map(r=>r.config_id)).size} 套配置 · 需处理 ${count(abnormal)} 套 · 主机模板不参与检测</p><div class="profit-category-tabs" aria-label="检测结果分类"><button data-profit-category="missing">成本缺失 <b>${count(categories.missing)}</b></button><button data-profit-category="profit">利润异常 <b>${count(categories.profit)}</b></button></div><p id="profit-category-note" class="hint"></p><div id="profit-results"></div>`;
  const paint=()=>{
  output().querySelectorAll('[data-profit-category]').forEach(button=>{button.classList.toggle('active',button.dataset.profitCategory===category);button.setAttribute('aria-pressed',String(button.dataset.profitCategory===category));});
  output().querySelector('#profit-category-note').textContent=category==='missing'?'缺少核算单价或未能读取 ERP 成本；补充后重新检测。同一配置可因不同口径的问题出现在两个分类。':'仅显示亏损超阈值、累计变化超阈值及其他计算异常。';
  const groups=new Map();for(const row of categories[category]){if(!groups.has(row.config_id))groups.set(row.config_id,[]);groups.get(row.config_id).push(row);}
  output().querySelector('#profit-results').innerHTML=`${[...groups.values()].map(g=>{
   const s=g[0].snapshot;
   return `<article class="profit-result profit-exception"><div class="profit-exception-heading"><strong>${esc(s.product)} / ${esc(s.name)}</strong><button data-profit-locate="${esc(g[0].config_id)}">定位配置</button></div>${g.map(r=>`<section><strong>${r.metric==='erp'?'ERP':'核算'}利润 ${r.valid?fmt(r.profit_cents):'无法计算'}</strong><span class="profit-reason">${r.loss?'亏损超过 ¥300 ':''}${r.changed?'累计变化超过 ¥100 ':''}</span>${r.reason?`<p>${esc(r.reason)}</p>`:''}${r.valid?`<p class="hint">上次差额 ${fmt(r.previous_delta_cents)} · 累计差额 ${fmt(r.anchor_delta_cents)}${r.configUpdated?' · 配置已更新，请重新检测':''}</p><button class="text-button" data-reset="${esc(r.config_id)}" data-result="${esc(r.id)}" data-metric="${r.metric}">重设此口径变化基准</button>`:''}</section>`).join('')}</article>`;
  }).join('')||`<p class="profit-empty">${category==='missing'?'没有成本缺失项。':'没有利润异常项。'}</p>`}`;
  output().querySelectorAll('[data-profit-locate]').forEach(button=>button.onclick=()=>locate?.(button.dataset.profitLocate));
  output().querySelectorAll('[data-reset]').forEach(button=>button.onclick=async()=>{if(!confirm('将此口径当前利润设为新基准？历史记录保留。'))return;try{const receipt=await request('/api/profit/reset',{method:'POST',body:JSON.stringify({shopId:shopId(),configId:button.dataset.reset,metric:button.dataset.metric,resultId:button.dataset.result})});if(!receipt.ok)throw Error('这不是当前最新结果，请重新检测后重设基准');toast('基准已重设');}catch(e){toast(e.message);}});
  };
  output().querySelectorAll('[data-profit-category]').forEach(button=>button.onclick=()=>{category=button.dataset.profitCategory;paint();});paint();
 };
 const draw=()=>{
  openDialog('一键检测利润',`<p class="hint">主机模板不参与检测。使用已保存到手价和核算价，重新只读采集 ERP 成本。分别检查亏损超过 ¥300 和累计变化超过 ¥100。</p><div class="profit-scope"></div><div class="actions"><button id="profit-start" class="primary">开始检测</button><button id="profit-history">查看历史</button></div><div id="profit-output" aria-live="polite"></div><details><summary>发布到后台监控</summary><label><input id="profit-publish-enabled" type="checkbox">保存后自动发布完整快照</label><label>目标目录<input id="profit-publish-directory" type="text" placeholder="例如 D:/监控数据"></label><button id="profit-publish-save">保存并发布</button><small id="profit-publish-status"></small></details>`);
  request('/api/profit/publish').then(v=>{const enabled=document.querySelector('#profit-publish-enabled'),directory=document.querySelector('#profit-publish-directory'),status=document.querySelector('#profit-publish-status');if(enabled){enabled.checked=v.enabled;directory.value=v.directory||'';status.textContent=v.error||((v.publishedAt?'上次发布 '+v.publishedAt:'尚未发布'));}}).catch(e=>toast(e.message));
  document.querySelector('#profit-publish-save').onclick=async()=>{try{const v=await request('/api/profit/publish',{method:'POST',body:JSON.stringify({enabled:document.querySelector('#profit-publish-enabled').checked,directory:document.querySelector('#profit-publish-directory').value})});document.querySelector('#profit-publish-status').textContent=v.error||((v.enabled?'已发布 '+v.publishedAt:'已关闭联动'));}catch(e){toast(e.message);}};
  document.querySelector('#dialog').classList.add('profit-check-dialog');
  mountProfitScope(document.querySelector('.profit-scope'),all,selection,esc);
  document.querySelector('#profit-start').onclick=async()=>{
   if(!selection.size)return toast('请勾选配置');const button=document.querySelector('#profit-start');button.disabled=true;output().textContent='正在保存配置…';
   try{await save();const started=await request('/api/profit/start',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),shopId:shopId(),configIds:[...selection]})});
    for(;;){const report=await request('/api/profit/status',{method:'POST',body:JSON.stringify({runId:started.runId})});if(!output())break;if(report.run.status==='completed'){show(report);break;}if(['failed','interrupted'].includes(report.run.status)){output().textContent=report.run.error||'检测中断';break;}output().textContent=report.phase==='collecting'?'正在采集 ERP 成本…':'正在计算…';await new Promise(resolve=>setTimeout(resolve,800));}
   }catch(e){if(output())output().textContent=e.message;}finally{if(button.isConnected)button.disabled=false;}
  };
  document.querySelector('#profit-history').onclick=async()=>{try{const history=await request('/api/profit/history');output().innerHTML=history.runs.map(r=>`<button data-run="${esc(r.id)}">${esc(r.started_at)} · ${esc(r.status)} · ${r.covered} 套</button>`).join('')||'<p>暂无历史</p>';document.querySelectorAll('[data-run]').forEach(button=>button.onclick=async()=>show(await request('/api/profit/status',{method:'POST',body:JSON.stringify({runId:button.dataset.run})})));}catch(e){toast(e.message);}};
 };
 draw();
}
