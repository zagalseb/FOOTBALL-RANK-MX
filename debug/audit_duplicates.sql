-- Auditoría de jugadores duplicados en stats. SOLO LECTURA. Correr después de cada importación
-- (SQL editor de Supabase o MCP). Resultado esperado: 0 filas.
--
-- Origen (2026-10-28): la misma persona quedó con dos filas en un partido —un jugador por tener un
-- id de roster de la temporada anterior y otro de la actual, y otro por tener dos filas en el mismo
-- roster— y sus stats se contaron dos veces (o repartidas en dos jugadores) en Líderes.
--
-- check:
--   A_MISMO_NUMERO   mismo partido + mismo equipo + mismo número, distinto player_id
--                    (es la misma regla que bloquea el importador y avisa Líderes)
--   B_MISMO_NOMBRE   mismo partido + mismo equipo + mismas palabras de nombre (en cualquier orden,
--                    sin acentos), distinto player_id; compara nombre+apellido y nombre_completo
--   C_EQUIPO_AJENO   la fila de stats es de un jugador cuyo equipo no juega ese partido
--   D_OTRA_TEMPORADA el jugador es de una temporada distinta a la del partido (games.temporada o,
--                    si es null, el año del kickoff, igual que getGameTemporada)
-- Partidos TEST excluidos.

with pl as (
  select p.id, p.team_id, p.number, p.nombre, p.apellido, p.temporada,
    (select string_agg(w, ' ' order by w)
       from unnest(regexp_split_to_array(trim(regexp_replace(translate(lower(coalesce(p.nombre, '') || ' ' || coalesce(p.apellido, '')), 'áéíóúüñ', 'aeiouun'), '[^a-z ]', ' ', 'g')), '\s+')) w
      where w <> '') as key_na,
    (select string_agg(w, ' ' order by w)
       from unnest(regexp_split_to_array(trim(regexp_replace(translate(lower(coalesce(p.nombre_completo, '')), 'áéíóúüñ', 'aeiouun'), '[^a-z ]', ' ', 'g')), '\s+')) w
      where w <> '') as key_nc
  from covercero.players p
),
st as (
  select s.game_id, s.player_id, g.semana, g.home_team_id, g.away_team_id,
         coalesce(g.temporada, extract(year from g.kickoff)::text) as season,
         h.abreviatura || ' vs ' || a.abreviatura as partido
  from covercero.player_game_stats_manual s
  join covercero.games g on g.id = s.game_id
  join covercero.teams h on h.id = g.home_team_id
  join covercero.teams a on a.id = g.away_team_id
  where g.semana is distinct from 'TEST'
),
pairs as (
  select a.game_id, a.semana, a.partido,
         a.player_id as id_a, b.player_id as id_b,
         pa.team_id, pa.number as num_a, pb.number as num_b,
         pa.apellido || ' ' || pa.nombre || ' (' || coalesce(pa.temporada, '?') || ')' as quien_a,
         pb.apellido || ' ' || pb.nombre || ' (' || coalesce(pb.temporada, '?') || ')' as quien_b,
         pa.key_na as na_a, pa.key_nc as nc_a, pb.key_na as na_b, pb.key_nc as nc_b
  from st a
  join st b on b.game_id = a.game_id and b.player_id > a.player_id
  join pl pa on pa.id = a.player_id
  join pl pb on pb.id = b.player_id
  where pa.team_id = pb.team_id
)
select 'A_MISMO_NUMERO' as check, semana, partido,
       'equipo ' || (select abreviatura from covercero.teams where id = team_id) || ' #' || num_a || ': ' || quien_a || ' [' || id_a || '] / ' || quien_b || ' [' || id_b || ']' as detalle
from pairs where num_a = num_b
union all
select 'B_MISMO_NOMBRE', semana, partido,
       'equipo ' || (select abreviatura from covercero.teams where id = team_id) || ': ' || quien_a || ' #' || num_a || ' [' || id_a || '] / ' || quien_b || ' #' || num_b || ' [' || id_b || ']'
from pairs
where na_a = na_b
   or (nc_a is not null and (nc_a = nc_b or nc_a = na_b))
   or (nc_b is not null and nc_b = na_a)
union all
select 'C_EQUIPO_AJENO', st.semana, st.partido,
       pl.apellido || ' ' || pl.nombre || ' [' || pl.id || '] no juega en este partido'
from st join pl on pl.id = st.player_id
where pl.team_id not in (st.home_team_id, st.away_team_id)
union all
select 'D_OTRA_TEMPORADA', st.semana, st.partido,
       pl.apellido || ' ' || pl.nombre || ' #' || pl.number || ' [' || pl.id || '] es del roster ' || coalesce(pl.temporada, '?') || ' y el partido es de ' || coalesce(st.season, '?')
from st join pl on pl.id = st.player_id
where pl.temporada is distinct from st.season
order by 1, 2, 3;

-- ── Informativa (no cuenta para el "0 filas") ────────────────────────────────
-- Mismo nombre dos veces en el MISMO roster y temporada. Pueden ser homónimos reales
-- (a 2026-10-28 había dos casos, en dos equipos distintos); revisar a mano
-- solo si alguno recibe stats. Descomentar para correrla.
--
-- select t.abreviatura, p.temporada, p.key_na as nombre_clave, count(*) as filas,
--        string_agg('#' || p.number || ' [' || p.id || '] stats=' ||
--                   (select count(*) from covercero.player_game_stats_manual s where s.player_id = p.id), ' ; ' order by p.number) as detalle
-- from (select p.*, (select string_agg(w, ' ' order by w)
--         from unnest(regexp_split_to_array(trim(regexp_replace(translate(lower(coalesce(p.nombre, '') || ' ' || coalesce(p.apellido, '')), 'áéíóúüñ', 'aeiouun'), '[^a-z ]', ' ', 'g')), '\s+')) w where w <> '') as key_na
--       from covercero.players p) p
-- join covercero.teams t on t.id = p.team_id
-- group by t.abreviatura, p.team_id, p.temporada, p.key_na having count(*) > 1
-- order by 1, 2, 3;
