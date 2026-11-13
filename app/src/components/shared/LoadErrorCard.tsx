import { Card } from '@/components/ui/card';

interface LoadErrorCardProps {
  /** What could not load, as one plain sentence. */
  title: string;
  /** The reason and what to do next. */
  message: string;
  onRetry: () => void;
}

/** Stands in for a page's content when its data could not load, with one way forward. */
export function LoadErrorCard({ title, message, onRetry }: LoadErrorCardProps) {
  return (
    <Card className="flex items-center justify-between gap-4 p-6">
      <div>
        <p className="font-medium text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-muted">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-[8px] bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Try again
      </button>
    </Card>
  );
}
