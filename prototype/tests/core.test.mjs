import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {erpRow,copyText,totals,fromTemplate,modulesDefault,normalizeProducts,productGroups,productTemplate,templateConfigs,importTemplateConfigs,blankConfig,liveConfigs,deleteConfigs,restoreConfigs} from '../core.js';
import {suggestedName} from '../legacy-names.js';
import {makeZip} from '../zip.js';
import {sourceCatalog,bindSources,sourceDiff,syncSource,replaceSourcePart} from '../source.js';
import {posterModules,posterParts,applyPosterStyle} from '../core.js';
const seed=JSON.parse(fs.readFileSync(new URL('../seed.json',import.meta.url)));
const legacy=JSON.parse(fs.readFileSync(new URL('../../现有工具输出契约核验.json',import.meta.url)));

test('旧配置补入服务承诺时保留原模块，重复载入不重复添加或覆盖隐藏状态',()=>{
 const old=[{id:'notes',type:'custom',text:'保留内容',visible:false,color:'#abcdef'},{id:'footer',type:'footer',text:'原说明'}],before=structuredClone(old);
 const modules=posterModules({modules:old});assert.deepEqual(old,before);assert.deepEqual(modules.filter(m=>m.type!=='service'),before);assert.equal(modules.at(-2).type,'service');
 const service=modules.find(m=>m.type==='service');Object.assign(service,{text:'自定义承诺',visible:false,background:'#225544'});
 const reloaded=posterModules(JSON.parse(JSON.stringify({modules})));assert.equal(reloaded.filter(m=>m.type==='service').length,1);assert.deepEqual(reloaded,modules);
});

test('配置图隐藏配件仍保留成本、维护表输出和模板记录',()=>{
 const c=structuredClone(seed.configs[0]),cost=totals(c),row=erpRow(c);c.parts.find(p=>p.slot==='风扇').posterVisible=false;
 assert.ok(!posterParts(c).some(p=>p.slot==='风扇'));assert.deepEqual(totals(c),cost);assert.deepEqual(erpRow(c),row);
 const loaded=JSON.parse(JSON.stringify(productTemplate([c],'带隐藏配件模板')));assert.equal(loaded.configs[0].parts.find(p=>p.slot==='风扇').posterVisible,false);
 c.parts.find(p=>p.slot==='风扇').posterVisible=true;assert.ok(posterParts(c).some(p=>p.slot==='风扇'));
});

test('批量样式保留配置内容、配件隐藏状态和目标独有模块，不共享对象',()=>{
 const source={...structuredClone(seed.configs[0]),modules:modulesDefault(),theme:'dark',layout:'long',palette:{accent:'#12b8b0'},fontFamily:'SimHei',textStyles:{'part.CPU.name':{color:'#abcdef',size:25}}};
 source.modules.reverse();source.modules.find(m=>m.type==='service').text='源服务文案';
 const target={...structuredClone(seed.configs[1]),modules:modulesDefault(),skuId:'1234567890123456789',textStyles:{'part.CPU.name':{color:'#123456',italic:true}}};
 target.modules.find(m=>m.type==='service').text='目标服务文案';target.modules.push({id:'only-target',type:'custom',text:'目标独有',visible:true});target.parts[0].posterVisible=false;
 const before=structuredClone(target);applyPosterStyle(source,target);
 for(const key of ['parts','spu','skuId','price','name','version','addons','benefits','caseImage','footer'])assert.deepEqual(target[key],before[key],key);
 assert.equal(target.modules.find(m=>m.type==='service').text,'目标服务文案');assert.equal(target.modules.at(-1).text,'目标独有');assert.equal(target.modules[0].type,'footer');
 assert.deepEqual(target.textStyles['part.CPU.name'],source.textStyles['part.CPU.name']);assert.equal(target.theme,'dark');assert.equal(target.layout,'long');
 target.palette.accent='#ffffff';assert.equal(source.palette.accent,'#12b8b0');target.modules[0].size=99;assert.notEqual(source.modules[0].size,99);
});

