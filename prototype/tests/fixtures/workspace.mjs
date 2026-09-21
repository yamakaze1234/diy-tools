// Synthetic fixtures for public tests. Never read the workstation's seed/catalog.
// Costs deliberately total ERP 6520 and manual 6440, with quantity coverage.
const part = (slot, goodsId, name, qty, erp, tax = erp) =>
  ({slot, goodsId, name, qty, erp, tax, warranty:'', upgrade:''});
const parts = [
  part('CPU', '47538', '测试 CPU i5-14600KF', 1, 1400),
  part('散热', '10002', '测试散热', 1, 200),
  part('主板', '10003', '测试主板', 1, 1000),
  part('内存', '10004', '测试内存 16GB', 2, 400),
  part('硬盘', '10005', '测试硬盘 1TB', 1, 1000),
  part('显卡', '', '无卡', 1, 0),
  part('电源', '383029', '测试电源', 1, 600),
  part('机箱', '10008', '测试机箱', 1, 720, 640),
  part('风扇', '375660', '测试风扇', 8, 100),
];
export const seed = {
  revision:0, dataVersion:3,
  configs:[1,2,3].map(n => ({
    id:`synthetic-config-${n}`, shopId:'intel', product:'合成测试链接',
    spu:'3797170100491124774', skuId:'', name:`配置${n}`, version:'进阶版',
    price:6699, theme:'light', layout:'long', fontFamily:'Microsoft YaHei',
    parts:structuredClone(parts), addons:[], benefits:[], caseImage:'', footer:'合成测试',
  })),
  templates:[], sourceCatalog:[], costSource:[], caseGallery:[], logs:[],
};
// First row is deliberately not the CPU: partial ERP snapshots must mark it missing.
export const catalog = [parts.at(-1), ...parts.slice(0,-1)]
  .filter(p => p.goodsId)
  .map(p => ({...p, sourceId:`synthetic-source-${p.goodsId}`, shopId:'intel'}));
seed.sourceCatalog = structuredClone(catalog);

// Frozen contract expectation, independent of erpRow()/erpFormula().
const slots = ['CPU','散热','主板','内存','硬盘','显卡','电源','机箱','风扇','配件1','配件2','配件3','配件4','配件5'];
const contractParts = {CPU:['10001','1'], 内存:['10002','2'], 电源:['10003','1'], 风扇:['10004','8']};
export const legacyRow = slots.flatMap(slot => {
  const [id, qty] = contractParts[slot] || ['0','1'];
  return [id, `=IF([@[${slot}_id]]<>"",INDEX([主机成本表V2.xlsb]库存数据!$BD:$BD,MATCH([@[${slot}_id]],[主机成本表V2.xlsb]库存数据!$BB:$BB,0)),"")`, qty, ''];
});
