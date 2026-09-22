import {selectedSourceAddons} from './addon-data.js';
import {makeZip} from './zip.js';
import {isSpecialComponent} from './special-components.js';

export const sourceExportHeaders=['goodsid（ERP ID）','ERP名称','展示名称','升级项'];
const xml=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function sourceExportRows(rows,costs,shopId){
 const erpNames=new Map(costs.filter(r=>r.goodsId).map(r=>[String(r.goodsId),r.name||r.erpName||'']));
 return rows.filter(r=>r.shopId===shopId&&!r.deletedAt).map(r=>{
  if(typeof r.goodsId==='number'&&!Number.isSafeInteger(r.goodsId))throw Error('ERP ID 已丢失数字精度，请重新绑定文本 ID 后导出');
  const id=isSpecialComponent(r)?'':String(r.goodsId??'');
  return [id,id?(erpNames.get(id)||r.erpName||r.originalName||''):'',String(r.name??''),selectedSourceAddons(r).map(a=>a.text).join('')];
 });
}
export function sourceExportWorkbook(rows){
 if(rows.length>1048575)throw Error('记录超过 Excel 单表行数上限');
 const data=[sourceExportHeaders,...rows];
 if(data.some(r=>r.length!==4||r.some(v=>String(v??'').length>32767)))throw Error('表格必须为四列，单格文字不可超过 32767 字');
 const sheetRows=data.map((row,i)=>`<row r="${i+1}"${i===0?' ht="26" customHeight="1"':''}>${row.map((value,j)=>`<c r="${'ABCD'[j]}${i+1}" s="${i===0?1:0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`).join('');
 const files={
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="输出源" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173E76"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D${data.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="32"/><cols><col min="1" max="1" width="25" customWidth="1"/><col min="2" max="2" width="45" customWidth="1"/><col min="3" max="3" width="60" customWidth="1"/><col min="4" max="4" width="70" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:D${data.length}"/></worksheet>`
 };
 const encoder=new TextEncoder(),archive=makeZip(Object.entries(files).map(([name,body])=>({name,bytes:encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+body)})));
 return new Blob([archive],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
