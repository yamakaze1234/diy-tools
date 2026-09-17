import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryLinks, inventoryPlan, inventoryCsv} from '../inventory-export.js';

const part = (goodsId, name = '配件', extra = {}) => ({goodsId, name, slot: '内存', qty: 2, ...extra});
const config = (id, productId, parts, extra = {}) => ({id, productId, product: `链接${productId}`, name: `配置${id}`, shopId: 'intel', parts, ...extra});

test('merge by exact ID across all configurations of selected links, retaining hidden parts and source references', () => {
  const configs = [config('a', 'one', [part('123', '名称一'), part('123', '名称二', {posterVisible: false}), part('00123')]),
    config('b', 'one', [part('123'), part('456', '名称一')]), config('c', 'two', [part('123')]), config('d', 'other', [part('999')])];
  const before = structuredClone(configs), plan = inventoryPlan(configs, 'intel', ['one', 'two', 'one']);
  assert.deepEqual(plan.rows.map(r => r.goodsId), ['123', '00123', '456']);
  assert.equal(plan.rows[0].sources.length, 4);
  assert.equal(plan.merged, 3);
  assert.equal(plan.configCount, 3);
  assert.deepEqual(configs, before);
});

test('exclude other shops, deleted configurations, draft links and unselected links', () => {
  const configs = [config('a', 'one', [part('1')]), config('b', 'one', [part('2')], {shopId: 'jonsbo'}),
    config('c', 'one', [part('3')], {deletedAt: 'today'}), config('d', 'draft', [part('4')], {emptyLinkDraft: true})];
  assert.equal(inventoryLinks(configs, 'intel').length, 1);
  assert.deepEqual(inventoryPlan(configs, 'intel', ['one', 'draft']).rows.map(r => r.goodsId), ['1']);
  assert.equal(inventoryPlan(configs, 'intel', []).rows.length, 0);
});

test('missing and invalid IDs never fall back to names; long text IDs keep precision', () => {
  const plan = inventoryPlan([config('a', 'one', [part(''), part('0'), part('1e10'), part(9007199254740992),
    part('900719925474099312345'), part(' 25 '), part('', ''), part(26)])], 'intel', ['one']);
  assert.equal(plan.skipped.length, 4);
  assert.deepEqual(plan.rows.map(r => r.goodsId), ['900719925474099312345', '25', '26']);
  assert.match(plan.skipped[3].reason, /精度/);
});

test('CSV contract: BOM, monitor headers, integer threshold, quoting, formula protection', () => {
  const plan = inventoryPlan([config('a', 'one', [part('900719925474099312345', '名称,"测试"\n第二行'), part('2', '=危险公式')])], 'intel', ['one']);
  const csv = inventoryCsv(plan, 10);
  assert.ok(csv.startsWith('\uFEFF"goodsid","名称","预警值"'));
  assert.ok(csv.includes('"900719925474099312345","名称,""测试""\n第二行","10"'));
  assert.ok(csv.includes('"\'=危险公式"'));
  for (const value of ['', -1, 1.5, '1e2', 100000001]) assert.throws(() => inventoryCsv(plan, value), /预警值/);
  for (const value of [0, 10, 100000000]) assert.doesNotThrow(() => inventoryCsv(plan, value));
  assert.throws(() => inventoryCsv({rows: []}), /没有可导出/);
  assert.throws(() => inventoryCsv({rows: Array(5001).fill(plan.rows[0])}), /5000/);
});
