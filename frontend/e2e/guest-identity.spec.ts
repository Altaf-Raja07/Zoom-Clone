/**
 * Seam 2: the running frontend, driven in a browser.
 *
 * These cover what cannot be asserted at the API: that a visitor arriving with
 * no cookie and no login step is greeted by name, and that coming back in the
 * same browser greets them by the same name. The backend runs for real, so the
 * identity cookie is exercised the way a browser exercises it.
 */

import { expect, test } from "@playwright/test";

test("a first-time visitor is greeted by a display name with no login step", async ({
  page,
}) => {
  await page.goto("/");

  // There is no login form, so the greeting is the first thing that resolves.
  const greeting = page.getByTestId("greeting");
  await expect(greeting).toBeVisible();
  await expect(greeting).toHaveText(/^Hi, \S+/);
  await expect(page.getByLabel("Sign in")).toHaveCount(0);
});

test("a returning visitor is greeted by the same display name", async ({ page }) => {
  await page.goto("/");
  const first = await page.getByTestId("greeting").textContent();

  await page.reload();

  await expect(page.getByTestId("greeting")).toHaveText(first ?? "");
});

test("two browsers get two different identities", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();

  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await first.goto("/");
  await second.goto("/");

  const firstName = await first.getByTestId("greeting").textContent();
  const secondName = await second.getByTestId("greeting").textContent();

  expect(firstName).not.toEqual(secondName);

  await firstContext.close();
  await secondContext.close();
});

test("the dashboard shows the three primary actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "New Meeting" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join Meeting" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Schedule Meeting" })).toBeVisible();
});
