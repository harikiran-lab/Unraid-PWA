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
const unraid = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  mutations.push(JSON.parse(body));
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ data: { docker: { updateContainer: { id: "new-container" } } } }));
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
});
