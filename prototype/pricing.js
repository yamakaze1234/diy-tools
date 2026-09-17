// Prices are copied as plain numeric columns in the same configuration order.
export function pricing(config,settings={}){
 const arrival=Number(config.price),coupon=Number(settings.coupon??0),term=Number(config.installment??0);
 if(!Number.isFinite(arrival)||arrival<0||!Number.isFinite(coupon)||coupon<0)throw Error(`${config.name||'配置'} 的到手价或优惠券无效`);
 if(![0,12,24].includes(term))throw Error('请选择不分期、12 期或 24 期');
 const rate=term===12?.06:term===24?.1:0;
 return{arrival,coupon,listPrice:(Math.round(arrival*100)+Math.round(coupon*100))/100,term,rate,fee:Math.round(arrival*100*rate)/100};
}
export function pricingColumn(configs,settings){if(!configs.length)throw Error('请先勾选配置');return configs.map(c=>pricing(c,settings).listPrice.toFixed(2)).join('\r\n');}
export const sessionDeleted=(configs,sessionId)=>configs.filter(c=>c.deletedAt&&c.deletionSessionId===sessionId);
