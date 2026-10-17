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
  await expect(page.getByText("Update status unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "Update", exact: true })).toHaveCount(0);
  await expect(page.getByText("Up to date", { exact: true })).toHaveCount(0);
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
