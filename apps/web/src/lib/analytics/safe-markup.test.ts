import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Recordings show the text and the readable attributes (aria-label, title, alt, placeholder …) of everything
// inside an element marked data-ph-safe (or phSafe on Button, ButtonLink, Chip, Tile). Such an attribute must
// never be built from data (a program, client or exercise name), so inside a safe element these attributes may
// only hold fixed words. Keep the list equal to SAFE_TEXT_ATTRIBUTES in replay-config.ts.
const SRC = join(__dirname, '..', '..');
const READABLE = new Set(['alt', 'title', 'placeholder', 'aria-label', 'aria-description', 'aria-roledescription']);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [p] : [];
  });
}

/** Fixed words only: a string, or a choice between strings (`pending ? 'Sending…' : 'Send'`). */
function fixed(e: ts.Expression): boolean {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return true;
  if (e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined')) return true;
  if (ts.isParenthesizedExpression(e)) return fixed(e.expression);
  if (ts.isConditionalExpression(e)) return fixed(e.whenTrue) && fixed(e.whenFalse);
  return false;
}

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function markedSafe(el: Opening): boolean {
  return el.attributes.properties.some((a) => {
    if (ts.isJsxSpreadAttribute(a)) return a.getText().includes('data-ph-safe');
    const name = a.name.getText();
    if (name !== 'data-ph-safe' && name !== 'phSafe') return false;
    return !(a.initializer && ts.isJsxExpression(a.initializer) && a.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword);
  });
}

function computedReadableInSafe(source: string, fileName = 'x.tsx'): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const visit = (node: ts.Node, safe: boolean) => {
    let inside = safe;
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening) {
      inside = safe || markedSafe(opening);
      if (inside) {
        for (const a of opening.attributes.properties) {
          if (!ts.isJsxAttribute(a) || !READABLE.has(a.name.getText())) continue;
          const init = a.initializer;
          if (init && ts.isJsxExpression(init) && init.expression && !fixed(init.expression)) {
            hits.push(`${fileName}:${file.getLineAndCharacterOfPosition(a.getStart()).line + 1}: ${a.getText().replace(/\s+/g, ' ').slice(0, 120)}`);
          }
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(file, false);
  return hits;
}

describe('computedReadableInSafe', () => {
  it('flags a computed label on a safe element, on a phSafe component and on anything inside one', () => {
    expect(computedReadableInSafe('const a = <button aria-label={`Assign ${name}`} data-ph-safe="">Assign</button>;')).toHaveLength(1);
    expect(computedReadableInSafe('const a = <Button phSafe title={name}>Save</Button>;')).toHaveLength(1);
    expect(computedReadableInSafe('const a = <div data-ph-safe=""><p><input placeholder={hint} /></p></div>;')).toHaveLength(1);
    expect(computedReadableInSafe("const a = <p {...(safe ? { 'data-ph-safe': '' } : {})}><img alt={name} /></p>;")).toHaveLength(1);
  });
  it('allows fixed words, and computed labels outside safe elements', () => {
    expect(computedReadableInSafe('const a = <button aria-label="Close" data-ph-safe="">x</button>;')).toEqual([]);
    expect(computedReadableInSafe("const a = <button aria-label={open ? 'Close' : 'Open'} data-ph-safe=\"\">x</button>;")).toEqual([]);
    expect(computedReadableInSafe('const a = <button aria-label={`Assign ${name}`}>Assign</button>;')).toEqual([]);
    expect(computedReadableInSafe('const a = <Button phSafe={false} title={name}>Save</Button>;')).toEqual([]);
  });
});

it('no data-ph-safe element holds a computed aria-label, title, alt or placeholder', () => {
  const hits = files(SRC).flatMap((f) => computedReadableInSafe(readFileSync(f, 'utf8'), f.slice(SRC.length + 1)));
  expect(hits).toEqual([]);
});
