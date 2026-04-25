-- ============================================================
-- Migration 011: auto all-out detection + stronger Garmin lap validation
-- ============================================================

ALTER TABLE all_out_tests
  ADD COLUMN IF NOT EXISTS source_run_activity_id UUID REFERENCES run_activities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_confidence NUMERIC(4,3);

CREATE UNIQUE INDEX IF NOT EXISTS idx_all_out_tests_user_source_activity
  ON all_out_tests (user_id, source_run_activity_id);

CREATE INDEX IF NOT EXISTS idx_all_out_tests_user_auto
  ON all_out_tests (user_id, is_auto_generated, date DESC);

WITH session_stats AS (
  SELECT
    rs.run_activity_id,
    AVG(rs.pace_min_km) FILTER (WHERE rs.pace_min_km IS NOT NULL AND rs.pace_min_km > 0) AS avg_pace,
    MIN(rs.pace_min_km) FILTER (WHERE rs.pace_min_km IS NOT NULL AND rs.pace_min_km > 0) AS fastest_pace,
    AVG(rs.avg_hr) FILTER (WHERE rs.avg_hr IS NOT NULL AND rs.avg_hr > 0) AS avg_hr
  FROM run_sessions rs
  WHERE rs.source = 'garmin'
    AND rs.run_activity_id IS NOT NULL
  GROUP BY rs.run_activity_id
)
UPDATE run_sessions rs
SET interval_type = CASE
  WHEN LOWER(COALESCE(rs.interval_type, '')) = 'race' THEN 'Race'
  WHEN COALESCE(rs.distance_km, 0) > 0
    AND COALESCE(rs.distance_km, 0) <= 0.25
    AND (
      (rs.pace_min_km IS NOT NULL AND ss.fastest_pace IS NOT NULL AND rs.pace_min_km >= ss.fastest_pace * 1.08)
      OR (rs.avg_hr IS NOT NULL AND ss.avg_hr IS NOT NULL AND rs.avg_hr <= ss.avg_hr - 8)
    ) THEN 'Easy'
  WHEN COALESCE(rs.distance_km, 0) BETWEEN 0.85 AND 1.2
    AND rs.pace_min_km IS NOT NULL
    AND ss.avg_pace IS NOT NULL
    AND rs.pace_min_km <= ss.avg_pace * 0.98
    AND (
      LOWER(COALESCE(rs.interval_type, '')) IN ('intervals', 'threshold', 'tempo', 'vo2max', 'race')
      OR COALESCE(rs.avg_hr, 0) >= GREATEST(COALESCE(ss.avg_hr, 0) + 4, 160)
      OR COALESCE(rs.max_hr, 0) >= 176
    ) THEN 'Intervals'
  WHEN rs.pace_min_km IS NOT NULL
    AND ss.avg_pace IS NOT NULL
    AND rs.pace_min_km <= ss.avg_pace * 1.01
    AND (
      LOWER(COALESCE(rs.interval_type, '')) IN ('intervals', 'threshold', 'tempo', 'vo2max', 'race')
      OR COALESCE(rs.avg_hr, 0) >= GREATEST(COALESCE(ss.avg_hr, 0), 155)
    ) THEN 'Threshold'
  ELSE 'Easy'
END
FROM session_stats ss
WHERE rs.source = 'garmin'
  AND rs.run_activity_id = ss.run_activity_id;

