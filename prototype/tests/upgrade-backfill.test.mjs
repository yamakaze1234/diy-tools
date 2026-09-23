import test from 'node:test';
import assert from 'node:assert/strict';
import {backfillMissingSourceUpgrades} from '../upgrade-backfill.js';

test('只补同店同 goods ID 的空说明，保留 620 链接手写文案和其他店数据',()=>{
 const rows=[{sourceId:'text',shopId:'intel',goodsId:'101',addonText:'文字说明',addonChoices:[{id:'t',label:'文字说明',goodsId:'',enabled:true}]}];
 const configs=[{id:'empty',shopId:'intel',parts:[{slot:'CPU',sourceId:'text',goodsId:'101',upgrade:''}]},{id:'manual',shopId:'intel',parts:[{slot:'CPU',sourceId:'text',goodsId:'101',upgrade:'620 手工说明'}]},{id:'wrong',shopId:'intel',parts:[{slot:'CPU',sourceId:'text',goodsId:'999',upgrade:''}]},{id:'other',shopId:'jonsbo',parts:[{slot:'CPU',sourceId:'text',goodsId:'101',upgrade:''}]}];
 assert.deepEqual(backfillMissingSourceUpgrades(configs,rows),[{configId:'empty',slot:'CPU',sourceId:'text'}]);
 assert.equal(configs[0].parts[0].upgrade,'文字说明');assert.equal(configs[1].parts[0].upgrade,'620 手工说明');assert.equal(configs[2].parts[0].upgrade,'');assert.equal(configs[3].parts[0].upgrade,'');
 assert.deepEqual(backfillMissingSourceUpgrades(configs,rows),[]);
});
