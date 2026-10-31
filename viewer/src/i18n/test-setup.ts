/**
 * Pin the test language to English regardless of the machine's OS locale:
 * the injected `t()` follows the browser language, so on a zh-CN machine
 * assertions written against English strings would otherwise fail.
 */
Object.defineProperty(Navigator.prototype, 'language', {
  get: () => 'en-US',
  configurable: true,
});
Object.defineProperty(Navigator.prototype, 'languages', {
  get: () => ['en-US'],
  configurable: true,
});
