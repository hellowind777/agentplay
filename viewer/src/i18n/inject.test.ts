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
});
