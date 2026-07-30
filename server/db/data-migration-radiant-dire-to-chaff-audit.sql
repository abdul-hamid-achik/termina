-- Termina R1/R5 data migration: faction text values
-- Run ONCE against Neon (or local Postgres) AFTER all rewrite code is deployed.
-- schema.ts already types TeamId as chaff|audit; columns are plain text — no DDL.
-- Safe to re-run: only rewrites remaining radiant/dire rows.

BEGIN;

UPDATE matches
SET winner = 'chaff'
WHERE winner = 'radiant';

UPDATE matches
SET winner = 'audit'
WHERE winner = 'dire';

UPDATE match_players
SET team = 'chaff'
WHERE team = 'radiant';

UPDATE match_players
SET team = 'audit'
WHERE team = 'dire';

-- Optional audit: should return 0 rows after success
-- SELECT 'matches' AS t, winner, count(*) FROM matches GROUP BY winner
-- UNION ALL
-- SELECT 'match_players', team, count(*) FROM match_players GROUP BY team;

COMMIT;
