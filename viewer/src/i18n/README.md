# 简体中文语言包（zh-CN patch）

这是对 agentplay viewer 的**最小侵入式**简体中文支持。上游源码的字符串
**一行都不改**——翻译发生在构建期，由 Vite 插件按词典注入。

## 用户体验

- 默认**跟随系统语言**：`zh*` → 简体中文，其他 → 英文
- 顶栏右上角（主题按钮旁）有 `EN / 中文` 开关，点击即切换并记住选择
- 词典未收录的新文案自动回退英文，不会显示空白或报错

## 构成

| 文件 | 作用 |
|---|---|
| `src/i18n.tsx` | runtime：`t()`、语言检测（localStorage > 系统语言）、`LocaleToggle` 开关 |
| `src/i18n/zh.ts` | **中文词典（唯一需要日常维护的文件）**：key = 英文原文，value = 中文 |
| `src/i18n/vite-plugin.ts` | 构建期注入器 + 候选提取器（AST 级，词典命中才改写） |
| `src/i18n/coverage.test.ts` | 词典覆盖检查（见下） |
| `src/i18n/inject.test.ts` | 注入器单元测试 |
| `src/i18n/test-setup.ts` | 测试语言固定为英文（不受本机系统语言影响） |
| `scripts/verify-locale.mjs` | 浏览器端到端验证（EN→ZH→EN 切换） |

对上游文件的改动只有五处，均为极小 diff，合并冲突概率很低：

1. `src/App.tsx`：import `LocaleToggle` + 右上角渲染一行
2. `vite.config.ts`：plugins 里加 `agentplayI18n()` 一项（及 test.setupFiles 一行）
3. `package.json`：devDependencies（`@babel/parser`、`magic-string`）
4. `src/explorer/SessionList.tsx`、`src/insights/SearchHeatmap.tsx`：
   各几行——英文复数机制（`plural(n, 'prompt')` 拼单词）无法词典化，
   改为直接调用 `t('{n} prompts', { n })`，中文没有复数故单复数合并

## 安全性设计（为什么不会破坏功能）

注入器只改写"显示位置"的字符串，以下位置**永不改写**（词典命中也不改）：

- import/export、对象 key、成员访问 `obj['x']`、类型位置、tag 模板
- `className`/`style`/`rel` 等样式属性，`cn()/cva()` 的参数
- **值语义位置**：`===` 比较、`includes/has/startsWith…` 参数、
  `switch case`、**带非 string 类型标注的数组**（枚举列表）——
  词典词条与代码枚举同形（如 `'blocked'`）也不会改变程序行为
- 已在 `t()`/`__ap_t()` 调用内的参数（防二次包裹）

## 同步上游更新后的工作流

```bash
git fetch upstream && git merge upstream/main   # 或 rebase
cd viewer && pnpm install && pnpm test          # coverage 测试会列出缺翻译的新文案
```

`src/i18n/coverage.test.ts` 会把**所有词典未覆盖的 UI 文案**打印出来
（带 `文件:行号`），并为每条给出 key 形态。把新词条补进 `src/i18n/zh.ts`
直到测试通过即可；模板串的插值槽写成 `{a0}`、`{a1}`（按出现顺序）。

```bash
pnpm build && node scripts/verify-locale.mjs    # 构建 + 双语切换验证
```

故意不翻译的字符串（CSS 选择器、className 拼接、泛型槽位模板等）登记在
`coverage.test.ts` 的 `INTENTIONALLY_UNTRANSLATED`，附原因。

## 词典 key 规则

- JSX 文本与字符串字面量：**英文原文逐字匹配**（含标点、省略号；注意
  冒号/句号结尾的区别）
- 带插值的模板串：插值位置写成 `{a0}`、`{a1}`…，译文沿用同样槽位
  （译文可以少用槽位，但不能多用；`{a0}` 与中文之间不加空格更自然）
- 嵌套模板（模板里又套模板）：外层保持英文、内层正常翻译——这是注入器
  的既定行为（见 `vite-plugin.ts` 的 `dropNestedOuter`），此类外层 key
  登记在豁免清单里即可

## 如果上游官方加了多语言支持

删除 `src/i18n/`、`src/i18n.tsx`、`scripts/verify-locale.mjs`，还原
`App.tsx`/`vite.config.ts`/`package.json` 的三处小改动即可，无残留。
