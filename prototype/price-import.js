import {clipboardRows} from './wps-import.js';
import {pricing} from './pricing.js';
import {suggestedName} from './legacy-names.js';

const cell=value=>String(value??'').trim().replace(/^\*\*([\s\S]*)\*\*$/,'$1').replace(/&(?:#x([\da-f]+)|#(\d+)|nbsp|amp);/gi,(entity,hex,dec)=>{if(hex||dec){const code=parseInt(hex||dec,hex?16:10);return code<=0x10ffff?String.fromCodePoint(code):entity;}return entity.toLowerCase()==='&amp;'?'&':' ';}).trim();
export const nameKey=value=>cell(value).normalize('NFKC').replace(/[丨｜]/g,'|').replace(/\s+/g,'').toUpperCase();
export const priceImportName=config=>config.shortName||suggestedName(config,config.nameFormat||'compact');
export function parsePriceTable(text){
 const markdown=!String(text).includes('\t')&&String(text).split(/\r?\n/).some(line=>line.trim().startsWith('|'));
 const records=markdown?String(text).split(/\r?\n/).map((line,i)=>({line:i+1,cells:line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(v=>v.replace(/\\\|/g,'|'))})):clipboardRows(text);
 const result={rows:[],errors:[],skipped:0};
 for(const record of records){const cells=record.cells.map(cell);if(cells.every(c=>!c)||markdown&&cells.every(c=>/^:?-{3,}:?$/.test(c))){result.skipped++;continue;}
  if(cells.length===3&&/^(?:配置简称|简称|维护表简称)$/.test(cells[0])&&/定价|价格/.test(cells[2])){result.skipped++;continue;}
  if(cells.length!==3){result.errors.push(`第 ${record.line} 行：请粘贴简称、库存、定价三列`);continue;}
  const [name,stock,raw]=cells,value=raw.replace(/^[¥￥]\s*/,''),plain=value.replace(/,/g,'');
  if(!name){result.errors.push(`第 ${record.line} 行：简称为空`);continue;}
  if(!value){result.skipped++;continue;}
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)||!Number.isSafeInteger(Math.round(Number(plain)*100))){result.errors.push(`第 ${record.line} 行：定价必须是非负数字，最多两位小数`);continue;}
  result.rows.push({line:record.line,name,stock,listPrice:Number(plain)});
 }
 return result;
}
export function priceImportPlan(text,configs,settings){
 const parsed=parsePriceTable(text),coupon=Number(settings?.coupon??0),result={rows:[],changes:[],errors:[...parsed.errors],skipped:parsed.skipped,coupon};
 if(!Number.isFinite(coupon)||coupon<0){result.errors.push('店铺优惠券无效');return result;}
 const targets=new Map();for(const c of configs.filter(c=>!c.deletedAt)){const key=nameKey(priceImportName(c));if(!targets.has(key))targets.set(key,[]);targets.get(key).push(c);}
 const seen=new Map();for(const row of parsed.rows){const key=nameKey(row.name),previous=seen.get(key);if(previous){if(previous.listPrice!==row.listPrice)result.errors.push(`第 ${previous.line}、${row.line} 行：同一简称出现不同定价`);else result.skipped++;continue;}seen.set(key,row);
  const matches=targets.get(key)||[];if(matches.length!==1){const status=matches.length?'简称重复，无法唯一匹配':'当前链接没有匹配简称';result.rows.push({...row,status});if(matches.length>1)result.errors.push(`第 ${row.line} 行：${status}`);continue;}
  const c=matches[0],old=pricing(c,settings),arrival=(Math.round(row.listPrice*100)-Math.round(coupon*100))/100;
  if(arrival<0){result.errors.push(`第 ${row.line} 行：定价低于店铺优惠券，无法计算到手价`);result.rows.push({...row,status:'定价低于店铺券'});continue;}
  const change={...row,id:c.id,before:Number(c.price),after:arrival,oldList:old.listPrice,status:arrival===Number(c.price)?'价格相同':'待更新'};
  result.rows.push(change);if(change.status==='待更新')result.changes.push(change);
 }
 if(!parsed.rows.length&&!result.errors.length)result.errors.push('没有可用的价格行');return result;
}
export function applyPriceImport(plan,configs,settings,at=new Date().toISOString()){
 if(plan.errors.length)throw Error(plan.errors[0]);if(Number(settings?.coupon??0)!==plan.coupon)throw Error('店铺券已变化，请重新预览');
 const targets=plan.changes.map(change=>{const c=configs.find(c=>!c.deletedAt&&c.id===change.id);if(!c||Number(c.price)!==change.before||nameKey(priceImportName(c))!==nameKey(change.name))throw Error('配置已变化，请重新预览');return c;});
 targets.forEach((c,i)=>{c.price=plan.changes[i].after;c.priceImportedAt=at;});return targets.map(c=>c.id);
}

