import { useState } from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { accountApi, type TeamLostOnDelete } from '@/lib/api/accountApi';
import { useAuthStore } from '@/stores/authStore';

const CONFIRM_WORD = 'DELETE';

export function DeleteAccountPanel() {
  const signOut = useAuthStore((s) => s.signOut);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [teamsLost, setTeamsLost] = useState<TeamLostOnDelete[]>([]);
  // Deleting stays locked until the team check succeeds, so nobody deletes a
  // team for everyone without having been told.
  const [checked, setChecked] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDialog() {
    setTyped('');
    setError(null);
    setTeamsLost([]);
    setChecked(false);
    setOpen(true);
    setLoading(true);
    try {
      setTeamsLost(await accountApi.previewDelete());
      setChecked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check your teams. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function onConfirm() {
    if (typed.trim().toUpperCase() !== CONFIRM_WORD || !checked || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await accountApi.deleteAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your account could not be deleted. Try again.');
      setDeleting(false);
      return;
    }
    // The account is gone. Clear this browser's session and reload on the
    // login page, so nothing of the deleted account stays in memory.
    await signOut();
    window.location.replace('/login');
  }

  const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>
            Permanently delete your account, your snippets, prompts and Brains. This cannot be
            undone.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-end">
          <Button
            variant="ghost"
            className="border-danger/30 text-danger hover:border-danger/50 hover:bg-danger/5"
            onClick={() => void openDialog()}
          >
            <Trash2 className="h-4 w-4" />
            Delete account
          </Button>
        </CardFooter>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!deleting) setOpen(next);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This cannot be undone. You'll be signed out on every device.
            </DialogDescription>
          </DialogHeader>

          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink">
            <li>Your personal snippets, prompts, folders and Brains are deleted.</li>
            <li>What you added to a team stays with the team. A team admin takes it over.</li>
          </ul>

          {loading ? (
            <div className="flex items-center gap-3 text-sm text-ink-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Checking your teams…
            </div>
          ) : (
            teamsLost.length > 0 && (
              <div className="rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                <p className="font-semibold">
                  You're the only admin of{' '}
                  {teamsLost.length === 1 ? 'this team' : 'these teams'}. Deleting your account
                  deletes {teamsLost.length === 1 ? 'it' : 'them'} for everyone:
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-5">
                  {teamsLost.map((t) => (
                    <li key={t.organizationId}>
                      <strong>{t.name}</strong>
                      {t.otherMembers > 0 &&
                        ` (${t.otherMembers} other ${t.otherMembers === 1 ? 'person' : 'people'} lose it)`}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs">
                  To keep a team, make someone else an admin on the Team page first.
                </p>
              </div>
            )
          )}

          <div className="grid gap-2">
            <label htmlFor="delete-confirm" className="text-xs font-medium text-ink-muted">
              Type {CONFIRM_WORD} to confirm
            </label>
            <Input
              id="delete-confirm"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(null);
              }}
              autoComplete="off"
              disabled={deleting}
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-xs text-danger" role="alert">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={deleting} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-danger text-white hover:bg-danger/90"
              disabled={!confirmed || !checked || deleting}
              onClick={() => void onConfirm()}
            >
              {deleting ? 'Deleting…' : 'Delete account'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
