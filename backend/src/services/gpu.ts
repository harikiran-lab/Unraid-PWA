import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GpuDevice, GpuOverview } from "../types/api.js";

const execFileAsync = promisify(execFile);
const NVIDIA_FIELDS = [
  "uuid", "name", "utilization.gpu", "memory.used", "memory.total",
  "temperature.gpu", "power.draw", "power.limit", "fan.speed",
];

function metric(value: string | undefined, maximum = Infinity): number | null {
  if (!value?.trim()) return null;
  const number = Number(value.trim());
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : null;
}

// nvidia-smi uses CSV quoting for device names that contain commas.
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      fields.push(field.trim());
      field = "";
    } else field += char;
  }
  if (quoted) return [];
  fields.push(field.trim());
  return fields;
}

export function parseNvidiaCsv(output: string): GpuDevice[] {
  return output.split(/\r?\n/).filter((line) => line.trim()).flatMap((line) => {
    const fields = csvFields(line);
    if (fields.length !== NVIDIA_FIELDS.length || !fields[0].startsWith("GPU-") || !fields[1]) return [];
    const [id, name, utilization, used, total, temperature, power, limit, fan] = fields;
    const memoryTotalMiB = metric(total);
    const memoryUsedMiB = metric(used, memoryTotalMiB ?? Infinity);
    return [{
      id, name, vendor: "NVIDIA", blacklisted: false,
      utilizationPercent: metric(utilization, 100),
      memoryUsedMiB, memoryTotalMiB,
      memoryPercent: memoryUsedMiB !== null && memoryTotalMiB !== null && memoryTotalMiB > 0
        ? Math.round(memoryUsedMiB / memoryTotalMiB * 1000) / 10 : null,
      temperatureC: metric(temperature),
      powerWatts: metric(power), powerLimitWatts: metric(limit), fanPercent: metric(fan, 100),
    }];
  });
}

export function isGpuServerMatch(activeUrl: string, configuredUrl: string | undefined): boolean {
  if (!configuredUrl?.trim()) return false;
  try {
    const active = new URL(activeUrl);
    const configured = new URL(configuredUrl.trim());
    if (!["http:", "https:"].includes(configured.protocol)) return false;
    return active.origin === configured.origin
      && active.pathname.replace(/\/+$/, "") === configured.pathname.replace(/\/+$/, "");
  } catch { return false; }
}

export function mapGpuInventory(raw: unknown): GpuDevice[] {
  const devices = (raw as { info?: { gpu?: unknown } } | null)?.info?.gpu;
  if (!Array.isArray(devices)) return [];
  return devices.filter((item) => item && typeof item === "object").map((item, index) => {
    const gpu = item as Record<string, unknown>;
    const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
    const vendor = text(gpu.vendorname) || text(gpu.type) || "Unknown";
    return {
      id: text(gpu.id) || `gpu-${index}`,
      name: text(gpu.productid) ? `${vendor} (${text(gpu.productid)})` : vendor,
      vendor, blacklisted: gpu.blacklisted === true,
      utilizationPercent: null, memoryUsedMiB: null, memoryTotalMiB: null, memoryPercent: null,
      temperatureC: null, powerWatts: null, powerLimitWatts: null, fanPercent: null,
    };
  });
}

type NvidiaReader = () => Promise<string>;
async function readNvidia(): Promise<string> {
  const { stdout } = await execFileAsync("nvidia-smi", [
    `--query-gpu=${NVIDIA_FIELDS.join(",")}`, "--format=csv,noheader,nounits",
  ], { timeout: 2000, maxBuffer: 256 * 1024, windowsHide: true });
  return stdout;
}

export async function collectGpuOverview(input: {
  baseUrl: string;
  localServerUrl?: string;
  inventory: () => Promise<unknown>;
  readNvidia?: NvidiaReader;
}): Promise<GpuOverview> {
  const local = isGpuServerMatch(input.baseUrl, input.localServerUrl);
  if (local) {
    try {
      const devices = parseNvidiaCsv(await (input.readNvidia ?? readNvidia)());
      if (devices.length > 0) return { state: "live", source: "nvidia", message: null, devices };
    } catch { /* Driver, GPU access, or command unavailable: keep the dashboard usable. */ }
  }

  try {
    const raw = await input.inventory();
    if (!Array.isArray((raw as { info?: { gpu?: unknown } } | null)?.info?.gpu)) {
      throw new Error("GPU inventory unavailable");
    }
    const devices = mapGpuInventory(raw);
    return {
      state: devices.length > 0 ? "inventory" : "empty", source: "unraid", devices,
      message: local
        ? "Live NVIDIA stats unavailable. Check the NVIDIA driver and container GPU access."
        : "Live GPU stats are not exposed by this Unraid API. Enable local NVIDIA monitoring to see readings.",
    };
  } catch {
    return {
      state: "unavailable", source: "unraid", devices: [],
      message: local
        ? "GPU stats unavailable. Check the NVIDIA driver, container GPU access, and API permissions."
        : "GPU details unavailable. Check Unraid API support and permissions.",
    };
  }
}
