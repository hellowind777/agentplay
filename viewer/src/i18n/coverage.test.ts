/**
 * Dictionary coverage check: lists every UI string in the sources that the
 * zh-CN dictionary does not cover yet (and dictionary entries the sources no
 * longer contain). Run after syncing upstream to see what needs translating:
 *
 *   pnpm i18n:check
 *
 * Fails when translations are missing, so a synced-but-untranslated string
 * cannot slip through silently. Keys intentionally left out of the
 * dictionary (generic templates like `{a0} {a1}` that could false-positive
 * elsewhere) belong in INTENTIONALLY_UNTRANSLATED below with a reason.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractCandidates } from './vite-plugin';
import { zh } from './zh';

/** Keys we deliberately do not translate. Generic slot-only templates are
 * unsafe: the same shape can occur in code strings, where swapping in a
 * translated value would corrupt behaviour. */
const INTENTIONALLY_UNTRANSLATED = new Set<string>([
  // Slot-only or near-slot keys are too generic to translate safely: the
  // same template shape can appear in code (style joins), where a swapped-in
  // value would corrupt behaviour.
  ' · {a0}',
  ' · {a0} {a1}',
  ' · {a0}×{a1}',
  '{a0} hook',
  '{a0} inline-flex items-center gap-1',
  // Interpolations carry English words chosen by a ternary inside the
  // template; translating around them reads worse than leaving English.
  'Skill {a0}{a1}',
  // Format-only: identical in Chinese.
  '{a0} · {a1} {a2} UTC',
  // Internal logs and programmer errors, not user-facing.
  'render failed',
  'useSessionMapSource needs a SessionMapSourceProvider',
  'SessionExplorerError',
  // Component displayName / internal labels, not user-facing copy.
  'Button',
  'CommandShortcut',
  'Input',
  'ToggleGroup',
  'ToggleGroupItem',
  // Focus-trap CSS selectors assembled at runtime.
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="listbox"], [role="option"], [role="menu"], [role="dialog"]',
  '{a0}, [role="tab"], [role="radio"]',
  '{a0}, button, summary, a[href], [role="button"]',
  // Nested-template outers: the inner strings translate, the surrounding
  // sentence keeps its English shape (see dropNestedOuter in the plugin).
  '{a0} context in · {a1} out{a2}',
  '{a0} could not be opened: {a1}.',
  // Slots carry lowercase English grammar words chosen in code.
  'Your {a0} {a1} ready',
  'session is',
  'sessions are',
  // Internal logs and error identifiers.
  'session explorer: map failed',
  'session explorer: session list failed',
  'sessionMap not found',
]);

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'i18n') continue;
      listSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) {
      if (full.endsWith(path.join('src', 'i18n.tsx'))) continue; // our runtime
      out.push(full);
    }
  }
  return out;
}

describe('zh dictionary coverage', () => {
  it('covers every UI string in the sources', () => {
    const root = path.resolve(__dirname, '..');
    const files = listSourceFiles(root);
    const uncovered = new Map<string, string[]>();
    const seen = new Set<string>();
    for (const file of files) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      for (const c of extractCandidates(readFileSync(file, 'utf8'))) {
        seen.add(c.key);
        if (c.key in zh || INTENTIONALLY_UNTRANSLATED.has(c.key)) continue;
        const list = uncovered.get(c.key) ?? [];
        list.push(`${rel}:${c.line}`);
        uncovered.set(c.key, list);
      }
    }
    const stale = Object.keys(zh).filter((k) => !seen.has(k));
    if (uncovered.size) {
      console.log(`\n== ${uncovered.size} strings missing from src/i18n/zh.ts ==`);
      for (const [key, where] of [...uncovered].sort()) {
        console.log(`  ${JSON.stringify(key)}  ←  ${where.join(', ')}`);
      }
    }
    if (stale.length) {
      console.log(`\n== ${stale.length} dictionary entries no longer found in sources ==`);
      for (const k of stale) console.log(`  ${JSON.stringify(k)}`);
    }
    expect([...uncovered.keys()]).toEqual([]);
  });
});
