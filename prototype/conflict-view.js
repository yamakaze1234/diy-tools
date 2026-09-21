const labels={name:'名称',priceCents:'售价',taxCents:'人工核算价',couponCents:'优惠券',parts:'配件',deletedAt:'记录状态',workspaceOrder:'排列顺序',qty:'数量',slot:'配件类别',goodsId:'商品编号',product:'所属商品',version:'版本名称',shortName:'简称',spu:'SPU',skuId:'SKU',productUrl:'商品链接',productCategory:'商品分类',shopId:'店铺',theme:'配色',layout:'排版',modules:'图片模块',addons:'加购项目',addonItems:'加购配件',benefits:'福利',warranty:'质保',upgrade:'升级说明',visible:'显示',showWarranty:'显示质保',showUpgrades:'显示升级',caseImage:'机箱图片',image:'图片',src:'图片',footer:'页脚',text:'内容',title:'标题',color:'文字颜色',background:'背景颜色',size:'字号',weight:'字重',gap:'间距',fontFamily:'字体',tax:'核算价',price:'售价',coupon:'优惠券',originalName:'原名称',brandText:'品牌',shop:'店铺',description:'说明',shortNameAuto:'自动简称',width:'宽度',height:'高度',x:'横向位置',y:'纵向位置',scale:'大小比例',rotation:'旋转角度'};
const internal=new Set(['id','lineId','sourceId','erpScopeId','updatedAt','createdAt']);
export const fieldLabel=key=>labels[key]||'其他设置';
export function displayValue(value,key,esc){
 if(key==='deletedAt')return value?'已删除':'保留此记录';
 if(value==null||value==='')return '未填写';
 if(/Cents$/.test(key))return '¥'+(Number(value)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
 if(typeof value==='boolean')return value?'是':'否';
 if(Array.isArray(value))return value.length?value.map((v,i)=>`<div class="conflict-item"><strong>${esc(v?.slot||v?.title||`第 ${i+1} 项`)}</strong>${displayValue(v,'item',esc)}</div>`).join(''):'无';
 if(typeof value==='object')return Object.entries(value).filter(([k])=>!internal.has(k)).map(([k,v])=>`<div class="conflict-property"><span>${esc(fieldLabel(k))}</span><div>${displayValue(v,k,esc)}</div></div>`).join('')||'无';
 if(['caseImage','image','src'].includes(key))return /^\/(?!\/)|^https?:\/\/|^data:image\/(png|jpeg|webp);base64,/.test(String(value))?`<img class="conflict-image" src="${esc(value)}" alt="图片预览">`:'已设置图片';
 const names={intel:'英特尔',gigabyte:'技嘉',jonsbo:'乔思伯',light:'浅色',dark:'深色',long:'长图'};
 return esc(names[value]||String(value));
}
export function conflictCards(records,esc){
 return records.map((r,i)=>{
  const local=r.draft||{},remote=r.conflict.remote?.data||{},base=r.conflict.base||{};
  const keys=[...new Set([...Object.keys(local),...Object.keys(remote)])].filter(k=>!internal.has(k)&&JSON.stringify(local[k])!==JSON.stringify(remote[k]));
  const rows=keys.map(k=>`<section class="conflict-field"><h4>${esc(fieldLabel(k))}</h4><div class="conflict-columns"><div><small>我的内容</small>${displayValue(local[k],k,esc)}</div><div><small>云端内容</small>${displayValue(remote[k],k,esc)}</div></div><details><summary>查看修改前的内容</summary>${displayValue(base[k],k,esc)}</details></section>`).join('');
  return `<section class="conflict-card"><h3>${esc(local.name||remote.name||'待处理记录')}</h3><p class="hint">两边修改了同一条记录。请比较后选择保留哪一整份内容，未选择前不会覆盖。</p>${rows||'<p>内容相同，可任选一份保留。</p>'}<div class="actions"><button data-conflict="${i}" data-choice="local">保留我的这份</button><button data-conflict="${i}" data-choice="remote">使用云端这份</button></div></section>`;
 }).join('');
}
