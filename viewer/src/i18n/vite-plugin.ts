/**
 * Build-time i18n injection for the agentplay viewer.
 *
 * Upstream sources are never edited for translation: at build time this
 * plugin parses each module and rewrites the strings that the zh-CN
 * dictionary (./zh) lists into `t('<source text>')` calls from ../i18n.
 * Dictionary misses are left untouched, so they render in English until the
 * dictionary catches up — that is what keeps upstream merges painless.
 *
 * What gets rewritten (only on a dictionary hit, which protects logic
 * strings from ever being touched):
 *   JSX text          <b>Sessions</b>            → <b>{t('Sessions')}</b>
 *   JSX attribute     aria-label="Dismiss"       → aria-label={t('Dismiss')}
 *   string literal    'Sessions'                 → t('Sessions')
 *   template literal  `${n} maps`                → t('{n} maps', { n })
 *
 * Skipped on principle, hit or not: import/export specifiers, directive
 * prologues, property keys and computed member access, tagged templates,
 * type positions (TSLiteralType), and every file under src/i18n, *.test.*,
 * scripts/ and node_modules.
 */
import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import { zh } from './zh';

// `__ap_t`, never bare `t`: source functions commonly have a parameter or
// local named `t` (sessionMapModel does), which would shadow the import.
const T_IMPORT = "import { t as __ap_t } from '@/i18n';\n";

/** A JS string literal for `s`. JSON.stringify escapes every hazard
 * (quotes, newlines, line separators) and is valid JS. */
function quote(s: string): string {
  return JSON.stringify(s);
}

const SKIP_KEYS = new Set([
  'loc',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'start',
  'end',
]);

interface Node {
  type: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

function walk(node: unknown, parent: Node | null, parentKey: string | null, visit: (n: Node, p: Node | null, pk: string | null) => void): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Node;
  if (typeof n.type !== 'string') return;
  visit(n, parent, parentKey);
  for (const key of Object.keys(n)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = (n as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      for (const item of v) walk(item, n, key, visit);
    } else {
      walk(v, n, key, visit);
    }
  }
}

/** Positions whose string must keep its exact value to stay code, not copy. */
function isStructural(node: Node, parent: Node | null, parentKey: string | null): boolean {
  if (!parent) return false;
  switch (parent.type) {
    case 'ImportDeclaration':
    case 'ExportNamedDeclaration':
    case 'ExportAllDeclaration':
    case 'DeclareModule':
      return parentKey === 'source';
    case 'Directive':
    case 'DirectiveLiteral':
      return true;
    case 'ObjectProperty':
    case 'ClassProperty':
    case 'ClassPrivateProperty':
    case 'TSPropertySignature':
    case 'TSAbstractClassProperty':
      return parentKey === 'key';
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return parentKey === 'property';
    case 'TSLiteralType':
      return true;
    case 'TaggedTemplateExpression':
      return parentKey === 'quasi';
    default:
      return false;
  }
}

/**
 * Positions where a string is compared, looked up or enumerated rather than
 * displayed. Rewriting there would break logic the moment the dictionary
 * translates it (`OUTCOME_ORDER` holding `t("blocked")` made the Insights
 * view crash on lookup). Value positions never render directly, so skipping
 * them only costs a fallback to English.
 */
