import { Fragment, useEffect, useState } from 'react';
import { Crown, Flag } from 'lucide-react';
import { Avatar } from '@/components/shared/Avatar';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { BlackSheep } from '@/features/org/BlackSheep';
import { CardHeading } from '@/features/org/CardHeading';
import { orgApi } from '@/lib/api/orgApi';
import { memberName } from '@/lib/orgChart';
import {
  actionCount,
  moreActions,
  ordinal,
  teamGameStanding,
  TEAM_GAME_DAYS,
  TEAM_GAME_GRACE_DAYS,
  TEAM_GAME_MIN_PEOPLE,
  type TeamGamePlayer,
  type TeamGameStandings,
} from '@/lib/teamGame';
import { useOrgStore } from '@/stores/orgStore';
import { useUiStore } from '@/stores/uiStore';
import type { TeamGameScore } from '@/types/database';

// The Team game on the Team page: the card with the Team Leader and the Black
// Sheep, the row that lets an admin start it, and the small badge each title
// puts on a face in the People list. Who holds which title is decided in
// lib/teamGame.ts; this file only draws it.

/** The title a person holds in the game, if any. */
export type TeamGameTitle = 'leader' | 'sheep';

/** The team's counts while its game is on; nothing is read while it is off. */
export function useTeamGameScores(orgId: string | null, on: boolean) {
  const [scores, setScores] = useState<TeamGameScore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setScores(null);
    setError(null);
    if (!orgId || !on) return;
    let live = true;
    orgApi
      .getTeamGameScores(orgId)
      .then((rows) => {
        if (live) setScores(rows);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Try again in a moment.');
      });
    return () => {
      live = false;
    };
  }, [orgId, on, attempt]);

  return { scores, error, retry: () => setAttempt((n) => n + 1) };
}

