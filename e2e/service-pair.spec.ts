import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

const urls = JSON.parse(readFileSync(join(process.cwd(), "e2e/.urls.json"), "utf8")) as {
  nodeA: string;
  nodeB: string;
  uiBuilt: boolean;
};

async function openFullSettings(page: Page) {
  const navAll = page.getByRole("navigation").getByRole("button", { name: "All settings" });
  if (await navAll.isVisible().catch(() => false)) {
    await navAll.click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    return;
  }
  await page.getByRole("button", { name: /^[A-Z]$/ }).first().click();
  await page.getByRole("complementary").getByRole("button", { name: "All settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

test.describe("cross-node service pair UI", () => {
  test.skip(!urls.uiBuilt, "UI not built — run npm run build:ui first");

  test("paste invite and grant between two node origins", async ({ browser }) => {
    test.setTimeout(180_000);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`${urls.nodeA}/?mock=1`);
    await pageB.goto(`${urls.nodeB}/?mock=1`);

    await pageB.getByPlaceholder("alice").fill("alice");
    await pageB.getByRole("button", { name: "Open existing mailbox" }).click();
    await pageB.getByRole("button", { name: "Continue" }).click();
    await expect(pageB.locator("textarea").first()).toContainText("oe-inv1.", { timeout: 30_000 });
    const inviteBlob = await pageB.locator("textarea").first().inputValue();

    await pageA.getByRole("button", { name: "Demo sign in" }).click();
    await expect(pageA.getByText("alice@node-a.test")).toBeVisible({ timeout: 30_000 });

    await openFullSettings(pageA);
    await pageA.getByRole("button", { name: "Connect another service" }).click();
    await pageA.locator("textarea").fill(inviteBlob);
    await pageA.getByRole("button", { name: "Verify invite" }).click();
    await expect(pageA.getByText("node-b.test")).toBeVisible({ timeout: 15_000 });
    await pageA.getByRole("button", { name: "Confirm with passkey" }).click();
    await expect(pageA.locator("textarea").first()).toContainText("oe-gr1.", { timeout: 30_000 });
    const grantBlob = await pageA.locator("textarea").first().inputValue();

    await pageB.getByRole("button", { name: "I have a grant" }).click();
    await pageB.locator("#grant-blob").fill(grantBlob);
    await pageB.getByRole("button", { name: "Finish pairing" }).click();
    await expect(pageB.getByText("alice@node-b.test")).toBeVisible({ timeout: 30_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test("rejects unsigned invite on node A", async ({ browser }) => {
    test.setTimeout(180_000);
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto(`${urls.nodeA}/?mock=1`);
    await pageA.getByRole("button", { name: "Demo sign in" }).click();
    await expect(pageA.getByText("alice@node-a.test")).toBeVisible({ timeout: 30_000 });

    await openFullSettings(pageA);
    await pageA.getByRole("button", { name: "Connect another service" }).click();
    await pageA.locator("textarea").fill('{"v":1,"name":"alice","domain":"evil.test"}');
    await pageA.getByRole("button", { name: "Verify invite" }).click();
    await expect(pageA.getByText(/not signed|invalid|unsupported|missing node identity/i)).toBeVisible({ timeout: 15_000 });

    await ctxA.close();
  });
});
