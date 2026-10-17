import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { collectTemperatures, cpuPackageTemperature, readHardwareSensors, selectTemperatures } from "./temperatures.js";

describe("hardware temperatures", () => {
  const sensors = [
    { id: "coretemp:temp1", chip: "coretemp", label: "Package id 0", celsius: 56 },
    { id: "coretemp:temp2", chip: "coretemp", label: "Core 0", celsius: 51 },
    { id: "nct6798:temp1", chip: "nct6798", label: "SYSTIN", celsius: 38 },
    { id: "nvme:temp1", chip: "nvme", label: "Composite", celsius: 80 },
    { id: "nct6798:temp3", chip: "nct6798", label: "temp3", celsius: 42 },
    { id: "nct6798:temp4", chip: "nct6798", label: "System", celsius: 255 },
  ];
  it("prefers CPU packages and labeled motherboard readings, excluding disks and bogus sensors", () => {
    const value = selectTemperatures(sensors);
    assert.equal(value.cpuC, 56);
    assert.equal(value.motherboardC, 38);
    assert.equal(selectTemperatures(sensors.filter((s) => s.label !== "SYSTIN")).motherboardC, null);
    assert.equal(selectTemperatures(sensors, undefined, "nct6798:temp3").motherboardC, 42);
    assert.equal(selectTemperatures(sensors, "missing").cpuC, null);
  });
  it("reads millidegrees and skips files that disappear or are not hwmon temperature inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "unpwa-hwmon-"));
    try {
      await mkdir(join(root, "hwmon0"));
      await writeFile(join(root, "hwmon0", "name"), "coretemp\n");
      await writeFile(join(root, "hwmon0", "temp1_input"), "55000\n");
      await writeFile(join(root, "hwmon0", "temp1_label"), "Package id 0\n");
      await writeFile(join(root, "hwmon0", "temp2_input"), "\n");
      await writeFile(join(root, "hwmon0", "fan1_input"), "1200");
      const read = await readHardwareSensors(root);
      assert.equal(read.length, 1);
      assert.equal(selectTemperatures(read).cpuC, 55);
    } finally {
      assert.equal(dirname(resolve(root)), resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    }
  });
  it("never reads local hardware for another server and uses CPU-only API fallback", async () => {
    let localReads = 0;
    const value = await collectTemperatures({ local: false, cpuSelector: "local-only:temp1", readSensors: async () => { localReads++; return sensors; }, readCpuPackage: async () => ({ info: { cpu: { packages: { temp: [44, 57] } } } }) });
    assert.equal(localReads, 0);
    assert.equal(value.cpuC, 57);
    assert.equal(value.motherboardC, null);
    assert.equal(cpuPackageTemperature({ info: { cpu: { packages: { temp: [null, "59", 0, NaN, 300] } } } }), null);
  });
  it("keeps unavailable sensors null and honors explicit selection", async () => {
    const value = await collectTemperatures({ local: true, cpuSelector: "not-found", readSensors: async () => sensors, readCpuPackage: async () => { throw new Error("should not run"); } });
    assert.equal(value.cpuC, null);
    assert.equal(value.motherboardC, 38);
  });
  it("explains missing mappings, unlabeled inputs, invalid selections and remote collection separately", async () => {
    const collect = (local: boolean, values: typeof sensors, boardSelector?: string) => collectTemperatures({ local, boardSelector,
      readSensors: async () => values, readCpuPackage: async () => null });
    const missing = await collect(true, []);
    assert.match(missing.motherboardMessage ?? "", /read-only \/sys to \/host\/sys/);
    const unlabeled = await collect(true, sensors.filter((s) => s.label !== "SYSTIN"));
    assert.match(unlabeled.motherboardMessage ?? "", /explicit motherboard label/);
    assert.equal(unlabeled.sensors?.some((s) => s.celsius === 255), false);
    assert.match((await collect(true, sensors, "missing:temp1")).motherboardMessage ?? "", /Selected sensor missing:temp1/);
    const remote = await collect(false, sensors);
    assert.deepEqual(remote.sensors, []);
    assert.match(remote.motherboardMessage ?? "", /Local sensors are disabled/);
    assert.equal((await collect(true, sensors)).motherboardMessage, undefined);
    for (const label of ["Mainboard", "Mobo", "System Temp", "Sys Temperature", "MB Temp", "Motherboard Temperature", "System_Temp", "System 1"]) {
      assert.equal(selectTemperatures([{ id: "chip:temp1", chip: "chip", label, celsius: 39 }]).motherboardC, 39);
    }
  });
});
