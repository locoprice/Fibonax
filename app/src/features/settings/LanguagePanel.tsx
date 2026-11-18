import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LanguagePicker } from '@/components/ui/LanguagePicker';

/**
 * "Language" card: the same choice as the globe in the top bar, with the name
 * of the language written out.
 *
 * Kept on this device only, like the theme, so it is not part of the account.
 * The translation is Google's and covers the dashboard's own words; what a
 * person wrote is marked to be left as it is.
 */
export function LanguagePanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Language</CardTitle>
        <CardDescription>
          Shows the dashboard in your language, translated by Google. Your snippets, prompts and
          Brains stay as you wrote them. This applies to this device only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-ink-muted">Dashboard language</span>
          <LanguagePicker variant="named" />
        </div>
      </CardContent>
    </Card>
  );
}