/** Switch the game, with the toast that says what happened. */
function useSwitchTeamGame() {
  const setTeamGame = useOrgStore((s) => s.setTeamGame);
  const showToast = useUiStore((s) => s.showToast);
  const [busy, setBusy] = useState(false);

  async function switchTo(on: boolean) {
    setBusy(true);
    try {
      await setTeamGame(on);
      showToast(on ? 'Team game started. Everyone in the team sees it.' : 'Team game turned off.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not switch the team game.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return { busy, switchTo };
}

/**
 * "Anna", "Anna and Bruno", "Anna, Bruno and Carla", "Anna, Bruno and 2 more".
 * Each name keeps `translate="no"`, with the spaces around it inside the
 * protected piece (Google drops a space left outside); the words between the
 * names may be translated. `lead` starts with a space, for a name that follows
 * a word ("ahead of Anna").
 */
function PeopleNames({ players, lead = false }: { players: TeamGamePlayer[]; lead?: boolean }) {
  const named = players.length > 3 ? players.slice(0, 2) : players;
  const more = players.length - named.length;
  return (
    <>
      {named.map((p, i) => {
        const last = i === named.length - 1;
        // What follows this name: nothing, a comma, or "and".
        const andNext = (i === named.length - 2 && more === 0) || (last && more > 0);
        const before = i > 0 || lead ? ' ' : '';
        return (
          <Fragment key={p.member.user_id}>
            <span translate="no">{`${before}${memberName(p.member)}${andNext ? ' ' : ''}`}</span>
            {last ? (more > 0 ? `and ${more} more` : '') : andNext ? 'and' : ','}
          </Fragment>
        );
      })}
    </>
  );
}

/** The crown, filled gold with an amber edge so it reads on both themes. */
function GoldCrown({ className }: { className?: string }) {
  return <Crown aria-hidden="true" className={`fill-warning text-warning-deep ${className ?? ''}`} />;
}

function LeaderTile({ standings }: { standings: TeamGameStandings }) {
  const { leaders, runnersUp, leadBy, started } = standings;
  const faces = leaders.slice(0, 2);
  const top = leaders[0]?.actions ?? 0;
  return (
    <div className="group flex min-w-0 items-center gap-4 rounded-[12px] bg-warning/10 p-4">
      <span className="relative flex shrink-0 pt-3">
        {faces.length > 0 ? (
          <span className="flex -space-x-3">
            {faces.map((p) => (
              <Avatar
                key={p.member.user_id}
                src={p.member.avatar_url}
                name={p.member.display_name}
                email={p.member.email}
                size="lg"
                className="ring-2 ring-card"
              />
            ))}
          </span>
        ) : (
          <span className="h-12 w-12 rounded-full border-2 border-dashed border-warning-deep/40" />
        )}
        <GoldCrown className="absolute inset-x-0 -top-1.5 mx-auto h-6 w-6 motion-safe:group-hover:animate-status-cheer" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-semibold text-ink-muted">Team Leader</span>
        <span className="truncate text-base font-semibold text-ink">
          {leaders.length > 0 ? (
            <PeopleNames players={leaders} />
          ) : started ? (
            'Everyone is level'
          ) : (
            'Nobody yet'
          )}
        </span>
        <span className="text-[13px] text-ink-muted">
          {leaders.length === 1 ? (
            <>
              {`${actionCount(top)}, ${leadBy} ahead of`}
              <PeopleNames lead players={runnersUp} />.
            </>
          ) : leaders.length > 1 ? (
            `Level at ${actionCount(top)}. The next action takes the crown.`
          ) : started ? (
            'The next action takes the crown.'
          ) : (
            'The first action takes the crown.'
          )}
        </span>
      </span>
    </div>
  );
}

function SheepTile({ standings }: { standings: TeamGameStandings }) {
  const { sheep, sheepNeeds, started } = standings;
  const bottom = sheep[0]?.actions ?? 0;
  return (
    <div className="group flex min-w-0 items-center gap-3 rounded-[12px] bg-bg-alt p-4">
      <BlackSheep size={52} />
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-semibold text-ink-muted">Black Sheep</span>
        <span className="truncate text-[15px] font-semibold text-ink">
          {sheep.length > 0 ? <PeopleNames players={sheep} /> : started ? 'Nobody' : 'Nobody yet'}
        </span>
        <span className="text-[13px] text-ink-muted">
          {sheep.length === 1
            ? `${actionCount(bottom)}. ${moreActions(sheepNeeds)} and the title moves on.`
            : sheep.length > 1
              ? `Level at ${actionCount(bottom)}. One action each gets them out.`
              : started
                ? 'Nobody is behind on their own.'
                : 'The game has just begun.'}
        </span>
      </span>
    </div>
  );
}

/** One line for the person reading: where they stand and what it takes to climb. */
function MyLine({ standings, userId }: { standings: TeamGameStandings; userId: string | null }) {
  const me = teamGameStanding(standings, userId);
  if (!me) return null;

  let line: React.ReactNode;
  if (!standings.started) {
    line = 'Use, add or improve a snippet or prompt in a team folder to open the score.';
  } else if (me.isLeader) {
    line =
      standings.leaders.length === 1
        ? `You're the Team Leader, ${standings.leadBy} ahead. Keep it up.`
        : 'You share the crown. One more action makes it yours.';
  } else if (me.isSheep) {
    line =
      standings.sheep.length === 1
        ? `You're the Black Sheep for now. ${moreActions(standings.sheepNeeds)} hand the title on.`
        : 'You share the Black Sheep title. One action gets you out.';
  } else {
    line = (
      <>
        You're {ordinal(me.player.place)} of {me.of}.
        {me.next && (
          <>
            {` ${moreActions(me.next.needs)} to pass`}
            <PeopleNames lead players={me.next.players} />.
          </>
        )}
        {me.player.isNew &&
          ` You're new, so you can't be the Black Sheep for your first ${TEAM_GAME_GRACE_DAYS} days.`}
      </>
    );
  }

  return (
    <p className="flex items-start gap-2 px-5 pt-3 text-sm text-ink">
      <Flag className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{line}</span>
    </p>
  );
}

/**
 * The game itself, shown to everyone in the team while it is on. An admin can
 * turn it off from its heading.
 */
export function TeamGameCard({
  isAdmin,
  canInvite,
  standings,
  error,
  onRetry,
  currentUserId,
}: {
  isAdmin: boolean;
  canInvite: boolean;
  standings: TeamGameStandings | null;
  error: string | null;
  onRetry: () => void;
  currentUserId: string | null;
}) {
  const { busy, switchTo } = useSwitchTeamGame();

  return (
    <section className="rounded-[16px] border border-line bg-card" aria-labelledby="team-game-title">
      <CardHeading
        id="team-game-title"
        title="Team game"
        detail={`last ${TEAM_GAME_DAYS} days`}
        action={
          isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => void switchTo(false)} disabled={busy}>
              Turn off
            </Button>
          )
        }
      />

      {error ? (
        <div className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
          <span className="text-ink-muted">The team game could not load. {error}</span>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : !standings ? (
        <p className="px-5 py-4 text-sm text-ink-subtle" role="status">
          Loading the team game…
        </p>
      ) : standings.tooSmall ? (
        <p className="px-5 py-4 text-sm text-ink-muted">
          The game starts when your team has {TEAM_GAME_MIN_PEOPLE} people.
          {canInvite && ' Invite people to begin.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)] gap-3 px-5 pt-4">
            <LeaderTile standings={standings} />
            <SheepTile standings={standings} />
          </div>
          <MyLine standings={standings} userId={currentUserId} />
          <p className="mt-3 border-t border-line px-5 py-2.5 text-xs text-ink-subtle">
            An action is each time someone uses, adds or improves a snippet or prompt in a team
            folder. Nobody is the Black Sheep in their first {TEAM_GAME_GRACE_DAYS} days.
          </p>
        </>
      )}
    </section>
  );
}

/** For admins while the game is off: what it is, and the one button that starts it. */
export function TeamGameStart() {
  const { busy, switchTo } = useSwitchTeamGame();
  return (
    <section
      className="group flex items-center gap-4 rounded-[16px] border border-line bg-card px-5 py-4"
      aria-labelledby="team-game-start-title"
    >
      <span className="flex shrink-0 items-center -space-x-2">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-warning/15 ring-2 ring-card">
          <GoldCrown className="h-5 w-5" />
        </span>
        <BlackSheep size={40} className="rounded-full ring-2 ring-card" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <h2 id="team-game-start-title" className="text-sm font-semibold text-ink">
          Team game
        </h2>
        <span className="text-sm text-ink-muted">
          Crown the most active person of the last {TEAM_GAME_DAYS} days as Team Leader, and give
          the least active a friendly nudge as the Black Sheep. Everyone in the team sees it.
        </span>
      </span>
      <Button variant="ghost" size="sm" onClick={() => void switchTo(true)} disabled={busy}>
        Start the team game
      </Button>
    </section>
  );
}

/** The crown or the sheep on a face in the People list, named for screen readers. */
export function TeamGameBadge({ title }: { title: TeamGameTitle }) {
  const label = title === 'leader' ? 'Team Leader' : 'Black Sheep';
  return (
    <Tooltip label={label} className="absolute -right-1.5 -top-1.5">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-card shadow-sm ring-1 ring-line">
        {title === 'leader' ? <GoldCrown className="h-3.5 w-3.5" /> : <BlackSheep size={20} />}
        <span className="sr-only">{label}</span>
      </span>
    </Tooltip>
  );
}
