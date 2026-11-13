import { useRef, useState } from 'react';
import { ArrowUpDown, ArrowUpRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FIBOTOKEN_RATE_TEXT, PRICING_URL, fiboTokenRateView } from '@/lib/fiboTokenRate';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const CHIP =
  'inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-light font-semibold text-primary';

/**
 * "FiboToken exchange rate" card under Settings > Account: the rate today,
 * what an example amount buys and when the rate was set. Rate details opens a
 * window with the full explanation and a link to the packs.
 *
 * The numbers come from src/config/fiboTokenRate.json (see lib/fiboTokenRate.ts).
 */
export function FiboTokenRatePanel() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  // Read on every render, so the "on sale" line follows the clock.
  const view = fiboTokenRateView(Date.now());

  return (
    <Card>
      <CardHeader>
        <CardTitle>{FIBOTOKEN_RATE_TEXT.title}</CardTitle>
        <CardDescription>
          What one FiboToken is worth today. The rate can change; a new rate applies to new packs
          only.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line border-t-4 border-t-primary bg-bg px-4 py-3">
          <p className="font-mono tabular-nums text-ink">
            <span className="sr-only">{view.worth}</span>
            <span aria-hidden>
              <span className="text-sm font-semibold">1 FiboToken</span>
              <span className="mx-2 text-sm text-ink-subtle">=</span>
              <span className="text-2xl font-extrabold tracking-tight text-primary">{view.rate}</span>
            </span>
          </p>
          <span className={cn(CHIP, 'px-2 py-0.5 text-xs')}>
            <ArrowUpDown className="h-3 w-3" aria-hidden />
            {FIBOTOKEN_RATE_TEXT.chip}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-xs leading-relaxed text-ink-muted">
            <span className="block font-mono font-semibold tabular-nums text-ink">{view.example}</span>
            <span className="sr-only">. </span>
            <span className="block">
              {FIBOTOKEN_RATE_TEXT.setOn} {view.setOnDate}
            </span>
          </p>
          <Button
            ref={opener}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
            Rate details
          </Button>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-[520px] gap-5"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{FIBOTOKEN_RATE_TEXT.title}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2">
              {FIBOTOKEN_RATE_TEXT.label}
              <span className={cn(CHIP, 'px-2 py-0.5 text-xs')}>
                <ArrowUpDown className="h-3 w-3" aria-hidden />
                {FIBOTOKEN_RATE_TEXT.chip}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-[12px] border border-line border-t-4 border-t-primary bg-bg px-5 py-5 text-center">
            <p className="font-mono tabular-nums text-ink">
              <span className="sr-only">{view.worth}</span>
              <span aria-hidden>
                <span className="text-xl font-bold">1 FiboToken</span>
                <span className="mx-3 text-xl text-ink-subtle">=</span>
                <span className="text-[42px] font-extrabold leading-none tracking-tight text-primary">
                  {view.rate}
                </span>
              </span>
            </p>
          </div>

          {/* The example and the date split on the golden ratio. */}
          <dl className="grid grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)] gap-3 text-sm">
            <div className="rounded-[12px] bg-bg-alt px-4 py-3">
              <dt className="text-xs text-ink-muted">{FIBOTOKEN_RATE_TEXT.example}</dt>
              <dd className="mt-1 font-mono font-semibold tabular-nums text-ink">{view.example}</dd>
            </div>
            <div className="rounded-[12px] bg-bg-alt px-4 py-3">
              <dt className="text-xs text-ink-muted">{FIBOTOKEN_RATE_TEXT.setOn}</dt>
              <dd className="mt-1 font-semibold text-ink">{view.setOnDate}</dd>
            </div>
          </dl>

          <p className="text-sm leading-relaxed text-ink-muted">{FIBOTOKEN_RATE_TEXT.disclaimer}</p>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            {view.packsNote && (
              <p className="min-w-0 flex-1 text-xs text-ink-muted">{view.packsNote}</p>
            )}
            <a
              href={PRICING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'primary', size: 'md' })}
            >
              {FIBOTOKEN_RATE_TEXT.pricing}
              <ArrowUpRight className="h-4 w-4" aria-hidden />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
