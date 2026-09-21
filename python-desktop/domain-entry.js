// Pure business rules shared with the existing UI. No filesystem/network/Node runtime.
export {normalizeWorkspaceState} from '../prototype/shops.js';
export {projectWorkspace,applyWorkspace,changesBetween,migrationSummary,hash} from '../prototype/workspace-records.mjs';
export {stripLocalErp,keepCloudType} from '../prototype/local-erp-policy.mjs';
export {mergeRecord,equal} from '../shared/sync/protocol.mjs';
export {validateWorkspaceRecord} from '../prototype/workspace-validation.mjs';
export {recentActivity,activityEntry} from '../prototype/activity.js';
export {sqlStockPlan} from '../prototype/sql-sync.mjs';
export {validateGallery} from '../prototype/case-gallery-data.js';
export {validateAddon,sourceAddon} from '../prototype/addon-data.js';
export {validateSnapshot,mergeErp} from '../prototype/erp-sync.js';
import {ErpJobs,browserErpScope} from '../prototype/erp-sync.js';
let scope=null;const jobs=new ErpJobs(()=>scope);
export function erpJob(action,data,info){scope=browserErpScope(info);if(action==='complete'){Object.assign(jobs.job,{status:'complete',completedAt:data.updatedAt,result:data});return {ok:true};}if(action==='operator'){jobs.job.operator=data;return {ok:true};}return jobs[action](data);}

export {mergeEditingState} from '../prototype/workspace-ui-merge.js';

export {initializeActualParts} from '../prototype/actual-parts.js';
export {parseStandardProduct,standardProducts} from '../prototype/product-standard.js';
