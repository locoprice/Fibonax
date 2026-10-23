import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AssetFilterBar,
  ClearFiltersButton,
  FilterChip,
  FilterDropdown,
  SortControl,
  plainOptions,
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

describe('FilterDropdown', () => {
  const options = plainOptions(['CoT', 'ToT', 'RAG'] as const);
  const icon = <svg data-testid="icon" />;

  it('shows just the name while nothing is chosen', () => {
    const html = renderToStaticMarkup(
      <FilterDropdown label="Strategy" icon={icon} value={null} options={options} onSelect={noop} />,
    );
    expect(html).toContain('Strategy');
    expect(html).not.toContain('Strategy:');
    expect(html).toContain('data-testid="icon"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('names the filter and its value once one is chosen', () => {
    const html = renderToStaticMarkup(
      <FilterDropdown label="Strategy" value="CoT" options={options} onSelect={noop} />,
    );
    expect(html).toContain('Strategy:');
    expect(html).toContain('font-semibold">CoT<');
    // A lit button takes the accent, so it is seen at a glance.
    expect(html).toContain('bg-primary-light');
  });

  it('shows the option label, not its stored value', () => {
    const labelled = [{ value: 'last-7-days' as const, label: 'Last 7 days' }];
    const html = renderToStaticMarkup(
      <FilterDropdown label="Updated" value="last-7-days" options={labelled} onSelect={noop} />,
    );
    expect(html).toContain('Last 7 days');
    expect(html).not.toContain('>last-7-days<');
  });

  it('keeps the menu closed until it is opened', () => {
    const html = renderToStaticMarkup(
      <FilterDropdown label="Strategy" value={null} options={options} onSelect={noop} />,
    );
    expect(html).not.toContain('role="menu"');
  });
});

describe('plainOptions', () => {
  it('uses each value as its own label', () => {
    expect(plainOptions(['a', 'b'] as const)).toEqual([
      { value: 'a', label: 'a' },
      { value: 'b', label: 'b' },
    ]);
  });
});

describe('AssetFilterBar', () => {
  it('keeps the end slot beside the first row and gives the left side the rest', () => {
    const withEnd = renderToStaticMarkup(
      <AssetFilterBar end={<span>end</span>}>
        <span>start</span>
      </AssetFilterBar>,
    );
    expect(withEnd).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(withEnd).toContain('end');
    expect(withEnd).toContain('start');

    const without = renderToStaticMarkup(
      <AssetFilterBar>
        <span>start</span>
      </AssetFilterBar>,
    );
    expect(without).toContain('grid-cols-1');
    expect(without).not.toContain('auto]');
  });

  it('is one named group for assistive technology', () => {
    const html = renderToStaticMarkup(
      <AssetFilterBar>
        <span>start</span>
      </AssetFilterBar>,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Filter and sort"');
  });
});
