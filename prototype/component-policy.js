// ERP asterisk markers exclude components from new selections, not saved configurations.
export const excludedComponent=row=>[row?.name,row?.originalName,row?.erpName].some(name=>/[＊*]/.test(String(name??'')));
export function selectableComponents(rows,costs=[]){const blocked=new Set(costs.filter(excludedComponent).map(r=>r.goodsId));return rows.filter(r=>!excludedComponent(r)&&!blocked.has(r.goodsId));}
