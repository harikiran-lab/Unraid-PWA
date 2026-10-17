import { expect, test } from "@playwright/test";
import { dashboard } from "./fixtures";
import type { GpuDevice, GpuOverview } from "../src/types";

const device: GpuDevice = {
  id: "GPU-test", name: "NVIDIA GeForce RTX 4090", vendor: "NVIDIA", blacklisted: false,
  utilizationPercent: 42, memoryUsedMiB: 4096, memoryTotalMiB: 24576, memoryPercent: 16.7,
  temperatureC: 61, powerWatts: 120.5, powerLimitWatts: 450, fanPercent: null,
  encoderPercent: 20, decoderPercent: 0, activeApps: [{ pid: 1234, name: "ffmpeg", type: "C", gpuPercent: 42, encoderPercent: 20, decoderPercent: 0, memoryMiB: 512 }],
};


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
  await expect(card.getByRole("progressbar")).toHaveCount(8);
  await expect(page.getByText("55.0 °C", { exact: true })).toBeVisible();
  await expect(page.getByText("38.0 °C", { exact: true })).toBeVisible();
  await card.getByText("Active Apps (1)").first().click();
  await expect(card.getByText("ffmpeg").first()).toBeVisible();
  await expect(card.getByText("PID 1234 · C").first()).toBeVisible();
  await card.screenshot({ path: testInfo.outputPath("gpu-card-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.getByText(device.name)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await card.screenshot({ path: testInfo.outputPath("gpu-card-mobile.png") });
});

test("GPU card shows inventory without inventing load or VRAM readings", async ({ page }) => {
  const card = await dashboard(page, {
    state: "inventory", source: "unraid", message: "Live NVIDIA stats unavailable.",
    devices: [{ ...device, blacklisted: true, utilizationPercent: null, memoryUsedMiB: null, memoryTotalMiB: null, memoryPercent: null, temperatureC: null, powerWatts: null, powerLimitWatts: null, encoderPercent: null, decoderPercent: null, activeApps: null }],
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

test("compute-only fallback explains its limits and shows host PIDs without invented utilization", async ({ page }) => {
  const card = await dashboard(page, { state: "live", source: "nvidia", message: null, devices: [{ ...device,
    activeAppsSource: "compute", activeApps: [{ pid: 123, name: "PID 123", type: "C", memoryMiB: 128, gpuPercent: null, encoderPercent: null, decoderPercent: null }] }] });
  await card.getByText("Active Apps (1)").click();
  await expect(card.getByText(/Compute apps only/)).toBeVisible();
  await expect(card.getByText("PID 123", { exact: true })).toBeVisible();
  await expect(card.getByText("GPU Unavailable · Encoder Unavailable · Decoder Unavailable", { exact: true })).toBeVisible();
  await expect(card.getByText("VRAM 128 MiB", { exact: true })).toBeVisible();
});

test("missing motherboard temperature exposes sensor setup and exact selectors", async ({ page }, testInfo) => {
  await dashboard(page, undefined, { temperatures: { cpuC: 55, motherboardC: null, cpuSensor: "coretemp:temp1", motherboardSensor: null,
    motherboardMessage: "No sensor has an explicit motherboard label. Set UNRAID_BFF_MOTHERBOARD_SENSOR after identifying the correct input.",
    sensors: [{ id: "it8688:temp1", chip: "it8688", label: "temp1", celsius: 38 }] } });
  await page.getByText("Temperature sensor setup", { exact: true }).click();
  await expect(page.getByText(/Set UNRAID_BFF_MOTHERBOARD_SENSOR/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Available temperature sensors" }).getByText("it8688:temp1", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("article").filter({ has: page.getByRole("heading", { name: "System", exact: true }) }).screenshot({ path: testInfo.outputPath("motherboard-sensor-setup-mobile.png") });
});
