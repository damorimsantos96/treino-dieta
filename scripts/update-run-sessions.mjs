import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import XLSX from 'xlsx';
import * as dotenv from 'dotenv';

dotenv.config({ path: new URL('.env', import.meta.url).pathname.slice(1) });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const wb = XLSX.readFile('C:/Users/damor/Downloads/run_sessions_rows_corrigido.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

console.log(`Total rows in Excel: ${rows.length}`);

// Fetch current run_sessions from Supabase to compare
const BATCH = 500;
let allCurrent = [];
for (let i = 0; ; i++) {
  const { data, error } = await supabase
    .from('run_sessions')
    .select('id,duration_min,thermal_sensation_c,pace_min_km')
    .range(i * BATCH, (i + 1) * BATCH - 1);
  if (error) { console.error('Fetch error', error); process.exit(1); }
  allCurrent.push(...data);
  if (data.length < BATCH) break;
}
console.log(`Current rows in DB: ${allCurrent.length}`);

const currentMap = new Map(allCurrent.map(r => [r.id, r]));

// Build list of rows that differ in duration_min or thermal_sensation_c
const toUpdate = [];
for (const row of rows) {
  const cur = currentMap.get(row.id);
  if (!cur) continue; // id not in DB, skip

  const newDuration = row.duration_min != null ? Number(row.duration_min) : null;
  const newThermal = row.thermal_sensation_c != null ? Number(row.thermal_sensation_c) : null;
  const newPace = row.pace_min_km != null ? Number(row.pace_min_km) : null;

  const durChanged = newDuration !== null && Math.abs(newDuration - (cur.duration_min ?? Infinity)) > 0.001;
  const thermalChanged = newThermal !== cur.thermal_sensation_c;
  const paceChanged = newPace !== null && Math.abs(newPace - (cur.pace_min_km ?? Infinity)) > 0.001;

  if (durChanged || thermalChanged || paceChanged) {
    toUpdate.push({
      id: row.id,
      duration_min: newDuration,
      thermal_sensation_c: newThermal,
      pace_min_km: newPace,
    });
  }
}

console.log(`Rows needing update: ${toUpdate.length}`);
if (toUpdate.length === 0) { console.log('Nothing to update.'); process.exit(0); }

// Update in batches
let updated = 0;
let errors = 0;
const UPDATE_BATCH = 50;
for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
  const chunk = toUpdate.slice(i, i + UPDATE_BATCH);
  const results = await Promise.all(
    chunk.map(r =>
      supabase.from('run_sessions').update({
        duration_min: r.duration_min,
        thermal_sensation_c: r.thermal_sensation_c,
        pace_min_km: r.pace_min_km,
      }).eq('id', r.id)
    )
  );
  for (const { error } of results) {
    if (error) { console.error('Update error:', error.message); errors++; }
    else updated++;
  }
  process.stdout.write(`\rUpdated ${updated + errors}/${toUpdate.length}...`);
}
console.log(`\nDone. Updated: ${updated}, Errors: ${errors}`);
