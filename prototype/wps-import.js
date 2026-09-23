import {slots,clone} from './core.js';
import {sourceUpgradeDescription} from './source.js';

// WPS/Excel clipboard text uses tabs, quoted multiline cells and doubled quotes.
export function clipboardRows(text){
 const rows=[];let cells=[],cell='',quoted=false,line=1,start=1;
 const value=String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 for(let i=0;i<value.length;i++){
  const ch=value[i];
  if(ch==='"'&&(quoted||cell==='')){if(quoted&&value[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&(ch==='\t'||ch==='\n')){cells.push(cell);cell='';if(ch==='\n'){rows.push({line:start,cells});cells=[];start=line+1;}}
  else cell+=ch;
  if(ch==='\n')line++;
 }
 if(quoted)throw Error('粘贴内容存在未闭合的引号，请重新复制完整单元格区域');
 cells.push(cell);if(cells.length>1||cells.some(c=>c.trim()))rows.push({line:start,cells});return rows;
}
const category=value=>{
 const text=String(value||'').trim();
 if(/^配件\d*$/.test(text))return '配件';
 if(slots.includes(text))return text;
 if(/散热|水冷|风冷|冷排/.test(text))return '散热';
 if(/机箱|X400\s*CG/i.test(text))return '机箱';
 if(/风扇/.test(text))return '风扇';
 if(/电源|额定\s*\d+\s*W/i.test(text))return '电源';
 if(/主板|(?:[BHZX]\d{3}|A[56]20)[A-Z\d -]*(?:M|WIFI|DDR|D[45]|PLUS|PRO|GAMING|AORUS)/i.test(text))return '主板';
 if(/显卡|不含显卡|无卡|核显|(?:RTX|GTX|RX)\s*\d{3,4}/i.test(text))return '显卡';
 if(/内存|(?:DDR[345]|D[345]|3600\s*C18|\d{4}\s*(?:MHz|MT\/s))/.test(text))return '内存';
 if(/硬盘|固态|SSD|NVME|PCIE|\d+\s*TB|\d+\s*MB\/s/i.test(text))return '硬盘';
 if(/CPU|酷睿|锐龙|RYZEN|CORE|\bI[3579]\b|\b\d{4,5}(?:K|KF|F|X|X3D)\b/i.test(text))return 'CPU';
 if(/定制|延长线|副屏|灯板|支架/.test(text))return '配件';
 return '';
};
const validPrice=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
export function importProblems(result){
 if(result.groups)return [...result.errors,...result.groups.flatMap((group,i)=>importProblems(group).map(e=>`${group.name||'配置'+(i+1)}：${e}`)),...(!result.groups.length?['没有可导入的配件']:[])];
 const errors=[...result.errors],used=new Set();
 for(const row of result.rows){if(!slots.includes(row.part.slot))errors.push(`第 ${row.line} 行：请选择配件分类`);else if(used.has(row.part.slot))errors.push(`第 ${row.line} 行：${row.part.slot} 分类重复，请调整为独立配件槽位`);used.add(row.part.slot);}
 if(!result.rows.length)errors.push('没有可导入的配件');if(result.rows.length>slots.length)errors.push(`一套配置最多 ${slots.length} 项配件，请仅复制一套配置`);return errors;
}
export function parseWpsParts(text,{catalog=[],costSource=[],configs=[],format='auto',quantity='auto'}={}){
 const result={rows:[],groups:[],errors:[],skipped:0,skipCounts:{empty:0,header:0,summary:0,placeholder:0},format:null},used=new Set();
 const records=clipboardRows(text),empty=value=>!String(value??'').trim()||/^0(?:\.0+)?$/.test(String(value).trim());
 const sample=records.find(r=>r.cells.some(c=>c.trim())),width=format==='auto'?(sample?.cells.length||3):format==='full'?(sample?.cells.length||14):Number(format);
 const full=width>=8,idIndex=full?3:0,nameIndex=full?7:width===5?4:2,hintIndex=full?6:width===5?3:-1;
 const field=(r,i)=>String(r?.cells[i]??'').trim(),header=r=>/^(?:EXCEL利润|ERP总价|含税总价)$/i.test(field(r,idIndex))||full&&/^配置\s*[\d一二三四五六七八九十]+$/.test(field(r,10));
 const coreSlots=['CPU','散热','主板','内存','硬盘','显卡','电源','机箱'];
 const headerIndexes=records.flatMap((r,i)=>header(r)?[i]:[]);
 const fixed19=!headerIndexes.length&&records.length>=19&&category(field(records[2],hintIndex)||field(records[2],nameIndex))==='CPU'&&(records.length<=21||category(field(records[21],hintIndex)||field(records[21],nameIndex))==='CPU');
 let group=null,start=0,structured=false;
 const begin=(index,isStructured)=>{start=index;structured=isStructured;used.clear();const titled=full&&/^配置/.test(field(records[index],10));group={name:titled?field(records[index],10):`配置${result.groups.length+1}`,version:titled?field(records[index],11):'',rows:[],errors:[],lineStart:records[index]?.line||1,skipped:0};};
 const finish=()=>{if(group&&(group.rows.length||group.errors.length))result.groups.push(group);group=null;};
 const skip=kind=>{result.skipped++;result.skipCounts[kind]++;if(group)group.skipped++;};
 let autoQty='E';if(width===5){const values=records.filter(r=>/^\d+$/.test(field(r,0))&&!empty(field(r,4))&&!header(r));autoQty=values.some(r=>field(r,2)!=='')?'F':'E';}
 result.quantity=width===3?'第二列':full?'E':quantity==='auto'?autoQty:quantity;
 begin(0,fixed19);
 const sourceById=new Map(),costById=new Map(costSource.map(c=>[String(c.goodsId),c]));
 for(const row of catalog.filter(c=>!c.deletedAt)){const key=String(row.goodsId);if(!sourceById.has(key))sourceById.set(key,[]);sourceById.get(key).push(row);}
 const knownById=new Map();for(const c of configs.filter(c=>!c.deletedAt))for(const p of c.parts){if(!knownById.has(p.goodsId))knownById.set(p.goodsId,new Set());knownById.get(p.goodsId).add(p.slot);}
 for(const [recordIndex,record] of records.entries()){
  const cells=record.cells.map(c=>c.trim()),line=record.line;
  if(header(record)||fixed19&&recordIndex>0&&recordIndex%19===0){finish();const nextCore=category(field(records[recordIndex+2],hintIndex)||field(records[recordIndex+2],nameIndex));begin(recordIndex,fixed19||nextCore==='CPU'||headerIndexes.includes(recordIndex+19)||headerIndexes.includes(recordIndex-19));}
  if(cells.every(c=>!c)){skip('empty');continue;}
  if(header(record)||/^(goods?[ _]?id|商品id|配件id|id)$/i.test(field(record,idIndex))){skip('header');continue;}
  const size=width;
  if(!([3,5].includes(size)||full)||cells.length>size){group.errors.push(`第 ${line} 行：列数不符，请复制三列、D:H 或从 A 列开始的完整区域`);continue;}result.format=size;
  const offset=recordIndex-start,id=field(record,idIndex).replace(/^'/,''),rawQty=field(record,full?4:width===3?1:result.quantity==='E'?1:2),name=field(record,nameIndex),hint=field(record,hintIndex);
  if(structured&&offset===1&&empty(name)&&!category(hint)){skip('summary');continue;}
  if(empty(name)){skip('placeholder');continue;}
  if(!/^\d{1,20}$/.test(id)){group.errors.push(`第 ${line} 行：goods ID 应为完整数字，请勿使用科学计数法`);continue;}
  const qty=Number(rawQty);if(!rawQty||!Number.isSafeInteger(qty)||qty<1){group.errors.push(`第 ${line} 行：数量必须为正整数`);continue;}
  const goodsId=/^0+$/.test(id)?'':id,choices=sourceById.get(goodsId)||[],exact=choices.filter(c=>c.name===name||c.originalName===name),source=exact.length===1?exact[0]:choices.length===1?choices[0]:null;
  const known=knownById.get(goodsId),positionKind=structured&&offset>=2&&offset<=9?coreSlots[offset-2]:structured&&offset>=11&&offset<=16?(offset===11?'风扇':'配件'):'';
  if(goodsId&&choices.length>1&&!source)group.errors.push(`第 ${line} 行：输出表中该 goods ID 对应多个配件，请在 WPS 中填写准确的输出表名称`);
  const kind=category(hint)||positionKind||category(name)||(known?.size===1?[...known][0]:'');
  let slot=kind;const notes=[];
  if(kind==='配件'||used.has(kind)&&['风扇','硬盘','内存'].includes(kind)){slot=slots.find(s=>s.startsWith('配件')&&!used.has(s))||'';if(kind!=='配件')notes.push(`第二项${kind}放入 ${slot||'待分配槽位'}`);}
  used.add(slot);
  const cost=costById.get(goodsId),erp=validPrice(cost?cost.erp:source?.erp),tax=validPrice(cost?cost.tax:source?.tax);
  if(!goodsId)notes.push('原 ID 为 0，保留名称，不绑定配件 ID');
  else if(!source&&!cost)notes.push('未匹配本地成本，保留原 ID 与名称，成本待补');
  else if(choices.length>1&&!source)notes.push('同 ID 有多条输出源，未自动绑定展示资料');
  else if(source&&source.name!==name)notes.push('已按本店输出表名称替换 WPS 名称');
  if(goodsId&&(erp===null||tax===null))notes.push('部分成本缺失');
  const part={slot,goodsId,qty,name:source?.name||name,erp,tax,warranty:source?.warranty||'',upgrade:source?sourceUpgradeDescription(source):''};if(source)part.sourceId=source.sourceId;
  const row={line,part,notes};group.rows.push(row);result.rows.push(row);
 }
 finish();
 return result;
}

export function mountWpsImport(container,options){
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 container.innerHTML=`<details class="wps-import"><summary>从 WPS 粘贴配置配件</summary><p class="hint">可连续复制多套配置，保留每套 19 行原始结构。支持 ID／数量／名称三列、D:H 五列或从 A 列开始的完整表格；配件名称和升级说明以本店输出表为准。</p><div class="inline-grid"><label class="field">粘贴格式<select data-wps-format><option value="auto">自动识别原表区域</option><option value="3">三列：ID / 数量 / 名称</option><option value="5">五列：D:H 原表区域</option><option value="full">完整表格：从 A 列开始</option></select></label><label class="field">D:H 区域中的数量<select data-wps-quantity><option value="auto">自动识别 E / F 列</option><option value="E">E 列（截图格式）</option><option value="F">F 列</option></select></label></div><textarea data-wps-text aria-label="WPS 配件数据" placeholder="从 WPS 复制单元格后粘贴到这里，可一次粘贴多套"></textarea><button data-wps-check type="button">预览导入配件</button><p data-wps-status role="status" class="hint"></p><details data-wps-errors hidden><summary>查看需要修正的行</summary><div></div></details><div data-wps-preview></div></details>`;
 const $=selector=>container.querySelector(selector);let result=null,signature='';
 const key=()=>[$('[data-wps-text]').value,$('[data-wps-format]').value,$('[data-wps-quantity]').value].join('\u0000');
 function status(){const errors=importProblems(result);$('[data-wps-status]').classList.toggle('error',errors.length>0);const summary=`已识别 ${result.rows.length} 项配件，共 ${result.groups.length} 套配置；跳过 ${result.skipped} 行（表头 ${result.skipCounts.header}、汇总 ${result.skipCounts.summary}、空行 ${result.skipCounts.empty}、空配件 ${result.skipCounts.placeholder}）。数量：${result.quantity}。`;$('[data-wps-status]').textContent=summary+(errors.length?`有 ${errors.length} 处需修正：${errors.slice(0,3).join('；')}`:'核对后可一次创建全部配置。');$('[data-wps-errors]').hidden=!errors.length;$('[data-wps-errors] div').textContent=errors.join('\n');}
 function preview(){try{result=parseWpsParts($('[data-wps-text]').value,{...options,format:$('[data-wps-format]').value,quantity:$('[data-wps-quantity]').value});signature=key();let rowIndex=0;$('[data-wps-preview]').innerHTML=result.groups.map((group,index)=>`<details class="wps-config-preview" ${index===0?'open':''}><summary>${esc(group.name)}${group.version?' · '+esc(group.version):''} · ${group.rows.length} 项配件 · 原第 ${group.lineStart} 行起</summary><div class="wps-table-wrap"><table class="wps-table"><thead><tr><th>原行</th><th>分类</th><th>goods ID</th><th>数量</th><th>配件名称与提示</th></tr></thead><tbody>${group.rows.map(r=>`<tr><td>${r.line}</td><td><select data-wps-slot="${rowIndex++}" aria-label="第 ${r.line} 行分类"><option value="">请选择</option>${slots.map(s=>`<option ${r.part.slot===s?'selected':''}>${s}</option>`).join('')}</select></td><td>${esc(r.part.goodsId||'0（未绑定）')}</td><td>${r.part.qty}</td><td>${esc(r.part.name)}${r.notes.map(n=>`<small>${esc(n)}</small>`).join('')}</td></tr>`).join('')}</tbody></table></div></details>`).join('');container.querySelectorAll('[data-wps-slot]').forEach(select=>select.onchange=()=>{result.rows[select.dataset.wpsSlot].part.slot=select.value;status();});status();}catch(e){result=null;$('[data-wps-status]').textContent=e.message;$('[data-wps-status]').classList.add('error');$('[data-wps-preview]').innerHTML='';$('[data-wps-errors]').hidden=true;}}
 $('[data-wps-check]').onclick=preview;for(const selector of ['[data-wps-text]','[data-wps-format]','[data-wps-quantity]'])$(selector).addEventListener('input',()=>{result=null;$('[data-wps-status]').textContent='内容已变化，请重新预览';$('[data-wps-status]').classList.remove('error');$('[data-wps-errors]').hidden=true;$('[data-wps-preview]').innerHTML='';});
 return{read(){if(!$('[data-wps-text]').value.trim())return null;if(!result||signature!==key())throw Error('请先点击“预览导入配件”，核对后再创建');const errors=importProblems(result);if(errors.length)throw Error(errors[0]);const text=$('[data-wps-text]').value,lines=text.replace(/\r\n?/g,'\n').split('\n');return{groups:result.groups.map((g,i)=>({name:g.name,version:g.version,parts:clone(g.rows.map(r=>r.part)),lineStart:g.lineStart,sourceText:result.groups.length===1?text:lines.slice(g.lineStart-1,result.groups[i+1]?result.groups[i+1].lineStart-1:undefined).join('\n')})),importedAt:new Date().toISOString()};}};
}
