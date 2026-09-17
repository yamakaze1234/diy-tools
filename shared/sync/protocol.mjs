// Protocol v1: absent, null and a tombstone are distinct values.
export const PROTOCOL_VERSION = 1;
export const clone = value => value === undefined ? undefined : structuredClone(value);
export function canonical(value) {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const equal = (a, b) => canonical(a) === canonical(b);
export const recordKey = (type, id) => JSON.stringify([type, id]);
export function mergeRecord(base, local, remote) {
  if (equal(local, base)) return {value: clone(remote), fields: []};
  if (equal(remote, base) || equal(local, remote)) return {value: clone(local), fields: []};
  if (!base || !local || !remote || local.deletedAt !== base.deletedAt || remote.deletedAt !== base.deletedAt) {
    return {value: clone(local), fields: ['$record']};
  }
  const value = clone(remote), fields = [];
  // Arrays (notably parts) are atomic: replacing a part cannot combine with a concurrent quantity change.
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    if (equal(local[key], base[key])) continue;
    if (equal(remote[key], base[key]) || equal(local[key], remote[key])) {
      if (Object.hasOwn(local, key)) value[key] = clone(local[key]); else delete value[key];
    } else { fields.push(key); if (Object.hasOwn(local, key)) value[key] = clone(local[key]); else delete value[key]; }
  }
  return {value, fields};
}
export function validateRecord(type, id, data) {
  if (!['configuration', 'component'].includes(type) || typeof id !== 'string' || !id || id.length > 200) throw Error('记录类型或 ID 无效');
  if (!data || Array.isArray(data) || typeof data !== 'object' || JSON.stringify(data).length > 250000) throw Error('记录格式无效');
  if (Object.keys(data).some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw Error('字段名无效');
  if (data.deletedAt != null && !Number.isFinite(Date.parse(data.deletedAt))) throw Error('删除时间无效');
  if (type === 'component') {
    if (typeof data.goodsId !== 'string' || !/^\d{1,20}$/.test(data.goodsId) || !data.erpScopeId) throw Error('成本必须绑定真实 ERP ID 和来源');
    if(id !== `${data.erpScopeId}|${data.goodsId}`)throw Error('成本 ID 必须由 ERP 来源与真实商品 ID 确定');
    if (data.taxCents !== null && (!Number.isSafeInteger(data.taxCents) || data.taxCents < 0)) throw Error('含税价必须是非负整数分或空值');
  } else {
    for(const key of ['spu','skuId'])if(data[key]!==undefined&&typeof data[key]!=='string')throw Error('长 ID 必须是字符串');
    if (data.id !== id || !['intel','gigabyte','jonsbo'].includes(data.shopId) || !Array.isArray(data.parts)) throw Error('配置店铺或配件格式无效');
    if (!Number.isSafeInteger(data.priceCents) || data.priceCents < 0) throw Error('售价必须是非负整数分');
    const ids = new Set();
    for (const part of data.parts) {
      if (typeof part.lineId !== 'string' || !part.lineId || ids.has(part.lineId) || typeof part.goodsId !== 'string' || !Number.isSafeInteger(part.qty) || part.qty < 1) throw Error('配件行 ID、商品 ID 或数量无效');
      ids.add(part.lineId);
    }
  }
  return data;
}
