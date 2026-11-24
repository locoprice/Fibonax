import type { SearchReason } from '@/lib/searchIndex';

/**
 * The line under a result that says why the search found it when its row does
 * not show the words: the keyword, the label, or the piece of its text around
 * the word. One component for snippets, prompts and Brain items.
 */
export function SearchReasonLine({ reason }: { reason: SearchReason }) {
  return (
    <span className="max-w-full break-words text-xs text-ink-muted">
      {reason.kind === 'Text' ? (
        // What the person wrote: never handed to the page translator.
        <span translate="no">
          {reason.before}
          <mark className="bg-transparent font-semibold text-primary">{reason.hit}</mark>
          {reason.after}
        </span>
      ) : (
        <>
          {reason.kind}:<span translate="no"> {reason.value}</span>
        </>
      )}
    </span>
  );
}
