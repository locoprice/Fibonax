import { useRef, useState } from 'react';
import { AlertCircle, ImagePlus, UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pickHttpsUrl, COVER_INPUT_ACCEPT, validateCoverSource } from '@/lib/branding';
import { coverPresetClass, isImageCover, TEAM_COVER_PRESETS } from '@/lib/teamCoverPresets';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TeamSwitcher } from '@/features/org/TeamSwitcher';
import { useAuthStore } from '@/stores/authStore';
import { useOrgStore } from '@/stores/orgStore';
import { useUiStore } from '@/stores/uiStore';

/**
 * Header of the Team page (TEAM-COVER-001): the team cover (a preset gradient
 * or an uploaded image) with the logo card straddling its lower edge and the
 * team name beside it. Admins get one visible **Change cover** button that
 * opens the gallery in a window, where Upload image and Remove cover live
 * too; everyone else sees the cover read-only. The cover is one value per
 * organization, so the whole team sees the same choice.
 *
 * Breaks out of the dashboard content padding (`-mx-8 -mt-8`) so the cover
 * spans full width and meets the top edge, the way a Notion cover does.
 */
export function TeamCover() {
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const setCover = useOrgStore((s) => s.setCover);
  const uploadCover = useOrgStore((s) => s.uploadCover);
  const user = useAuthStore((s) => s.user);
  const showToast = useUiStore((s) => s.showToast);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const isAdmin = activeOrg?.myRole === 'admin';
  const cover = activeOrg?.cover ?? null;
  const hasCover = cover !== null;
  const companyLogo = pickHttpsUrl(user?.user_metadata, 'company_logo_url');
  const orgName = activeOrg?.name ?? 'Team';
  const initial = orgName.slice(0, 1).toUpperCase();

  /** Point the team at a preset or at nothing. True when it landed. */
  async function applyCover(next: string | null): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await setCover(next);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the cover.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // Only type + an outer ceiling here — a large photo gets downscaled during
    // upload rather than rejected.
    const invalid = validateCoverSource(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadCover(file);
      setPickerOpen(false);
      showToast('Cover updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    if (await applyCover(null)) {
      setPickerOpen(false);
      showToast('Cover removed');
    }
  }

  function openPicker() {
    setError(null);
    setPickerOpen(true);
  }

  const coverStyle = isImageCover(cover)
    ? { backgroundImage: `url("${cover}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : undefined;
  const coverClass = !isImageCover(cover) && cover ? coverPresetClass(cover) : '';

  return (
    <div className="mb-6">
      {hasCover && (
        <div
          className={cn('relative -mx-8 -mt-8 h-[150px] overflow-hidden', coverClass)}
          style={coverStyle}
        >
          {/* Always in view, never only on hover: a control people cannot see
              is a control they never use. White on any artwork, in both
              themes, so it never depends on the cover behind it. */}
          {isAdmin && (
            <button
              type="button"
              onClick={openPicker}
              disabled={busy}
              className="absolute bottom-3 right-5 inline-flex items-center gap-1.5 rounded-[8px] border border-black/10 bg-white/90 px-2.5 py-1.5 text-xs font-semibold text-black shadow-sm backdrop-blur-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
            >
              <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
              Change cover
            </button>
          )}
        </div>
      )}

      {/* Identity: the logo card straddles the cover edge (it carries its own
          card surface), the name sits fully below it, so its contrast never
          depends on the artwork. `relative z-10` is load-bearing: the cover
          above is positioned, and a positioned sibling paints over a static
          one regardless of DOM order. */}
      <div
        className={cn(
          'relative z-10 flex gap-4',
          hasCover ? 'mt-4 items-end px-1' : 'items-center',
        )}
      >
        <div
          className={cn(
            'flex h-[68px] w-[68px] shrink-0 items-center justify-center overflow-hidden rounded-[16px] border border-line shadow-sm',
            // Logos are usually dark artwork: keep them on white in both themes
            // (same treatment as the topbar co-brand chip). The initial-letter
            // fallback is azure, so it reads on the normal card surface.
            companyLogo ? 'bg-white' : 'bg-card',
            hasCover && '-mt-[34px]',
          )}
        >
          {companyLogo ? (
            <img
              src={companyLogo}
              alt=""
              draggable={false}
              className="max-h-[52px] max-w-[52px] object-contain"
            />
          ) : (
            <span className="text-2xl font-bold text-primary">{initial}</span>
          )}
        </div>

        {/* The title is the switcher: the name of the team you are looking
            at is also the control that changes it. Falls back to plain text
            when the user has no team (the create panel owns that case). No
            `truncate` here: it sets overflow:hidden, which once clipped the
            switcher's menu. The switcher handles its own overflow. */}
        <h1 className="min-w-0 max-w-full">
          {activeOrg ? (
            <TeamSwitcher name={orgName} />
          ) : (
            <span className="text-2xl font-bold tracking-tight text-ink">{orgName}</span>
          )}
        </h1>

        {isAdmin && !hasCover && (
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-2 text-sm font-medium text-ink-subtle transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            Add cover
          </button>
        )}
      </div>

      {/* Hidden file input for uploads */}
      <input
        ref={fileRef}
        type="file"
        accept={COVER_INPUT_ACCEPT}
        onChange={onPickFile}
        className="hidden"
        aria-label="Upload team cover"
      />

      {/* Gallery (admins only) */}
      <Dialog
        open={isAdmin && pickerOpen}
        onOpenChange={(open) => {
          if (!busy) setPickerOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Team cover</DialogTitle>
            <DialogDescription>Everyone in the team sees the same cover.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-2.5">
            {TEAM_COVER_PRESETS.map((p) => {
              const active = cover === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => void applyCover(p.key)}
                  disabled={busy}
                  aria-pressed={active}
                  title={p.label}
                  className={cn(
                    'relative h-[64px] overflow-hidden rounded-[10px] border border-line transition-shadow disabled:opacity-60',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ring-offset-2 ring-offset-card',
                    coverPresetClass(p.key),
                    active && 'ring-2 ring-primary',
                  )}
                >
                  <span className="absolute bottom-1.5 left-2 text-[11px] font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.4)]">
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-2 text-[12.5px] font-medium text-ink-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
            >
              <UploadCloud className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Working…' : 'Upload image'}
              <span className="text-[11px] font-normal text-ink-subtle">PNG/JPG/WebP · 2 MB</span>
            </button>
            {hasCover && (
              <button
                type="button"
                onClick={() => void onRemove()}
                disabled={busy}
                className="ml-auto rounded-[8px] px-2 py-1.5 text-[12.5px] font-semibold text-ink-subtle transition-colors hover:text-danger disabled:opacity-60"
              >
                Remove cover
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
