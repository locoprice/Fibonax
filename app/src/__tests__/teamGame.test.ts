import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  actionCount,
  moreActions,
  ordinal,
  teamGameStanding,
  teamGameStandings,
  TEAM_GAME_DAYS,
  TEAM_GAME_GRACE_DAYS,
} from '@/lib/teamGame';
import type { OrgMember, TeamGameScore } from '@/types/database';

function member(id: string, name: string): OrgMember {
  return {
    user_id: id,
    email: `${id}@example.com`,
    display_name: name,
    role: 'member',
    avatar_url: null,
    department_id: null,
    job_title: null,
    is_department_lead: false,
  };
}

const TEAM = [
  member('a', 'Anna'),
  member('b', 'Bruno'),
  member('c', 'Carla'),
  member('d', 'Dario'),
  member('e', 'Elena'),
];

function scores(rows: Array<[string, number, boolean?]>): TeamGameScore[] {
  return rows.map(([user_id, actions, is_new]) => ({ user_id, actions, is_new: is_new === true }));
}

const names = (players: { member: OrgMember }[]) => players.map((p) => p.member.display_name);

describe('teamGameStandings', () => {
  it('crowns the person with the most actions and names who is right behind', () => {
    const s = teamGameStandings(TEAM, scores([['a', 40], ['b', 52], ['c', 12], ['d', 9], ['e', 30]]));
    expect(names(s.players)).toEqual(['Bruno', 'Anna', 'Elena', 'Carla', 'Dario']);
    expect(names(s.leaders)).toEqual(['Bruno']);
    expect(names(s.runnersUp)).toEqual(['Anna']);
    expect(s.leadBy).toBe(12);
  });

  it('makes the person with the fewest the Black Sheep, with what it takes to hand it on', () => {
    const s = teamGameStandings(TEAM, scores([['a', 40], ['b', 52], ['c', 12], ['d', 9], ['e', 30]]));
    expect(names(s.sheep)).toEqual(['Dario']);
    // Carla has 12: Dario passes her at 13.
    expect(s.sheepNeeds).toBe(4);
  });

  it('shares the crown between people level at the top', () => {
    const s = teamGameStandings(TEAM, scores([['a', 20], ['b', 20], ['c', 5], ['d', 3], ['e', 8]]));
    expect(names(s.leaders)).toEqual(['Anna', 'Bruno']);
    expect(s.runnersUp).toEqual([]);
    expect(s.leadBy).toBe(0);
  });

  it('shares the Black Sheep between people level at the bottom', () => {
    const s = teamGameStandings(TEAM, scores([['a', 20], ['b', 0], ['c', 0], ['d', 3], ['e', 8]]));
    expect(names(s.sheep)).toEqual(['Bruno', 'Carla']);
    expect(s.sheepNeeds).toBe(0);
  });

  it('never makes a newcomer the Black Sheep', () => {
    const s = teamGameStandings(TEAM, scores([['a', 20], ['b', 0, true], ['c', 4], ['d', 3], ['e', 8]]));
    expect(names(s.sheep)).toEqual(['Dario']);
    expect(s.players.find((p) => p.member.user_id === 'b')?.place).toBe(5);
  });

  it('awards nothing until someone has done something', () => {
    const s = teamGameStandings(TEAM, scores([['a', 0], ['b', 0], ['c', 0], ['d', 0], ['e', 0]]));
    expect(s.started).toBe(false);
    expect(s.leaders).toEqual([]);
    expect(s.sheep).toEqual([]);
  });

  it('awards nothing while the whole team is level', () => {
    const s = teamGameStandings(TEAM, scores([['a', 4], ['b', 4], ['c', 4], ['d', 4], ['e', 4]]));
    expect(s.started).toBe(true);
    expect(s.leaders).toEqual([]);
    expect(s.sheep).toEqual([]);
  });

  it('gives no Black Sheep when everyone who could hold it is level', () => {
    // The only one ahead is new; the rest are level.
    const s = teamGameStandings(TEAM, scores([['a', 9, true], ['b', 2], ['c', 2], ['d', 2], ['e', 2]]));
    expect(names(s.leaders)).toEqual(['Anna']);
    expect(s.sheep).toEqual([]);
  });

  it('plays from 3 people up', () => {
    const s = teamGameStandings(TEAM.slice(0, 2), scores([['a', 9], ['b', 1]]));
    expect(s.tooSmall).toBe(true);
    expect(s.leaders).toEqual([]);
    expect(s.sheep).toEqual([]);
  });

  it('counts someone the database did not mention as a newcomer at 0, and drops someone who left', () => {
    const s = teamGameStandings(TEAM.slice(0, 3), scores([['a', 6], ['b', 2], ['z', 99]]));
    const carla = s.players.find((p) => p.member.user_id === 'c');
    expect(carla).toMatchObject({ actions: 0, isNew: true, place: 3 });
    expect(s.players).toHaveLength(3);
    expect(names(s.leaders)).toEqual(['Anna']);
    // Carla has fewer, but she is new: the title goes to Bruno.
    expect(names(s.sheep)).toEqual(['Bruno']);
    expect(s.sheepNeeds).toBe(5);
  });

  it('gives people level the same place', () => {
    const s = teamGameStandings(TEAM, scores([['a', 10], ['b', 7], ['c', 7], ['d', 3], ['e', 1]]));
    expect(s.players.map((p) => p.place)).toEqual([1, 2, 2, 4, 5]);
  });
});