export function openPriceImport(api){
 const {openDialog,closeDialog,toast,esc,money,getConfigs,getSettings,apply,back}=api;
 const p=api.product();openDialog('从成本维护表更新价格',`<p class="hint">更新当前链接：<strong>${esc(p.name)}</strong> · ${p.configs.length} 套。按完整简称匹配，不按行号对应。</p><p class="hint">三列依次为：简称、库存、定价。库存仅供核对。到手价 = 定价 − 店铺券 ¥${money(getSettings().coupon)}。</p><textarea id="price-import-text" aria-label="成本维护表价格数据" placeholder="从 WPS 复制三列后粘贴，也支持 Markdown 表格"></textarea><div class="actions"><button id="price-import-check">预览价格差异</button></div><p id="price-import-status" role="status" class="hint"></p><div id="price-import-preview"></div><div class="actions"><button id="price-import-back">返回总览</button><button id="price-import-apply" class="primary" disabled>应用价格更新</button></div>`);
 const $=selector=>document.querySelector(selector);let plan=null;
 $('#price-import-text').oninput=()=>{plan=null;$('#price-import-apply').disabled=true;$('#price-import-preview').innerHTML='';$('#price-import-status').textContent='请重新预览价格差异';};
 $('#price-import-check').onclick=()=>{try{plan=priceImportPlan($('#price-import-text').value,getConfigs(),getSettings());const unmatched=plan.rows.filter(r=>!r.id).length;$('#price-import-status').textContent=plan.errors.length?plan.errors.slice(0,5).join('；'):`匹配 ${plan.rows.length-unmatched} 行，待更新 ${plan.changes.length} 套，未匹配 ${unmatched} 行，跳过 ${plan.skipped} 行空值、表头或相同重复。`;$('#price-import-status').classList.toggle('error',!!plan.errors.length);$('#price-import-preview').innerHTML=`<div class="price-import-table-wrap"><table class="price-import-table"><thead><tr><th>简称 / 状态</th><th>库存</th><th>原定价 → 新定价</th><th>新到手价</th></tr></thead><tbody>${plan.rows.map(r=>`<tr><td>${esc(r.name)}<small>${esc(r.status)}</small></td><td>${esc(r.stock)}</td><td>${r.oldList===undefined?'—':money(r.oldList)} → ${money(r.listPrice)}</td><td>${r.after===undefined?'—':money(r.after)}</td></tr>`).join('')}</tbody></table></div>`;$('#price-import-apply').disabled=!!plan.errors.length||!plan.changes.length;$('#price-import-apply').textContent=`更新 ${plan.changes.length} 套配置价格`;}catch(e){plan=null;$('#price-import-apply').disabled=true;$('#price-import-status').textContent=e.message;}};
 $('#price-import-back').onclick=back;$('#price-import-apply').onclick=()=>{try{if(!plan)return;apply(plan);closeDialog();toast(`已更新 ${plan.changes.length} 套配置价格，正在保存`);}catch(e){toast(e.message);$('#price-import-apply').disabled=true;}};
}
