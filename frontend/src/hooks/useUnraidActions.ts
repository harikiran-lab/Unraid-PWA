import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { callApi, getCsrfFromCookie, isApiAbortError } from "../api";
import type { DockerData, DockerUpdateBatch, PendingAction, ServerRecord } from "../types";
import { invalidateDockerReads } from "../lib/dockerUpdates";

type ConnectionTestResponse = {
  ok: boolean;
  scopes: string[];
  missingScopes: string[];
  canWrite?: boolean;
};

type UseUnraidActionsInput = {
  serverName: string;
  serverUrl: string;
  apiKey: string;
  trustSelfSigned: boolean;
  renameInput: Record<string, string>;
  apiKeyInput: Record<string, string>;
  activeServerId: string | null;
  canCheckDockerUpdates: boolean;
  setDocker: Dispatch<SetStateAction<DockerData | null>>;
  pendingAction: PendingAction | null;
  setMessage: Dispatch<SetStateAction<string>>;
  setMessageVariant: Dispatch<SetStateAction<"success" | "error" | undefined>>;
  setIsSavingSetup: Dispatch<SetStateAction<boolean>>;
  setIsTestingSetup: Dispatch<SetStateAction<boolean>>;
  setScopeInfo: Dispatch<SetStateAction<string[]>>;
  setMissingScopes: Dispatch<SetStateAction<string[]>>;
  setCanWriteFromServer: Dispatch<SetStateAction<boolean>>;
  setSetupDone: Dispatch<SetStateAction<boolean>>;
  setServers: Dispatch<SetStateAction<ServerRecord[]>>;
  setActiveServerId: Dispatch<SetStateAction<string | null>>;
  setThemeMode: Dispatch<SetStateAction<"dark" | "light">>;
  setAccentColor: Dispatch<SetStateAction<string>>;
  setTrustSelfSigned: Dispatch<SetStateAction<boolean>>;
  setReloadNonce: Dispatch<SetStateAction<number>>;
  setPendingAction: Dispatch<SetStateAction<PendingAction | null>>;
  setArchivingNotificationId: Dispatch<SetStateAction<string | null>>;
  setServerName: Dispatch<SetStateAction<string>>;
  setServerUrl: Dispatch<SetStateAction<string>>;
  setApiKey: Dispatch<SetStateAction<string>>;
  setApiKeyInput: Dispatch<SetStateAction<Record<string, string>>>;
  setAddServerOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
};

