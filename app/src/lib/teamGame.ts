import { memberName } from '@/lib/orgChart';
import type { OrgMember, TeamGameScore } from '@/types/database';

// The Team game on the Team page. The database counts each person's actions
// (team_game_scores); everything that decides who wears which title lives
// here, so the card and the People list only draw it.
//
// The rules, in plain words:
// - A team plays from 3 people up.
// - Whoever has the most actions is the Team Leader. People level at the top
//   share the crown.
// - Whoever has the fewest is the Black Sheep, and people level at the bottom
//   share it. Nobody is the Black Sheep in their first 14 days, nor while the
//   whole team is level, nor when everyone who could be is level.
// - Nothing is awarded until someone has done something.

/** How far back the game counts. Mirrors team_game_scores(). */
export const TEAM_GAME_DAYS = 30;

/** A newcomer's grace: never the Black Sheep in these first days. Mirrors is_new. */
export const TEAM_GAME_GRACE_DAYS = 14;

/** The smallest team that plays. */
export const TEAM_GAME_MIN_PEOPLE = 3;

export interface TeamGamePlayer {
  member: OrgMember;
  actions: number;
  isNew: boolean;
  /** 1, plus how many people have more actions. People level share a place. */
  place: number;
}

export interface TeamGameStandings {
  /** Everyone in the team, most actions first, then by name. */
  players: TeamGamePlayer[];
  /** Fewer than 3 people: nothing is awarded. */
  tooSmall: boolean;
  /** Someone has at least one action. */
  started: boolean;
  /** Everyone at the top. Empty while nothing is awarded or the whole team is level. */
  leaders: TeamGamePlayer[];
  /** Everyone at the bottom who can hold the title. Empty when nobody can. */
  sheep: TeamGamePlayer[];
  /** With one leader: the people right behind them, and the gap. */
  runnersUp: TeamGamePlayer[];
  leadBy: number;
  /** With one Black Sheep: the actions that hand the title on. */
  sheepNeeds: number;
}

export interface TeamGameStanding {
  player: TeamGamePlayer;
  /** How many people play. */
  of: number;
  isLeader: boolean;
  isSheep: boolean;
  /** The nearest people above, and the actions it takes to pass them. Null at the top. */
  next: { players: TeamGamePlayer[]; needs: number } | null;
}

function byActionsThenName(a: TeamGamePlayer, b: TeamGamePlayer): number {
  return (
    b.actions - a.actions ||
    memberName(a.member).localeCompare(memberName(b.member), undefined, { sensitivity: 'base' })
  );
}

const NOTHING: Pick<TeamGameStandings, 'leaders' | 'sheep' | 'runnersUp' | 'leadBy' | 'sheepNeeds'> = {
  leaders: [],
  sheep: [],
  runnersUp: [],
  leadBy: 0,
  sheepNeeds: 0,
};

/**
 * The standings, from the team's directory and the counts the database gave.
 * A person the counts do not mention (they joined after the read) plays at 0
 * as a newcomer; a count for someone no longer in the team is left out.
 */
export function teamGameStandings(
  members: readonly OrgMember[],
  scores: readonly TeamGameScore[],
): TeamGameStandings {
  const byId = new Map(scores.map((s) => [s.user_id, s]));
  const unplaced = members.map((member) => {
    const score = byId.get(member.user_id);
    return {
      member,
      actions: Math.max(0, score?.actions ?? 0),
      isNew: score ? score.is_new : true,
      place: 0,
    };
  });
  unplaced.sort(byActionsThenName);
  const players = unplaced.map((p) => ({
    ...p,
    place: 1 + unplaced.filter((q) => q.actions > p.actions).length,
  }));

  const tooSmall = players.length < TEAM_GAME_MIN_PEOPLE;
  const top = players[0]?.actions ?? 0;
  const started = top > 0;
  if (tooSmall || !started) return { players, tooSmall, started, ...NOTHING };

  const leaders = players.filter((p) => p.actions === top);
  const everyoneLevel = leaders.length === players.length;
  const shownLeaders = everyoneLevel ? [] : leaders;

  let runnersUp: TeamGamePlayer[] = [];
  let leadBy = 0;
  if (shownLeaders.length === 1) {
    const second = players[1]?.actions ?? 0;
    runnersUp = players.filter((p) => p.actions === second);
    leadBy = top - second;
  }

  const eligible = players.filter((p) => !p.isNew);
  const bottom = eligible.length > 0 ? Math.min(...eligible.map((p) => p.actions)) : 0;
  const atBottom = eligible.filter((p) => p.actions === bottom);
  const sheep = bottom < top && atBottom.length < eligible.length ? atBottom : [];

  let sheepNeeds = 0;
  if (sheep.length === 1) {
    const nextUp = Math.min(...eligible.filter((p) => p.actions > bottom).map((p) => p.actions));
    sheepNeeds = nextUp - bottom + 1;
  }

  return { players, tooSmall, started, leaders: shownLeaders, sheep, runnersUp, leadBy, sheepNeeds };
}

/** Where one person stands, or null when they are not in the team. */
export function teamGameStanding(
  standings: TeamGameStandings,
  userId: string | null,
): TeamGameStanding | null {
  const player = standings.players.find((p) => p.member.user_id === userId);
  if (!player) return null;
  const above = standings.players.filter((p) => p.actions > player.actions);
  const nearest = above.length > 0 ? Math.min(...above.map((p) => p.actions)) : null;
  return {
    player,
    of: standings.players.length,
    isLeader: standings.leaders.includes(player),
    isSheep: standings.sheep.includes(player),
    next:
      nearest === null
        ? null
        : {
            players: above.filter((p) => p.actions === nearest),
            needs: nearest - player.actions + 1,
          },
  };
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "1 action", "3 actions". */
export function actionCount(n: number): string {
  return `${n} ${n === 1 ? 'action' : 'actions'}`;
}

/** "1 more action", "3 more actions". */
export function moreActions(n: number): string {
  return `${n} more ${n === 1 ? 'action' : 'actions'}`;
}
