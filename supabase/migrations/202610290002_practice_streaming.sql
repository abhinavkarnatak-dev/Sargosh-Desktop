-- Apply before deploying the practice streaming endpoint. Reuses the existing
-- three-attempt practice policy and shared budgets; normal minutes stay separate.
begin;
create or replace function public.reserve_practice_stream_usage(p_user_id uuid,p_request_id text,p_kind text,p_fingerprint text,p_seconds integer,p_cost_micro bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_kind<>'stt' then return jsonb_build_object('code','INVALID_USAGE');end if;
 result:=public.reserve_practice_usage(p_user_id,p_request_id,p_kind,p_fingerprint,p_seconds,p_cost_micro);
 if result->>'code'='OK' then
  update sargosh_private.usage_operations set streaming=true
  where user_id=p_user_id and request_id=p_request_id and kind='stt' and practice
   and lease_id=(result->>'leaseId')::uuid;
 end if;
 return result;
end $$;
revoke all on function public.reserve_practice_stream_usage(uuid,text,text,text,integer,bigint) from public,anon,authenticated;
grant execute on function public.reserve_practice_stream_usage(uuid,text,text,text,integer,bigint) to service_role;
commit;
