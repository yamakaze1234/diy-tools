import {recentActivity} from './activity.js';
export function openActivity({openDialog,esc,rows,locate,toast}){
 openDialog('操作记录',`<p class="hint">保留最近 7 天。云端记录为其他成员已同步的修改；尚未同步的编辑不可见。摘要不展开完整内容，定位显示当前版本。</p><div class="inline-grid"><label class="field">开始日期<input id="activity-from" type="date"></label><label class="field">结束日期<input id="activity-to" type="date"></label></div><p id="activity-count" class="hint"></p><div id="activity-list"></div><div class="actions"><button id="activity-prev">上一页</button><span id="activity-page"></span><button id="activity-next">下一页</button></div>`);
 const $=s=>document.querySelector(s);let page=0;const day=at=>{const d=new Date(at);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
 function draw(){const from=$('#activity-from').value,to=$('#activity-to').value,filtered=recentActivity(rows).filter(r=>(!from||day(r.at)>=from)&&(!to||day(r.at)<=to)),pages=Math.max(1,Math.ceil(filtered.length/30));page=Math.min(page,pages-1);const visible=filtered.slice(page*30,page*30+30);
 $('#activity-count').textContent=`共 ${filtered.length} 条记录`;$('#activity-list').innerHTML=visible.map((r,i)=>`<div class="list-card"><div><strong>${esc(r.message)}</strong><p>${esc(r.summary||'')}</p>${r.preview?`<p>${esc(r.preview)}${r.preview.length>=80?'…':''}</p>`:''}<small>${r.origin==='cloud'?'云端同步 · 成员':'本地操作 · 操作人'}：${esc(r.operator||'历史记录未记录')} · ${esc(new Date(r.at).toLocaleString())}</small></div>${r.target?`<button data-activity-locate="${i}">定位修改</button>`:'<small>旧记录无定位信息</small>'}</div>`).join('')||'<p class="hint">所选日期暂无操作记录。</p>';
 for(const b of document.querySelectorAll('[data-activity-locate]'))b.onclick=async()=>{try{await locate(visible[Number(b.dataset.activityLocate)].target);}catch(e){toast(e.message);}};
 $('#activity-page').textContent=`${page+1} / ${pages}`;$('#activity-prev').disabled=page===0;$('#activity-next').disabled=page===pages-1;
 }
 for(const id of ['activity-from','activity-to'])$('#'+id).onchange=()=>{page=0;draw();};$('#activity-prev').onclick=()=>{page--;draw();};$('#activity-next').onclick=()=>{page++;draw();};draw();
}
