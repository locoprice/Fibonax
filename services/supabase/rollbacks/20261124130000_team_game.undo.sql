-- Undo for 20261124130000_team_game.sql.
--
-- Drops the standings function and the switch. Nothing else is lost: the game
-- only read rows that every other feature keeps.

begin;

drop function if exists public.team_game_scores(uuid);

alter table public.organizations drop column if exists team_game;

commit;
