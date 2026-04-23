import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: new URL('.env', import.meta.url).pathname.slice(1) });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Activities where duration/pace appear to be stored in seconds instead of minutes
// Identified by comparing with run_sessions: activity_dur ~= sessions_dur * 60
const { data: activities, error } = await supabase
  .from('run_activities')
  .select('id,date,duration_min,avg_pace_min_km,distance_km');
if (error) { console.error(error); process.exit(1); }

// Fetch session aggregates
const BATCH = 500;
let sessions = [];
for (let i = 0; ; i++) {
  const { data, error: e } = await supabase
    .from('run_sessions')
    .select('run_activity_id,distance_km,duration_min')
    .range(i * BATCH, (i + 1) * BATCH - 1);
  if (e) { console.error(e); process.exit(1); }
  sessions.push(...data);
  if (data.length < BATCH) break;
}

const grouped = new Map();
for (const s of sessions) {
  if (!grouped.has(s.run_activity_id)) grouped.set(s.run_activity_id, []);
  grouped.get(s.run_activity_id).push(s);
}

const toFix = [];
for (const act of activities) {
  const sesses = grouped.get(act.id) || [];
  if (sesses.length === 0) continue;
  const sumDur = sesses.reduce((a, s) => a + (s.duration_min ?? 0), 0);
  const sumDist = sesses.reduce((a, s) => a + (s.distance_km ?? 0), 0);
  const durDiff = Math.abs((act.duration_min ?? 0) - sumDur);

  // If activity duration is ~60x the session sum, it's stored in seconds
  if (durDiff > 50 && Math.abs((act.duration_min ?? 0) / 60 - sumDur) < 2) {
    const correctedDur = (act.duration_min ?? 0) / 60;
    const correctedPace = sumDist > 0 ? correctedDur / sumDist : null;
    toFix.push({
      id: act.id,
      date: act.date,
      old_dur: act.duration_min,
      new_dur: Math.round(correctedDur * 1000) / 1000,
      old_pace: act.avg_pace_min_km,
      new_pace: correctedPace ? Math.round(correctedPace * 1000) / 1000 : null,
    });
  }
}

console.log(`Activities to fix (seconds → minutes): ${toFix.length}`);
toFix.forEach(r => console.log(`  [${r.date}] ${r.id}: dur ${r.old_dur}s → ${r.new_dur}min | pace ${r.old_pace?.toFixed(3)} → ${r.new_pace?.toFixed(3)}`));

if (toFix.length === 0) { console.log('Nothing to fix.'); process.exit(0); }

// Apply fixes
let updated = 0, errors = 0;
for (const r of toFix) {
  const { error: e } = await supabase
    .from('run_activities')
    .update({ duration_min: r.new_dur, avg_pace_min_km: r.new_pace })
    .eq('id', r.id);
  if (e) { console.error(`Error updating ${r.id}:`, e.message); errors++; }
  else updated++;
}
console.log(`\nDone. Updated: ${updated}, Errors: ${errors}`);
