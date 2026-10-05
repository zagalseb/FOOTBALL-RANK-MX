-- PENDIENTE DE OK. NO APLICAR SIN CONFIRMACIÓN EXPLÍCITA.
-- Mueve los rosters actuales de MTY y AT a temporada 2025 (eran 2026 por el backfill).
-- Precondiciones verificadas en solo lectura (2026-10-06):
--   - 140 jugadores en MTY+AT, 0 con temporada 2025 hoy, 0 colisiones del índice tras el cambio.
--   - Respaldo previo: scratchpad/backup_pre_2025_move/{players,games}.json (285 y 23 filas).
-- Rollback: ver bloque al final.

begin;

-- a. Jugadores de MTY y AT a 2025 (team_id explícitos).
update covercero.players
   set temporada = '2025'
 where team_id in ('ebd0f661-6336-4c5b-a0cb-6405c3ec5974',   -- MTY
                   '641143d3-4969-4384-bb3b-2b872906d5b8'); -- AT

-- b. Final MTY vs AT a 2025, por id.
update covercero.games
   set temporada = '2025'
 where id = 'c0a826d4-5dfa-4279-942e-b3ecff24361c'
   and temporada = '2026';

-- c. Verificación dentro de la transacción. Si algo no cuadra, RAISE deshace todo.
do $$
declare
  n_mtyat_2025 int;
  n_mtyat_2026 int;
  n_final_2025 int;
  n_ab  int;
  n_ccm int;
  n_pue int;
  n_ts1 int;
  n_ts2 int;
begin
  select count(*) into n_mtyat_2025 from covercero.players
   where team_id in ('ebd0f661-6336-4c5b-a0cb-6405c3ec5974','641143d3-4969-4384-bb3b-2b872906d5b8') and temporada = '2025';
  if n_mtyat_2025 <> 140 then raise exception 'verificación: MTY+AT en 2025 = % (esperado 140)', n_mtyat_2025; end if;

  select count(*) into n_mtyat_2026 from covercero.players
   where team_id in ('ebd0f661-6336-4c5b-a0cb-6405c3ec5974','641143d3-4969-4384-bb3b-2b872906d5b8') and temporada = '2026';
  if n_mtyat_2026 <> 0 then raise exception 'verificación: MTY+AT aún con % filas en 2026 (esperado 0)', n_mtyat_2026; end if;

  select count(*) into n_final_2025 from covercero.games
   where id = 'c0a826d4-5dfa-4279-942e-b3ecff24361c' and temporada = '2025';
  if n_final_2025 <> 1 then raise exception 'verificación: Final con temporada 2025 = % (esperado 1)', n_final_2025; end if;

  select count(*) into n_ab  from covercero.players where team_id = '6391e8d4-89dc-408c-833d-63c46ffed7ae' and temporada = '2026';
  select count(*) into n_ccm from covercero.players where team_id = '9a0c9951-9512-47ce-a0fd-07c8398e028f' and temporada = '2026';
  select count(*) into n_pue from covercero.players where team_id = '55a1a31b-514f-4504-b665-d1651bbdf8bf' and temporada = '2026';
  select count(*) into n_ts1 from covercero.players where team_id = 'a1000000-0000-4000-8000-000000000001' and temporada = '2026';
  select count(*) into n_ts2 from covercero.players where team_id = 'a1000000-0000-4000-8000-000000000002' and temporada = '2026';
  if n_ab <> 68 or n_ccm <> 70 or n_pue <> 2 or n_ts1 <> 4 or n_ts2 <> 1 then
    raise exception 'verificación: AB=% CCM=% PUE=% TS1=% TS2=% (esperado 68/70/2/4/1)', n_ab, n_ccm, n_pue, n_ts1, n_ts2;
  end if;
end $$;

commit;

-- ── ROLLBACK (no incluido; solo si hiciera falta después de aplicar) ─────────
-- begin;
-- update covercero.players set temporada = '2026'
--  where team_id in ('ebd0f661-6336-4c5b-a0cb-6405c3ec5974','641143d3-4969-4384-bb3b-2b872906d5b8');
-- update covercero.games set temporada = '2026' where id = 'c0a826d4-5dfa-4279-942e-b3ecff24361c';
-- commit;
