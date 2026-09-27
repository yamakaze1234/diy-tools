// Recheck the source rows after flushing earlier edits, before applying a preview.
export function validateBatchSources(plan,catalog){
 const byId=new Map(catalog.map(row=>[row.sourceId,row]));
 for(const chosen of [...(plan.replacements||[]),...(plan.replacement?[plan.replacement]:[])]){
  if(!chosen?.sourceId||JSON.stringify(byId.get(chosen.sourceId))!==JSON.stringify(chosen))
   throw Error('配件资料已变化，请重新预览');
 }
}
