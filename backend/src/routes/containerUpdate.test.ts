import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import cookieParser from "cookie-parser";

// This test process uses its own temporary credential store and a fake Unraid endpoint.
const originalCwd = process.cwd();
const root = await mkdtemp(join(tmpdir(), "unpwa-update-test-"));
process.chdir(root);
const { apiRouter } = await import("./api.js");
const { saveServer, setActiveServer } = await import("../services/secretStore.js");
let mutations: Array<{ query: string; variables: Record<string, unknown> }> = [];
let currentContainerId = "container-123";
let updateAvailable = true;
const unraid = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  mutations.push(request);
  let data: unknown;
  if (request.query.includes("refreshDockerDigests")) {
    updateAvailable = false;
    data = { refreshDockerDigests: true };
  } else if (request.query.includes("mutation UpdateContainer")) {
    currentContainerId = "new-container";
    data = { docker: { updateContainer: { id: currentContainerId } } };
  } else if (request.query.includes("Capability")) {
    data = { __type: { fields: [{ name: "updateContainer" }] }, __schema: { mutationType: { fields: [{ name: "refreshDockerDigests" }] } } };
  } else {
    data = { docker: { containers: [{ id: currentContainerId, names: ["/Media"], image: "example/media:latest", state: "RUNNING", isUpdateAvailable: updateAvailable }] } };
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ data }));
});
const app = express();
app.use(express.json(), cookieParser());
app.use("/api", apiRouter);
const api = http.createServer(app);
let baseUrl = "";
let serverId = "";
let readOnlyId = "";
before(async () => {
  await new Promise<void>((done) => unraid.listen(0, "127.0.0.1", done));
  const serverUrl = `http://127.0.0.1:${(unraid.address() as AddressInfo).port}`;
  serverId = (await saveServer({ baseUrl: serverUrl, apiKey: "test-key", scopes: ["docker:update_any"], trustSelfSigned: false, createdAt: new Date().toISOString() })).id;
  readOnlyId = (await saveServer({ baseUrl: serverUrl, apiKey: "test-read-key", scopes: ["read:docker"], trustSelfSigned: false, createdAt: new Date().toISOString() })).id;
  await setActiveServer(serverId);
  await new Promise<void>((done) => api.listen(0, "127.0.0.1", done));
  baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
after(async () => {
  await Promise.all([new Promise<void>((done) => api.close(() => done())), new Promise<void>((done) => unraid.close(() => done()))]);
  process.chdir(originalCwd);
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true });
});
async function update(id: string, csrf = true) {
  return fetch(`${baseUrl}/api/docker/container-123/update`, { method: "POST", headers: {
    "content-type": "application/json", ...(csrf ? { cookie: "unpwa_csrf=test-token", "x-csrf-token": "test-token" } : {}),
  }, body: JSON.stringify({ serverId: id }) });
}
it("requires CSRF and a stable selected server, and rejects read-only keys", async () => {
  mutations = [];
  assert.equal((await update(serverId, false)).status, 403);
  assert.equal((await update("")).status, 400);
  await setActiveServer(readOnlyId);
  assert.equal((await update(serverId)).status, 409);
  assert.equal((await update(readOnlyId)).status, 403);
  assert.equal(mutations.length, 0);
});
it("updates through the selected server once and records a confirmed result", async () => {
  await setActiveServer(serverId);
  const response = await update(serverId);
  assert.equal(response.status, 200);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].variables.id, "container-123");
  assert.match(mutations[0].query, /updateContainer/);
  assert.equal((await response.json()).updatedId, "new-container");
});

it("clears old update buttons after a native digest check and later shows a new update for the same container", async () => {
  const before = await fetch(`${baseUrl}/api/docker`);
  assert.match(before.headers.get("cache-control") ?? "", /no-store/);
  const pending = await before.json();
  assert.equal(pending.containers[0].id, "new-container");
  assert.equal(pending.containers[0].updatePending, true);
  assert.equal(pending.containers[0].updateAvailable, null);
  assert.equal(pending.canCheckUpdates, true);
  const headers = { "content-type": "application/json", cookie: "unpwa_csrf=test-token", "x-csrf-token": "test-token" };
  const check = (id: string, csrf = true) => fetch(`${baseUrl}/api/docker/check-updates`, { method: "POST", headers: csrf ? headers : { "content-type": "application/json" }, body: JSON.stringify({ serverId: id }) });
  const refreshCount = () => mutations.filter((entry) => entry.query.includes("refreshDockerDigests")).length;
  assert.equal((await check(serverId, false)).status, 403);
  await setActiveServer(readOnlyId);
  assert.equal((await check(serverId)).status, 409);
  assert.equal((await check(readOnlyId)).status, 403);
  assert.equal(refreshCount(), 0);
  await setActiveServer(serverId);
  const response = await check(serverId);
  assert.equal(response.status, 200);
  const fresh = await response.json();
  assert.equal(fresh.serverId, serverId);
  assert.equal(fresh.containers[0].updateAvailable, false);
  assert.equal(fresh.containers[0].updatePending, false);
  assert.equal(refreshCount(), 1);
  updateAvailable = true;
  const later = await (await fetch(`${baseUrl}/api/docker`)).json();
  assert.equal(later.containers[0].id, "new-container");
  assert.equal(later.containers[0].updateAvailable, true);
});
