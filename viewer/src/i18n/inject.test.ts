import { describe, expect, it } from 'vitest';
import { injectTranslations } from './vite-plugin';

describe('injectTranslations', () => {
  it('rewrites JSX text, attributes and templates on dictionary hits', () => {
    const src = [
      `export function X() {`,
      `  const n = 3;`,
      `  return <div aria-label="Open map file"><b>Sessions</b>{n} maps</div>;`,
      `}`,
    ].join('\n');
    const out = injectTranslations(src);
    expect(out?.code).toContain(`{__ap_t("Sessions")}`);
    expect(out?.code).toContain(`aria-label={__ap_t("Open map file")}`);
    expect(out?.code).toContain(`import { t as __ap_t } from '@/i18n';`);
  });

  it('leaves dictionary misses and structural strings alone', () => {
    const src = `import { x } from 'Sessions';\nconst a = 'className';\nconst b = obj['Sessions'];\nconst c = 'Open map file';\nexport { a, b, c };`;
    const out = injectTranslations(src)!;
    expect(out.code).toContain(`from 'Sessions'`);
    expect(out.code).toContain(`obj['Sessions']`);
    expect(out.code).toContain(`__ap_t("Open map file")`);
  });

  it('builds {aN} keys for interpolated templates', () => {
    const src = 'const x = `Task ${n}`;';
    const out = injectTranslations(src)!;
    expect(out.code).toContain(`__ap_t("Task {a0}", { a0: n })`);
  });

  it('never rewrites enum arrays, comparisons or lookups', () => {
    const src = [
      `type Outcome = 'verified' | 'blocked';`,
      `const ORDER: Outcome[] = ['verified', 'blocked'];`,
      `const NAMES: string[] = ['Verified', 'Blocked'];`,
      `const hit = ORDER.includes('blocked');`,
      `const same = state === 'Blocked';`,
      `const cap = NAMES[0];`,
      `export { ORDER, NAMES, hit, same, cap };`,
    ].join('\n');
    const out = injectTranslations(src)!;
    // 'Verified'/'Blocked' translate only in the plain string[] list.
    expect(out.code).toContain(`const NAMES: string[] = [__ap_t("Verified"), __ap_t("Blocked")]`);
    expect(out.code).not.toContain(`ORDER = [__ap_t`);
    expect(out.code).toContain(`ORDER.includes('blocked')`);
    expect(out.code).toContain(`state === 'Blocked'`);
  });
});
