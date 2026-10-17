import { Activity, CircleX, Info, Download } from "lucide-react";
import { BadgePill } from "../BadgePill";
import { dockerIconProxyUrl } from "../../lib/ui";
import type { DockerData, DockerUpdateBatch } from "../../types";
import { FrostedCard } from "../FrostedCard";
import { IconRow } from "../IconRow";
import { SectionHeader } from "../SectionHeader";
import { StatusPill } from "../StatusPill";
import { DockerLogo } from "../DockerLogo";

type DockerTabProps = {
  docker: DockerData | null;
  filteredContainers: DockerData["containers"];
  dockerSearch: string;
  onDockerSearchChange: (value: string) => void;
  onOpenContainerInfo: (containerId: string) => void;
  canWriteControls: boolean;
  updating: boolean;
  checkingUpdates: boolean;
  updateCheckError: string;
  onCheckUpdates: () => void;
  onUpdateContainer: (containerId: string, name: string) => void;
  onUpdateAll: (containers: Array<{ id: string; name: string }>) => void;
  updateBatch: DockerUpdateBatch | null;
};

export function DockerTab({
  docker,
  filteredContainers,
  dockerSearch,
  onDockerSearchChange,
  onOpenContainerInfo,
  canWriteControls,
  updating,
  checkingUpdates,
  updateCheckError,
  onCheckUpdates,
  onUpdateContainer,
  onUpdateAll,
  updateBatch,
}: DockerTabProps) {
  // The summary always covers the whole server, independently of search.
  const blockedIds = new Set(updateBatch?.items.filter((item) => item.status === "uncertain").map((item) => item.id));
  const updates = docker?.containers.filter((container) => container.updateAvailable === true && !blockedIds.has(container.id)) ?? [];
  const unknown = docker?.containers.filter((container) => container.updateAvailable == null).length ?? 0;
  const confirmed = updateBatch?.items.filter((item) => item.status === "completed").length ?? 0;
  const eligible = updates;
  const updateDisabled = !canWriteControls || !docker?.canUpdate || updating || eligible.length === 0;
  return (
    <>
      <FrostedCard>
        <SectionHeader title="Docker Overview" />
        <label className="search-inline-label">
          <input
            className="search-inline-input"
            value={dockerSearch}
            onChange={(event) => onDockerSearchChange(event.target.value)}
            placeholder="Search dockers..."
          />
        </label>
        <IconRow label="Running" value={`${docker?.summary.running ?? 0}`} icon={Activity} />
        <IconRow label="Stopped" value={`${docker?.summary.stopped ?? 0}`} icon={CircleX} />
        <div className="container-update-summary">
          <IconRow label="Updates available" value={checkingUpdates ? "Checking…" : !docker || (updates.length === 0 && unknown > 0) ? "Unavailable" : `${updates.length}${unknown > 0 ? " known" : ""}`} icon={Download} />
          {docker?.canCheckUpdates && <button type="button" disabled={!canWriteControls || updating} onClick={onCheckUpdates}>
            {checkingUpdates ? "Checking…" : "Check for updates"}
          </button>}
          {updateCheckError && <small role="status">{updateCheckError}</small>}
          {unknown > 0 && <small>Update status unavailable for {unknown} {unknown === 1 ? "container" : "containers"}.</small>}
          {updates.length > 0 && (
            <>
              <ul className="container-update-list" aria-label="Containers with updates">
                {updates.map((container) => <li key={container.id}>{container.name}</li>)}
              </ul>
              <button type="button" disabled={updateDisabled}
                title={!docker?.canUpdate ? "This Unraid API does not expose container updates" : !canWriteControls ? "Docker write permission is required" : "Update all listed containers one at a time"}
                onClick={() => onUpdateAll(eligible.map(({ id, name }) => ({ id, name })))}>
                <Download size={14} aria-hidden /> Update all{eligible.length ? ` (${eligible.length})` : ""}
              </button>
            </>
          )}
          {docker && updates.length === 0 && unknown === 0 && <small>No container updates available.</small>}
          {updateBatch?.items.some((item) => item.status === "uncertain") && <small>An update is unconfirmed. Check Unraid before refreshing this page or retrying it.</small>}
        </div>
        {updateBatch && (
          <div className="container-update-summary" role="status" aria-live="polite">
            <strong>{confirmed} of {updateBatch.items.length} updates confirmed</strong>
            <ul className="container-update-list" aria-label="Update progress">
              {updateBatch.items.map((item) => <li key={item.id}>{item.name}: {({ queued: "Queued", updating: "Updating…", completed: "Completed", uncertain: "Unconfirmed — check Unraid", skipped: "Not started" })[item.status]}</li>)}
            </ul>
            {updateBatch.error && <small>Check Unraid before retrying an unconfirmed update.</small>}
          </div>
        )}
      </FrostedCard>
      {filteredContainers.map((container) => (
        <FrostedCard key={container.id}>
          <div className="row">
            <div className="docker-title">
              <DockerLogo
                name={container.name}
                iconUrl={container.iconUrl}
                fallbackIconUrl={dockerIconProxyUrl(container.id)}
              />
              <h3>{container.name}</h3>
            </div>
            <div className="docker-card-actions">
              <StatusPill status={container.status} />
              <button
                className="icon-button notification-archive"
                type="button"
                onClick={() => onOpenContainerInfo(container.id)}
                aria-label={`Open info for ${container.name}`}
                title="Container details"
              >
                <Info size={14} />
              </button>
            </div>
          </div>
          <small>{container.image}</small>
          <div className="row container-update-row">
            {container.updatePending ? <small>Updated</small> : container.updateAvailable === true ? <BadgePill value="Update available" />
              : container.updateAvailable === false ? <small>Up to date</small>
                : <small>Update status unavailable</small>}
            {container.updateAvailable === true && (
              <button type="button" disabled={!docker?.canUpdate || !canWriteControls || updating || blockedIds.has(container.id)}
                title={!docker?.canUpdate ? "This Unraid API does not expose container updates" : !canWriteControls ? "Docker write permission is required" : "Pull the latest image and recreate this container"}
                onClick={() => onUpdateContainer(container.id, container.name)}>
                <Download size={14} aria-hidden /> Update
              </button>
            )}
          </div>
        </FrostedCard>
      ))}
    </>
  );
}
