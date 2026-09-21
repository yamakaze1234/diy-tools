-- Bound history responses like synchronization pages.
CREATE OR REPLACE FUNCTION public.wa_commit_history(request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.wa_members%ROWTYPE; before_seq bigint; rows jsonb; next_seq bigint; total int;
BEGIN
 IF coalesce(auth.role(),'')<>'authenticated' OR coalesce(auth.uid(),'')='' OR coalesce(auth.jwt()->>'is_anonymous','false')='true' THEN
 RETURN jsonb_build_object('ok',false,'code','UNAUTHENTICATED'); END IF;
 SELECT * INTO m FROM public.wa_members WHERE uid=auth.uid() AND active;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_MEMBER'); END IF;
 before_seq:=coalesce((request->'payload'->>'before')::bigint,9223372036854775807);
 IF before_seq<1 THEN RETURN jsonb_build_object('ok',false,'code','INVALID_CURSOR'); END IF;
 SELECT coalesce(jsonb_agg(x.item ORDER BY x.seq DESC),'[]'),min(x.seq),count(*) INTO rows,next_seq,total FROM (
 SELECT c.seq,jsonb_build_object('seq',c.seq,'version',c.version,'data',c.data,'id',c.mutation_id,
 'type',c.entity_type,'entityId',c.entity_id,'at',c.updated_at,'actorId',c.updated_by) AS item
 FROM (SELECT candidate.*,sum(octet_length(data::text)) OVER(ORDER BY seq DESC) AS bytes,row_number() OVER(ORDER BY seq DESC) AS rn FROM (SELECT c.* FROM public.wa_commit_history_index h JOIN public.wa_changes c USING(workspace_id,seq) WHERE h.workspace_id=m.workspace_id AND h.seq<before_seq AND h.at>=now()-interval '30 days' ORDER BY c.seq DESC LIMIT 50) candidate) c WHERE bytes<=450000 OR rn=1) x;
 RETURN jsonb_build_object('ok',true,'records',rows,'nextBefore',CASE WHEN EXISTS(SELECT 1 FROM public.wa_commit_history_index WHERE workspace_id=m.workspace_id AND seq<next_seq AND at>=now()-interval '30 days') THEN next_seq ELSE NULL END,'retentionDays',30);
END $$;
