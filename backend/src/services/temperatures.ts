import { readFile, readdir } from "node:fs/promises";
import type { HardwareTemperatures } from "../types/api.js";

export type HardwareSensor = { id: string; chip: string; label: string; celsius: number };
const empty = (): HardwareTemperatures => ({ cpuC: null, motherboardC: null, cpuSensor: null, motherboardSensor: null });

export function selectTemperatures(sensors: HardwareSensor[], cpuSelector?: string, boardSelector?: string): HardwareTemperatures {
  const valid = sensors.filter((s) => Number.isFinite(s.celsius) && s.celsius >= -20 && s.celsius <= 150);
  const exact = (selector: string | undefined) => valid.filter((s) => s.id === selector);
  const packages = valid.filter((s) => /coretemp|k10temp|zenpower|cpu_thermal/i.test(s.chip)
    && /package|tctl|tdie|cpu|^temp1$/i.test(s.label));
  const cores = valid.filter((s) => /coretemp|k10temp|zenpower/i.test(s.chip) && /core/i.test(s.label));
  const cpu = cpuSelector ? exact(cpuSelector) : packages.length ? packages : cores;
  const board = boardSelector ? exact(boardSelector) : valid.filter((s) => /^(?:system|motherboard|mainboard|mobo|mb|systin|sys)(?:\s*temp(?:erature)?)?(?:\s*\d+)?$/i.test(s.label.replace(/[_-]+/g, " ").trim()));
  const hottest = (items: HardwareSensor[]) => items.reduce<HardwareSensor | null>((a, b) => !a || b.celsius > a.celsius ? b : a, null);
  const cpuSensor = hottest(cpu);
  const motherboardSensor = hottest(board);
  return {
    cpuC: cpuSensor?.celsius ?? null, motherboardC: motherboardSensor?.celsius ?? null,
    cpuSensor: cpuSensor?.id ?? null, motherboardSensor: motherboardSensor?.id ?? null,
  };
}

export async function readHardwareSensors(root = "/host/sys/class/hwmon"): Promise<HardwareSensor[]> {
  const result: HardwareSensor[] = [];
  const dirs = await readdir(root).catch(() => [] as string[]);
  await Promise.all(dirs.filter((name) => /^hwmon\d+$/.test(name)).slice(0, 64).map(async (dir) => {
    const base = `${root}/${dir}`;
    const chip = (await readFile(`${base}/name`, "utf8").catch(() => "")).trim();
    if (!chip) return;
    const files = await readdir(base).catch(() => [] as string[]);
    await Promise.all(files.filter((name) => /^temp\d+_input$/.test(name)).slice(0, 64).map(async (file) => {
      const key = file.replace("_input", "");
      const [input, label] = await Promise.all([
        readFile(`${base}/${file}`, "utf8").catch(() => ""),
        readFile(`${base}/${key}_label`, "utf8").catch(() => key),
      ]);
      if (!input.trim()) return;
      const celsius = Number(input.trim()) / 1000;
      result.push({ id: `${chip}:${key}`, chip, label: label.trim(), celsius });
    }));
  }));
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export function cpuPackageTemperature(raw: unknown): number | null {
  const values = (raw as { info?: { cpu?: { packages?: { temp?: unknown } } } } | null)?.info?.cpu?.packages?.temp;
  if (!Array.isArray(values)) return null;
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 150);
  return valid.length ? Math.max(...valid) : null;
}

export async function collectTemperatures(input: {
  local: boolean;
  cpuSelector?: string;
  boardSelector?: string;
  readSensors?: () => Promise<HardwareSensor[]>;
  readCpuPackage: () => Promise<unknown>;
}): Promise<HardwareTemperatures> {
  const sensors = input.local ? await (input.readSensors ?? readHardwareSensors)().catch(() => []) : [];
  const result = input.local ? selectTemperatures(sensors, input.cpuSelector, input.boardSelector) : empty();
  // This CPU-only API does not invoke the API's combined disk-temperature providers.
  if (result.cpuC === null && (!input.local || !input.cpuSelector)) {
    result.cpuC = cpuPackageTemperature(await input.readCpuPackage().catch(() => null));
    if (result.cpuC !== null) result.cpuSensor = "CPU package (Unraid API)";
  }
  return result;
}