export function useUnraidActions(input: UseUnraidActionsInput) {
  const runningAction = useRef(false);
  const [isRunningAction, setIsRunningAction] = useState(false);
  const [updateBatch, setUpdateBatch] = useState<DockerUpdateBatch | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState("");
  const checkingUpdates = useRef(false);
  const lastChecks = useRef(new Map<string, number>());
  const activeServer = useRef(input.activeServerId);
  activeServer.current = input.activeServerId;

  async function checkForDockerUpdates(force = true, serverId = input.activeServerId, report = true) {
    if (!serverId || !input.canCheckDockerUpdates || checkingUpdates.current || runningAction.current) return;
    if (!force && Date.now() - (lastChecks.current.get(serverId) ?? 0) < 300_000) return;
    checkingUpdates.current = true;
    lastChecks.current.set(serverId, Date.now());
    setIsCheckingUpdates(true);
    setUpdateCheckError("");
    try {
      const docker = await callApi<DockerData>("/api/docker/check-updates", { method: "POST",
        headers: { "x-csrf-token": getCsrfFromCookie() ?? "" }, body: JSON.stringify({ serverId }), timeoutMs: 150_000 });
      if (activeServer.current === serverId && docker.serverId === serverId) {
        invalidateDockerReads();
        input.setDocker(docker);
        if (report) { input.setMessage("Container update check completed."); input.setMessageVariant("success"); }
      }
    } catch {
      if (activeServer.current === serverId) setUpdateCheckError("Could not refresh update status. Try Check for updates again.");
    } finally {
      checkingUpdates.current = false;
      setIsCheckingUpdates(false);
    }
  }

  function containerUpdated(serverId: string | undefined, id: string, updatedId?: string) {
    if (!serverId || activeServer.current !== serverId) return;
    invalidateDockerReads();
    input.setDocker((current) => current && (!current.serverId || current.serverId === serverId) ? {
      ...current, serverId, containers: current.containers.map((container) =>
        container.id === id || container.id === updatedId ? { ...container, updateAvailable: null, updatePending: true } : container),
    } : current);
  }
  async function runSetupConnectionTest(): Promise<{ scopes: string[]; missingScopes: string[] } | null> {
    const test = await callApi<ConnectionTestResponse>("/api/servers/test", {
      method: "POST",
      body: JSON.stringify({
        baseUrl: input.serverUrl,
        apiKey: input.apiKey,
        trustSelfSigned: input.trustSelfSigned,
      }),
    });

    if (!test.ok) {
      input.setMessage("Connection test failed.");
      return null;
    }

    input.setScopeInfo(test.scopes);
    input.setMissingScopes(test.missingScopes);
    input.setCanWriteFromServer(Boolean(test.canWrite));
    return { scopes: test.scopes, missingScopes: test.missingScopes };
  }

  async function refreshServerSettingsData() {
    const [serverList, appSettings] = await Promise.all([
      callApi<{ activeServerId: string | null; servers: ServerRecord[] }>("/api/servers"),
      callApi<{ themeMode: "dark" | "light"; accentColor: string }>("/api/settings/app"),
    ]);

    input.setServers(serverList.servers);
    input.setActiveServerId(serverList.activeServerId);
    input.setThemeMode(appSettings.themeMode);
    const activeServerAccent = serverList.servers.find(
      (server) => server.id === serverList.activeServerId,
    )?.accentColor;
    input.setAccentColor(activeServerAccent ?? appSettings.accentColor);
  }

  async function handleSetup() {
    input.setMessage("");
    input.setMessageVariant(undefined);
    input.setIsSavingSetup(true);

    try {
      const test = await runSetupConnectionTest();
      if (!test) {
        return;
      }

      const csrf = getCsrfFromCookie();
      await callApi("/api/servers", {
        method: "POST",
        headers: { "x-csrf-token": csrf ?? "" },
        body: JSON.stringify({
          name: input.serverName,
          baseUrl: input.serverUrl,
          apiKey: input.apiKey,
          trustSelfSigned: input.trustSelfSigned,
          requestedScopes: test.scopes,
        }),
      });

      input.setSetupDone(true);
      input.setAddServerOpen(false);
      input.setMessage("Server setup complete.");
    } catch (error) {
      input.setMessage(error instanceof Error ? error.message : "Setup failed.");
      input.setMessageVariant("error");
    } finally {
      input.setIsSavingSetup(false);
    }
  }

  async function handleTestConnection() {
    if (!input.serverUrl || !input.apiKey) {
      input.setMessage("Fill in server URL and API key first.");
      input.setMessageVariant("error");
      return;
    }

    input.setMessage("");
    input.setMessageVariant(undefined);
    input.setIsTestingSetup(true);

    try {
      const test = await runSetupConnectionTest();
      if (test) {
        input.setMessage("Connection OK.");
        input.setMessageVariant("success");
      }
    } catch (error) {
      input.setMessage(error instanceof Error ? error.message : "Connection test failed.");
      input.setMessageVariant("error");
    } finally {
      input.setIsTestingSetup(false);
    }
  }

  async function runAction() {
    if (!input.pendingAction || runningAction.current || checkingUpdates.current) {
      return;
    }
    const pending = input.pendingAction;
    const isUpdate = pending.target === "dockerBatch" || (pending.target === "docker" && pending.action === "update");
    runningAction.current = true;
    setIsRunningAction(true);
    input.setMessageVariant(undefined);
    const csrf = getCsrfFromCookie();
    let didUpdate = false;
    const updateServerId = pending.target === "dockerBatch" || pending.target === "docker" ? pending.serverId : undefined;

    try {
      if (pending.target === "dockerBatch") {
        const items: DockerUpdateBatch["items"] = pending.containers.map((container) => ({ ...container, status: "queued" }));
        const publish = (error?: string) => setUpdateBatch({ serverId: pending.serverId, items: items.map((item) => ({ ...item })), error });
        publish();
        for (let index = 0; index < items.length; index++) {
          const item = items[index];
          // Pace requests below the existing 20 writes/minute limit, even for
          // immediately completed native updates. Never retry an update.
          if (index > 0) await new Promise((resolve) => window.setTimeout(resolve, 3200));
          item.status = "updating";
          publish();
          try {
            const result = await callApi<{ updatedId?: string }>(`/api/docker/${encodeURIComponent(item.id)}/update`, {
              method: "POST", headers: { "x-csrf-token": csrf ?? "" },
              body: JSON.stringify({ serverId: pending.serverId }), timeoutMs: 610_000,
            });
            didUpdate = true;
            containerUpdated(pending.serverId, item.id, result.updatedId);
            item.status = "completed";
            publish();
          } catch (error) {
            item.status = "uncertain";
            for (const remaining of items.slice(index + 1)) remaining.status = "skipped";
            const detail = `Stopped at ${item.name}. ${index} of ${items.length} updates confirmed. Check Unraid before retrying; this update may still be running. ${error instanceof Error ? error.message : ""}`;
            publish(detail);
            input.setMessage(detail);
            input.setMessageVariant("error");
            return;
          }
        }
        input.setMessage(`All ${items.length} container updates completed.`);
        input.setMessageVariant("success");
        setUpdateBatch(null);
        return;
      }
      const endpoint =
        pending.target === "docker"
          ? `/api/docker/${encodeURIComponent(pending.id)}/${pending.action}`
          : pending.target === "vm"
            ? `/api/vms/${pending.id}/${pending.action}`
            : `/api/array/${pending.action}`;

      const result = await callApi<{ updatedId?: string }>(endpoint, {
        method: "POST",
        headers: { "x-csrf-token": csrf ?? "" },
        ...(isUpdate && pending.target === "docker" ? { body: JSON.stringify({ serverId: pending.serverId }), timeoutMs: 610_000 } : {}),
      });
      if (isUpdate && pending.target === "docker") {
        didUpdate = true;
        containerUpdated(pending.serverId, pending.id, result.updatedId);
      }

      input.setMessage(isUpdate ? "Container update completed." : `${pending.target} ${pending.action} requested.`);
      input.setMessageVariant("success");
      if (!isUpdate) input.setReloadNonce((current) => current + 1);
    } catch (error) {
      input.setMessage(isUpdate ? `Update did not confirm completion. It may still be running; check Unraid before retrying. ${error instanceof Error ? error.message : ""}` : error instanceof Error ? error.message : "Action failed.");
      input.setMessageVariant("error");
    } finally {
      if (isUpdate) input.setReloadNonce((current) => current + 1);
      input.setPendingAction(null);
      runningAction.current = false;
      setIsRunningAction(false);
      if (didUpdate && updateServerId) void checkForDockerUpdates(true, updateServerId, false);
    }
  }

  async function activateServer(id: string) {
    if (runningAction.current) return;
    const csrf = getCsrfFromCookie();
    await callApi(`/api/servers/${id}/activate`, {
      method: "POST",
      headers: { "x-csrf-token": csrf ?? "" },
    });

    await refreshServerSettingsData();
    input.setMessage("Active server changed.");
    input.setReloadNonce((current) => current + 1);
  }

  async function renameServerById(id: string) {
    const csrf = getCsrfFromCookie();
    const name = (input.renameInput[id] ?? "").trim();

    await callApi(`/api/servers/${id}`, {
      method: "PUT",
      headers: { "x-csrf-token": csrf ?? "" },
      body: JSON.stringify({ name }),
    });

    await refreshServerSettingsData();
    input.setMessage("Server name updated.");
  }

  async function setServerTrustSelfSigned(id: string, value: boolean) {
    const csrf = getCsrfFromCookie();

    await callApi(`/api/servers/${id}`, {
      method: "PUT",
      headers: { "x-csrf-token": csrf ?? "" },
      body: JSON.stringify({ trustSelfSigned: value }),
    });

    await refreshServerSettingsData();
    if (input.activeServerId === id) {
      input.setTrustSelfSigned(value);
    }

    input.setMessage(`Trust self-signed ${value ? "enabled" : "disabled"} for server.`);
  }

  async function setServerAccentColor(id: string, accentColor: string) {
    const csrf = getCsrfFromCookie();

    await callApi(`/api/servers/${id}`, {
      method: "PUT",
      headers: { "x-csrf-token": csrf ?? "" },
      body: JSON.stringify({ accentColor }),
    });

    await refreshServerSettingsData();
    input.setMessage("Server accent color updated.");
  }

  async function replaceServerApiKey(id: string) {
    const csrf = getCsrfFromCookie();
    const nextApiKey = (input.apiKeyInput[id] ?? "").trim();
    if (!nextApiKey) {
      input.setMessage("Enter a new API key first.");
      input.setMessageVariant("error");
      return;
    }

    try {
      const tested = await callApi<ConnectionTestResponse>(`/api/servers/${id}/test-key`, {
        method: "POST",
        headers: { "x-csrf-token": csrf ?? "" },
        body: JSON.stringify({ apiKey: nextApiKey }),
      });

      await callApi(`/api/servers/${id}`, {
        method: "PUT",
        headers: { "x-csrf-token": csrf ?? "" },
        body: JSON.stringify({ apiKey: nextApiKey }),
      });

      input.setApiKeyInput((current) => ({
        ...current,
        [id]: "",
      }));
      if (input.activeServerId === id) {
        input.setScopeInfo(tested.scopes);
        input.setMissingScopes(tested.missingScopes);
        input.setCanWriteFromServer(Boolean(tested.canWrite));
      }
      await refreshServerSettingsData();
      input.setMessage("Server API key tested and updated.");
      input.setMessageVariant("success");
    } catch (error) {
      if (isApiAbortError(error) && error.timedOut) {
        input.setMessage("API key test timed out. Try again.");
      } else {
        input.setMessage(error instanceof Error ? error.message : "Unable to update server API key.");
      }
      input.setMessageVariant("error");
    }
  }

  async function removeServer(id: string) {
    const csrf = getCsrfFromCookie();

    await callApi(`/api/servers/${id}`, {
      method: "DELETE",
      headers: { "x-csrf-token": csrf ?? "" },
    });

    await refreshServerSettingsData();
    input.setMessage("Server removed.");
  }

  async function saveAppSettings(nextThemeMode: "dark" | "light", nextAccent: string) {
    const csrf = getCsrfFromCookie();

    await callApi("/api/settings/app", {
      method: "PUT",
      headers: { "x-csrf-token": csrf ?? "" },
      body: JSON.stringify({ themeMode: nextThemeMode, accentColor: nextAccent }),
    });

    input.setThemeMode(nextThemeMode);
    input.setAccentColor(nextAccent);
    input.setMessage("App settings saved.");
  }

  async function archiveNotificationById(notificationId: string) {
    const csrf = getCsrfFromCookie();
    input.setArchivingNotificationId(notificationId);

    try {
      await callApi(`/api/notifications/${encodeURIComponent(notificationId)}/archive`, {
        method: "POST",
        headers: { "x-csrf-token": csrf ?? "" },
      });

      input.setMessage("Notification archived.");
      input.setReloadNonce((current) => current + 1);
    } catch (error) {
      input.setMessage(error instanceof Error ? error.message : "Archive failed.");
      input.setMessageVariant("error");
    } finally {
      input.setArchivingNotificationId(null);
    }
  }

  function openAddServerFlow() {
    input.setServerName("");
    input.setServerUrl("");
    input.setApiKey("");
    input.setMessage("");
    input.setMessageVariant(undefined);
    input.setScopeInfo([]);
    input.setMissingScopes([]);
    input.setTrustSelfSigned(true);
    input.setAddServerOpen(true);
    input.setSettingsOpen(false);
  }

  return {
    isRunningAction,
    updateBatch,
    isCheckingUpdates,
    updateCheckError,
    checkForDockerUpdates,
    handleSetup,
    handleTestConnection,
    runAction,
    activateServer,
    renameServerById,
    setServerTrustSelfSigned,
    setServerAccentColor,
    replaceServerApiKey,
    removeServer,
    saveAppSettings,
    archiveNotificationById,
    openAddServerFlow,
  };
}
