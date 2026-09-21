import {actualParts} from '../prototype/actual-parts.js';

const keySlots=['CPU','显卡','内存','硬盘'];
const normalizedSlot=value=>String(value||'').trim().toUpperCase();
function compactPart(part,slot){
 const name=String(part.name||'').trim();
 if(!name)return `${slot}待选`;
 let label=name;
 if(slot==='CPU'){
  const match=name.match(/(?:Ultra\s*[3579]\s*)?(\d{3}K(?:F)?(?:\s*PLUS)?|\d{4,5}(?:X3D|KF|KS|XT|X|F|K|G|T)?)(?![\dA-Z])/i);
  if(match)label=match[1].toUpperCase().replace(/\s+/g,' ');
 }else if(slot==='显卡'){
  if(/不含显卡|无独显|无显卡|^无卡$/.test(name))label='无独显';
  else{
   const match=name.match(/(?:RTX|GTX|RX)\s*\d{3,4}(?:\s*(?:Ti\s*SUPER|Ti|SUPER|XTX|XT|GRE|D(?:\s*V2)?))?|ARC\s*[AB]\d{3}/i);
   if(match){label=match[0].toUpperCase().replace(/\s+/g,' ').replace(/TI/g,'Ti');const vram=name.match(/\b(\d{1,2})\s*G(?:B)?\b/i);if(vram)label+=' '+vram[1]+'GB';}
  }
 }else{
  const capacity=name.normalize('NFKC').match(/(\d+(?:\.\d+)?)\s*(TB|GB|T|G)(?![A-Z])/i);
  if(capacity)label=capacity[1]+(capacity[2].toUpperCase().startsWith('T')?'TB':'GB');
 }
 // Quantity is explicit rather than guessing whether a named kit is one unit.
 if(part.qty!==undefined&&part.qty!==1)label+=' ×'+part.qty;
 return label;
}
export function configurationSummary(config){
 const parts=actualParts(config);
 return keySlots.map(slot=>{
  const rows=parts.filter(p=>normalizedSlot(p.slot)===normalizedSlot(slot));
  return {slot,text:rows.length?rows.map(p=>compactPart(p,slot)).join(' / '):`${slot}待选`,detail:rows.length?rows.map(p=>`${p.name||'待选'} ×${p.qty??'待填'}`).join(' / '):`${slot}待选`};
 });
}
