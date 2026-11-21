import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BodyMap, BodyMapLegend, parseRegionKey } from './body-map';

describe('BodyMap', () => {
  it('draws a picture (no buttons) when nothing can be picked, with states and pins', () => {
    const html = renderToStaticMarkup(
      <BodyMap view="back" label="Back of body" states={{ 'glute_medius.L': 'under', 'calves.R': 'over', 'lats.L': 'normal' }} pins={[{ key: 'k', label: '2', x: 79, y: 293 }]} />,
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Back of body"');
    expect(html).not.toContain('role="button"');
    expect(html).toContain('data-region="glute_medius.L" data-state="under"');
    expect(html).toContain('data-region="calves.R" data-state="over"');
    expect(html).toContain('data-region="lats.L" data-state="normal"');
    // Under is hatched (a pattern fill), over a solid token colour.
    expect(html).toMatch(/fill="url\(#bm[^"]*h\)"[^>]*data-region="glute_medius.L"/);
    expect(html).toMatch(/fill="var\(--ct-map-over\)"[^>]*data-region="calves.R"/);
    expect(html).toContain('data-pin="2"');
  });

  it('makes each region a named radio in pick mode, one tab stop for the figure', () => {
    const html = renderToStaticMarkup(<BodyMap view="front" label="Front of body" onSelect={() => {}} areas selected={{ id: 'neck', side: 'centre' }} />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Right neck"');
    expect(html).toContain('aria-label="Left knee"');
    expect(html).toContain('aria-label="Abs"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/aria-checked="true"/g)?.length).toBe(2);
    // The tab stop is on the chosen body part.
    expect(html).toMatch(/tabindex="0" data-target="\d+" aria-label="Right neck"/);
    // Glute medius is drawn on the back only.
    expect(html).not.toContain('glute medius');
  });

  it('is one named button in tap mode, with the body parts still marked for a pointer tap', () => {
    const html = renderToStaticMarkup(<BodyMap view="back" label="Flag a body part on the back" onTap={() => {}} />);
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Flag a body part on the back"[^>]*><\/button><\/div>$/);
    expect(html).toMatch(/^<div[^>]*><svg[^>]*aria-hidden="true"/);
    expect(html).not.toContain('role="radio"');
    expect(html).toContain('data-region="knee.L"');
    expect(parseRegionKey('knee.L')).toEqual({ id: 'knee', side: 'L' });
    expect(parseRegionKey('abs')).toEqual({ id: 'abs', side: 'none' });
    expect(parseRegionKey('spleen.L')).toBeNull();
  });

  it('labels the sides from the client’s point of view', () => {
    expect(renderToStaticMarkup(<BodyMap view="front" label="Front" />)).toMatch(/<text x="20" y="412">R<\/text><text x="170" y="412">L<\/text>/);
    expect(renderToStaticMarkup(<BodyMap view="back" label="Back" />)).toMatch(/<text x="20" y="412">L<\/text><text x="170" y="412">R<\/text>/);
  });

  it('has a legend with words for every colour', () => {
    const html = renderToStaticMarkup(<BodyMapLegend />);
    expect(html).toContain('Possibly overactive');
    expect(html).toContain('Possibly underactive');
    expect(html).toContain('Normal');
  });
});
