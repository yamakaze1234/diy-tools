-- Retain user-facing commit history for 30 days. The sync journal and
-- idempotent receipts remain untouched: offline clients still replay them.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE TABLE public.wa_commit_history_index (
 workspace_id text NOT NULL REFERENCES public.wa_workspaces(id),
 seq bigint NOT NULL, at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,seq)
);
CREATE INDEX wa_commit_history_age ON public.wa_commit_history_index(at);
ALTER TABLE public.wa_commit_history_index ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_commit_history_index FROM PUBLIC,anon,authenticated;
INSERT INTO public.wa_commit_history_index
 SELECT workspace_id,seq,updated_at FROM public.wa_changes
 WHERE updated_at>=now()-interval '30 days' AND entity_type NOT IN ('erp_chunk','erp_snapshot');
CREATE FUNCTION public.wa_index_commit_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.entity_type NOT IN ('erp_chunk','erp_snapshot') THEN
 INSERT INTO public.wa_commit_history_index VALUES(NEW.workspace_id,NEW.seq,NEW.updated_at);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wa_index_commit_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER wa_commit_history_insert AFTER INSERT ON public.wa_changes
 FOR EACH ROW EXECUTE FUNCTION public.wa_index_commit_history();
CREATE FUNCTION public.wa_prune_commit_history() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE removed bigint;
BEGIN
 DELETE FROM public.wa_commit_history_index WHERE at<now()-interval '30 days';
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.wa_prune_commit_history() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.wa_commit_history(request jsonb) RETURNS jsonb
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
 FROM public.wa_commit_history_index h JOIN public.wa_changes c USING(workspace_id,seq)
 WHERE h.workspace_id=m.workspace_id AND h.seq<before_seq AND h.at>=now()-interval '30 days'
 ORDER BY c.seq DESC LIMIT 50) x;
 RETURN jsonb_build_object('ok',true,'records',rows,'nextBefore',CASE WHEN total=50 THEN next_seq ELSE NULL END,'retentionDays',30);
END $$;
REVOKE ALL ON FUNCTION public.wa_commit_history(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wa_commit_history(jsonb) TO authenticated;
-- Sunday 19:00 UTC is Monday 03:00 Asia/Shanghai.
SELECT cron.schedule('workbench-history-weekly','0 19 * * 0','SELECT public.wa_prune_commit_history()');
