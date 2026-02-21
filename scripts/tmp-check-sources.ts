import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  const { data } = await supabase.from('hospitals').select('source').limit(13000);
  const sources: Record<string, number> = {};
  for (const r of data ?? []) { sources[r.source ?? 'null'] = (sources[r.source ?? 'null'] ?? 0) + 1; }
  console.log('Sources:', JSON.stringify(sources));

  const { count: withWeb } = await supabase.from('hospitals').select('id', { count: 'exact', head: true })
    .eq('status', 'active').eq('is_target', true).not('website', 'is', null);
  console.log('Active+target+website:', withWeb);

  const { data: recent } = await supabase.from('hospitals').select('id, name, source, website, status, is_target')
    .order('created_at', { ascending: false }).limit(5);
  for (const r of recent ?? []) console.log(`  ${r.name} | source=${r.source} | web=${r.website?.slice(0,40)} | status=${r.status} | target=${r.is_target}`);
}
main();
