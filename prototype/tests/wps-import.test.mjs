import test from 'node:test';
import assert from 'node:assert/strict';
import {clipboardRows,parseWpsParts,importProblems} from '../wps-import.js';
import {erpRow,totals} from '../core.js';
import {screenshotText,screenshotBlock} from './wps-block-fixture.mjs';

test('截图 760 行按 19 行保留边界：40 套配置独立导入，汇总和空槽不报错',()=>{
 const parsed=parseWpsParts(screenshotText(40));assert.deepEqual(importProblems(parsed),[]);assert.equal(parsed.groups.length,40);assert.equal(parsed.rows.length,400);assert.equal(parsed.skipCounts.header,40);assert.equal(parsed.skipCounts.summary,40);assert.equal(parsed.skipCounts.placeholder,160);assert.equal(parsed.skipped,360);
 for(const [i,g] of parsed.groups.entries()){assert.equal(g.lineStart,i*19+1);assert.equal(g.rows.length,10);assert.equal(g.rows[0].part.slot,'CPU');assert.equal(g.rows[3].part.slot,'内存');assert.equal(g.rows[8].part.qty,11);assert.equal(g.rows[9].part.slot,'配件1');assert.equal(g.rows[5].part.goodsId,'');assert.equal(erpRow({parts:g.rows.map(r=>r.part)}).length,56);}
});
test('D:H 的 F 列为空时自动采用 E，完整 A:N 保留配置名称和版本',()=>{
 const five=parseWpsParts(screenshotText(2,5));assert.equal(five.quantity,'E');assert.deepEqual(importProblems(five),[]);assert.equal(five.groups.length,2);
 const full=parseWpsParts(screenshotText(2,14));assert.deepEqual(importProblems(full),[]);assert.equal(full.groups[1].name,'配置2');assert.equal(full.groups[1].version,'进阶版');assert.equal(full.groups[1].rows[3].part.qty,1);
 const wrong=parseWpsParts(screenshotText(2,5),{quantity:'F'});assert.ok(importProblems(wrong).some(e=>e.includes('数量')));
});
test('多套中真实非空配件的非法 ID 仍按原行报错，不影响其他组识别',()=>{
 const rows=[...screenshotBlock(0),...screenshotBlock(1)];rows[21][0]='3.25766E+19';const parsed=parseWpsParts(rows.map(r=>r.join('\t')).join('\n'));assert.equal(parsed.groups.length,2);assert.equal(parsed.groups[0].rows.length,10);assert.ok(importProblems(parsed).some(e=>e.includes('配置2')&&e.includes('第 22 行')));
});
test('名称为空或 0 的占位行跳过，无表头但保留完整 19 行也能分组',()=>{
 const rows=[...screenshotBlock(0),...screenshotBlock(1)];rows[0]=['','',''];rows[19]=['','',''];const parsed=parseWpsParts(rows.map(r=>r.join('\t')).join('\n'));assert.deepEqual(importProblems(parsed),[]);assert.equal(parsed.groups.length,2);
 const empty=parseWpsParts('123\t1\t\n456\t1\t0\n789\t1\tCPU');assert.equal(empty.rows.length,1);assert.equal(empty.skipCounts.placeholder,2);
});

