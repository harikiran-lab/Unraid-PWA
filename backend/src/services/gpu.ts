import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import type { GpuApp } from "../types/api.js";
import type { GpuDevice, GpuOverview } from "../types/api.js";

const execFileAsync = promisify(execFile);
const NVIDIA_FIELDS = [
  "uuid", "name", "utilization.gpu", "memory.used", "memory.total",
  "temperature.gpu", "power.draw", "power.limit", "fan.speed",
];

export function metric(value: string | undefined, maximum = Infinity): number | null {
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
    if (![NVIDIA_FIELDS.length, NVIDIA_FIELDS.length + 1].includes(fields.length) || !fields[0].startsWith("GPU-") || !fields[1]) return [];
    const [id, name, utilization, used, total, temperature, power, limit, fan] = fields;
    const memoryTotalMiB = metric(total);
    const memoryUsedMiB = metric(used, memoryTotalMiB ?? Infinity);
    return [{
      id, name, vendor: "NVIDIA", blacklisted: false,
      gpuIndex: metric(fields[9]), encoderPercent: null, decoderPercent: null, activeApps: null,
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
    `--query-gpu=${NVIDIA_FIELDS.join(",")},index`, "--format=csv,noheader,nounits",
  ], { timeout: 2000, maxBuffer: 256 * 1024, windowsHide: true });
  return stdout;
}

// Column names vary between driver releases (e.g. JPEG/OFA columns were added).
function monitoringRows(output: string, required: string[]): { columns: string[]; rows: string[][] } | null {
  let columns: string[] = [];
  const rows: string[][] = [];
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().replace(/^#\s*/, "").split(/\s+/);
    if (line.trim().startsWith("#")) {
      if (required.every((column) => fields.includes(column))) columns = fields;
    } else if (/^\d+$/.test(fields[0]) && columns.length) rows.push(fields);
  }
  return columns.length ? { columns, rows } : null;
}

export function parseEngineStats(output: string): Map<number, { encoder: number | null; decoder: number | null }> | null {
  const parsed = monitoringRows(output, ["gpu", "enc", "dec"]);
  if (!parsed) return null;
  return new Map(parsed.rows.map((row) => [Number(row[parsed.columns.indexOf("gpu")]), {
    encoder: metric(row[parsed.columns.indexOf("enc")], 100),
    decoder: metric(row[parsed.columns.indexOf("dec")], 100),
  }]));
}

export function parseActiveApps(output: string): Map<number, GpuApp[]> | null {
  const parsed = monitoringRows(output, ["gpu", "pid", "type", "command"]);
  if (!parsed) return null;
  const result = new Map<number, GpuApp[]>();
  for (const row of parsed.rows) {
    const gpu = Number(row[parsed.columns.indexOf("gpu")]);
    if (!result.has(gpu)) result.set(gpu, []);
    const pid = metric(row[parsed.columns.indexOf("pid")]);
    if (pid === null || !Number.isInteger(pid) || pid <= 0) continue;
    const get = (key: string) => row[parsed.columns.indexOf(key)];
    const name = row.slice(parsed.columns.indexOf("command")).join(" ");
    const app: GpuApp = {
      pid, name: !name || ["-", "[Not Found]"].includes(name) ? `PID ${pid}` : name,
      type: get("type") || "Unknown", gpuPercent: metric(get("sm"), 100),
      encoderPercent: metric(get("enc"), 100), decoderPercent: metric(get("dec"), 100),
      memoryMiB: metric(get("fb")),
    };
    const apps = result.get(gpu)!;
    if (!apps.some((existing) => existing.pid === pid)) apps.push(app);
  }
  return result;
}

type GpuActivity = {
  engines: ReturnType<typeof parseEngineStats>;
  apps: ReturnType<typeof parseActiveApps>;
};

async function readGpuActivity(): Promise<GpuActivity> {
  const run = async (args: string[]) => {
    try { return (await execFileAsync("nvidia-smi", args, { timeout: 3500, maxBuffer: 512 * 1024, windowsHide: true })).stdout; }
    catch { return ""; }
  };
  const [engines, apps] = await Promise.all([
    run(["dmon", "-s", "u", "-c", "1"]),
    run(["pmon", "-s", "um", "-c", "1"]),
  ]);
  const activity = { engines: parseEngineStats(engines), apps: parseActiveApps(apps) };
  // Only read short process names, never command lines or environment variables.
  await Promise.all(Array.from(activity.apps?.values() ?? []).flat().map(async (app) => {
    try {
      const name = (await readFile(`/host/proc/${app.pid}/comm`, "utf8")).trim();
      if (name) app.name = name.slice(0, 120);
    } catch { /* A process can exit between samples, or host /proc is not mounted. */ }
  }));
  return activity;
}

export async function collectGpuOverview(input: {
  baseUrl: string;
  localServerUrl?: string;
  inventory: () => Promise<unknown>;
  readNvidia?: NvidiaReader;
  readActivity?: () => Promise<GpuActivity>;
}): Promise<GpuOverview> {
  const local = isGpuServerMatch(input.baseUrl, input.localServerUrl);
  if (local) {
    try {
      const devices = parseNvidiaCsv(await (input.readNvidia ?? readNvidia)());
      if (devices.length > 0) {
        const activity = await (input.readActivity ?? readGpuActivity)().catch(() => ({ engines: null, apps: null }));
        for (const device of devices) {
          const index = device.gpuIndex;
          if (index === undefined || index === null) continue;
          const engines = activity.engines?.get(index);
          device.encoderPercent = engines?.encoder ?? null;
          device.decoderPercent = engines?.decoder ?? null;
          device.activeApps = activity.apps?.get(index) ?? null;
        }
        return { state: "live", source: "nvidia", message: null, devices };
      }
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
