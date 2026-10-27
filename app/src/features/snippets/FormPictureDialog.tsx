import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { EditingBanner, ERROR, HINT } from '@/features/snippets/formulaDialogParts';
import { snippetPicturesApi } from '@/lib/api/snippetPicturesApi';
import {
  buildPictureToken,
  PICTURE_INPUT_ACCEPT,
  PICTURE_SIZE_OPTIONS,
  pictureFileError,
  type PictureConfig,
  type PictureSize,
} from '@/lib/pictureToken';
import { cn } from '@/lib/utils';

const STEP = 'mb-1.5 block text-xs font-medium text-ink';

interface FormPictureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The picture being changed, or null to add a new one. Must stay the same
   * object while open: the window reloads whenever it changes.
   */
  initial?: PictureConfig | null;
  /** The pictures already in the snippet, listed above the form. */
  list?: ReactNode;
  /** Leaves the picture being changed as it is and starts a new one. */
  onNew?: () => void;
  onInsert: (token: string) => void;
}

/**
 * Adds a `{picture:}` to the snippet body: choose the picture, say what it
 * shows, pick a size. The file is uploaded on Insert, not on choosing, so a
 * window closed with Cancel leaves nothing behind in storage.
 */
export function FormPictureDialog({ open, onOpenChange, initial = null, list, onNew, onInsert }: FormPictureDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [size, setSize] = useState<PictureSize>('medium');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Every opening starts clean; opened on a picture in the snippet, from that one.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setAlt(initial?.alt ?? '');
    setSize(initial?.size ?? 'medium');
    setError('');
    setBusy(false);
    setDragging(false);
  }, [open, initial]);

  // The chosen file's preview, let go of when it changes or the window goes.
  useEffect(() => {
    if (!file) {
      setLocalUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const shown = localUrl || initial?.src || '';

  function choose(next: File | undefined) {
    if (!next) return;
    const problem = pictureFileError(next);
    setError(problem);
    if (problem) return;
    setFile(next);
    // A file named "Logo.png" says what it shows; a camera's IMG_2041 does not.
    if (alt.trim() === '' && !/^(img|image|dsc|photo|screenshot|pxl)[\W_]*\d/i.test(next.name)) {
      setAlt(next.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim());
    }
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files[0]);
  }

  async function handleSubmit() {
    if (busy || !shown) return;
    let src = initial?.src ?? '';
    if (file) {
      setBusy(true);
      setError('');
      try {
        src = await snippetPicturesApi.upload(file);
      } catch (err) {
        console.error('[FormPictureDialog] the picture upload failed', err);
        setError(
          err instanceof Error && /5 MB|PNG, JPG|empty|session/i.test(err.message)
            ? err.message
            : 'The picture could not be uploaded. Check your connection and try again.',
        );
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    onInsert(buildPictureToken({ src, alt, size }));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-[440px] gap-0 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{initial ? 'Edit picture' : 'Add a picture'}</DialogTitle>
          <DialogDescription>It shows in emails. Chats and plain text boxes get the text only.</DialogDescription>
        </DialogHeader>

        {list && <div className="min-w-0 px-6 pb-3">{list}</div>}

        <div className="max-h-[60vh] overflow-y-auto px-6 pb-2 flex flex-col gap-4">
          {initial && onNew && (
            <EditingBanner onNew={onNew} newLabel="New picture instead">
              Editing {initial.alt || 'a picture'}. Save puts it back where it was.
            </EditingBanner>
          )}

          <section aria-label="Step 1">
            <p className={STEP}>1. Choose the picture</p>
            <input
              ref={fileRef}
              type="file"
              accept={PICTURE_INPUT_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-label="Picture file"
              onChange={(e) => {
                choose(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {shown ? (
              <div
                className="flex items-center gap-3 rounded-[10px] border border-line bg-bg-alt p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
              >
                <img
                  src={shown}
                  alt={alt || 'The chosen picture'}
                  className="h-16 w-24 shrink-0 rounded-[6px] bg-card object-contain"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-ink">{file ? file.name : 'The picture in the snippet'}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    className="mt-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    Choose another
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  'flex w-full flex-col items-center gap-1.5 rounded-[10px] border border-dashed px-3 py-5 text-xs text-ink-muted transition-colors',
                  'hover:border-primary/50 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  dragging ? 'border-primary bg-primary-light' : 'border-line bg-card',
                )}
              >
                <ImagePlus className="h-5 w-5 text-primary" aria-hidden />
                <span>
                  Drop a picture here or <span className="font-medium text-primary">choose a file</span>
                </span>
              </button>
            )}
            <p className={HINT}>PNG, JPG, GIF or WebP, up to 5 MB.</p>
            {error && (
              <p role="alert" className={ERROR}>
                {error}
              </p>
            )}
          </section>

          <section aria-label="Step 2">
            <label htmlFor="picture-alt" className={STEP}>
              2. Say what it shows
            </label>
            <Input
              id="picture-alt"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Company logo"
              className="h-10 rounded-[10px]"
            />
          </section>

          <section aria-label="Step 3">
            <p className={STEP}>3. Size</p>
            <Segmented
              options={PICTURE_SIZE_OPTIONS}
              value={size}
              onChange={setSize}
              ariaLabel="Size"
              disabled={busy}
              className="w-full [&>button]:flex-1"
            />
          </section>
        </div>

        <div className="px-6 py-4 mt-2 border-t border-line flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSubmit()} disabled={busy || !shown}>
            {busy ? 'Uploading…' : initial ? 'Save' : 'Insert picture'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
