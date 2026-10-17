import { describe, expect, it } from 'vitest';
import { MENU_PRESETS, menuPresetOptions } from '@/lib/menuPresets';
import { sanitizeMenuOption } from '@/lib/formMenuToken';

describe('menuPresets', () => {
  it('writes every list in each language, and Multi in English', () => {
    expect(menuPresetOptions('days', 'EN')[0]).toBe('Monday');
    expect(menuPresetOptions('days', 'IT')[0]).toBe('lunedì');
    expect(menuPresetOptions('months', 'ES')[11]).toBe('diciembre');
    expect(menuPresetOptions('yesno', 'FR')).toEqual(['Oui', 'Non']);
    expect(menuPresetOptions('priority', 'MULTI')).toEqual(['High', 'Medium', 'Low']);
    expect(menuPresetOptions('nope', 'EN')).toEqual([]);
  });

  it('only holds options the token grammar keeps as they are, with no duplicates', () => {
    for (const preset of MENU_PRESETS) {
      for (const options of Object.values(preset.options)) {
        expect(options.length).toBeGreaterThan(1);
        expect(new Set(options).size).toBe(options.length);
        for (const option of options) expect(sanitizeMenuOption(option)).toBe(option);
      }
    }
  });
});
