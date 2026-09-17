import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudSchedule,AUTO_SYNC_INTERVAL_MS as interval} from '../cloud-schedule.mjs';

function harness(dueAt){
 let time=1000,timer;const calls=[],deadlines=[];
 const scheduler=createCloudSchedule({dueAt,run:manual=>calls.push({manual:!!manual,time}),now:()=>time,setTimer:(fn,ms)=>(timer={fn,at:time+ms}),clearTimer:()=>{timer=null;},onDeadline:x=>deadlines.push(x)});
 const tick=ms=>{const end=time+ms;while(timer&&timer.at<=end){time=timer.at;const fn=timer.fn;timer=null;fn();}time=end;};
 return{scheduler,tick,calls,deadlines};
}
test('two-hour auto sync has no per-edit debounce or short polling',()=>{const h=harness();assert.equal(interval,7200000);h.tick(interval-1);assert.deepEqual(h.calls,[]);h.tick(1);assert.equal(h.calls.length,1);assert.equal(h.calls[0].manual,false);h.tick(interval);assert.equal(h.calls.length,2);h.scheduler.close();h.tick(interval);assert.equal(h.calls.length,2);});
test('manual sync runs immediately and resets the next automatic deadline',()=>{const h=harness();h.tick(10000);h.scheduler.manual();assert.equal(h.calls.length,1);assert.equal(h.calls[0].manual,true);h.tick(interval-1);assert.equal(h.calls.length,1);h.tick(1);assert.equal(h.calls.length,2);});
test('saved deadline survives restart and overdue work starts once',()=>{const h=harness(1500);h.tick(499);assert.equal(h.calls.length,0);h.tick(1);assert.equal(h.calls.length,1);const expired=harness(500);expired.tick(0);assert.equal(expired.calls.length,1);assert.equal(expired.scheduler.next(),1000+interval);});
test('logged-out or paused time does not consume an overdue sync',()=>{let allowed=false,callback,runs=0;const schedule=createCloudSchedule({dueAt:500,now:()=>1000,canRun:()=>allowed,run:()=>runs++,setTimer:fn=>(callback=fn),clearTimer:()=>{}});callback();assert.equal(runs,0);assert.equal(schedule.next(),500);allowed=true;schedule.checkDue();assert.equal(runs,1);assert.equal(schedule.next(),1000+interval);schedule.close();});
