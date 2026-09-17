CREATE OR REPLACE FUNCTION public.wa_storage_member(space text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.wa_members WHERE uid=auth.uid() AND (space IS NULL OR workspace_id=space) AND active)
$$;
ALTER POLICY workbench_bucket_read ON storage.buckets USING(id='workbench-assets' AND public.wa_storage_member(NULL));
