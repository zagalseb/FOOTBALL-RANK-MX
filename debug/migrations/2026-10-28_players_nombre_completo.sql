-- Migración única: players.nombre_completo (nombre como sale en el PDF de Tableau: "APELLIDOS NOMBRES").
--
-- Decisiones (2026-10-28):
--   - Columna nullable, sin default, sin constraints, SIN backfill.
--   - El fallback vive en JS (rosterFullName en shared/stats-lib.js): nombre_completo || (apellido + ' ' + nombre).
--   - No se toca players_team_season_identity_key ni nombre/apellido.
--
-- Verificado antes de escribirla (solo lectura):
--   - Políticas RLS de players son por tabla (no por columna): lectura pública, insert/update/delete a authenticated.
--   - anon tiene grants a nivel tabla, pero RLS le bloquea las escrituras; una columna nueva hereda ambos.
--
-- ROLLBACK: ver el bloque al final.

begin;

alter table covercero.players add column if not exists nombre_completo text;

-- Verificación antes del commit. Si algo no cuadra, RAISE EXCEPTION deshace toda la transacción.
do $$
declare
  col_ok int;
  n_filled int;
begin
  select count(*) into col_ok
    from information_schema.columns
   where table_schema = 'covercero' and table_name = 'players'
     and column_name = 'nombre_completo'
     and data_type = 'text' and is_nullable = 'YES' and column_default is null;
  if col_ok <> 1 then
    raise exception 'verificación: nombre_completo no quedó como text nullable sin default';
  end if;

  select count(*) into n_filled from covercero.players where nombre_completo is not null;
  if n_filled <> 0 then
    raise exception 'verificación: % filas con nombre_completo no nulo (esperado 0, sin backfill)', n_filled;
  end if;
end $$;

commit;

-- ── ROLLBACK (no incluido en la migración) ───────────────────────────────────
-- alter table covercero.players drop column nombre_completo;
-- Pierde los nombres completos capturados desde entonces.
