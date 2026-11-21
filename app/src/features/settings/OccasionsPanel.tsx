import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OccasionsDialog } from '@/features/snippets/OccasionsDialog';

/**
 * "Seasonal line" card: the way into Your occasions from Settings, for a
 * person who wants to change a sentence or a period without opening a snippet.
 * The same window the snippet editor opens (Logic, Seasonal line). The
 * calendar belongs to the account, so it follows the person to the extension
 * and the phone.
 */
export function OccasionsPanel() {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seasonal line</CardTitle>
        <CardDescription>
          A snippet with a seasonal line prints your wishes while their occasion is in season, and
          nothing for the rest of the year. Choose the occasions, their days and their words.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Your occasions
        </Button>
        <OccasionsDialog open={open} onOpenChange={setOpen} />
      </CardContent>
    </Card>
  );
}
