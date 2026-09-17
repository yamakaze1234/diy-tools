import test from 'node:test';
import assert from 'node:assert/strict';
import {displayUpgrade,memoryUpgradeKey} from '../memory-upgrade.js';
test('两条内存默认屏蔽双条升级，手动选择按配件与文案确认，其他数量不受影响',()=>{
 const p={slot:'内存',qty:2,goodsId:'1',upgrade:'【+399元 升级8G*2 共16G内存】'};
 assert.equal(displayUpgrade(p),'');p.memoryUpgradeConfirmed=memoryUpgradeKey(p);assert.equal(displayUpgrade(p),p.upgrade);
 assert.equal(displayUpgrade({...p,goodsId:'2'}),'');assert.equal(displayUpgrade({...p,qty:1}),p.upgrade);
 assert.equal(displayUpgrade({...p,upgrade:'升级16G*20'}),'升级16G*20');assert.equal(displayUpgrade({...p,upgrade:'升级16G×2'}),'');
 assert.equal(displayUpgrade({...p,slot:'风扇'}),p.upgrade);
});
