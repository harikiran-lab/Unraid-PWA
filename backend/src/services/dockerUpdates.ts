type Execute = <T>(query: string, variables?: Record<string, unknown>, timeoutMs?: number) => Promise<T>;

export type DockerUpdateInfo = { canUpdate: boolean; canCheckUpdates: boolean; available: Map<string, boolean | null> };
const capabilityCache = new Map<string, { expires: number; supported: boolean; canCheck: boolean }>();
const updateStates = new Map<string, { generation: number; pending: Map<string, { generation: number; expires: number }> }>();
function state(serverId: string) {
  let current = updateStates.get(serverId);
  if (!current) {
    if (updateStates.size >= 100) updateStates.delete(updateStates.keys().next().value!);
    current = { generation: 0, pending: new Map() };
    updateStates.set(serverId, current);
  }
  for (const [id, item] of current.pending) if (item.expires < Date.now()) current.pending.delete(id);
  return current;
}

export function markContainerUpdated(serverId: string, originalId: string, updatedId: string): void {
  const current = state(serverId);
  const entry = { generation: ++current.generation, expires: Date.now() + 15 * 60_000 };
  if (current.pending.size > 2000) current.pending.clear();
  for (const id of [originalId, updatedId]) current.pending.set(id, entry);
}

export function pendingContainerUpdate(serverId: string, id: string, available: boolean | null): boolean {
  const current = state(serverId);
  if (available === false) current.pending.delete(id);
  return current.pending.has(id);
}

// A digest refresh updates Unraid's registry cache; it never updates containers.
export async function refreshDockerUpdateStatuses(execute: Execute, serverId: string): Promise<void> {
  const current = state(serverId);
  const generation = current.generation;
  const result = await execute<{ refreshDockerDigests?: boolean }>("mutation RefreshDockerUpdates { refreshDockerDigests }", {}, 120_000);
  if (result?.refreshDockerDigests !== true) throw new Error("Unraid could not refresh container update status.");
  for (const [id, item] of current.pending) if (item.generation <= generation) current.pending.delete(id);
}

export async function fetchDockerUpdateInfo(execute: Execute, serverId: string): Promise<DockerUpdateInfo> {
  const status = await execute<{ docker?: { containers?: Array<{ id: string; isUpdateAvailable?: boolean | null }> } }>(
    "query DockerUpdateStatus { docker { containers { id isUpdateAvailable } } }", {}, 3000,
  ).catch(() => null);
  const cached = capabilityCache.get(serverId);
  let canUpdate = cached?.expires && cached.expires > Date.now() ? cached.supported : null;
  let canCheckUpdates = cached?.expires && cached.expires > Date.now() ? cached.canCheck : false;
  if (canUpdate === null) {
    const schema = await execute<{ __type?: { fields?: Array<{ name: string }> }; __schema?: { mutationType?: { fields?: Array<{ name: string }> } } }>(
      'query DockerUpdateCapability { __type(name: "DockerMutations") { fields { name } } __schema { mutationType { fields { name } } } }', {}, 3000,
    ).catch(() => null);
    canUpdate = schema?.__type?.fields?.some((field) => field.name === "updateContainer") ?? false;
    canCheckUpdates = schema?.__schema?.mutationType?.fields?.some((field) => field.name === "refreshDockerDigests") ?? false;
    if (capabilityCache.size > 100) capabilityCache.clear();
    capabilityCache.set(serverId, { supported: canUpdate, canCheck: canCheckUpdates, expires: Date.now() + (schema ? 300_000 : 15_000) });
  }
  return {
    canUpdate,
    canCheckUpdates,
    available: new Map((status?.docker?.containers ?? []).map((c) => [c.id, typeof c.isUpdateAvailable === "boolean" ? c.isUpdateAvailable : null])),
  };
}

// One native update request, without legacy fallbacks or automatic retries.
// An interrupted HTTP response does not mean the update was rolled back.
export async function performContainerUpdate(execute: Execute, containerId: string): Promise<string> {
  const result = await execute<{ docker?: { updateContainer?: { id?: string } } }>(
    "mutation UpdateContainer($id: PrefixedID!) { docker { updateContainer(id: $id) { id } } }",
    { id: containerId }, 600_000,
  );
  if (!result?.docker?.updateContainer?.id) throw new Error("Unraid did not confirm the container update. Check its status before retrying.");
  return result.docker.updateContainer.id;
}
