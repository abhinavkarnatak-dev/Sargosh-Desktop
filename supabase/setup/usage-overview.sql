-- Operator-only overview. No recordings, transcripts, recipient names, or credentials.
select kind,state,count(*) as requests,sum(seconds) as audio_seconds,
 round(sum(cost_micro)::numeric/1000000,6) as estimated_usd
from sargosh_private.usage_operations
where reserved_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'
group by kind,state order by kind,state;
