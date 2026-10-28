import { useState } from 'react';
import { cn } from '@/lib/utils';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

interface AvatarProps {
  name?: string | null;
  email?: string | null;
  /** The person's profile photo (https). Falls back to the initial when missing or broken. */
  src?: string | null;
  /** Highlight as the current user (solid azure fill instead of light tint). */
  highlight?: boolean;
  size?: AvatarSize;
  /** Tooltip override. Defaults to the person's name/email. */
  title?: string;
  className?: string;
}

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
};

function labelFor(name?: string | null, email?: string | null): string {
  return (name && name.trim()) || (email && email.trim()) || 'Teammate';
}

function initialFor(name?: string | null, email?: string | null): string {
  const source = (name && name.trim()) || (email && email.trim());
  return source ? source.slice(0, 1).toUpperCase() : '?';
}

/**
 * A person's face: their photo when they set one in Settings → Account, else
 * an initial circle. The initial stays within the brand primary family (no new
 * palette colors): the current user reads as a solid azure fill, teammates as
 * a light azure tint — the same combo the sidebar and prompt cards already use.
 * Identity comes from the display name, falling back to email. A photo that
 * fails to load gives way to the initial rather than a broken image.
 */
export function Avatar({
  name,
  email,
  src,
  highlight = false,
  size = 'sm',
  title,
  className,
}: AvatarProps) {
  // Remembers which address failed, so a new photo is still tried.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const label = labelFor(name, email);
  const photo = src && src !== brokenSrc ? src : null;
  return (
    <span
      role="img"
      title={title ?? label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-bold',
        SIZE_CLASS[size],
        photo ? 'bg-bg-alt' : highlight ? 'bg-primary text-white' : 'bg-primary-light text-primary',
        className,
      )}
    >
      {photo ? (
        <img
          src={photo}
          alt=""
          draggable={false}
          onError={() => setBrokenSrc(photo)}
          className="h-full w-full object-cover"
        />
      ) : (
        initialFor(name, email)
      )}
    </span>
  );
}
