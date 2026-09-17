export const AUTO_SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000;

// Local edits do not call this scheduler. A manual run resets the two-hour clock.
export function createCloudSchedule({run, dueAt, canRun=()=>true, onDeadline=()=>{}, now=Date.now, setTimer=setTimeout, clearTimer=clearTimeout}) {
 let timer, closed=false, next=Number(dueAt)||now()+AUTO_SYNC_INTERVAL_MS;
 const checkDue=()=>{if(!closed&&now()>=next&&canRun()){advance();Promise.resolve(run()).catch(()=>{});return true;}return false;};
 const arm=(delay=Math.max(0,next-now()))=>{clearTimer(timer);if(!closed){timer=setTimer(()=>{if(!checkDue())arm(60000);},delay);timer?.unref?.();}};
 const advance=()=>{next=now()+AUTO_SYNC_INTERVAL_MS;onDeadline(next);arm();};
 onDeadline(next);arm();
 return {next:()=>next,checkDue,manual(){advance();return run(true);},close(){closed=true;clearTimer(timer);}};
}
