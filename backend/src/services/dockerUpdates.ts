type Execute = <T>(query: string, variables?: Record<string, unknown>, timeoutMs?: number) => Promise<T>;

export type DockerUpdateInfo = { canUpdate: boolean; available: Map<string, boolean | null> };
const capabilityCache = new Map<string, { expires: number; supported: boolean }>();

export async function fetchDockerUpdateInfo(execute: Execute, serverId: string): Promise<DockerUpdateInfo> {
  const status = await execute<{ docker?: { containers?: Array<{ id: string; isUpdateAvailable?: boolean | null }> } }>(
    "query DockerUpdateStatus { docker { containers { id isUpdateAvailable } } }", {}, 3000,
  ).catch(() => null);
  const cached = capabilityCache.get(serverId);
  let canUpdate = cached?.expires && cached.expires > Date.now() ? cached.supported : null;
  if (canUpdate === null) {
    const schema = await execute<{ __type?: { fields?: Array<{ name: string }> } }>(
      'query DockerUpdateCapability { __type(name: "DockerMutations") { fields { name } } }', {}, 3000,
    ).catch(() => null);
    canUpdate = schema?.__type?.fields?.some((field) => field.name === "updateContainer") ?? false;
    if (capabilityCache.size > 100) capabilityCache.clear();
    capabilityCache.set(serverId, { supported: canUpdate, expires: Date.now() + (schema ? 300_000 : 15_000) });
  }
  return {
    canUpdate,
    available: new Map((status?.docker?.containers ?? []).map((c) => [c.id, typeof c.isUpdateAvailable === "boolean" ? c.isUpdateAvailable : null])),
  };
}

// One native update request, without legacy fallbacks or automatic retries.
// An interrupted HTTP response does not mean the update was rolled back.
export async function performContainerUpdate(execute: Execute, containerId: string): Promise<void> {
  const result = await execute<{ docker?: { updateContainer?: { id?: string } } }>(
    "mutation UpdateContainer($id: PrefixedID!) { docker { updateContainer(id: $id) { id } } }",
    { id: containerId }, 600_000,
  );
  if (!result?.docker?.updateContainer?.id) throw new Error("Unraid did not confirm the container update. Check its status before retrying.");
}
