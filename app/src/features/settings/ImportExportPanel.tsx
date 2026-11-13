import { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { exportBrains, parseBrainFile } from '@/lib/brainIo';
import { countOf, exportMessage, importMessage, type Noun } from '@/lib/fileIo';
import { exportPrompts, parsePromptFile } from '@/lib/promptIo';
import { exportSnippets, parseImportFile } from '@/lib/snippetIo';
import { useMemoryStore } from '@/stores/memoryStore';
import { usePromptStore } from '@/stores/promptStore';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';

const SNIPPETS: Noun = { one: 'snippet', other: 'snippets' };
const PROMPTS: Noun = { one: 'prompt', other: 'prompts' };
const BRAINS: Noun = { one: 'Brain', other: 'Brains' };

/** What an import reports: items saved, and items left out (unreadable in the file, or not saved). */
interface ImportOutcome {
  count: number;
  skipped: number;
}

interface RowProps {
  title: string;
  noun: Noun;
  /** How many there are now; null while they load. */
  count: number | null;
  importHint: string;
  exportHint: string;
  /** Saves the file and returns how many went into it. */
  onExport: () => Promise<number>;
  /** Reads the file and adds what it holds. Throws a sentence a person can read. */
  onImport: (file: File) => Promise<ImportOutcome>;
}

/** One kind of thing, with its Import and Export. Snippets, prompts and Brains each get one, identical. */
function ImportExportRow({ title, noun, count, importHint, exportHint, onExport, onImport }: RowProps) {
  const showToast = useUiStore((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const busy = importing || exporting;

  async function handleExport() {
    setExporting(true);
    try {
      showToast(exportMessage(noun, await onExport()));
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Could not export your ${noun.other}.`, 'error');
    } finally {
      setExporting(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected after a failed import.
    e.target.value = '';

    setImporting(true);
    try {
      const { count: added, skipped } = await onImport(file);
      showToast(importMessage(noun, added, skipped), added > 0 ? 'success' : 'error');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed.', 'error');
    } finally {
      setImporting(false);
    }
  }

  const nothingToExport = count === 0;

  return (
    <li className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-ink-muted">{count === null ? 'Loading…' : countOf(noun, count)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title={importHint}
          aria-label={`Import ${noun.other}`}
        >
          <Upload className="h-3.5 w-3.5" />
          {importing ? 'Importing…' : 'Import :)'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void handleExport()}
          disabled={busy || count === null || nothingToExport}
          title={nothingToExport ? `You have no ${noun.other} to export yet.` : exportHint}
          aria-label={`Export ${noun.other}`}
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? 'Exporting…' : 'Export :('}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label={`Choose a file of ${noun.other} to import`}
          onChange={(e) => void handleFileChange(e)}
        />
      </div>
    </li>
  );
}

async function importSnippetFile(file: File): Promise<ImportOutcome> {
  const { valid, skipped } = await parseImportFile(file);
  if (valid.length === 0) throw new Error('No importable snippets found in the file.');
  const { imported, failed } = await useSnippetStore.getState().importSnippets(valid);
  return { count: imported, skipped: skipped + failed };
}

async function importPromptFile(file: File): Promise<ImportOutcome> {
  const { valid, skipped } = await parsePromptFile(file);
  if (valid.length === 0) throw new Error('No importable prompts found in the file.');
  const { imported, failed } = await usePromptStore.getState().importPrompts(valid);
  return { count: imported, skipped: skipped + failed };
}

async function importBrainFile(file: File): Promise<ImportOutcome> {
  const { valid, skipped } = await parseBrainFile(file);
  if (valid.length === 0) throw new Error('No importable Brains found in the file.');
  const { imported, failed } = await useMemoryStore.getState().importBrains(valid);
  return { count: imported, skipped: skipped + failed };
}

/**
 * The one place to save a copy of snippets, prompts and Brains to a file, or to
 * bring a file in. It used to sit in the Snippets page header, crowding the
 * actions people use every day; Prompts and Brains had no way at all.
 */
export function ImportExportPanel() {
  const snippets = useSnippetStore((s) => s.snippets);
  const snippetsLoading = useSnippetStore((s) => s.loading);
  const loadSnippets = useSnippetStore((s) => s.load);
  const prompts = usePromptStore((s) => s.prompts);
  const promptsLoading = usePromptStore((s) => s.loading);
  const loadPrompts = usePromptStore((s) => s.load);
  const spaces = useMemoryStore((s) => s.spaces);
  const spacesLoaded = useMemoryStore((s) => s.loaded);
  const loadSpaces = useMemoryStore((s) => s.loadSpaces);

  // The counts need the lists, and Settings may be the first page opened.
  useEffect(() => {
    if (snippets.length === 0) void loadSnippets();
  }, [loadSnippets, snippets.length]);
  useEffect(() => {
    if (prompts.length === 0) void loadPrompts();
  }, [loadPrompts, prompts.length]);
  useEffect(() => {
    if (!spacesLoaded) void loadSpaces();
  }, [loadSpaces, spacesLoaded]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import and export</CardTitle>
        <CardDescription>
          Save a copy to a file, or bring a file in. Snippets also read a Text Blaze export, and Brains
          carry their text only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-line">
          <ImportExportRow
            title="Snippets"
            noun={SNIPPETS}
            count={snippetsLoading ? null : snippets.length}
            importHint="Import snippets from a JSON file (Fibonax or Text Blaze format)"
            exportHint="Export all snippets as a JSON file"
            onExport={async () => {
              const all = useSnippetStore.getState().snippets;
              exportSnippets(all);
              return all.length;
            }}
            onImport={importSnippetFile}
          />
          <ImportExportRow
            title="Prompts"
            noun={PROMPTS}
            count={promptsLoading ? null : prompts.length}
            importHint="Import prompts from a JSON file"
            exportHint="Export all prompts as a JSON file"
            onExport={async () => {
              const all = usePromptStore.getState().prompts;
              exportPrompts(all);
              return all.length;
            }}
            onImport={importPromptFile}
          />
          <ImportExportRow
            title="Brains"
            noun={BRAINS}
            count={spacesLoaded ? spaces.length : null}
            importHint="Import Brains from a JSON file"
            exportHint="Export all Brains as a JSON file"
            onExport={exportBrains}
            onImport={importBrainFile}
          />
        </ul>
      </CardContent>
    </Card>
  );
}