WITH activity_features AS (
  SELECT
    ra.id AS run_activity_id,
    ra.user_id,
    ra.date,
    ra.name,
    ra.distance_km,
    ra.duration_min,
    ra.avg_hr,
    ra.max_hr,
    ra.thermal_sensation_c,
    COUNT(rs.id) AS interval_count,
    COUNT(*) FILTER (
      WHERE rs.interval_type IN ('Threshold', 'Intervals', 'VO2max', 'Tempo', 'Race')
    ) AS hard_blocks,
    COALESCE(SUM(rs.distance_km) FILTER (
      WHERE rs.interval_type IN ('Threshold', 'Intervals', 'VO2max', 'Tempo', 'Race')
    ), 0) AS hard_distance_km,
    COALESCE(SUM(rs.distance_km) FILTER (
      WHERE rs.interval_type IN ('Easy', 'Outro')
    ), 0) AS recovery_distance_km,
    COALESCE(MAX(rs.distance_km) FILTER (
      WHERE rs.interval_type IN ('Threshold', 'Intervals', 'VO2max', 'Tempo', 'Race')
    ), 0) AS longest_hard_km
  FROM run_activities ra
  LEFT JOIN run_sessions rs ON rs.run_activity_id = ra.id
  WHERE ra.source IN ('garmin', 'manual')
  GROUP BY ra.id
),
eligible AS (
  SELECT
    af.*,
    CASE
      WHEN ABS(COALESCE(af.distance_km, 0) - 1.609) <= 0.12 THEN 'auto_mile'
      WHEN ABS(COALESCE(af.distance_km, 0) - 3.0) <= 0.18 THEN 'auto_3k'
      WHEN ABS(COALESCE(af.distance_km, 0) - 5.0) <= 0.25 THEN 'auto_5k'
      WHEN ABS(COALESCE(af.distance_km, 0) - 10.0) <= 0.35 THEN 'auto_10k'
      ELSE 'auto_run'
    END AS auto_kind,
    CASE WHEN COALESCE(af.distance_km, 0) > 0 THEN af.hard_distance_km / af.distance_km ELSE 0 END AS hard_share,
    CASE WHEN COALESCE(af.distance_km, 0) > 0 THEN af.recovery_distance_km / af.distance_km ELSE 0 END AS recovery_share,
    LEAST(
      0.99,
      (
        CASE
          WHEN COALESCE(af.distance_km, 0) > 0
            AND af.hard_distance_km / af.distance_km >= 0.85
            AND af.recovery_distance_km / af.distance_km <= 0.15
            AND af.hard_blocks BETWEEN 1 AND 2
            AND af.longest_hard_km >= GREATEST(1.0, af.distance_km * 0.7)
          THEN 0.38 ELSE 0
        END
        +
        CASE
          WHEN LOWER(COALESCE(af.name, '')) ~ '(race|tt|test|time trial|parkrun|prova|5k|10k|3k|1mi|mile)'
            OR COALESCE(af.avg_hr, 0) >= 166
            OR COALESCE(af.max_hr, 0) >= 178
            OR (COALESCE(af.avg_hr, 0) >= 162 AND COALESCE(af.max_hr, 0) >= 174 AND COALESCE(af.distance_km, 0) <= 5.5)
          THEN 0.24 ELSE 0
        END
        +
        CASE WHEN af.interval_count <= 3 OR (COALESCE(af.distance_km, 0) > 0 AND af.recovery_distance_km / af.distance_km <= 0.08)
          THEN 0.12 ELSE 0 END
        +
        CASE WHEN LOWER(COALESCE(af.name, '')) ~ '(race|tt|test|time trial|parkrun|prova|5k|10k|3k|1mi|mile)'
          THEN 0.14 ELSE 0 END
        +
        CASE WHEN COALESCE(af.distance_km, 0) > 0 AND af.hard_distance_km / af.distance_km >= 0.95
          THEN 0.08 ELSE 0 END
        +
        CASE WHEN COALESCE(af.avg_hr, 0) >= 168 THEN 0.06 ELSE 0 END
        +
        CASE WHEN COALESCE(af.max_hr, 0) >= 180 THEN 0.06 ELSE 0 END
      )::NUMERIC
    ) AS confidence
  FROM activity_features af
  WHERE COALESCE(af.distance_km, 0) BETWEEN 1.4 AND 10.5
    AND COALESCE(af.duration_min, 0) BETWEEN 5 AND 80
    AND COALESCE(af.distance_km, 0) > 0
),
qualified AS (
  SELECT *
  FROM eligible
  WHERE hard_share >= 0.85
    AND recovery_share <= 0.15
    AND hard_blocks BETWEEN 1 AND 2
    AND longest_hard_km >= GREATEST(1.0, distance_km * 0.7)
    AND (
      LOWER(COALESCE(name, '')) ~ '(race|tt|test|time trial|parkrun|prova|5k|10k|3k|1mi|mile)'
      OR COALESCE(avg_hr, 0) >= 166
      OR COALESCE(max_hr, 0) >= 178
      OR (COALESCE(avg_hr, 0) >= 162 AND COALESCE(max_hr, 0) >= 174 AND COALESCE(distance_km, 0) <= 5.5)
    )
    AND (interval_count <= 3 OR recovery_share <= 0.08)
    AND confidence >= 0.65
)
DELETE FROM all_out_tests aot
WHERE aot.is_auto_generated = TRUE
  AND aot.source_run_activity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM qualified q
    WHERE q.user_id = aot.user_id
      AND q.run_activity_id = aot.source_run_activity_id
  );