function isValuePosition(node: Node, parent: Node | null, parentKey: string | null): boolean {
  if (!parent) return false;
  // `x === 'lit'`, `'lit' in obj`, ordering comparisons…
  if (parent.type === 'BinaryExpression') return true;
  // switch (x) { case 'lit': … }
  if (parent.type === 'SwitchCase' && parentKey === 'test') return true;
  // xs.includes('lit'), map.has('lit'), s.startsWith('lit') …
  if (parent.type === 'CallExpression' && parentKey === 'arguments') {
    const callee = parent.callee as { type: string; property?: { type: string; name?: string; value?: string } } | undefined;
    if (callee?.type === 'MemberExpression') {
      const prop = callee.property;
      const name = prop?.type === 'Identifier' ? prop.name : prop?.type === 'StringLiteral' ? prop.value : undefined;
      if (name && /^(includes|indexOf|lastIndexOf|startsWith|endsWith|has|hasOwn|findIndex|find|filter|some|every)$/.test(name)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Arrays initialized under a declaration with a non-string type annotation
 * (`const ORDER: SessionOutcome[] = […]`, `new Set<AgentId>([…])`) — enum
 * or value lists whose members must keep their exact spelling. The walker
 * visits a VariableDeclarator before its elements, so this is filled in
 * time for the element checks.
 */
function collectEnumArrays(root: Node): WeakSet<Node> {
  const out = new WeakSet<Node>();
  walk(root, null, null, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    const ann = (node.id as { typeAnnotation?: { typeAnnotation?: Node } }).typeAnnotation?.typeAnnotation;
    if (!ann || isPlainStringType(ann)) return;
    const init = node.init as Node | null | undefined;
    if (init?.type === 'ArrayExpression') out.add(init);
    if (init?.type === 'NewExpression' || init?.type === 'CallExpression') {
      for (const arg of ((init as { arguments?: Node[] }).arguments ?? []) as Node[]) {
        if (arg.type === 'ArrayExpression') out.add(arg);
      }
    }
  });
  return out;
}

/** `string`, `string[]`, `readonly string[]`, `Array<string>` — safe to translate. */
function isPlainStringType(ann: Node): boolean {
  if (ann.type === 'TSTypeOperator') return isPlainStringType(ann.typeAnnotation as Node);
  if (ann.type === 'TSArrayType') return (ann.elementType as Node)?.type === 'TSStringKeyword';
  if (ann.type === 'TSStringKeyword') return true;
  if (ann.type === 'TSTypeReference') {
    const name = (ann.typeName as { name?: string })?.name;
    if (name === 'string') return true;
    if (name === 'Array') {
      const param = (ann.typeParameters as { params?: Node[] })?.params?.[0];
      return param?.type === 'TSStringKeyword';
    }
  }
  return false;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
  /** Source ranges of the parameter expressions, to detect nesting. */
  exprRanges?: [number, number][];
}

/** A replacement whose parameters contain another replacement would have
 * those spans overwritten twice; the inner one wins and the outer is left
 * as English. */
function dropNestedOuter(replacements: Replacement[]): Replacement[] {
  return replacements.filter(
    (r) =>
      !r.exprRanges?.some(([es, ee]) =>
        replacements.some((o) => o !== r && o.start < ee && es < o.end)
      )
  );
}

/** True inside a `t(...)` / `__ap_t(...)` call — its argument is already
 * translated source, hand-patched or from an earlier pass. */
function isInsideTCall(parent: Node | null, parentKey: string | null): boolean {
  if (!parent || parent.type !== 'CallExpression' || parentKey !== 'arguments') return false;
  const callee = parent.callee as { type: string; name?: string } | undefined;
  return callee?.type === 'Identifier' && (callee.name === 't' || callee.name === '__ap_t');
}

/** Rewrite `code` per the dictionary; returns null when nothing matched. */
export function injectTranslations(code: string) {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
  const enumArrays = collectEnumArrays(ast.program as unknown as Node);
  const replacements: Replacement[] = [];
  walk(ast.program, null, null, (node, parent, parentKey) => {
    if (node.start == null || node.end == null) return;
    if (parent?.type === 'ArrayExpression' && enumArrays.has(parent)) return;

    if (node.type === 'JSXText') {
      const trimmed = String(node.value).trim();
      if (!trimmed || !(trimmed in zh)) return;
      const lead = /^\s*/.exec(String(node.value))![0];
      const trail = /\s*$/.exec(String(node.value))![0];
      replacements.push({
        start: node.start,
        end: node.end,
        text: `${lead}{__ap_t(${quote(trimmed)})}${trail}`,
      });
      return;
    }

    if (isStructural(node, parent, parentKey)) return;
    if (isInsideTCall(parent, parentKey)) return;
    if (isStylePosition(node, parent, parentKey)) return;
    if (isValuePosition(node, parent, parentKey)) return;

    if (node.type === 'StringLiteral') {
      const value = String(node.value);
      if (!(value in zh)) return;
      const call = `__ap_t(${quote(value)})`;
      replacements.push({
        start: node.start,
        end: node.end,
        text: parent?.type === 'JSXAttribute' ? `{${call}}` : call,
      });
      return;
    }

    if (node.type === 'TemplateLiteral') {
      const quasis = node.quasis as { value: { cooked: string } }[];
      const exprs = (node.expressions ?? []) as Node[];
      if (!quasis.length) return;
      if (!exprs.length) {
        const cooked = quasis[0].value.cooked;
        if (cooked && cooked in zh) {
          replacements.push({ start: node.start, end: node.end, text: `__ap_t(${quote(cooked)})` });
        }
        return;
      }
      // Interpolated: the dictionary key is the template with {a0}… slots.
      let key = '';
      const params: string[] = [];
      const exprRanges: [number, number][] = [];
      exprs.forEach((expr, i) => {
        key += (quasis[i].value.cooked ?? '') + `{a${i}}`;
        if (expr.start == null || expr.end == null) return;
        params.push(`a${i}: ${code.slice(expr.start, expr.end)}`);
        exprRanges.push([expr.start, expr.end]);
      });
      key += quasis[exprs.length].value.cooked ?? '';
      if (key in zh && params.length === exprs.length) {
        replacements.push({
          start: node.start,
          end: node.end,
          text: `__ap_t(${quote(key)}, { ${params.join(', ')} })`,
          exprRanges,
        });
      }
    }
  });

  if (!replacements.length) return null;
  const applied = dropNestedOuter(replacements);
  if (!applied.length) return null;
  // Inject `import { t }` unless the module already imports it. Checking the
  // AST, not the raw text: a module can mention '@/i18n' (the LocaleToggle
  // mount does) without importing `t` itself.
  const hasT = ast.program.body.some(
    (stmt) =>
      stmt.type === 'ImportDeclaration' &&
      /(^|\/)i18n$/.test(String(stmt.source.value)) &&
      (stmt.specifiers ?? []).some(
        (spec) => spec.type === 'ImportSpecifier' && spec.local?.name === '__ap_t'
      )
  );
  const s = new MagicString(code);
  // Replace innermost-first: same span never matches twice, but nested
  // template expressions were already sliced as source text, not rewritten.
  for (const r of applied) s.overwrite(r.start, r.end, r.text);
  if (!hasT) s.prepend(T_IMPORT);
  // `sourcesContent` may hold nulls, which Vite's map type rejects.
  const map = s.generateMap({ hires: true, includeContent: false });
  return { code: s.toString(), map: { ...map, sourcesContent: undefined } };
}

/** Positions whose strings are style or code, never UI copy. */
function isStylePosition(node: Node, parent: Node | null, parentKey: string | null): boolean {
  if (!parent) return false;
  // <div className="…"> / <button title-class=…> style attributes
  if (parent.type === 'JSXAttribute' && parentKey === 'value') {
    const name = parent.name as { type: string; name?: unknown } | undefined;
    if (name?.type === 'JSXIdentifier' && /^(className|style|variants|class|rel|accept|encoding|xmlns|d)$/.test(String(name.name))) {
      return true;
    }
  }
  // cn('flex …', …) / cva('…', …) class helper arguments
  if (parent.type === 'CallExpression' && parentKey === 'arguments') {
    const callee = parent.callee as { type: string; name?: string; property?: { name?: string } } | undefined;
    const id = callee?.type === 'Identifier' ? callee.name : callee?.property?.name;
    if (id && /^(cn|clsx|cva|twMerge|classify)$/.test(id)) return true;
  }
  return false;
}

/** Whole strings that are key names, font stacks or canvas paint settings. */
const NON_COPY_PATTERNS = [
  /^(Arrow(Up|Down|Left|Right)|Enter|Escape|Space|Shift|Tab|Home|End|PageUp|PageDown|Meta|Control|Alt)$/,
  /\bpx\s+(sans-serif|monospace|serif|ui-monospace|system-ui)\b/, // font stacks
  /^\d+(\.\d+)?(px|rem|em|%|s|ms)\b/i, // size/duration literals
  /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/,
  /^M[\d .CcSsLlHhVvAaQqTtZz-]+( ?[MmLlCcAaSs])?$/, // SVG path data
  /^[A-Z][A-Za-z0-9]*Error$/, // error class names
  /^(noopener|noreferrer|noopener noreferrer)$/,
  /^(translate[XYZ]|rotate|scale|skew[XY]|calc)\(/, // CSS/SVG transform fns
  /^(xMin|xMid|xMax)(YMin|YMid|YMax) (meet|slice)$/, // SVG preserveAspectRatio
  /^var\(--/, // CSS custom property values
];

/** Heuristic: does this string read like UI copy rather than code? */
function looksLikeCopy(s: string): boolean {
  if (!s || s.length < 2) return false;
  if (!/[a-zA-Z]/.test(s)) return false;
  if (NON_COPY_PATTERNS.some((re) => re.test(s))) return false;
  if (/^[a-z0-9_.\-/:#]+$/.test(s)) return false; // tokens, paths, query keys
  // Tailwind-style class lists: lowercase kebab tokens only, no sentence
  // punctuation — `border-t border-x`, `pointer-events-none absolute inset-0`.
  if (!/[A-Z]/.test(s) && /\s/.test(s) && !/[.!?…,;:'"()]$/.test(s)) {
    const tokens = s.trim().split(/\s+/);
    if (tokens.length >= 2 && tokens.every((tk) => /^[\w./[\]%():-]+$/.test(tk) && !/^[a-z]+ [a-z]+ [a-z]+ [a-z]+ [a-z]+$/.test(tk))) {
      const kebabish = tokens.filter((tk) => /-|\[|\d|:/.test(tk) || /^(flex|grid|block|hidden|absolute|relative|truncate|underline)$/.test(tk));
      if (kebabish.length >= Math.ceil(tokens.length / 2)) return false;
    }
  }
  // Tailwind-style class lists: wordly tokens, at least one `x:y` utility
  if (/\s/.test(s) && /(^|\s)[a-z][\w-]*:[\w./-]+/.test(s) && !/[.!?…]$/.test(s)) return false;
  // Templates that open with Tailwind tokens before the first slot
  // (`h-3 w-1/2 {a0}`): every pre-slot word is a utility class.
  const beforeFirstSlot = s.split(/\{a\d+\}/)[0] ?? '';
  if (/\{a\d+\}/.test(s) && beforeFirstSlot.trim()) {
    const toks = beforeFirstSlot.trim().split(/\s+/);
    if (toks.every((tk) => /^[\w./[\]%():.-]+$/.test(tk)) && toks.some((tk) => /-|\[|\d/.test(tk))) {
      const words = s.replace(/\{a\d+\}/g, ' ').split(/\s+/).filter((w) => /^[a-zA-Z]{2,}$/.test(w));
      if (words.length <= 1) return false;
    }
  }
  // Every non-slot token a utility class (`{a0} flex flex-col gap-2 p-3`).
  if (/\{a\d+\}/.test(s)) {
    const TW_BARE = new Set(['flex', 'grid', 'block', 'hidden', 'absolute', 'relative', 'fixed', 'sticky', 'truncate', 'underline']);
    const toks = s.split(/\{a\d+\}/).join(' ').trim().split(/\s+/).filter(Boolean);
    if (toks.length && toks.every((tk) => /[-:.[\]()/%\d#]/.test(tk) || TW_BARE.has(tk))) return false;
  }
  // Slot-only remainders (" · {a0}", " ({a0})", ", {a0}"): nothing solid to key on
  const solid = s.replace(/\{a\d+\}/g, '').replace(/[\s·,;:()[\]{}#+"/&%=*<>~^|._-]/g, '');
  if (solid.length < 3) return false;
  return /^[ A-Z]/.test(s) || /\s/.test(s) || /[.…:?!]$/.test(s);
}

export interface Candidate {
  key: string;
  kind: 'jsx' | 'str' | 'tpl';
  line: number;
}

/**
 * List the UI strings of a module that look translatable, whether or not the
 * dictionary covers them. Powers the coverage check test: after syncing
 * upstream, its report is the list of strings needing dictionary entries.
 */
export function extractCandidates(code: string): Candidate[] {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
  const enumArrays = collectEnumArrays(ast.program as unknown as Node);
  const out: Candidate[] = [];
  const lineOf = (offset: number) => code.slice(0, offset).split('\n').length;
  walk(ast.program, null, null, (node, parent, parentKey) => {
    if (node.start == null) return;
    if (parent?.type === 'ArrayExpression' && enumArrays.has(parent)) return;
    const line = lineOf(node.start);
    if (node.type === 'JSXText') {
      const trimmed = String(node.value).trim();
      if (trimmed && looksLikeCopy(trimmed)) out.push({ key: trimmed, kind: 'jsx', line });
      return;
    }
    if (isStructural(node, parent, parentKey)) return;
    if (isInsideTCall(parent, parentKey)) return;
    if (isStylePosition(node, parent, parentKey)) return;
    if (isValuePosition(node, parent, parentKey)) return;
    if (node.type === 'StringLiteral') {
      if (looksLikeCopy(String(node.value))) out.push({ key: String(node.value), kind: 'str', line });
      return;
    }
    if (node.type === 'TemplateLiteral') {
      const quasis = node.quasis as { value: { cooked: string } }[];
      const exprs = (node.expressions ?? []) as Node[];
      if (!quasis.length) return;
      if (!exprs.length) {
        const cooked = quasis[0].value.cooked ?? '';
        if (looksLikeCopy(cooked)) out.push({ key: cooked, kind: 'tpl', line });
        return;
      }
      let key = '';
      exprs.forEach((_, i) => {
        key += (quasis[i].value.cooked ?? '') + `{a${i}}`;
      });
      key += quasis[exprs.length].value.cooked ?? '';
      if (looksLikeCopy(key)) out.push({ key, kind: 'tpl', line });
    }
  });
  return out;
}

const SKIP_ID = /[\\/](src[\\/]i18n|scripts|node_modules)[\\/]|\.test\.|\.spec\.|\.d\.ts$/;

/** The Vite plugin: dictionary-driven injection over app sources. */
export function agentplayI18n(): Plugin {
  return {
    name: 'agentplay-i18n',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (process.env.AGENTPLAY_I18N_DEBUG) console.log('[i18n] try:', id);
      if (!/\.[cm]?[jt]sx?$/.test(id) || id.includes('?') || SKIP_ID.test(id)) return null;
      try {
        const out = injectTranslations(code);
        if (process.env.AGENTPLAY_I18N_DEBUG && out) console.log('[i18n] HIT:', id);
        return out;
      } catch (err) {
        this.warn(`i18n injection skipped for ${id}: ${err}`);
        return null;
      }
    },
  };
}
