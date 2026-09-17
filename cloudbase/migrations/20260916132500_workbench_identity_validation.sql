CREATE OR REPLACE FUNCTION public.wb_api(request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 m public.wb_members%ROWTYPE; rec public.wb_records%ROWTYPE; receipt public.wb_mutations%ROWTYPE;
 p jsonb; action text; base jsonb; desired jsonb; merged jsonb; conflicts jsonb:='[]';
 kind text; rid text; mid text; k text; v bigint; head bigint; cur bigint; stop_seq bigint; page_size int;
 rows jsonb; next_cur bigint; result jsonb; record_json jsonb; part jsonb;
BEGIN
 IF coalesce(auth.role(),'') <> 'authenticated' OR coalesce(auth.uid(),'')='' OR coalesce(auth.jwt()->>'is_anonymous','false')='true' THEN
   RETURN jsonb_build_object('ok',false,'code','UNAUTHENTICATED','message','请使用成员账号登录');
 END IF;
 SELECT * INTO m FROM public.wb_members WHERE uid=auth.uid() AND active=true;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_MEMBER','message','此账号尚未加入工作组'); END IF;
 IF request->>'protocolVersion' IS DISTINCT FROM '1' THEN RETURN jsonb_build_object('ok',false,'code','UPGRADE_REQUIRED','message','请升级客户端'); END IF;
 action:=request->>'action'; p:=coalesce(request->'payload','{}'::jsonb);
 IF action='session.get' THEN
   RETURN jsonb_build_object('ok',true,'workspaceId',m.workspace_id,'memberId',m.member_id,'uid',m.uid,'name',m.display_name,'protocolVersion',1);
 END IF;
 SELECT head_seq INTO head FROM public.wb_workspaces WHERE id=m.workspace_id;
 IF action='sync.bootstrap' THEN
   RETURN jsonb_build_object('ok',true,'headSeq',head,'fromCursor',0,'protocolVersion',1,'strategy','replay-retained-log');
 ELSIF action='sync.pull' THEN
   cur:=coalesce((p->>'cursor')::bigint,0); stop_seq:=coalesce((p->>'headSeq')::bigint,head);page_size:=least(100,greatest(1,coalesce((p->>'limit')::int,100)));
   IF cur<0 OR stop_seq<cur OR stop_seq>head THEN RETURN jsonb_build_object('ok',false,'code','INVALID_CURSOR','message','同步游标无效'); END IF;
   SELECT coalesce(jsonb_agg(x.row ORDER BY x.seq),'[]'),coalesce(max(x.seq),cur) INTO rows,next_cur FROM (
     SELECT seq,jsonb_build_object('seq',seq,'type',entity_type,'id',entity_id,'version',version,'data',data,'updatedBy',updated_by,'updatedAt',updated_at,'mutationId',mutation_id) AS row
     FROM public.wb_changes WHERE workspace_id=m.workspace_id AND seq>cur AND seq<=stop_seq ORDER BY seq LIMIT page_size
   ) x;
   RETURN jsonb_build_object('ok',true,'headSeq',stop_seq,'nextCursor',next_cur,'changes',rows,'hasMore',next_cur<stop_seq);
 ELSIF action='sync.receipt' THEN
   SELECT response INTO result FROM public.wb_mutations WHERE workspace_id=m.workspace_id AND mutation_id=p->>'mutationId' AND member_id=m.member_id;
   RETURN coalesce(result,jsonb_build_object('ok',false,'code','NOT_FOUND'));
 ELSIF action='records.history' THEN
   SELECT coalesce(jsonb_agg(x.row ORDER BY x.seq DESC),'[]') INTO rows FROM (
     SELECT seq,jsonb_build_object('seq',seq,'version',version,'data',data,'updatedBy',updated_by,'updatedAt',updated_at) AS row
     FROM public.wb_changes WHERE workspace_id=m.workspace_id AND entity_type=p->>'entityType' AND entity_id=p->>'entityId' ORDER BY seq DESC LIMIT 100
   ) x;
   RETURN jsonb_build_object('ok',true,'records',rows);
 ELSIF action<>'sync.push' THEN RETURN jsonb_build_object('ok',false,'code','UNKNOWN_ACTION'); END IF;
 kind:=p->>'entityType';rid:=p->>'entityId';mid:=p->>'mutationId';desired:=p->'after';v:=(p->>'baseVersion')::bigint;
 IF kind IS NULL OR kind NOT IN ('configuration','component') OR coalesce(length(rid),0) NOT BETWEEN 1 AND 200 OR coalesce(length(mid),0) NOT BETWEEN 16 AND 100 OR v IS NULL OR v<0
   OR desired IS NULL OR jsonb_typeof(desired)<>'object' OR octet_length(desired::text)>250000 THEN
   RETURN jsonb_build_object('ok',false,'code','INVALID_RECORD','message','记录格式无效');
 END IF;
 IF desired ?| ARRAY['__proto__','constructor','prototype'] THEN RETURN jsonb_build_object('ok',false,'code','INVALID_RECORD'); END IF;
 IF desired->>'deletedAt' IS NOT NULL THEN PERFORM (desired->>'deletedAt')::timestamptz; END IF;
 IF kind='component' THEN
   IF jsonb_typeof(desired->'goodsId') IS DISTINCT FROM 'string' OR coalesce(desired->>'goodsId','')!~'^[0-9]{1,20}$' OR coalesce(desired->>'erpScopeId','')='' OR rid IS DISTINCT FROM ((desired->>'erpScopeId')||'|'||(desired->>'goodsId')) OR NOT desired?'taxCents'
     OR (desired->'taxCents'<>'null'::jsonb AND (jsonb_typeof(desired->'taxCents')<>'number' OR (desired->>'taxCents')!~'^[0-9]+$' OR (desired->>'taxCents')::numeric>9007199254740991)) THEN
     RETURN jsonb_build_object('ok',false,'code','INVALID_RECORD','message','成本来源、ID 或金额无效');
   END IF;
 ELSE
   IF (desired?'skuId' AND jsonb_typeof(desired->'skuId')<>'string') OR (desired?'spu' AND jsonb_typeof(desired->'spu')<>'string') OR desired->>'id' IS DISTINCT FROM rid OR coalesce(desired->>'shopId','') NOT IN ('intel','gigabyte','jonsbo') OR jsonb_typeof(desired->'parts') IS DISTINCT FROM 'array'
     OR jsonb_typeof(desired->'priceCents') IS DISTINCT FROM 'number' OR coalesce(desired->>'priceCents','')!~'^[0-9]+$' OR (desired->>'priceCents')::numeric>9007199254740991 THEN
     RETURN jsonb_build_object('ok',false,'code','INVALID_RECORD','message','配置店铺、配件或售价无效');
   END IF;
   FOR part IN SELECT value FROM jsonb_array_elements(desired->'parts') LOOP
     IF coalesce(part->>'lineId','')='' OR jsonb_typeof(part->'goodsId') IS DISTINCT FROM 'string' OR coalesce(part->>'qty','')!~'^[1-9][0-9]*$' THEN RETURN jsonb_build_object('ok',false,'code','INVALID_RECORD','message','配件行格式无效'); END IF;
   END LOOP;
   IF (SELECT count(*) FROM jsonb_array_elements(desired->'parts'))<>(SELECT count(DISTINCT value->>'lineId') FROM jsonb_array_elements(desired->'parts')) THEN RETURN jsonb_build_object('ok',false,'code','INVALID_RECORD','message','配件行 ID 重复'); END IF;
 END IF;
 -- Serialise sequence allocation and receipt lookup: no duplicate effects or committed sequence gaps.
 SELECT head_seq INTO head FROM public.wb_workspaces WHERE id=m.workspace_id FOR UPDATE;
 SELECT * INTO receipt FROM public.wb_mutations WHERE workspace_id=m.workspace_id AND mutation_id=mid;
 IF FOUND THEN
   IF receipt.request IS DISTINCT FROM p OR receipt.member_id<>m.member_id THEN RETURN jsonb_build_object('ok',false,'code','MUTATION_REUSED','message','同一提交 ID 不能携带不同内容'); END IF;
   RETURN receipt.response;
 END IF;
 SELECT * INTO rec FROM public.wb_records WHERE workspace_id=m.workspace_id AND entity_type=kind AND entity_id=rid;
 IF rec.version IS NULL THEN
   IF v<>0 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_BASE'); END IF;
   merged:=desired;
 ELSE
   IF v=rec.version THEN base:=rec.data;
   ELSIF v=0 THEN base:=NULL;
   ELSE SELECT data INTO base FROM public.wb_changes WHERE workspace_id=m.workspace_id AND entity_type=kind AND entity_id=rid AND version=v;
     IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','INVALID_BASE','message','基础版本不存在'); END IF;
   END IF;
   IF desired IS NOT DISTINCT FROM base THEN merged:=rec.data;
   ELSIF rec.data IS NOT DISTINCT FROM base OR desired=rec.data THEN merged:=desired;
   ELSIF base IS NULL OR (desired->'deletedAt') IS DISTINCT FROM (base->'deletedAt') OR (rec.data->'deletedAt') IS DISTINCT FROM (base->'deletedAt') THEN conflicts:='["$record"]';
   ELSE
     merged:=rec.data;
     FOR k IN SELECT jsonb_object_keys(base || desired || rec.data) LOOP
       IF (desired->k) IS NOT DISTINCT FROM (base->k) THEN CONTINUE; END IF;
       IF (rec.data->k) IS NOT DISTINCT FROM (base->k) OR (desired->k) IS NOT DISTINCT FROM (rec.data->k) THEN
         IF desired?k THEN merged:=jsonb_set(merged,ARRAY[k],desired->k); ELSE merged:=merged-k; END IF;
       ELSE conflicts:=conflicts||jsonb_build_array(k); END IF;
     END LOOP;
   END IF;
 END IF;
 IF jsonb_array_length(conflicts)>0 THEN
   result:=jsonb_build_object('ok',false,'code','CONFLICT','fields',conflicts,'base',base,'local',desired,'remote',jsonb_build_object('type',kind,'id',rid,'version',rec.version,'data',rec.data,'updatedBy',rec.updated_by,'updatedAt',rec.updated_at));
 ELSE
   IF merged IS DISTINCT FROM rec.data THEN
     head:=head+1;v:=coalesce(rec.version,0)+1;
     INSERT INTO public.wb_records VALUES(m.workspace_id,kind,rid,v,merged,m.member_id,now()) ON CONFLICT(workspace_id,entity_type,entity_id) DO UPDATE SET version=excluded.version,data=excluded.data,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
     INSERT INTO public.wb_changes VALUES(m.workspace_id,head,kind,rid,v,merged,m.member_id,now(),mid);
     UPDATE public.wb_workspaces SET head_seq=head WHERE id=m.workspace_id;
   ELSE v:=rec.version; END IF;
   record_json:=jsonb_build_object('type',kind,'id',rid,'version',v,'data',merged);
   result:=jsonb_build_object('ok',true,'record',record_json,'headSeq',head,'mutationId',mid);
 END IF;
 INSERT INTO public.wb_mutations VALUES(m.workspace_id,mid,p,result,m.member_id,now());
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
 RETURN jsonb_build_object('ok',false,'code','INVALID_RECORD','message','数字或日期格式无效');
END;
$$;
REVOKE ALL ON FUNCTION public.wb_api(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wb_api(jsonb) TO authenticated;
