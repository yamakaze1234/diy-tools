import {componentStock} from './inventory-check-data.js';
import {isSpecialComponent} from './special-components.js';

export function componentStockView(part,costs){
 if(isSpecialComponent(part))return {status:'special',label:'特殊配件 · 不核算库存',detail:''};
 const stock=componentStock(part.goodsId,costs);
 const label=stock.value===null?'ERP 可销库存：未知':`ERP 可销库存：${stock.value.toLocaleString('zh-CN',{maximumFractionDigits:6})}${stock.status==='out'?' · 无库存':stock.status==='low'?' · 库存偏低':''}`;
 const time=stock.updatedAt?new Date(stock.updatedAt):null;
 const detail=stock.value===null?stock.reason:time&&!Number.isNaN(time.getTime())?'最近同步：'+time.toLocaleString('zh-CN'):'本机最近一次 ERP 库存快照';
 return {...stock,label,detail};
}
