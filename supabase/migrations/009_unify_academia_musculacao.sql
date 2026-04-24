ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS temp_musculacao NUMERIC(4,1);

-- Keep musculacao as the canonical gym/strength activity because Whoop imports already use it.
UPDATE daily_logs
SET
  kcal_musculacao = NULLIF(COALESCE(kcal_musculacao, 0) + COALESCE(kcal_academia, 0), 0),
  min_musculacao = NULLIF(COALESCE(min_musculacao, 0) + COALESCE(min_academia, 0), 0),
  temp_musculacao = CASE
    WHEN temp_musculacao IS NULL THEN temp_academia
    WHEN temp_academia IS NULL THEN temp_musculacao
    ELSE ROUND(
      (
        temp_musculacao * COALESCE(NULLIF(min_musculacao, 0), 1) +
        temp_academia * COALESCE(NULLIF(min_academia, 0), 1)
      ) /
      (
        COALESCE(NULLIF(min_musculacao, 0), 1) +
        COALESCE(NULLIF(min_academia, 0), 1)
      ),
      1
    )
  END,
  bpm_musculacao = CASE
    WHEN bpm_musculacao IS NULL THEN bpm_academia
    WHEN bpm_academia IS NULL THEN bpm_musculacao
    ELSE ROUND(
      (
        bpm_musculacao * COALESCE(NULLIF(min_musculacao, 0), 1) +
        bpm_academia * COALESCE(NULLIF(min_academia, 0), 1)
      ) /
      (
        COALESCE(NULLIF(min_musculacao, 0), 1) +
        COALESCE(NULLIF(min_academia, 0), 1)
      )
    )::SMALLINT
  END,
  kcal_academia = NULL,
  min_academia = NULL,
  temp_academia = NULL,
  bpm_academia = NULL
WHERE kcal_academia IS NOT NULL
   OR min_academia IS NOT NULL
   OR temp_academia IS NOT NULL
   OR bpm_academia IS NOT NULL;
