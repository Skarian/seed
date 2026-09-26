import { test as base, expect } from "@playwright/test";
export type { Page, APIRequestContext, Locator } from "@playwright/test";
/** Browser tests can only reach the isolated local fixture server. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const blocked: string[] = [];
    await page.route("**/*", async (route) => {
      const target = new URL(route.request().url());
      // Exercise plain-HTTP browser security on a non-localhost origin, while
      // forwarding exclusively to the isolated fixture server (never DNS/LAN).
      if (target.origin === 'http://seed-qa.test:4311') {
        const headers = {...route.request().headers(), host: '127.0.0.1:4311'};
        if ('origin' in headers) headers.origin = 'http://127.0.0.1:4311';
        const response = await route.fetch({url: 'http://127.0.0.1:4311' + target.pathname + target.search, headers, maxRedirects: 0});
        return route.fulfill({response});
      }
      if (
        ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
        target.protocol === "data:"
      )
        return route.continue();
      blocked.push(target.origin);
      return route.abort("blockedbyclient");
    });
    await use(page);
    expect(blocked, "Browser must not attempt external requests").toEqual([]);
  },
});
export { expect };
