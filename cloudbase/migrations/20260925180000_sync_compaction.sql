-- Compact the replay journal only after a complete, immutable checkpoint exists.
-- Old clients fail closed with SNAPSHOT_REQUIRED; they must be upgraded to rebase.
CREATE TABLE public.wa_sync_checkpoints (
 workspace_id text PRIMARY KEY REFERENCES public.wa_workspaces(id),
 seq bigint NOT NULL CHECK(seq>=0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.wa_sync_checkpoint_records (
 workspace_id text NOT NULL REFERENCES public.wa_workspaces(id),
 entity_type text NOT NULL, entity_id text NOT NULL,
 version bigint NOT NULL, data jsonb NOT NULL,
 updated_by text NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,entity_type,entity_id)
);
CREATE TABLE public.wa_mutation_keys (
 workspace_id text NOT NULL REFERENCES public.wa_workspaces(id),
 mutation_id text NOT NULL, member_id text NOT NULL,
 request_hash text NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,mutation_id)
);
CREATE INDEX wa_changes_compact_age ON public.wa_changes(workspace_id,updated_at,seq);
CREATE INDEX wa_mutations_compact_age ON public.wa_mutations(created_at);
ALTER TABLE public.wa_sync_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_sync_checkpoint_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wa_mutation_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_sync_checkpoints,public.wa_sync_checkpoint_records,public.wa_mutation_keys FROM PUBLIC,anon,authenticated;

-- Preserve the existing protocol implementation. The wrapper adds checkpoint
-- discovery and expired-receipt protection without rewriting merge behavior.
ALTER FUNCTION public.wa_api(jsonb) RENAME TO wa_api_core;
REVOKE ALL ON FUNCTION public.wa_api_core(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.wa_api(request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 m public.wa_members%ROWTYPE; p jsonb; action text; cp bigint; head bigint;
 page_size int; rows jsonb; next_key jsonb; has_more boolean; old_key public.wa_mutation_keys%ROWTYPE;
BEGIN
 IF coalesce(auth.role(),'')<>'authenticated' OR coalesce(auth.uid(),'')='' OR coalesce(auth.jwt()->>'is_anonymous','false')='true' THEN
  RETURN jsonb_build_object('ok',false,'code','UNAUTHENTICATED','message','请使用成员账号登录');
 END IF;
 SELECT * INTO m FROM public.wa_members WHERE uid=auth.uid() AND active=true;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_MEMBER'); END IF;
 IF request->>'protocolVersion' IS DISTINCT FROM '2' THEN RETURN jsonb_build_object('ok',false,'code','UPGRADE_REQUIRED'); END IF;
 p:=coalesce(request->'payload','{}'::jsonb);action:=request->>'action';
 IF action='sync.push' THEN
  -- Serialize with receipt archival before checking the permanent tombstone.
  SELECT head_seq INTO head FROM public.wa_workspaces WHERE id=m.workspace_id FOR UPDATE;
  SELECT * INTO old_key FROM public.wa_mutation_keys WHERE workspace_id=m.workspace_id AND mutation_id=p->>'mutationId';
  IF FOUND THEN
   IF old_key.member_id<>m.member_id OR old_key.request_hash<>encode(sha256(convert_to(p::text,'UTF8')),'hex') THEN
    RETURN jsonb_build_object('ok',false,'code','MUTATION_REUSED','message','同一提交 ID 不能携带不同内容');
   END IF;
   RETURN jsonb_build_object('ok',false,'code','RECEIPT_EXPIRED','message','旧提交回执已归档；原请求未重复执行，请核对本地待同步内容');
  END IF;
 ELSIF action='sync.receipt' THEN
  SELECT head_seq INTO head FROM public.wa_workspaces WHERE id=m.workspace_id FOR SHARE;
  IF EXISTS(SELECT 1 FROM public.wa_mutation_keys WHERE workspace_id=m.workspace_id AND mutation_id=p->>'mutationId' AND member_id=m.member_id) THEN
   RETURN jsonb_build_object('ok',false,'code','RECEIPT_EXPIRED','message','旧提交回执已归档');
  END IF;
 ELSIF action='sync.bootstrap' THEN
  SELECT head_seq INTO head FROM public.wa_workspaces WHERE id=m.workspace_id;
  SELECT seq INTO cp FROM public.wa_sync_checkpoints WHERE workspace_id=m.workspace_id;
  RETURN jsonb_build_object('ok',true,'headSeq',head,'fromCursor',coalesce(cp,0),'protocolVersion',2,
   'strategy',CASE WHEN cp IS NULL THEN 'replay-retained-log' ELSE 'checkpoint-replay' END);
 ELSIF action='sync.pull' THEN
  SELECT head_seq INTO head FROM public.wa_workspaces WHERE id=m.workspace_id FOR SHARE;
  SELECT seq INTO cp FROM public.wa_sync_checkpoints WHERE workspace_id=m.workspace_id;
  IF cp IS NOT NULL AND coalesce((p->>'cursor')::bigint,0)<cp THEN
   RETURN jsonb_build_object('ok',false,'code','SNAPSHOT_REQUIRED','checkpointSeq',cp,'message','同步日志已归档，需要接收云端检查点');
  END IF;
 ELSIF action='sync.snapshot' THEN
  SELECT head_seq INTO head FROM public.wa_workspaces WHERE id=m.workspace_id FOR SHARE;
  SELECT seq INTO cp FROM public.wa_sync_checkpoints WHERE workspace_id=m.workspace_id;
  IF cp IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SNAPSHOT_UNAVAILABLE'); END IF;
  IF p?'checkpointSeq' AND (p->>'checkpointSeq')::bigint<>cp THEN
   RETURN jsonb_build_object('ok',false,'code','SNAPSHOT_CHANGED','message','检查点已更新，请从第一页重试');
  END IF;
  IF p?'cursor' AND p->'cursor'<>'null'::jsonb AND (jsonb_typeof(p->'cursor')<>'array' OR jsonb_array_length(p->'cursor')<>2) THEN
   RETURN jsonb_build_object('ok',false,'code','INVALID_CURSOR');
  END IF;
  page_size:=least(100,greatest(1,coalesce((p->>'limit')::int,100)));
  WITH candidates AS (
   SELECT r.*,sum(octet_length(r.data::text)) OVER(ORDER BY r.entity_type,r.entity_id) AS bytes,
    row_number() OVER(ORDER BY r.entity_type,r.entity_id) AS rn
   FROM (SELECT * FROM public.wa_sync_checkpoint_records
    WHERE workspace_id=m.workspace_id AND (NOT (p?'cursor') OR p->'cursor'='null'::jsonb OR (entity_type,entity_id)>(p->'cursor'->>0,p->'cursor'->>1))
    ORDER BY entity_type,entity_id LIMIT page_size) r
  ), bounded AS (
   SELECT * FROM candidates WHERE bytes<=450000 OR rn=1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('type',entity_type,'id',entity_id,'version',version,
   'data',data,'updatedBy',updated_by,'updatedAt',updated_at) ORDER BY entity_type,entity_id),'[]'::jsonb),
   (SELECT jsonb_build_array(entity_type,entity_id) FROM bounded ORDER BY entity_type DESC,entity_id DESC LIMIT 1)
  INTO rows,next_key FROM bounded;
  IF jsonb_array_length(rows)=0 THEN next_key:=p->'cursor'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.wa_sync_checkpoint_records
   WHERE workspace_id=m.workspace_id AND (next_key IS NULL OR (entity_type,entity_id)>(next_key->>0,next_key->>1))) INTO has_more;
  RETURN jsonb_build_object('ok',true,'checkpointSeq',cp,'records',rows,'nextCursor',next_key,'hasMore',has_more);
 END IF;
 RETURN public.wa_api_core(request);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('ok',false,'code','INVALID_CURSOR');
