import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceExportRows,sourceExportHeaders,sourceExportWorkbook} from '../source-export.js';

test('输出源四列导出按店铺与在用状态筛选，ERP 名称只按精确 ID 取值',()=>{
 const rows=[{shopId:'intel',goodsId:'00123456789012345678',erpName:'缓存名',name:'展示名',upgrade:'旧升级文案',addonText:'升级一\n升级二'},{shopId:'intel',goodsId:'2',erpName:'ERP 缓存',name:'显示2'},{shopId:'intel',goodsId:'3',name:'已删除',deletedAt:'now'},{shopId:'gigabyte',goodsId:'4',name:'其他店'},{shopId:'intel',specialComponent:true,goodsId:'0',name:'不含显卡'}];
 const before=structuredClone(rows),values=sourceExportRows(rows,[{goodsId:'00123456789012345678',name:'真实 ERP 名称'}],'intel');
 assert.deepEqual(values,[['00123456789012345678','真实 ERP 名称','展示名','升级一\n升级二'],['2','ERP 缓存','显示2',''],['','','不含显卡','']]);assert.deepEqual(rows,before);assert.equal(sourceExportHeaders.length,4);
});
test('真正的 XLSX 内联文本单元格保留长 ID、换行及公式样式文案',async()=>{
 const blob=sourceExportWorkbook([['00123456789012345678','ERP & <名称>','=SUM(A1:A2)','第一行\n第二行']]);
 const bytes=new Uint8Array(await blob.arrayBuffer()),zip=new DataView(bytes.buffer);assert.equal(zip.getUint32(0,true),0x04034b50);
 const text=new TextDecoder().decode(bytes);assert.ok(text.includes('xl/worksheets/sheet1.xml'));assert.ok(text.includes('t="inlineStr"'));assert.ok(text.includes('00123456789012345678'));assert.ok(text.includes('ERP &amp; &lt;名称&gt;'));assert.ok(text.includes('第一行\n第二行'));assert.ok(!text.includes('<f>'));assert.ok(text.includes('state="frozen"'));assert.equal(blob.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
test('不能静默导出已失真的数字 ID 或超出 Excel 上限的内容',()=>{
 assert.throws(()=>sourceExportRows([{shopId:'intel',goodsId:12345678901234567890}],[],'intel'),/精度/);
 assert.throws(()=>sourceExportWorkbook([['id','ERP','显示','a'.repeat(32768)]]),/32767/);
});

 test('升级项使用本店已选加购，忽略旧升级字段和未勾选商品',()=>{
 const rows=[{shopId:'intel',goodsId:'1',name:'A',upgrade:'旧 +219',addonText:'旧缓存',addonChoices:[{id:'a',goodsId:'2',label:'升级新款',priceCents:24900,enabled:true},{id:'b',goodsId:'3',label:'不展示',priceCents:39900,enabled:false}]},{shopId:'intel',goodsId:'4',name:'B',upgrade:'过时文案',addonText:''}];
 assert.deepEqual(sourceExportRows(rows,[],'intel').map(r=>r[3]),['【+249元升级新款】','']);
 });