describe('teamGameStanding', () => {
  const s = teamGameStandings(TEAM, scores([['a', 40], ['b', 52], ['c', 12], ['d', 9], ['e', 12]]));

  it('says where a person stands and what it takes to pass the next one up', () => {
    const me = teamGameStanding(s, 'a');
    expect(me).toMatchObject({ of: 5, isLeader: false, isSheep: false });
    expect(me?.player.place).toBe(2);
    expect(names(me?.next?.players ?? [])).toEqual(['Bruno']);
    expect(me?.next?.needs).toBe(13);
  });

  it('marks the leader and the Black Sheep', () => {
    expect(teamGameStanding(s, 'b')).toMatchObject({ isLeader: true, next: null });
    expect(teamGameStanding(s, 'd')).toMatchObject({ isSheep: true });
  });

  it('names everyone level right above', () => {
    const me = teamGameStanding(s, 'd');
    expect(names(me?.next?.players ?? [])).toEqual(['Carla', 'Elena']);
    expect(me?.next?.needs).toBe(4);
  });

  it('is null for someone outside the team', () => {
    expect(teamGameStanding(s, 'zz')).toBeNull();
    expect(teamGameStanding(s, null)).toBeNull();
  });
});

describe('wording helpers', () => {
  it('writes places in English', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st',
    ]);
  });

  it('counts actions', () => {
    expect(actionCount(1)).toBe('1 action');
    expect(actionCount(0)).toBe('0 actions');
    expect(actionCount(12)).toBe('12 actions');
    expect(moreActions(1)).toBe('1 more action');
    expect(moreActions(5)).toBe('5 more actions');
  });
});

// The page and the database must agree on the window and the grace period,
// and on who may read and switch the game.
const sql = readFileSync(
  fileURLToPath(
    new URL('../../../services/supabase/migrations/20261124130000_team_game.sql', import.meta.url),
  ),
  'utf8',
);
const fn = sql.slice(sql.indexOf('create or replace function public.team_game_scores'));

describe('team_game_scores', () => {
  it('counts the same window the page names', () => {
    expect(fn).toContain(`now() - interval '${TEAM_GAME_DAYS} days' as since`);
    expect(fn).toContain(`m.created_at > now() - interval '${TEAM_GAME_GRACE_DAYS} days'`);
  });

  it('returns one total per person and nothing else', () => {
    expect(fn).toContain('returns table(user_id uuid, actions bigint, is_new boolean)');
  });

  it('answers only a member of the team, only while the game is on', () => {
    expect(fn).toContain('and o.team_game');
    expect(fn).toContain('and app.is_org_member(p_org)');
    expect(sql).toContain('revoke all on function public.team_game_scores(uuid) from public, anon;');
  });

  it('counts uses, additions and saved changes in the team folders', () => {
    for (const source of ['snippet_events', 'prompt_events', 'snippet_revisions', 'prompt_versions']) {
      expect(fn).toContain(`from ${source}`);
    }
    // Six sources, each held to the team's own folders.
    expect(fn.match(/[sp]\.organization_id = p_org/g)).toHaveLength(6);
  });

  it('starts every team with the game off', () => {
    expect(sql).toContain('add column if not exists team_game boolean not null default false;');
  });
});