END $$;
REVOKE ALL ON FUNCTION public.wa_api(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wa_api(jsonb) TO authenticated;

CREATE FUNCTION public.wa_compact_sync() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w record; cp bigint; locked_head bigint; deleted_count int; created int:=0; removed_changes int:=0; removed_receipts int:=0;
BEGIN
 -- The workspace row is also the push lock, so the copied records and seq match.
 FOR w IN SELECT id FROM public.wa_workspaces ORDER BY id LOOP
  SELECT head_seq INTO locked_head FROM public.wa_workspaces WHERE id=w.id FOR UPDATE;
  SELECT seq INTO cp FROM public.wa_sync_checkpoints WHERE workspace_id=w.id;
  IF EXISTS(SELECT 1 FROM public.wa_changes WHERE workspace_id=w.id AND seq>coalesce(cp,0)
    AND updated_at<now()-interval '90 days') THEN
   DELETE FROM public.wa_sync_checkpoint_records WHERE workspace_id=w.id;
   INSERT INTO public.wa_sync_checkpoint_records
    SELECT workspace_id,entity_type,entity_id,version,data,updated_by,updated_at
    FROM public.wa_records WHERE workspace_id=w.id;
   INSERT INTO public.wa_sync_checkpoints(workspace_id,seq,created_at) VALUES(w.id,locked_head,now())
    ON CONFLICT(workspace_id) DO UPDATE SET seq=excluded.seq,created_at=excluded.created_at;
   cp:=locked_head;created:=created+1;
  END IF;
  IF cp IS NOT NULL THEN
   WITH doomed AS (SELECT ctid FROM public.wa_changes WHERE workspace_id=w.id AND seq<=cp
    AND updated_at<now()-interval '90 days' ORDER BY seq LIMIT 2000)
   DELETE FROM public.wa_changes WHERE ctid IN (SELECT ctid FROM doomed);
   GET DIAGNOSTICS deleted_count=ROW_COUNT;
   removed_changes:=removed_changes+deleted_count;
  END IF;
 END LOOP;
 -- Keep the UUID and request hash forever: an old retry must never write twice.
 WITH doomed AS (SELECT workspace_id,mutation_id,member_id,request,created_at
   FROM public.wa_mutations WHERE created_at<now()-interval '180 days'
   ORDER BY created_at LIMIT 2000 FOR UPDATE),
 archived AS (INSERT INTO public.wa_mutation_keys
   SELECT workspace_id,mutation_id,member_id,encode(sha256(convert_to(request::text,'UTF8')),'hex'),created_at FROM doomed
   ON CONFLICT DO NOTHING RETURNING workspace_id,mutation_id),
 deleted AS (DELETE FROM public.wa_mutations m USING archived a
   WHERE m.workspace_id=a.workspace_id AND m.mutation_id=a.mutation_id RETURNING 1)
 SELECT count(*) INTO removed_receipts FROM deleted;
 RETURN jsonb_build_object('checkpointsCreated',created,'changesDeleted',removed_changes,'receiptsDeleted',removed_receipts);
END $$;
REVOKE ALL ON FUNCTION public.wa_compact_sync() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('workbench-sync-compact-daily','20 19 * * *','SELECT public.wa_compact_sync()');