test('只同步配色不覆盖字号版式，只同步格式不覆盖配色',()=>{
 const source={modules:modulesDefault(),parts:[],theme:'dark',layout:'long',fontFamily:'SimHei',textStyles:{'header.shop':{color:'#abcdef',size:31}}};
 const target={modules:modulesDefault(),parts:[],theme:'light',layout:'square',fontFamily:'Microsoft YaHei',textStyles:{'header.shop':{color:'#123456',size:22}}};
 applyPosterStyle(source,target,{colors:true,format:false});assert.equal(target.layout,'square');assert.equal(target.fontFamily,'Microsoft YaHei');assert.equal(target.textStyles['header.shop'].size,22);assert.equal(target.textStyles['header.shop'].color,'#abcdef');
 target.theme='light';target.textStyles['header.shop'].color='#654321';applyPosterStyle(source,target,{colors:false,format:true});assert.equal(target.theme,'light');assert.equal(target.layout,'long');assert.equal(target.textStyles['header.shop'].color,'#654321');assert.equal(target.textStyles['header.shop'].size,31);
});
test('横向输出逐格兼容已记录 V5 纯函数结果',()=>{
 const parts=[['CPU','10001',1],['内存','10002',2],['电源','10003',1],['风扇','10004',8]].map(([slot,goodsId,qty])=>({slot,goodsId,qty}));
 assert.deepEqual(erpRow({parts}),legacy.checks.firstRow);
});
test('真实样例成本，单价乘数量及利润',()=>{const t=totals(seed.configs[0]);assert.equal(t.erp,6520);assert.equal(t.tax,6440);assert.equal(t.basis,6797.6);assert.equal(t.taxProfit,-98.6);assert.equal(t.erpProfit,45.02);});
test('同一配件行保持 ID/数量对应，不采用来源 AA/AB 错位引用',()=>{const row=erpRow(seed.configs[0]);assert.equal(row.length,56);assert.equal(row[24],'383029');assert.equal(row[26],'1');assert.equal(row[32],'375660');assert.equal(row[34],'8');assert.equal(row[14],'2');});
test('SPU/SKU 字符串精度与空 ID 阻止复制',()=>{const c={...seed.configs[0],skuId:'3682299409011548'};assert.equal(copyText([c,c],'sku'),'3682299409011548\r\n3682299409011548');assert.equal(copyText([c],'spu'),'3797170100491124774');assert.throws(()=>copyText(seed.configs.slice(0,1),'sku'),/尚未填写/);});
test('模板调用清空平台身份而保留配件和样式',()=>{const source={...seed.configs[0],modules:modulesDefault(),skuId:'3682299409011548'};const c=fromTemplate({name:'测试模板',config:source});assert.equal(c.spu,'');assert.equal(c.skuId,'');assert.notEqual(c.id,source.id);assert.deepEqual(c.parts,source.parts);c.parts[0].qty=3;assert.equal(source.parts[0].qty,1);});
test('V5 两种简称，显存规则及数量容量',()=>{assert.equal(suggestedName(seed.configs[0]),'配置1：14600KF+无卡+32G+1T丨进阶版');assert.equal(suggestedName(seed.configs[0],'default'),'配置1：14600KF丨无卡 进阶版');const c=structuredClone(seed.configs[0]);Object.assign(c.parts.find(p=>p.slot==='显卡'),{goodsId:'1',name:'技嘉 RTX 5060Ti 16GB'});assert.match(suggestedName(c),/5060Ti 16G/);c.parts.find(p=>p.slot==='显卡').name='技嘉 RTX5080 GAMING 16GB';assert.doesNotMatch(suggestedName(c),/80G|5080 16G/);});
test('重复 ERP 槽位与非法数量不静默导出',()=>{const c=structuredClone(seed.configs[0]);c.parts.push({...c.parts[0]});assert.throws(()=>erpRow(c),/重复/);c.parts.pop();c.parts[0].qty=0;assert.throws(()=>erpRow(c),/正整数/);});
test('ZIP 中文文件名与长度记录可读取',async()=>{const blob=makeZip([{name:'浅色.png',bytes:new Uint8Array([1,2,3])},{name:'导出清单.json',bytes:new TextEncoder().encode('{"success":1}')}]);const bytes=new Uint8Array(await blob.arrayBuffer());const view=new DataView(bytes.buffer);assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint16(bytes.length-22+8,true),2);assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);});
test('旧数据按链接归组，SPU 修改后组身份保持稳定',()=>{const configs=normalizeProducts(structuredClone(seed.configs));const firstId=configs[0].productId;assert.equal(productGroups(configs).length,1);configs[0].spu='999';normalizeProducts(configs);assert.equal(configs[0].productId,firstId);assert.equal(productGroups(configs).length,1);});
test('整组模板保存完整独立快照并兼容旧单配置模板',()=>{const source=structuredClone(seed.configs.slice(0,3));const template=productTemplate(source,'整组');assert.equal(templateConfigs(template).length,3);source[0].parts[0].qty=99;assert.notEqual(template.configs[0].parts[0].qty,99);assert.equal(templateConfigs({config:source[0]}).length,1);});
test('选择多套模板配置导入到新链接，不复制旧 SKU 或旧 SPU',()=>{const source=structuredClone(seed.configs.slice(0,3));source.forEach(c=>c.skuId='3682299409011548');const imported=importTemplateConfigs([source[0],source[2]],{id:'new-link',name:'新链接',spu:'3797170100491124999',url:'https://example.com'});assert.equal(imported.length,2);assert.equal(new Set(imported.map(c=>c.id)).size,2);for(const c of imported){assert.equal(c.skuId,'');assert.equal(c.spu,'3797170100491124999');assert.equal(c.productId,'new-link');assert.ok(!source.some(s=>s.id===c.id));}imported[0].parts[0].qty=99;assert.notEqual(source[0].parts[0].qty,99);assert.equal(importTemplateConfigs([source[0]],{id:'blank',name:'空链接'})[0].spu,'');});
test('空白配置不继承旧成本、平台身份或加购，仅保留展示样式',()=>{const c=blankConfig(seed.configs[0],{id:'new',name:'新链接'});assert.equal(c.price,0);assert.equal(c.spu,'');assert.equal(c.skuId,'');assert.equal(c.parts.length,8);assert.ok(c.parts.every(p=>!p.name&&!p.goodsId&&p.erp===null&&p.tax===null));assert.deepEqual(c.addons,[]);assert.deepEqual(c.modules,seed.configs[0].modules);});
test('单项、批量及全部删除均可恢复原始配件和平台身份',()=>{const configs=structuredClone(seed.configs.slice(0,3));configs[0].skuId='3682299409011548';const before=structuredClone(configs);assert.equal(deleteConfigs(configs,[configs[0].id,configs[2].id]),2);assert.deepEqual(liveConfigs(configs).map(c=>c.id),[configs[1].id]);assert.equal(deleteConfigs(configs,[configs[0].id]),0);deleteConfigs(configs,configs.map(c=>c.id));assert.equal(liveConfigs(configs).length,0);const reloaded=JSON.parse(JSON.stringify(configs));restoreConfigs(reloaded,reloaded.map(c=>c.id));assert.deepEqual(reloaded,before);});
test('按原表 D2/E2 利润公式随到手价和配件数量计算',()=>{const c=structuredClone(seed.configs[0]);c.price=7999;assert.equal(totals(c).taxProfit,1201.4);assert.equal(totals(c).erpProfit,1319.02);c.parts[0].qty+=1;assert.equal(totals(c).taxProfit,-254.6);assert.equal(totals(c).erpProfit,-80.98);});
test('全删后新建配置不会继承删除标记',()=>{const source=structuredClone(seed.configs[0]);source.deletedAt='2026-09-14';assert.equal(blankConfig(source,{id:'new',name:'新链接'}).deletedAt,undefined);assert.equal(importTemplateConfigs([source],{id:'new',name:'新链接'})[0].deletedAt,undefined);});
test('输出源绑定使用精确 ID，重复 ID 不按模糊名称猜测',()=>{const rows=sourceCatalog([{goodsId:'1',name:'A',tax:1},{goodsId:'1',name:'B',tax:2},{goodsId:'2',name:'C',tax:3}]);const configs=[{parts:[{goodsId:'1',name:'B'},{goodsId:'1',name:'未知名称'},{goodsId:'2',name:'自定义名称'}]}];bindSources(configs,rows);assert.equal(configs[0].parts[0].sourceId,rows[1].sourceId);assert.equal(configs[0].parts[1].sourceId,undefined);assert.equal(configs[0].parts[2].sourceId,rows[2].sourceId);});
test('输出源同步仅改指定字段，保留 ERP、数量、平台身份和手动加购',()=>{const rows=sourceCatalog([{goodsId:'47538',name:seed.configs[0].parts[0].name,erp:1400,tax:1400,upgrade:''}]);const c=structuredClone(seed.configs[0]);c.skuId='3682299409011548';c.addons=[{text:'手动加购',note:'保留'}];bindSources([c],rows);const row={...rows[0],name:'新显示名称',tax:1500,erp:9999,upgrade:'+199 升级',addonText:'+39 加购风扇',addonNote:'推荐 3 把'};assert.equal(sourceDiff([c],row,['name','tax','upgrade','addon']).length,1);syncSource([c],row,['name','tax','upgrade','addon']);assert.equal(c.parts[0].erp,1400);assert.equal(c.parts[0].qty,1);assert.equal(c.skuId,'3682299409011548');assert.equal(c.parts[0].name,row.name);assert.equal(c.parts[0].tax,1500);assert.equal(c.addons.length,2);assert.equal(c.addons[0].text,'手动加购');syncSource([c],row,['addon']);assert.equal(c.addons.length,2);syncSource([c],{...row,addonText:''},['addon']);assert.deepEqual(c.addons,[{text:'手动加购',note:'保留'}]);});
test('选择输出源配件带入资料；已删除配置不被同步',()=>{const c=structuredClone(seed.configs[0]),rows=sourceCatalog([{goodsId:'999',name:'新配件',erp:10,tax:11,warranty:'三年',upgrade:'可升级',addonText:'加购项'}]);replaceSourcePart(c,0,rows[0]);assert.equal(c.parts[0].goodsId,'999');assert.equal(c.parts[0].qty,1);assert.equal(c.addons.at(-1).text,'加购项');c.deletedAt='2026-09-14';assert.deepEqual(syncSource([c],{...rows[0],tax:22},['tax']),[]);assert.equal(c.parts[0].tax,11);});

test('输出源删除可恢复，阻止重新选用但保留已有配置快照',async()=>{const {setSourceDeleted,sourcePart}=await import('../source.js');const rows=[{sourceId:'source-test',goodsId:'123',name:'配件',tax:50,erp:60}];const old=structuredClone(rows[0]);setSourceDeleted(rows,'source-test',true,'2026-09-15');assert.equal(rows[0].deletedAt,'2026-09-15');assert.equal(old.deletedAt,undefined);assert.throws(()=>sourcePart(rows[0]),/已删除/);setSourceDeleted(rows,'source-test',false);assert.equal(sourcePart(rows[0]).name,'配件');assert.equal(rows[0].tax,50);});

test('型号换行保留英文规格词，并保留原有换行',async()=>{const {wrapText}=await import('../core.js');const ctx={measureText:text=>({width:text.length})};assert.deepEqual(wrapText(ctx,'小雕 DDR4',6),['小雕','DDR4']);assert.deepEqual(wrapText(ctx,'第一行\n第二行',12),['第一行','第二行']);assert.ok(wrapText(ctx,'接口 6500Mb/s',10).includes('6500Mb/s'));});
