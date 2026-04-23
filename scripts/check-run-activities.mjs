import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: new URL('.env', import.meta.url).pathname.slice(1) });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Fetch all run_activities
const { data: activities, error: actErr } = await supabase
  .from('run_activities')
  .select('id,date,distance_km,duration_min,avg_pace_min_km,avg_hr,calories_kcal');
if (actErr) { console.error(actErr); process.exit(1); }
console.log(`run_activities count: ${activities.length}`);

// Fetch all run_sessions
const BATCH = 500;
let sessions = [];
for (let i = 0; ; i++) {
  const { data, error } = await supabase
    .from('run_sessions')
    .select('run_activity_id,distance_km,duration_min,pace_min_km,avg_hr,calories_kcal')
    .range(i * BATCH, (i + 1) * BATCH - 1);
  if (error) { console.error(error); process.exit(1); }
  sessions.push(...data);
  if (data.length < BATCH) break;
}
console.log(`run_sessions count: ${sessions.length}`);

// Group sessions by run_activity_id
const grouped = new Map();
for (const s of sessions) {
  if (!grouped.has(s.run_activity_id)) grouped.set(s.run_activity_id, []);
  grouped.get(s.run_activity_id).push(s);
}

// Compare each activity with its sessions
const issues = [];
for (const act of activities) {
  const sesses = grouped.get(act.id) || [];
  if (sesses.length === 0) {
    issues.push({ id: act.id, date: act.date, issue: 'No sessions found' });
    continue;
  }

  const sumDist = sesses.reduce((a, s) => a + (s.distance_km ?? 0), 0);
  const sumDur = sesses.reduce((a, s) => a + (s.duration_min ?? 0), 0);
  const avgPace = sumDist > 0 ? sumDur / sumDist : null;

  const distDiff = Math.abs((act.distance_km ?? 0) - sumDist);
  const durDiff = Math.abs((act.duration_min ?? 0) - sumDur);
  const paceDiff = avgPace !== null && act.avg_pace_min_km !== null
    ? Math.abs((act.avg_pace_min_km ?? 0) - avgPace)
    : 0;

  if (distDiff > 0.05 || durDiff > 0.5 || paceDiff > 0.1) {
    issues.push({
      id: act.id,
      date: act.date,
      issue: `dist: act=${act.distance_km?.toFixed(2)} sessions=${sumDist.toFixed(2)} diff=${distDiff.toFixed(3)} | dur: act=${act.duration_min?.toFixed(2)} sessions=${sumDur.toFixed(2)} diff=${durDiff.toFixed(2)} | pace: act=${act.avg_pace_min_km?.toFixed(3)} computed=${avgPace?.toFixed(3)} diff=${paceDiff.toFixed(3)}`,
    });
  }
}

if (issues.length === 0) {
  console.log('\n✓ All run_activities are consistent with run_sessions.');
} else {
  console.log(`\n⚠ ${issues.length} activities with mismatches:`);
  for (const iss of issues) {
    console.log(`  [${iss.date}] ${iss.id}: ${iss.issue}`);
  }
}
