import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListRow, RowList } from './list-row';
import { CreateLink, PageHeader } from './page-header';
import { PhoneActionBar, keyboardCover } from './phone-action-bar';

describe('PageHeader (UI rules §8)', () => {
  it('has one h1 with the count, the subtitle and the actions on the title row', () => {
    const out = renderToStaticMarkup(<PageHeader title="Meals" count="(4)" subtitle="Shared with all clients" action={<button>x</button>} />);
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain('(4)');
    expect(out).toContain('Shared with all clients');
    expect(out).toContain('<button>x</button>');
  });

  it('draws the back link as "‹ Parent", heard as "Back to Parent"', () => {
    const out = renderToStaticMarkup(<PageHeader title="Chicken bowl" back={{ href: '/meals', label: 'Meals' }} />);
    expect(out).toMatch(/<a [^>]*href="\/meals"/);
    expect(out).toContain('Back to </span>Meals');
    expect(out).toContain('data-chevron="left"');
  });

  it('can leave the h1 to another part of the page', () => {
    const out = renderToStaticMarkup(<PageHeader title="Meals" titleAs="p" />);
    expect(out).not.toContain('<h1');
  });

  it('the create link keeps the full name for screen readers', () => {
    const out = renderToStaticMarkup(<CreateLink href="/meals/new" thing="meal" />);
    expect(out).toContain('aria-label="New meal"');
    expect(out).toMatch(/class="[^"]*create/);
  });
});

describe('ListRow (UI rules §7)', () => {
  it('the row is the link; the action and ⋯ sit outside it', () => {
    const out = renderToStaticMarkup(
      <RowList aria-label="Meals">
        <ListRow href="/meals/1" title="Bowl" meta="580 kcal" action={<button>Assign</button>} more={<button>⋯</button>} />
      </RowList>,
    );
    const link = /<a [^>]*>(.*?)<\/a>/.exec(out)?.[1] ?? '';
    expect(link).toContain('Bowl');
    expect(link).toContain('580 kcal');
    expect(link).not.toContain('Assign');
    expect(out).toContain('aria-label="Meals"');
  });

  it('marks the open row with aria-current', () => {
    expect(renderToStaticMarkup(<ListRow href="/a" title="A" current />)).toContain('aria-current="page"');
    expect(renderToStaticMarkup(<ListRow href="/a" title="A" />)).not.toContain('aria-current');
  });

  it('a list with columns gets a header row and the rows their cells', () => {
    const out = renderToStaticMarkup(
      <RowList columns={['Name', 'Exercises', 'Updated']}>
        <ListRow href="/a" title="A" cells={['4', '10 Nov']} />
      </RowList>,
    );
    expect(out).toContain('data-columns="3"');
    expect(out).toContain('Exercises');
    expect(out).toContain('10 Nov');
  });
});

describe('PhoneActionBar (UI rules §8)', () => {
  it('hides the tab bar while it is shown and reads its status politely', () => {
    const out = renderToStaticMarkup(
      <PhoneActionBar status="Unsaved changes">
        <button>Save</button>
      </PhoneActionBar>,
    );
    expect(out).toContain('data-no-menu-button=""');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('Unsaved changes');
  });

  it('keyboardCover is how much of the page the keyboard hides', () => {
    expect(keyboardCover(844, { height: 844, offsetTop: 0 })).toBe(0);
    expect(keyboardCover(844, { height: 500, offsetTop: 0 })).toBe(344);
    expect(keyboardCover(844, { height: 500, offsetTop: 100 })).toBe(244);
    expect(keyboardCover(844, { height: 900, offsetTop: 0 })).toBe(0);
  });
});
