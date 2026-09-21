import {shops} from './shops.js';
import {shopAddonRows} from './shop-addon-data.js';
import {sourceAddon,sourceAddonFields,validateAddon,sourceAddonOptions,addonItems,choiceDescription} from './addon-data.js';
import {addonStatusHtml} from './addon-ui.js';
import {mountAddonChoices} from './addon-choices-ui.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function initialChoices(row){
 if(row.addonChoices!==undefined)return structuredClone(row.addonChoices);
 return sourceAddonOptions(row).filter(a=>addonItems(a).length===1).map((a,i)=>{const item=addonItems(a)[0];return {id:a.variantId||'legacy-'+row.sourceId+'-'+i,goodsId:item.goodsId,qty:item.qty,priceCents:a.priceCents??null,label:(a.text||'').replace(/^[【\[]?[+＋]\s*\d+(?:\.\d{1,2})?\s*元/,'').replace(/[】\]]$/,''),enabled:a.showTogether!==false,...(a.originalQty!==undefined?{originalQty:a.originalQty}:{})};});
}
export function mountShopAddons(root,{original,getRows,getCosts,getOriginal,onChange=()=>{}}){
 const entries=shopAddonRows(getRows(),original,shops),base=sourceAddon(original),$=s=>root.querySelector(s);
 let ready=false,commonEditor;const editors=new Map(),localTouched=new Set(),legacyTexts=new Map(entries.filter(e=>e.row).map(e=>[e.shop.id,e.row.addonText||'']));
 root.innerHTML=`<div class="shop-addon-actions"><button type="button" data-shop-addon-only>只修改当前店铺</button><button type="button" data-shop-addon-all>选择三店</button><span class="hint" data-shop-addon-scope></span></div><div class="shop-addon-common"><h5>共同信息 · 多个加购商品</h5><div data-common-choices></div><label class="field">加购说明<input data-common-note value="${esc(base.note)}"></label><label><input type="checkbox" data-apply-choices> 将以上商品、各自加购价和展示文案应用到勾选店铺</label><p class="hint">默认勾选有对应配件的三家店。修改上方商品后自动应用到勾选店铺；可取消勾选或点击“只修改当前店铺”。旧文案不会自动匹配商品 ID，请按真实商品选择。</p></div><div class="shop-addon-grid">${entries.map(({shop,row,reason})=>`<section class="shop-addon-card" data-addon-shop="${shop.id}"><label class="shop-addon-heading"><input type="checkbox" data-shop-enabled ${row?'':'disabled'} ${row?'checked':''}><strong>${esc(shop.shortName)}</strong></label>${row?`<fieldset><label class="field">加购描述（同一条展示）<textarea data-shop-text rows="3">${esc(row.addonText)}</textarea></label><div data-legacy-price><label class="field">原单商品加购价<input data-shop-price type="number" min="0" step=".01" value="${row.addonPriceCents==null?'':(row.addonPriceCents/100).toFixed(2)}"></label></div><details data-shop-edit><summary>单独调整本店加购商品与价格</summary><div data-local-choices></div></details></fieldset><div data-shop-check></div>`:`<p class="hint">${esc(reason)}</p>`}</section>`).join('')}</div><p class="hint">每个加购商品分别检查：原配件成本 × 替换数量 ＋ 此商品加购价 − 此商品成本 × 数量。不会把多个升级商品的成本或加购价相加。</p>`;
 const card=id=>$(`[data-addon-shop="${id}"]`),enabled=id=>card(id).querySelector('[data-shop-enabled]').checked;
 const changed=()=>{if(!ready)return;$('[data-apply-choices]').checked=true;refresh();};
 commonEditor=mountAddonChoices($('[data-common-choices]'),{initial:initialChoices(original),getCosts,sourceId:original.sourceId,onChange:changed,renderCheck:a=>addonStatusHtml(a,getCosts(),[getOriginal()])});
 for(const e of entries.filter(e=>e.row))editors.set(e.shop.id,mountAddonChoices(card(e.shop.id).querySelector('[data-local-choices]'),{initial:initialChoices(e.row),getCosts,sourceId:e.row.sourceId,onChange:()=>{if(!ready)return;localTouched.add(e.shop.id);refresh();},renderCheck:a=>addonStatusHtml(a,getCosts(),[e.shop.id===original.shopId?getOriginal():e.row])}));
 function readEntry(e,required=false){const a=sourceAddon(e.row),node=card(e.shop.id);if(!enabled(e.shop.id))return a;
  const common=$('[data-apply-choices]').checked,multi=common||localTouched.has(e.shop.id)||a.choices!==undefined;
  if(multi){const choices=(common?commonEditor:editors.get(e.shop.id)).read(required);const value={...a,choices,text:choiceDescription(choices),...(common?{note:$('[data-common-note]').value.trim()}:{})};return required?validateAddon(value,{required:true,costs:getCosts()}):value;}
  const raw=node.querySelector('[data-shop-price]').value;if(raw!==''&&!/^\d+(\.\d{1,2})?$/.test(raw))throw Error('加购价最多两位小数');const value={...a,text:legacyTexts.get(e.shop.id).trim(),priceCents:raw===''?null:Math.round(Number(raw)*100)};return validateAddon(value,{required:required&&!!value.text.trim(),costs:getCosts()});
 }
 function refresh(){for(const e of entries.filter(e=>e.row)){const node=card(e.shop.id),selected=enabled(e.shop.id),common=$('[data-apply-choices]').checked,multi=common||localTouched.has(e.shop.id)||e.row.addonChoices!==undefined;node.classList.toggle('is-selected',selected);node.querySelector('fieldset').disabled=!selected;node.querySelector('[data-shop-edit]').inert=common;node.querySelector('[data-legacy-price]').hidden=multi;node.querySelector('[data-shop-text]').readOnly=multi;
  try{const a=readEntry(e);node.querySelector('[data-shop-text]').value=multi?a.text:legacyTexts.get(e.shop.id);node.querySelector('[data-shop-check]').innerHTML=addonStatusHtml(a,getCosts(),[e.shop.id===original.shopId?getOriginal():e.row]);}catch(error){node.querySelector('[data-shop-check]').textContent=error.message;}
 }$('[data-shop-addon-scope]').textContent='本次修改：'+entries.filter(e=>e.row&&enabled(e.shop.id)).map(e=>e.shop.shortName).join('、');onChange();}
 $('[data-common-note]').oninput=changed;$('[data-apply-choices]').onchange=refresh;
 for(const input of root.querySelectorAll('[data-shop-enabled],[data-shop-text],[data-shop-price]'))input.addEventListener('input',()=>{if(input.hasAttribute('data-shop-text'))legacyTexts.set(input.closest('[data-addon-shop]').dataset.addonShop,input.value);refresh();});
 $('[data-shop-addon-only]').onclick=()=>{for(const e of entries)card(e.shop.id).querySelector('[data-shop-enabled]').checked=!!e.row&&e.shop.id===original.shopId;refresh();};
 $('[data-shop-addon-all]').onclick=()=>{for(const e of entries)card(e.shop.id).querySelector('[data-shop-enabled]').checked=!!e.row;refresh();};
 function changes(required=true){return entries.filter(e=>e.row&&enabled(e.shop.id)).flatMap(e=>{const addon=readEntry(e,required),before=sourceAddonFields(sourceAddon(e.row));return JSON.stringify(before)===JSON.stringify(sourceAddonFields(addon))?[]:[{sourceId:e.row.sourceId,shopId:e.shop.id,before,addon}];});}
 ready=true;refresh();return {read:(required=true)=>readEntry(entries.find(e=>e.shop.id===original.shopId),required),changes,refresh,isDirty:()=>{try{return changes(false).length>0;}catch{return true;}}};
}
