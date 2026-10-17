import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectGpuOverview, isGpuServerMatch, mapGpuInventory, parseNvidiaCsv } from "./gpu.js";

const sample = "GPU-123, NVIDIA GeForce RTX 4090, 42, 4096, 24576, 61, 120.5, 450, 30";
const inventory = { info: { gpu: [{ id: "pci-1", vendorname: "NVIDIA", productid: "2684", blacklisted: true }] } };

describe("NVIDIA readings", () => {
  it("parses multiple GPUs, quoted names, and MiB values", () => {
    const devices = parseNvidiaCsv(`${sample}\r\nGPU-456, "NVIDIA, Test", 0, 0, 1024, 0, 0, 75, 0\r\n`);
    assert.equal(devices.length, 2);
    assert.equal(devices[0].memoryPercent, 16.7);
    assert.equal(devices[0].powerWatts, 120.5);
    assert.equal(devices[1].name, "NVIDIA, Test");
    assert.equal(devices[1].utilizationPercent, 0);
    assert.equal(devices[1].memoryPercent, 0);
    assert.equal(devices[1].temperatureC, 0);
    assert.equal(devices[1].fanPercent, 0);
  });

  it("preserves unsupported and invalid readings as null, never zero", () => {
    const [device] = parseNvidiaCsv("GPU-test, Test, N/A, [Not Supported], 0, NaN, -1, Infinity, 101");
    assert.equal(device.utilizationPercent, null);
    assert.equal(device.memoryUsedMiB, null);
    assert.equal(device.memoryPercent, null);
    assert.equal(device.temperatureC, null);
    assert.equal(device.powerWatts, null);
    assert.equal(device.powerLimitWatts, null);
    assert.equal(device.fanPercent, null);
    assert.equal(parseNvidiaCsv("GPU-test, Test, 101, 2048, 1024, , , , ")[0].memoryUsedMiB, null);
  });

  it("ignores malformed rows and command diagnostics", () => {
    assert.deepEqual(parseNvidiaCsv("No devices were found\nGPU-x, Test\nGPU-y, \"Unclosed, 1, 2, 3, 4, 5, 6, 7"), []);
  });
});

describe("GPU server isolation", () => {
  it("requires an explicit matching server URL", () => {
    assert.equal(isGpuServerMatch("http://tower:3443", undefined), false);
    assert.equal(isGpuServerMatch("http://tower:3443/", "http://tower:3443"), true);
    assert.equal(isGpuServerMatch("https://tower", "https://tower:443/"), true);
    assert.equal(isGpuServerMatch("http://other:3443", "http://tower:3443"), false);
    assert.equal(isGpuServerMatch("https://tower", "http://tower"), false);
    assert.equal(isGpuServerMatch("http://tower:2442", "http://tower:3443"), false);
    assert.equal(isGpuServerMatch("http://tower/api", "http://tower/other"), false);
    assert.equal(isGpuServerMatch("bad", "bad"), false);
  });

  it("never runs local collection for a remote or unconfigured server", async () => {
    for (const localServerUrl of [undefined, "http://other:3443"]) {
      let localReads = 0;
      const result = await collectGpuOverview({
        baseUrl: "http://tower:3443", localServerUrl,
        readNvidia: async () => { localReads += 1; return sample; },
        inventory: async () => inventory,
      });
      assert.equal(result.state, "inventory");
      assert.equal(localReads, 0);
      assert.equal(result.devices[0].utilizationPercent, null);
    }
  });

  it("returns live stats without depending on inventory support", async () => {
    const result = await collectGpuOverview({
      baseUrl: "http://tower:3443", localServerUrl: "http://tower:3443",
      readNvidia: async () => sample,
      inventory: async () => { throw new Error("unsupported query"); },
    });
    assert.equal(result.state, "live");
    assert.equal(result.source, "nvidia");
    assert.equal(result.devices[0].utilizationPercent, 42);
  });

  it("falls back on driver failures and clears old live readings", async () => {
    for (const readNvidia of [async () => { throw new Error("timeout"); }, async () => "No devices were found"]) {
      const result = await collectGpuOverview({
        baseUrl: "http://tower:3443", localServerUrl: "http://tower:3443", readNvidia,
        inventory: async () => inventory,
      });
      assert.equal(result.state, "inventory");
      assert.equal(result.devices[0].blacklisted, true);
      assert.equal(result.devices[0].temperatureC, null);
      assert.match(result.message ?? "", /NVIDIA driver/);
    }
  });

  it("distinguishes an empty inventory from unsupported or denied data", async () => {
    const collect = (raw: unknown) => collectGpuOverview({ baseUrl: "http://tower", inventory: async () => raw });
    assert.equal((await collect({ info: { gpu: [] } })).state, "empty");
    assert.equal((await collect({ info: { gpu: null } })).state, "unavailable");
    assert.equal((await collect(null)).state, "unavailable");
    const denied = await collectGpuOverview({ baseUrl: "http://tower", inventory: async () => { throw new Error("denied"); } });
    assert.equal(denied.state, "unavailable");
  });

  it("maps API inventory without inventing live metrics", () => {
    const [device] = mapGpuInventory(inventory);
    assert.equal(device.name, "NVIDIA (2684)");
    assert.equal(device.utilizationPercent, null);
    assert.deepEqual(mapGpuInventory(null), []);
  });
});
