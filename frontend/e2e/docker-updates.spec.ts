import { expect, test } from "@playwright/test";
import type { DockerData } from "../src/types";
import { dashboard } from "./fixtures";

const container: DockerData["containers"][number] = {
  id: "tower:container-1", name: "Media Server", image: "example/media:latest", iconUrl: "", network: "bridge", endpoint: "-", ports: "-",
  createdAt: "2026-01-01", autoStart: true, stateLabel: "running", status: "running", updateAvailable: true,
};

test("container updates require confirmation and send one server-bound request", async ({ page, context }, testInfo) => {
  await context.addCookies([{ name: "unpwa_csrf", value: "test-token", url: "http://127.0.0.1:5173" }]);
  await dashboard(page, undefined, { canWrite: true, docker: { canUpdate: true, summary: { running: 1, stopped: 0 }, containers: [container] } });
  await page.getByRole("button", { name: "Docker", exact: true }).click();
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Media Server", exact: true }) });
  await expect(card.getByText("Update available")).toBeVisible();
  let requests = 0;
  let complete!: () => void;
  const waiting = new Promise<void>((done) => { complete = done; });
  await page.route("**/api/docker/*/update", async (route) => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ serverId: "tower" });
    expect(route.request().headers()["x-csrf-token"]).toBe("test-token");
    await waiting;
    await route.fulfill({ json: { ok: true } });
  });
  await card.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.getByText(/Unraid will recreate the container/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(requests).toBe(0);
  await card.getByRole("button", { name: "Update", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Working…", exact: true })).toBeDisabled();
  await expect.poll(() => requests).toBe(1);
  complete();
  await expect(page.getByText("Container update completed.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await card.screenshot({ path: testInfo.outputPath("container-update-mobile.png") });
});

test("container updates remain disabled for read-only access and older APIs", async ({ page }) => {
  for (const [canWrite, canUpdate] of [[false, true], [true, false]]) {
    await page.unroute("**/api/**");
    await dashboard(page, undefined, { canWrite, docker: { canUpdate, summary: { running: 1, stopped: 0 }, containers: [container] } });
    await page.getByRole("button", { name: "Docker", exact: true }).click();
    await expect(page.getByRole("button", { name: "Update", exact: true })).toBeDisabled();
  }
});

test("unknown update status never looks up to date and does not offer an update", async ({ page }) => {
  await dashboard(page, undefined, { canWrite: true, docker: { canUpdate: true, summary: { running: 1, stopped: 0 }, containers: [{ ...container, updateAvailable: null }] } });
  await page.getByRole("button", { name: "Docker", exact: true }).click();
  await expect(page.getByText("Update status unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update", exact: true })).toHaveCount(0);
  await expect(page.getByText("Up to date", { exact: true })).toHaveCount(0);
});

test("Docker overview lists all known updates regardless of search and confirms a sequential queue", async ({ page, context }, testInfo) => {
  await context.addCookies([{ name: "unpwa_csrf", value: "test-token", url: "http://127.0.0.1:5173" }]);
  const second = { ...container, id: "tower:container-2", name: "Downloader" };
  await dashboard(page, undefined, { canWrite: true, docker: { canUpdate: true, summary: { running: 3, stopped: 1 }, containers: [container, second,
    { ...container, id: "unknown", name: "Unknown status", updateAvailable: null }, { ...container, id: "current", name: "Current", updateAvailable: false }] } });
  await page.getByRole("button", { name: "Docker", exact: true }).click();
  const summary = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Docker Overview", exact: true }) });
  await expect(summary.getByText("2 known", { exact: true })).toBeVisible();
  await expect(summary.getByText("Update status unavailable for 1 container.")).toBeVisible();
  await page.getByPlaceholder("Search dockers...").fill("Media");
  await expect(summary.getByRole("list", { name: "Containers with updates" }).getByRole("listitem")).toHaveText(["Media Server", "Downloader"]);
  const requested: string[] = [];
  let finish!: () => void;
  const waiting = new Promise<void>((done) => { finish = done; });
  await page.route("**/api/docker/*/update", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ serverId: "tower" });
    expect(route.request().headers()["x-csrf-token"]).toBe("test-token");
    requested.push(decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3]));
    if (requested.length === 1) await waiting;
    await route.fulfill({ json: { ok: true } });
  });
  await summary.getByRole("button", { name: "Update all (2)", exact: true }).click();
  await expect(page.getByRole("list", { name: "Confirm container updates" }).getByRole("listitem")).toHaveText(["Media Server", "Downloader"]);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(requested).toEqual([]);
  await summary.getByRole("button", { name: "Update all (2)", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => requested).toEqual([container.id]);
  await expect(page.getByRole("button", { name: "Working\u2026", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(summary.getByRole("button", { name: "Update all (2)", exact: true })).toBeDisabled();
  finish();
  await expect(summary.getByText("2 of 2 updates confirmed", { exact: true })).toBeVisible({ timeout: 15000 });
  expect(requested).toEqual([container.id, second.id]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(summary.getByText("Downloader: Completed", { exact: true })).toBeVisible();
  await expect(summary.getByRole("button", { name: /^Update all/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await summary.screenshot({ path: testInfo.outputPath("docker-overview-updates-mobile.png") });
});

test("Update all stops on the first uncertain response and retains completed and not-started items", async ({ page }) => {
  const containers = [container, { ...container, id: "second", name: "Second" }, { ...container, id: "third", name: "Third" }];
  await dashboard(page, undefined, { canWrite: true, docker: { canUpdate: true, summary: { running: 3, stopped: 0 }, containers } });
  await page.getByRole("button", { name: "Docker", exact: true }).click();
  const requested: string[] = [];
  await page.route("**/api/docker/*/update", async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3]);
    requested.push(id);
    if (id === "second") await route.abort("connectionreset");
    else await route.fulfill({ json: { ok: true } });
  });
  await page.getByRole("button", { name: "Update all (3)", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  const progress = page.getByRole("list", { name: "Update progress" });
  await expect(progress.getByText("Second: Unconfirmed — check Unraid", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(progress.getByText("Media Server: Completed", { exact: true })).toBeVisible();
  await expect(progress.getByText("Third: Not started", { exact: true })).toBeVisible();
  expect(requested).toEqual([container.id, "second"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Update all respects read-only and old API restrictions, zero updates and unknown results", async ({ page }) => {
  for (const [canWrite, canUpdate] of [[false, true], [true, false]]) {
    await page.unroute("**/api/**");
    await dashboard(page, undefined, { canWrite, docker: { canUpdate, summary: { running: 1, stopped: 0 }, containers: [container] } });
    await page.getByRole("button", { name: "Docker", exact: true }).click();
    await expect(page.getByRole("button", { name: "Update all (1)", exact: true })).toBeDisabled();
  }
  for (const updateAvailable of [false, null]) {
    await page.unroute("**/api/**");
    await dashboard(page, undefined, { docker: { summary: { running: 1, stopped: 0 }, containers: [{ ...container, updateAvailable }] } });
    await page.getByRole("button", { name: "Docker", exact: true }).click();
    await expect(page.getByRole("button", { name: /^Update all/ })).toHaveCount(0);
    if (updateAvailable === false) await expect(page.getByText("No container updates available.")).toBeVisible();
    else await expect(page.getByText("Update status unavailable for 1 container.")).toBeVisible();
  }
});

test("a disconnected update reports an uncertain outcome and is not retried", async ({ page }) => {
  await dashboard(page, undefined, { canWrite: true, docker: { canUpdate: true, summary: { running: 1, stopped: 0 }, containers: [container] } });
  await page.getByRole("button", { name: "Docker", exact: true }).click();
  let requests = 0;
  await page.route("**/api/docker/*/update", async (route) => { requests++; await route.abort("connectionreset"); });
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText(/It may still be running; check Unraid before retrying/)).toBeVisible();
  expect(requests).toBe(1);
});
