export const doubleMemoryUpgrade=p=>p?.slot==='内存'&&Number(p.qty)===2&&/[＊*×]\s*2(?!\d)/.test(p.upgrade||'');
export const memoryUpgradeKey=p=>JSON.stringify([p.sourceId||'',p.goodsId||'',p.upgrade||'']);
export const displayUpgrade=p=>doubleMemoryUpgrade(p)&&p.memoryUpgradeConfirmed!==memoryUpgradeKey(p)?'':p.upgrade||'';
