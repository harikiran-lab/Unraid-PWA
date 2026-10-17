import { expect, type Page } from "@playwright/test";
import type { GpuOverview, DockerData } from "../src/types";

export async function dashboard(page: Page, gpu?: GpuOverview, options: { canWrite?: boolean; docker?: DockerData } = {}) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      "/api/servers/status": { configured: true, name: "Tower", baseUrl: "http://tower", scopes: options.canWrite ? ["docker:update_any"] : ["read:docker"], canWrite: options.canWrite ?? false },
      "/api/servers": { activeServerId: "tower", servers: [{ id: "tower", name: "Tower", baseUrl: "http://tower", accentColor: "orange", createdAt: "2026-01-01" }] },
      "/api/settings/app": { themeMode: "dark", accentColor: "orange" },
      "/api/overview": {
        temperatures: { cpuC: 55, motherboardC: 38, cpuSensor: "coretemp:temp1", motherboardSensor: "nct:temp1" },
        gpu, cpuPercent: 18, cpuModel: "Intel Core i9", cpuCores: 10, cpuThreads: 20, cpuSpeedGhz: 3.7,
        memoryPercent: 46, memoryUsed: "28 GB", memoryTotal: "62 GB", memoryAvailable: "34 GB", memoryCache: "4 GB", memoryFree: "30 GB",
        serverName: "Tower", hostname: "tower", uptime: "5 days", motherboard: "Gigabyte", unraidVersion: "7", licenseType: "Pro", osDistro: "Unraid", kernelVersion: "6.12",
        arrayState: "Started", arrayUsed: "4 TB", arrayFree: "8 TB", arrayTotal: "12 TB", arrayUsagePercent: 33,
        parity: { status: "Completed", errors: 0, progress: 100, running: false },
        lastParityCheck: { date: "2026-10-01", duration: "8 hours", speed: "150 MB/s" },
        ups: { devices: [] }, unreadNotifications: { total: 0, info: 0, warning: 0, alert: 0 }, notifications: [], accessUrls: [],
      },
      "/api/array": { devices: [], state: "Started", capacity: { used: "4 TB", free: "8 TB", total: "12 TB", usagePercent: 33 }, parity: { status: "Completed", progress: 100, errors: 0, running: false } },
      "/api/docker": options.docker ?? { summary: { running: 0, stopped: 0 }, containers: [] },
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
