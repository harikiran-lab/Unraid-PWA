import { Activity, Cpu, Fan, MemoryStick, Thermometer, Zap } from "lucide-react";
import type { GpuOverview } from "../../types";
import { BadgePill } from "../BadgePill";
import { FrostedCard } from "../FrostedCard";
import { IconRow } from "../IconRow";
import { ProgressBar } from "../ProgressBar";
import { SectionHeader } from "../SectionHeader";

function reading(value: number | null, unit: string): string {
  return value === null ? "Unavailable" : `${Number(value.toFixed(1))}${unit}`;
}

function memory(value: number | null): string {
  if (value === null) return "Unavailable";
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GiB` : `${Math.round(value)} MiB`;
}

function GpuMeter({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <ProgressBar value={value} />
    </div>
  );
}

export function GpuCard({ gpu }: { gpu?: GpuOverview }) {
  const live = gpu?.state === "live";
  const status = live ? "Live" : gpu?.state === "inventory" ? "Details only" : gpu?.state === "empty" ? "No GPUs" : "Unavailable";
  return (
    <FrostedCard>
      <SectionHeader title="GPU Stats" right={<BadgePill value={status} />} />
      {gpu?.devices.map((device) => (
        <div className="list-item" key={device.id}>
          <div className="row">
            <strong>{device.name}</strong>
            {device.blacklisted && <BadgePill value="Excluded by Unraid" />}
          </div>
          <small>{device.vendor}</small>
          <IconRow label="GPU load" value={reading(device.utilizationPercent, "%")} icon={Cpu} />
          <GpuMeter label={`${device.name} GPU load`} value={device.utilizationPercent} />
          <IconRow label="VRAM" value={`${memory(device.memoryUsedMiB)} / ${memory(device.memoryTotalMiB)}`} icon={MemoryStick} />
          <GpuMeter label={`${device.name} VRAM usage`} value={device.memoryPercent} />
          <div className="array-grid gpu-metrics">
            <IconRow label="Temperature" value={reading(device.temperatureC, " °C")} icon={Thermometer} />
            <IconRow label="Fan" value={reading(device.fanPercent, "%")} icon={Fan} />
            <IconRow label="Power" value={reading(device.powerWatts, " W")} icon={Zap} />
            <IconRow label="Power limit" value={reading(device.powerLimitWatts, " W")} icon={Activity} />
          </div>
        </div>
      ))}
      {gpu?.state === "empty" && <small>No GPUs reported by Unraid.</small>}
      {gpu?.message && <small>{gpu.message}</small>}
      {!gpu && <small>GPU stats unavailable from this server.</small>}
    </FrostedCard>
  );
}