test('三列保留长 ID、原始名称、数量，成本只按精确 ID 取值',()=>{
 const id='3797170100491124774',text=`goods id\t数量\t配件\n${id}\t2\t英特尔 酷睿 I5 14600KF 14核20线程`;
 const result=parseWpsParts(text,{catalog:[{goodsId:id,name:'本地其他名称',sourceId:'x',erp:100,tax:90}],costSource:[{goodsId:id,erp:120,tax:110}]});
 assert.deepEqual(importProblems(result),[]);const p=result.rows[0].part;assert.equal(p.goodsId,id);assert.equal(p.qty,2);assert.equal(p.name,'本地其他名称');assert.equal(p.erp,120);assert.equal(p.tax,110);assert.equal(p.sourceId,'x');assert.equal(totals({price:0,parts:[p]}).tax,220);
});
test('D:H 支持选择 E/F 数量，两个风扇独立保存，空槽位跳过，无卡不伪造 ID',()=>{
 const text='EXCEL利润\tERP利润\t数量\t定价\t\n47538\t1\t1\tCPU\t英特尔 14600KF\n0\t1\t1\t显卡\t不含显卡，可咨询客服加装显卡使用\n\t\t\t\t\n88750\t4\t8\t风扇\t乔思伯 ZA 连体风扇\n113932\t1\t1\t风扇\tARGB 定制光效\n0\t1\t1\t配件\t';
 const f=parseWpsParts(text),e=parseWpsParts(text,{quantity:'E'});assert.deepEqual(importProblems(f),[]);assert.equal(f.rows.length,4);assert.equal(f.rows[2].part.qty,8);assert.equal(e.rows[2].part.qty,4);assert.equal(f.rows[3].part.slot,'配件1');assert.equal(f.rows[1].part.goodsId,'');assert.equal(erpRow({parts:f.rows.map(r=>r.part)}).length,56);
});
test('Excel 多行单元格及引号完整保留，不把型号换行拆成配件行',()=>{
 const text='123\t1\t"CPU\n英特尔 ""定制"" 14600KF"';assert.equal(clipboardRows(text).length,1);const result=parseWpsParts(text);assert.equal(result.rows[0].part.name,'CPU\n英特尔 "定制" 14600KF');assert.deepEqual(importProblems(result),[]);assert.throws(()=>clipboardRows('123\t1\t"CPU'));
});
test('未匹配 ID 保留并告警，未知分类需要选择；缺失成本不回填旧缓存',()=>{
 const unknown=parseWpsParts('987654321\t1\t完全未知的型号');assert.equal(unknown.rows[0].part.goodsId,'987654321');assert.equal(unknown.rows[0].part.erp,null);assert.ok(importProblems(unknown).some(e=>e.includes('请选择')));unknown.rows[0].part.slot='配件1';assert.deepEqual(importProblems(unknown),[]);
 const cached=parseWpsParts('123\t1\tCPU 14600KF',{catalog:[{goodsId:'123',name:'CPU 14600KF',erp:99,tax:88}],costSource:[{goodsId:'123',erp:null,tax:0}]});assert.equal(cached.rows[0].part.erp,null);assert.equal(cached.rows[0].part.tax,0);
});
test('错误行不被静默吞掉：科学计数法、数量、列错位与多套配置混贴均阻止创建',()=>{
 for(const text of ['1.234E+15\t1\tCPU','123\t0\tCPU','123\t1.5\tCPU','123\t1\tCPU\t额外列','123\t1\tCPU\n456\t1\tCPU'])assert.ok(importProblems(parseWpsParts(text)).length,text);
 const result=parseWpsParts('123\t1\tCPU\n456\t错误\t主板');assert.equal(result.rows.length,1);assert.ok(importProblems(result).some(e=>e.includes('第 2 行')));
});


test('WPS 按本店输出表匹配显示名称，并把仅文字及多选加购带入逐项升级说明',()=>{
 const catalog=[{sourceId:'text',shopId:'intel',goodsId:'101',name:'输出表 CPU',addonText:'【仅文字说明】',addonChoices:[{id:'one',label:'【仅文字说明】',goodsId:'',enabled:true}]},{sourceId:'multi',shopId:'intel',goodsId:'102',name:'输出表散热',addonText:'待同步',addonChoices:[{id:'a',label:'【文字 A】',goodsId:'',enabled:true},{id:'b',label:'【文字 B】',goodsId:'',enabled:true},{id:'c',label:'不展示',goodsId:'',enabled:false}]}];
 const parsed=parseWpsParts('101\t1\t旧 CPU 名\n102\t1\t旧散热名',{catalog});
 assert.deepEqual(importProblems(parsed),[]);assert.deepEqual(parsed.rows.map(r=>r.part.name),['输出表 CPU','输出表散热']);assert.deepEqual(parsed.rows.map(r=>r.part.upgrade),['【仅文字说明】','【文字 A】【文字 B】']);
});

test('同 ID 两个输出表名称不能随意选，须由准确名称消歧',()=>{
 const catalog=[{sourceId:'a',goodsId:'101',name:'内存灯条 RGB',originalName:'ERP 原名'},{sourceId:'b',goodsId:'101',name:'内存马甲无光',originalName:'ERP 原名'}];
 const ambiguous=parseWpsParts('101\t1\tERP 原名',{catalog});assert.match(importProblems(ambiguous).join('；'),/多个配件/);
 const exact=parseWpsParts('101\t1\t内存马甲无光',{catalog});assert.deepEqual(importProblems(exact),[]);assert.equal(exact.rows[0].part.sourceId,'b');
});
