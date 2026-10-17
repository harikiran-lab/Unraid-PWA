import { expect, test, type Page } from "@playwright/test";
import type { GpuDevice, GpuOverview } from "../src/types";

const device: GpuDevice = {
  id: "GPU-test", name: "NVIDIA GeForce RTX 4090", vendor: "NVIDIA", blacklisted: false,
  utilizationPercent: 42, memoryUsedMiB: 4096, memoryTotalMiB: 24576, memoryPercent: 16.7,
  temperatureC: 61, powerWatts: 120.5, powerLimitWatts: 450, fanPercent: null,
};

async function dashboard(page: Page, gpu?: GpuOverview) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      "/api/servers/status": { configured: true, name: "Tower", baseUrl: "http://tower", scopes: ["read:monitoring"], canWrite: false },
      "/api/servers": { activeServerId: "tower", servers: [{ id: "tower", name: "Tower", baseUrl: "http://tower", accentColor: "orange", createdAt: "2026-01-01" }] },
      "/api/settings/app": { themeMode: "dark", accentColor: "orange" },
      "/api/overview": {
        gpu, cpuPercent: 18, cpuModel: "Intel Core i9", cpuCores: 10, cpuThreads: 20, cpuSpeedGhz: 3.7,
        memoryPercent: 46, memoryUsed: "28 GB", memoryTotal: "62 GB", memoryAvailable: "34 GB", memoryCache: "4 GB", memoryFree: "30 GB",
        serverName: "Tower", hostname: "tower", uptime: "5 days", motherboard: "Gigabyte", unraidVersion: "7", licenseType: "Pro", osDistro: "Unraid", kernelVersion: "6.12",
        arrayState: "Started", arrayUsed: "4 TB", arrayFree: "8 TB", arrayTotal: "12 TB", arrayUsagePercent: 33,
        parity: { status: "Completed", errors: 0, progress: 100, running: false },
        lastParityCheck: { date: "2026-10-01", duration: "8 hours", speed: "150 MB/s" },
        ups: { devices: [] }, unreadNotifications: { total: 0, info: 0, warning: 0, alert: 0 }, notifications: [], accessUrls: [],
      },
      "/api/array": { devices: [], state: "Started", capacity: { used: "4 TB", free: "8 TB", total: "12 TB", usagePercent: 33 }, parity: { status: "Completed", progress: 100, errors: 0, running: false } },
      "/api/docker": { summary: { running: 0, stopped: 0 }, containers: [] },
      "/api/vms": { summary: { running: 0, stopped: 0, paused: 0, other: 0 }, vms: [] },
      "/api/shares": { shares: [] },
    };
    await route.fulfill({ json: responses[path] ?? { ok: true } });
  });
  await page.goto("/");
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "GPU Stats" }) });
  await expect(card).toBeVisible();
  return card;
}

test("GPU card shows multiple GPUs, missing sensors, and real zero readings", async ({ page }, testInfo) => {
  const card = await dashboard(page, {
    state: "live", source: "nvidia", message: null,
    devices: [device, { ...device, id: "GPU-idle", name: "NVIDIA T400", utilizationPercent: 0, memoryUsedMiB: 0, memoryPercent: 0, fanPercent: 0 }],
  });
  await expect(card.getByText("Live", { exact: true })).toBeVisible();
  await expect(card.getByText("42%", { exact: true })).toBeVisible();
  await expect(card.getByText("4.0 GiB / 24.0 GiB")).toBeVisible();
  await expect(card.getByText("61 °C").first()).toBeVisible();
  await expect(card.getByText("120.5 W").first()).toBeVisible();
  await expect(card.getByText("Unavailable", { exact: true })).toHaveCount(1);
  await expect(card.getByRole("progressbar", { name: "NVIDIA T400 GPU load" })).toHaveAttribute("aria-valuenow", "0");
  await expect(card.getByRole("progressbar")).toHaveCount(4);
  await card.screenshot({ path: testInfo.outputPath("gpu-card-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.getByText(device.name)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await card.screenshot({ path: testInfo.outputPath("gpu-card-mobile.png") });
});

test("GPU card shows inventory without inventing load or VRAM readings", async ({ page }) => {
  const card = await dashboard(page, {
    state: "inventory", source: "unraid", message: "Live NVIDIA stats unavailable.",
    devices: [{ ...device, blacklisted: true, utilizationPercent: null, memoryUsedMiB: null, memoryTotalMiB: null, memoryPercent: null, temperatureC: null, powerWatts: null, powerLimitWatts: null }],
  });
  await expect(card.getByText("Excluded by Unraid")).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  await expect(card.getByText("Live NVIDIA stats unavailable.")).toBeVisible();
  await expect(card.getByText("0%", { exact: true })).toHaveCount(0);
});

test("GPU card handles empty, unavailable, and older backend responses", async ({ page }) => {
  for (const gpu of [
    { state: "empty", source: "unraid", devices: [], message: null },
    { state: "unavailable", source: "unraid", devices: [], message: "GPU details unavailable." },
    undefined,
  ] as Array<GpuOverview | undefined>) {
    await page.unroute("**/api/**");
    const card = await dashboard(page, gpu);
    await expect(card.getByRole("progressbar")).toHaveCount(0);
    if (gpu?.state === "empty") await expect(card.getByText("No GPUs reported by Unraid.")).toBeVisible();
    else await expect(card.getByText(gpu ? "GPU details unavailable." : "GPU stats unavailable from this server.", { exact: true })).toBeVisible();
  }
});