WITH activity_features AS (
  SELECT
    ra.id AS run_activity_id,
    ra.user_id,
    ra.date,
    ra.name,
    ra.distance_km,
    ra.duration_min,
    ra.avg_hr,
    ra.max_hr,
    ra.thermal_sensation_c,
    COUNT(rs.id) AS interval_count,
    COUNT(*) FILTER (
      WHERE rs.interval_type IN ('Threshold', 'Intervals', 'VO2max', 'Tempo', 'Race')
    ) AS hard_blocks,
    COALESCE(SUM(rs.distance_km) FILTER (
      WHERE rs.interval_type IN ('Threshold', 'Intervals', 'VO2max', 'Tempo', 'Race')
    ), 0) AS hard_distance_km,
    COALESCE(SUM(rs.distance_km) FILTER (
      WHERE rs.interval_type IN ('Easy', 'Outro')
    ), 0) AS recovery_distance_km,
    COALESCE(MAX(rs.distance_km) FILTER (
      WHERE rs.interval_type IN ('Threshold', 'Intervals', 'VO2max', 'Tempo', 'Race')
    ), 0) AS longest_hard_km
  FROM run_activities ra
  LEFT JOIN run_sessions rs ON rs.run_activity_id = ra.id
  WHERE ra.source IN ('garmin', 'manual')
  GROUP BY ra.id
),
eligible AS (
  SELECT
    af.*,
    CASE
      WHEN ABS(COALESCE(af.distance_km, 0) - 1.609) <= 0.12 THEN 'auto_mile'
      WHEN ABS(COALESCE(af.distance_km, 0) - 3.0) <= 0.18 THEN 'auto_3k'
      WHEN ABS(COALESCE(af.distance_km, 0) - 5.0) <= 0.25 THEN 'auto_5k'
      WHEN ABS(COALESCE(af.distance_km, 0) - 10.0) <= 0.35 THEN 'auto_10k'
      ELSE 'auto_run'
    END AS auto_kind,
    CASE WHEN COALESCE(af.distance_km, 0) > 0 THEN af.hard_distance_km / af.distance_km ELSE 0 END AS hard_share,
    CASE WHEN COALESCE(af.distance_km, 0) > 0 THEN af.recovery_distance_km / af.distance_km ELSE 0 END AS recovery_share,
    LEAST(
      0.99,
      (
        CASE
          WHEN COALESCE(af.distance_km, 0) > 0
            AND af.hard_distance_km / af.distance_km >= 0.85
            AND af.recovery_distance_km / af.distance_km <= 0.15
            AND af.hard_blocks BETWEEN 1 AND 2
            AND af.longest_hard_km >= GREATEST(1.0, af.distance_km * 0.7)
          THEN 0.38 ELSE 0
        END
        +
        CASE
          WHEN LOWER(COALESCE(af.name, '')) ~ '(race|tt|test|time trial|parkrun|prova|5k|10k|3k|1mi|mile)'
            OR COALESCE(af.avg_hr, 0) >= 166
            OR COALESCE(af.max_hr, 0) >= 178
            OR (COALESCE(af.avg_hr, 0) >= 162 AND COALESCE(af.max_hr, 0) >= 174 AND COALESCE(af.distance_km, 0) <= 5.5)
          THEN 0.24 ELSE 0
        END
        +
        CASE WHEN af.interval_count <= 3 OR (COALESCE(af.distance_km, 0) > 0 AND af.recovery_distance_km / af.distance_km <= 0.08)
          THEN 0.12 ELSE 0 END
        +
        CASE WHEN LOWER(COALESCE(af.name, '')) ~ '(race|tt|test|time trial|parkrun|prova|5k|10k|3k|1mi|mile)'
          THEN 0.14 ELSE 0 END
        +
        CASE WHEN COALESCE(af.distance_km, 0) > 0 AND af.hard_distance_km / af.distance_km >= 0.95
          THEN 0.08 ELSE 0 END
        +
        CASE WHEN COALESCE(af.avg_hr, 0) >= 168 THEN 0.06 ELSE 0 END
        +
        CASE WHEN COALESCE(af.max_hr, 0) >= 180 THEN 0.06 ELSE 0 END
      )::NUMERIC
    ) AS confidence
  FROM activity_features af
  WHERE COALESCE(af.distance_km, 0) BETWEEN 1.4 AND 10.5
    AND COALESCE(af.duration_min, 0) BETWEEN 5 AND 80
    AND COALESCE(af.distance_km, 0) > 0
),
qualified AS (
  SELECT *
  FROM eligible
  WHERE hard_share >= 0.85
    AND recovery_share <= 0.15
    AND hard_blocks BETWEEN 1 AND 2
    AND longest_hard_km >= GREATEST(1.0, distance_km * 0.7)
    AND (
      LOWER(COALESCE(name, '')) ~ '(race|tt|test|time trial|parkrun|prova|5k|10k|3k|1mi|mile)'
      OR COALESCE(avg_hr, 0) >= 166
      OR COALESCE(max_hr, 0) >= 178
      OR (COALESCE(avg_hr, 0) >= 162 AND COALESCE(max_hr, 0) >= 174 AND COALESCE(distance_km, 0) <= 5.5)
    )
    AND (interval_count <= 3 OR recovery_share <= 0.08)
    AND confidence >= 0.65
)
INSERT INTO all_out_tests (
  user_id,
  date,
  kind,
  distance_km,
  duration_min,
  temp_c,
  source_run_activity_id,
  is_auto_generated,
  auto_confidence,
  notes
)
SELECT
  q.user_id,
  q.date,
  q.auto_kind,
  q.distance_km,
  q.duration_min,
  q.thermal_sensation_c,
  q.run_activity_id,
  TRUE,
  ROUND(q.confidence, 3),
  CONCAT(
    'Auto-detectado (',
    ROUND(q.confidence * 100),
    '% confianca) • estrutura continua ',
    ROUND(q.hard_share * 100),
    '% forte'
  )
FROM qualified q
ON CONFLICT (user_id, source_run_activity_id) DO UPDATE SET
  date = EXCLUDED.date,
  kind = EXCLUDED.kind,
  distance_km = EXCLUDED.distance_km,
  duration_min = EXCLUDED.duration_min,
  temp_c = EXCLUDED.temp_c,
  is_auto_generated = TRUE,
  auto_confidence = EXCLUDED.auto_confidence,
  notes = EXCLUDED.notes,
  updated_at = NOW();
