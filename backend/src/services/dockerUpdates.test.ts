import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchDockerUpdateInfo, performContainerUpdate, markContainerUpdated, pendingContainerUpdate, refreshDockerUpdateStatuses } from "./dockerUpdates.js";

describe("native Docker updates", () => {
  it("preserves available, current, and unknown update states and detects the mutation", async () => {
    const result = await fetchDockerUpdateInfo(async <T>(query: string) => (query.includes("Status") ? { docker: { containers: [
      { id: "a", isUpdateAvailable: true }, { id: "b", isUpdateAvailable: false }, { id: "c", isUpdateAvailable: null },
    ] } } : { __type: { fields: [{ name: "updateContainer" }] } }) as T, "server-update-test-1");
    assert.equal(result.available.get("a"), true);
    assert.equal(result.available.get("b"), false);
    assert.equal(result.available.get("c"), null);
    assert.equal(result.canUpdate, true);
  });
  it("degrades safely on older APIs or denied introspection", async () => {
    const result = await fetchDockerUpdateInfo(async () => { throw new Error("unsupported"); }, "server-update-test-2");
    assert.equal(result.canUpdate, false);
    assert.equal(result.available.size, 0);
  });
  it("issues exactly one native mutation with a long timeout and never retries an uncertain result", async () => {
    let calls = 0;
    await assert.rejects(() => performContainerUpdate(async (query, variables, timeout) => {
      calls++;
      assert.match(query, /updateContainer\(id: \$id\)/);
      assert.deepEqual(variables, { id: "a" });
      assert.equal(timeout, 600_000);
      throw new Error("connection lost");
    }, "a"), /connection lost/);
    assert.equal(calls, 1);
    await assert.rejects(() => performContainerUpdate(async <T>() => ({ docker: { updateContainer: null } }) as T, "a"), /did not confirm/);
    await performContainerUpdate(async <T>() => ({ docker: { updateContainer: { id: "new-id" } } }) as T, "a");
  });
  it("keeps both old and recreated IDs pending until a successful fresh check, then allows another update", async () => {
    const server = "receipt-test";
    markContainerUpdated(server, "old", "new");
    assert.equal(pendingContainerUpdate(server, "old", true), true);
    assert.equal(pendingContainerUpdate(server, "new", true), true);
    assert.equal(pendingContainerUpdate("other", "new", true), false);
    await assert.rejects(() => refreshDockerUpdateStatuses(async <T>() => ({ refreshDockerDigests: false }) as T, server));
    assert.equal(pendingContainerUpdate(server, "new", true), true);
    let calls = 0;
    await refreshDockerUpdateStatuses(async <T>(query: string, variables?: Record<string, unknown>, timeout?: number) => {
      calls++;
      assert.match(query, /mutation RefreshDockerUpdates \{ refreshDockerDigests \}/);
      assert.equal(timeout, 120_000);
      return { refreshDockerDigests: true } as T;
    }, server);
    assert.equal(calls, 1);
    assert.equal(pendingContainerUpdate(server, "new", true), false);
  });
  it("does not clear a completion that happened while a digest check was running", async () => {
    const server = "concurrent-check-test";
    markContainerUpdated(server, "first", "first-new");
    await refreshDockerUpdateStatuses(async <T>() => {
      markContainerUpdated(server, "later", "later-new");
      return { refreshDockerDigests: true } as T;
    }, server);
    assert.equal(pendingContainerUpdate(server, "first-new", true), false);
    assert.equal(pendingContainerUpdate(server, "later-new", true), true);
    assert.equal(pendingContainerUpdate(server, "later-new", false), false);
  });
  it("detects registry check capability independently from cached update status", async () => {
    const value = await fetchDockerUpdateInfo(async <T>(query: string) => (query.includes("Capability") ? {
      __type: { fields: [{ name: "updateContainer" }] }, __schema: { mutationType: { fields: [{ name: "refreshDockerDigests" }] } },
    } : { docker: { containers: [] } }) as T, "check-capability-test");
    assert.equal(value.canCheckUpdates, true);
  });
});
