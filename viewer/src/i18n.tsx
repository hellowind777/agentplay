/**
 * Runtime side of the zh-CN i18n patch.
 *
 * The companion Vite plugin (src/i18n/vite-plugin.mjs) rewrites UI strings in
 * the upstream sources at build time into `t('<English source text>')` calls,
 * so the sources themselves stay untouched and merge cleanly with upstream.
 * This module is what those injected calls resolve to.
 *
 * English is the identity: keys are the exact source strings, and `en` simply
 * returns them. Only zh-CN has a dictionary (src/i18n/zh.mjs); a key missing
 * from it falls back to English, which is what makes upstream updates safe —
 * new upstream strings render in English until the dictionary catches up.
 *
 * Switching locale persists the choice and reloads: the translation happens
 * at render time from module state, and a reload is the one way to re-run it
 * everywhere without threading a subscription through every component.
 */
import { zh } from '@/i18n/zh';
import { Translate } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';

export type Locale = 'en' | 'zh-CN';

function detect(): Locale {
  // The key is inlined, not a module constant: injected modules call `t()`
  // during their own top-level evaluation, which can run before this
  // module's `const` declarations (bundler statement reordering) — a
  // temporal-dead-zone error there would be swallowed below and silently
  // fall back to the OS language.
  try {
    const saved = localStorage.getItem('agentplay.locale');
    if (saved === 'en' || saved === 'zh-CN') return saved;
  } catch {
    /* private mode: fall through to the OS language */
  }
  const langs =
    typeof navigator !== 'undefined' && navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
  return langs.some((l) => /^zh/i.test(l ?? '')) ? 'zh-CN' : 'en';
}

/** The active locale, resolved lazily: modules injected with `t()` calls can
 * import this one (Button does) and run before this module finishes, so
 * nothing may touch module state at load time. */
/** The active locale, resolved lazily. `var`, not `let`: injected modules
 * (Button) import this one and call `t()` while this module is still
 * executing, which would trip a `let`'s temporal dead zone. */
var _locale: Locale | undefined;
export function locale(): Locale {
  if (_locale === undefined) _locale = detect();
  return _locale;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in params ? String(params[key]) : m
  );
}

/** Translate a source-English template; untranslated keys pass through. */
export function t(template: string, params?: Record<string, string | number>): string {
  return interpolate(locale() === 'zh-CN' ? (zh[template] ?? template) : template, params);
}

/** Persist the choice and reload so every rendered string picks it up. */
export function setLocale(next: Locale): void {
  if (next === locale()) return;
  try {
    localStorage.setItem('agentplay.locale', next);
  } catch {
    /* private mode: the reload still applies it for this tab */
  }
  window.location.reload();
}

/** Top-bar switch between the only two locales. Shows the active one. */
export function LocaleToggle() {
  const zh = locale() === 'zh-CN';
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-ds-text-subtle"
      aria-label={zh ? 'Switch to English' : '切换到简体中文'}
      onClick={() => setLocale(zh ? 'en' : 'zh-CN')}
    >
      <Translate size={14} aria-hidden />
      {zh ? '中文' : 'EN'}
    </Button>
  );
}

// Keep <html lang> and the tab title in step from first load on.
if (typeof document !== 'undefined' && locale() === 'zh-CN') {
  document.documentElement.lang = 'zh-CN';
  document.title = 'agentplay 会话查看器';
}
