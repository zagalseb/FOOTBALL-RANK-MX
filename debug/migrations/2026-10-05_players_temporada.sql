-- APROBADA con ajustes (2026-10-05): respaldo previo, consulta de duplicados vacía, verificación antes del commit.
-- Migración única: temporada en players, nombre/apellido NOT NULL, y número repetido permitido.
--
-- Verificado antes de escribirla (solo lectura):
--   - players_team_id_number_key no tiene vistas, funciones, triggers ni políticas RLS que la usen.
--   - La única FK hacia players es player_game_stats_manual.player_id → players(id) (no depende de la restricción).
--   - Políticas RLS de players: por operador (insert/update/delete) y lectura pública; no mencionan team_id/number.
--   - nombre/apellido: 0 NULL hoy (la migración los normaliza igual).
--   - games.temporada: text, NULL en los 3 partidos de referencia.
--
-- ROLLBACK: ver el bloque al final. Con números repetidos ya no se puede recrear UNIQUE(team_id, number).

begin;

-- 1. Temporada (mismo tipo que games.temporada: text).
alter table covercero.players add column if not exists temporada text;
update covercero.players set temporada = '2026' where temporada is null;
alter table covercero.players alter column temporada set not null;
-- DEFAULT transitorio. QUITAR antes de 2027: alter table covercero.players alter column temporada drop default;
alter table covercero.players alter column temporada set default '2026';

-- 2. Nombre y apellido: NULL → '' y NOT NULL DEFAULT ''.
update covercero.players set nombre = '' where nombre is null;
update covercero.players set apellido = '' where apellido is null;
alter table covercero.players alter column nombre set default '';
alter table covercero.players alter column nombre set not null;
alter table covercero.players alter column apellido set default '';
alter table covercero.players alter column apellido set not null;

-- 3. Partidos de referencia: temporada 2026 explícita.
--    Final MTY vs AT: partido de prueba con kickoff 2025, asignado a 2026 porque no hay
--    roster 2025 cargado. Reasignar a 2025 cuando se cargue ese roster.
update covercero.games
   set temporada = '2026'
 where temporada is null
   and id in (
     'c0a826d4-5dfa-4279-942e-b3ecff24361c',  -- MTY vs AT (Final, partido de prueba)
     '2dd8daf7-5053-4f5c-8c32-acabbbacda83',  -- CCM vs CU
     'f75f4008-75b0-4455-911e-1995d52cf605'   -- AT vs AB
   );

-- 4. Quitar la restricción vieja (también elimina su índice).
alter table covercero.players drop constraint players_team_id_number_key;

-- 5. Identidad: mismo número en el mismo equipo y temporada solo si el nombre difiere.
create unique index players_team_season_identity_key
  on covercero.players (team_id, temporada, number, lower(trim(nombre)), lower(trim(apellido)));

-- 6. Verificación antes del commit. Si algo no cuadra, RAISE EXCEPTION deshace toda la transacción.
do $$
declare
  n_ref  int;
  n_null int;
begin
  select count(*) into n_ref
    from covercero.games
   where temporada = '2026'
     and id in ('c0a826d4-5dfa-4279-942e-b3ecff24361c',
                '2dd8daf7-5053-4f5c-8c32-acabbbacda83',
                'f75f4008-75b0-4455-911e-1995d52cf605');
  if n_ref <> 3 then
    raise exception 'verificación: % partidos de referencia con temporada 2026 (esperado 3)', n_ref;
  end if;

  select count(*) into n_null from covercero.players where temporada is null;
  if n_null <> 0 then
    raise exception 'verificación: % filas de players con temporada null (esperado 0)', n_null;
  end if;
end $$;

commit;

-- ── ROLLBACK (no incluido en la migración) ───────────────────────────────────
-- begin;
-- drop index covercero.players_team_season_identity_key;
-- alter table covercero.players add constraint players_team_id_number_key unique (team_id, number);
-- commit;
-- Falla si hay números repetidos dentro de un equipo. Solo es posible mientras no existan.
