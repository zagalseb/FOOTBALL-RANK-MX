-- Migración única: fumbles por jugador en player_game_stats_manual (importador de stats semanales).
--
-- Decisiones (2026-10-28):
--   - rush_fum y rec_fum: integer, default 0. Nullable, igual que el resto de columnas de stats.
--   - Sin backfill: las filas existentes toman 0 por el default.
--   - Los totales de equipo NO derivan fumbles (team_game_stats_manual no se toca).
--
-- Verificado antes de escribirla (solo lectura):
--   - Los grants de la tabla son a nivel tabla (anon e authenticated: INSERT, SELECT, UPDATE),
--     así que las columnas nuevas los heredan. RLS: lectura pública; insert/update solo authenticated.
--   - UNIQUE(game_id, player_id) existente es la llave del upsert; no cambia.
--
-- ROLLBACK: ver el bloque al final.

begin;

alter table covercero.player_game_stats_manual add column if not exists rush_fum integer default 0;
alter table covercero.player_game_stats_manual add column if not exists rec_fum integer default 0;

-- Verificación antes del commit. Si algo no cuadra, RAISE EXCEPTION deshace toda la transacción.
do $$
declare
  n_cols int;
  n_null int;
begin
  select count(*) into n_cols
    from information_schema.columns
   where table_schema = 'covercero' and table_name = 'player_game_stats_manual'
     and column_name in ('rush_fum', 'rec_fum')
     and data_type = 'integer' and column_default = '0';
  if n_cols <> 2 then
    raise exception 'verificación: % de 2 columnas rush_fum/rec_fum como integer default 0', n_cols;
  end if;

  select count(*) into n_null
    from covercero.player_game_stats_manual
   where rush_fum is null or rec_fum is null;
  if n_null <> 0 then
    raise exception 'verificación: % filas con rush_fum/rec_fum null (esperado 0, el default las llena)', n_null;
  end if;
end $$;

commit;

-- ── ROLLBACK (no incluido en la migración) ───────────────────────────────────
-- alter table covercero.player_game_stats_manual drop column rush_fum, drop column rec_fum;
-- Pierde los fumbles importados desde entonces.
