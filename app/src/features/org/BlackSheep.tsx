import { cn } from '@/lib/utils';

/**
 * The Black Sheep of the Team game: a black sheep on a light round ground, the
 * same on both themes. Decoration only, so screen readers skip it; the words
 * beside it say who holds the title. Its colours and its little hop when the
 * tile around it (a `group`) is pointed at live in index.css.
 */
export function BlackSheep({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={cn('team-game-sheep shrink-0', className)}
    >
      <circle className="team-game-sheep-ground" cx="24" cy="24" r="24" />
      <g className="team-game-sheep-body">
        <rect className="team-game-sheep-wool" x="18" y="30" width="3" height="10" rx="1.5" />
        <rect className="team-game-sheep-wool" x="29" y="30" width="3" height="10" rx="1.5" />
        <circle className="team-game-sheep-wool" cx="38" cy="23" r="2.6" />
        <circle className="team-game-sheep-wool" cx="20" cy="22" r="7" />
        <circle className="team-game-sheep-wool" cx="28" cy="19.5" r="7" />
        <circle className="team-game-sheep-wool" cx="33" cy="26" r="6.5" />
        <circle className="team-game-sheep-wool" cx="25" cy="29" r="7" />
        <circle className="team-game-sheep-wool" cx="17" cy="28" r="5.5" />
        <ellipse className="team-game-sheep-face" cx="12" cy="24" rx="5" ry="6" />
        <ellipse
          className="team-game-sheep-face"
          cx="9"
          cy="19"
          rx="3.2"
          ry="1.6"
          transform="rotate(-30 9 19)"
        />
        <circle className="team-game-sheep-wool" cx="13.5" cy="18" r="2.4" />
        <circle className="team-game-sheep-eye" cx="10.6" cy="23" r="1.4" />
        <circle className="team-game-sheep-wool" cx="10.3" cy="23.2" r="0.65" />
      </g>
    </svg>
  );
}
