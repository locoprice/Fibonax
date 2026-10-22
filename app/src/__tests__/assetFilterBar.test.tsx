import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AssetFilterBar,
  ClearFiltersButton,
  FilterChip,
  SortControl,
} from '@/components/shared/AssetFilterBar';

// The shared bar under the header of Snippets, Prompts and Brains. These pin the
// parts a page relies on: a scope that cannot change is not a button, Clear only
// shows while something narrows the list, and Sort says which way it runs.

const noop = () => {};

describe('FilterChip', () => {
  it('is a button when it can be clicked and says whether it is on', () => {
    const html = renderToStaticMarkup(<FilterChip label="All prompts" count={8} active onClick={noop} />);
    expect(html).toContain('<button');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('All prompts');
    expect(html).toContain('>8<');
  });

  it('is plain text when there is nothing to choose', () => {
    const html = renderToStaticMarkup(<FilterChip label="All Brains" count={8} active />);
    expect(html).not.toContain('<button');
    expect(html).toContain('All Brains');
  });

  it('leaves the count out until it is known', () => {
    const html = renderToStaticMarkup(<FilterChip label="All Brains" active />);
    expect(html).not.toContain('tabular-nums');
  });
});

describe('ClearFiltersButton', () => {
  it('renders nothing while nothing is filtered', () => {
    expect(renderToStaticMarkup(<ClearFiltersButton count={0} onClear={noop} />)).toBe('');
  });

  it('counts what it will clear', () => {
    expect(renderToStaticMarkup(<ClearFiltersButton count={1} onClear={noop} />)).toContain(
      'Clear 1 filter<',
    );
    expect(renderToStaticMarkup(<ClearFiltersButton count={3} onClear={noop} />)).toContain(
      'Clear 3 filters',
    );
  });
});

describe('SortControl', () => {
  const options = [
    { value: 'name', label: 'Name' },
    { value: 'updated_at', label: 'Updated' },
  ] as const;

  it('names the active column and its direction', () => {
    const html = renderToStaticMarkup(
      <SortControl options={options} sortBy="updated_at" sortDir="desc" onSort={noop} />,
    );
    expect(html).toContain('aria-label="Sort by Updated, descending"');
    expect(html).toContain('aria-label="Sort by Name"');
    expect(html).toContain('aria-pressed="true"');
  });
});

describe('AssetFilterBar', () => {
  it('puts the end slot on the right and omits it when empty', () => {
    const withEnd = renderToStaticMarkup(
      <AssetFilterBar end={<span>end</span>}>
        <span>start</span>
      </AssetFilterBar>,
    );
    expect(withEnd).toContain('ml-auto');
    expect(withEnd).toContain('end');

    const without = renderToStaticMarkup(
      <AssetFilterBar>
        <span>start</span>
      </AssetFilterBar>,
    );
    expect(without).not.toContain('ml-auto');
  });
});
