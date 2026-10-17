import { Activity, CircleX, Info, Download } from "lucide-react";
import { BadgePill } from "../BadgePill";
import { dockerIconProxyUrl } from "../../lib/ui";
import type { DockerData } from "../../types";
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
  onUpdateContainer: (containerId: string, name: string) => void;
};

export function DockerTab({
  docker,
  filteredContainers,
  dockerSearch,
  onDockerSearchChange,
  onOpenContainerInfo,
  canWriteControls,
  updating,
  onUpdateContainer,
}: DockerTabProps) {
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
            {container.updateAvailable === true ? <BadgePill value="Update available" />
              : container.updateAvailable === false ? <small>Up to date</small>
                : <small>Update status unavailable</small>}
            {container.updateAvailable === true && (
              <button type="button" disabled={!docker?.canUpdate || !canWriteControls || updating}
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
