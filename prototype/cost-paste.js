export function parseCostPrice(value){
 const text=String(value).trim();
 if(!/^\d+(\.\d{1,2})?$/.test(text)||!Number.isFinite(Number(text)))throw Error('核算单价须为非负金额，最多两位小数');
 return Number(text);
}

export function parseCostPaste(text,rows,selectedIds=[]){
 const lines=String(text).replace(/^\uFEFF/,'').replace(/\r/g,'').replace(/\n$/,'').split('\n');
 if(lines.length>100000)throw Error('一次最多粘贴 100,000 行，请分批处理');
 const lookup=new Map(rows.map(r=>[r.goodsId,r])),selected=new Set(selectedIds);
 const result={entries:[],headers:0,blank:0,duplicates:0,unmatched:[],valueErrors:[],erpFallbacks:[],unavailableErp:[]};
 const seen=new Map();
 const idHeader=s=>/^(goods_?id|商品id|配件id|erp\s*id)$/i.test(s);
 const priceHeader=s=>/^(含税成本|含税单价|含税核算单价|核算价格|核算价|实际核算价格)$/.test(s);
 const twoColumns=lines.some(line=>line.includes('\t'))||idHeader(lines.find(l=>l.trim())?.trim()||'');
 const add=(id,value,line)=>{
  if(!value.trim()){result.blank++;return;}
  const fallback=value.trim().toUpperCase()==='#VALUE!';
  let tax;
  if(fallback){
   result.valueErrors.push({goodsId:id,line});
   const row=lookup.get(id);
   if(!row){result.unmatched.push({goodsId:id,line});return;}
   if(!Number.isFinite(row.erp)||row.erp<0||row.erpUnknown||row.erpMissing){result.unavailableErp.push({goodsId:id,line});return;}
   tax=row.erp;
  }else{try{tax=parseCostPrice(value);}catch(e){throw Error(`第 ${line} 行（${id}）：${e.message}`);}}
  if(seen.has(id)){if(seen.get(id)!==tax)throw Error(`第 ${line} 行：goods_id ${id} 重复且价格不一致，请先核对`);result.duplicates++;return;}
  seen.set(id,tax);
  if(!lookup.has(id)){result.unmatched.push({goodsId:id,line});return;}
  if(fallback)result.erpFallbacks.push({goodsId:id,line});
  result.entries.push({goodsId:id,tax});
 };
 if(twoColumns){
  lines.forEach((line,i)=>{
   if(!line.trim()){result.blank++;return;}
   const cells=line.split('\t').map(c=>c.trim());
   if(idHeader(cells[0])&&cells.slice(1).every(c=>!c||priceHeader(c))){result.headers++;return;}
   if(cells.length!==2||!/^\d{1,20}$/.test(cells[0]))throw Error(`第 ${i+1} 行：请粘贴 goods_id 和含税单价两列（从表格直接复制）`);
   add(cells[0],cells[1],i+1);
  });
 }else{
  const ordered=rows.filter(r=>selected.has(r.goodsId));
  let start=0;if(priceHeader(lines[0]?.trim())){start=1;result.headers++;}
  if(!ordered.length||ordered.length!==lines.length-start)throw Error(`单列价格有 ${lines.length-start} 行，已选 ${ordered.length} 条；请先勾选相同行数的商品`);
  ordered.forEach((r,i)=>add(r.goodsId,lines[i+start],i+start+1));
 }
 if(!result.entries.length)throw Error(`没有可保存的价格：${result.headers} 行表头、${result.blank} 行空值保留，${result.unmatched.length} 个 ID 未匹配；${result.unavailableErp.length} 行 #VALUE! 因 ERP 成本不可用而保留原价${result.unavailableErp.length?'：'+result.unavailableErp.slice(0,10).map(r=>r.goodsId).join('、'):''}`);
 return result;
}
