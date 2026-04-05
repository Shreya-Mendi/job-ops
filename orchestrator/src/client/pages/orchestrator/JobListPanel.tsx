import {
  useMarkAsAppliedMutation,
  useSkipJobMutation,
} from "@client/hooks/queries/useJobMutations";
import type { JobListItem, JobSource } from "@shared/types.js";
import { sourceLabel } from "@/lib/utils";
import { ArrowDownUp, CheckCheck, ChevronDown, ChevronRight, Layers, Loader2, X } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { FilterTab, JobSort } from "./constants";
import { defaultStatusToken, emptyStateCopy, statusTokens } from "./constants";
import { JobRowContent } from "./JobRowContent";

interface JobListPanelProps {
  isLoading: boolean;
  jobs: JobListItem[];
  activeJobs: JobListItem[];
  selectedJobId: string | null;
  selectedJobIds: Set<string>;
  activeTab: FilterTab;
  sort: JobSort;
  onSortChange: (sort: JobSort) => void;
  onSelectJob: (jobId: string) => void;
  onToggleSelectJob: (jobId: string) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onMoveGroupToReady?: (ids: string[]) => void;
}

interface SourceGroup {
  source: JobSource;
  label: string;
  jobs: JobListItem[];
}

// Sources shown first when grouping
const SOURCE_PRIORITY: Partial<Record<JobSource, number>> = {
  jobright: 0,
  linkedin: 1,
  indeed: 2,
  glassdoor: 3,
};

function groupJobsBySource(jobs: JobListItem[]): SourceGroup[] {
  const map = new Map<JobSource, JobListItem[]>();
  for (const job of jobs) {
    const existing = map.get(job.source);
    if (existing) {
      existing.push(job);
    } else {
      map.set(job.source, [job]);
    }
  }
  return Array.from(map.entries())
    .map(([source, groupJobs]) => ({
      source,
      label: sourceLabel[source],
      jobs: groupJobs,
    }))
    .sort(
      (a, b) =>
        (SOURCE_PRIORITY[a.source] ?? 99) - (SOURCE_PRIORITY[b.source] ?? 99),
    );
}

export const JobListPanel: React.FC<JobListPanelProps> = ({
  isLoading,
  jobs,
  activeJobs,
  selectedJobId,
  selectedJobIds,
  activeTab,
  sort,
  onSortChange,
  onSelectJob,
  onToggleSelectJob,
  onToggleSelectAll,
  onMoveGroupToReady,
}) => {
  const [groupBySource, setGroupBySource] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<JobSource>>(new Set());

  const markAppliedMutation = useMarkAsAppliedMutation();
  const skipMutation = useSkipJobMutation();

  const sourceGroups = useMemo(
    () => (groupBySource ? groupJobsBySource(activeJobs) : null),
    [groupBySource, activeJobs],
  );

  const toggleCollapsed = useCallback((source: JobSource) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  const handleMarkApplied = useCallback(
    (e: React.MouseEvent, jobId: string) => {
      e.stopPropagation();
      markAppliedMutation.mutate(jobId);
    },
    [markAppliedMutation],
  );

  const handleSkip = useCallback(
    (e: React.MouseEvent, jobId: string) => {
      e.stopPropagation();
      skipMutation.mutate(jobId);
    },
    [skipMutation],
  );

  const renderJobRow = useCallback(
    (job: JobListItem) => {
      const isSelected = job.id === selectedJobId;
      const isChecked = selectedJobIds.has(job.id);
      const statusToken = statusTokens[job.status] ?? defaultStatusToken;
      const isApplied = job.status === "applied";
      const isSkipped = job.status === "skipped";

      return (
        <div
          key={job.id}
          data-job-id={job.id}
          className={cn(
            "group flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer border-l-2 border-b",
            isChecked
              ? "!border-l !border-l-primary !bg-muted/40"
              : "border-l border-l-border/40",
            isSelected
              ? "bg-primary/15"
              : "border-b-border/40 hover:bg-muted/20",
            isChecked && isSelected && "outline-2 outline-primary/30",
          )}
        >
          <div className="relative h-4 w-4 shrink-0">
            <span
              className={cn(
                "absolute inset-0 m-auto h-2 w-2 rounded-full transition-opacity duration-150 ease-out",
                statusToken.dot,
                isChecked || isSelected
                  ? "opacity-0"
                  : "opacity-100 group-hover:opacity-0",
              )}
              title={statusToken.label}
            />
            <Checkbox
              checked={isChecked}
              onCheckedChange={() => onToggleSelectJob(job.id)}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Select ${job.title}`}
              className={cn(
                "absolute inset-0 m-0 border-border/80 cursor-pointer text-muted-foreground/70 transition-opacity duration-150 ease-out",
                "data-[state=checked]:border-primary data-[state=checked]:bg-primary/20 data-[state=checked]:text-primary",
                "data-[state=checked]:shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]",
                isChecked || isSelected
                  ? "opacity-100 pointer-events-auto"
                  : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
              )}
            />
          </div>

          {/* Job content — shrinks when quick-actions appear */}
          <button
            type="button"
            onClick={() => onSelectJob(job.id)}
            data-testid={`select-${job.id}`}
            className="flex min-w-0 flex-1 cursor-pointer text-left"
            aria-pressed={isSelected}
          >
            <JobRowContent
              job={job}
              isSelected={isSelected}
              showStatusDot={false}
              showSourceBadge={!groupBySource}
            />
          </button>

          {/* Quick-action buttons — visible on row hover */}
          <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
            {!isApplied && (
              <button
                type="button"
                onClick={(e) => handleMarkApplied(e, job.id)}
                title="Mark as applied"
                disabled={markAppliedMutation.isPending}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300 transition-colors disabled:opacity-50"
              >
                <CheckCheck className="h-3 w-3" />
                <span className="hidden sm:inline">Applied</span>
              </button>
            )}
            {!isSkipped && (
              <button
                type="button"
                onClick={(e) => handleSkip(e, job.id)}
                title="Skip this job"
                disabled={skipMutation.isPending}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400 transition-colors disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                <span className="hidden sm:inline">Skip</span>
              </button>
            )}
          </div>
        </div>
      );
    },
    [
      selectedJobId,
      selectedJobIds,
      onSelectJob,
      onToggleSelectJob,
      groupBySource,
      handleMarkApplied,
      handleSkip,
      markAppliedMutation.isPending,
      skipMutation.isPending,
    ],
  );

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card shadow-sm">
      {isLoading && jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <div className="text-sm text-muted-foreground">Loading jobs...</div>
        </div>
      ) : activeJobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <div className="text-base font-semibold">No jobs found</div>
          <p className="max-w-md text-sm text-muted-foreground">
            {emptyStateCopy[activeTab]}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 px-4 py-2 opacity-100 transition-opacity sm:opacity-50 sm:hover:opacity-100">
            <label
              htmlFor="job-list-select-all"
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <Checkbox
                id="job-list-select-all"
                checked={
                  activeJobs.length > 0 &&
                  activeJobs.every((job) => selectedJobIds.has(job.id))
                }
                onCheckedChange={() => {
                  const allSelected =
                    activeJobs.length > 0 &&
                    activeJobs.every((job) => selectedJobIds.has(job.id));
                  onToggleSelectAll(!allSelected);
                }}
                aria-label="Select all filtered jobs"
              />
              Select all filtered
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {selectedJobIds.size} selected
              </span>
              {/* Quick date sort toggle */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (sort.key === "discoveredAt") {
                    // Toggle direction
                    onSortChange({
                      key: "discoveredAt",
                      direction: sort.direction === "desc" ? "asc" : "desc",
                    });
                  } else {
                    // Switch to date newest-first
                    onSortChange({ key: "discoveredAt", direction: "desc" });
                  }
                }}
                className={cn(
                  "h-6 gap-1 px-2 text-xs",
                  sort.key === "discoveredAt"
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground",
                )}
                title={
                  sort.key === "discoveredAt"
                    ? sort.direction === "desc"
                      ? "Sorted: newest first — click for oldest first"
                      : "Sorted: oldest first — click for newest first"
                    : "Sort by date posted"
                }
              >
                <ArrowDownUp className="h-3 w-3" />
                {sort.key === "discoveredAt"
                  ? sort.direction === "desc"
                    ? "Newest"
                    : "Oldest"
                  : "Date"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setGroupBySource((v) => !v);
                  setCollapsed(new Set());
                }}
                className={cn(
                  "h-6 gap-1 px-2 text-xs",
                  groupBySource
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground",
                )}
                title={groupBySource ? "Ungroup sources" : "Group by source"}
              >
                <Layers className="h-3 w-3" />
                {groupBySource ? "Grouped" : "Group"}
              </Button>
            </div>
          </div>

          {/* Job rows */}
          {groupBySource ? (
            sourceGroups!.map((group) => {
              const isCollapsed = collapsed.has(group.source);
              return (
                <div key={group.source}>
                  <div className="group/header flex items-center gap-2 px-4 py-2 bg-muted/30 border-b border-border/40">
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(group.source)}
                      className="flex flex-1 items-center gap-2 text-left hover:text-foreground transition-colors"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-xs font-semibold text-foreground/80 uppercase tracking-wide">
                        {group.label}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {group.jobs.length}
                      </span>
                    </button>
                    {onMoveGroupToReady && (() => {
                      const readyIds = group.jobs
                        .filter((j) => j.status === "discovered")
                        .map((j) => j.id);
                      if (readyIds.length === 0) return null;
                      return (
                        <button
                          type="button"
                          onClick={() => onMoveGroupToReady(readyIds)}
                          title={`Move ${readyIds.length} discovered job${readyIds.length !== 1 ? "s" : ""} to Ready`}
                          className="opacity-0 group-hover/header:opacity-100 transition-opacity shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/15 hover:text-primary"
                        >
                          → Ready ({readyIds.length})
                        </button>
                      );
                    })()}
                  </div>
                  {!isCollapsed && group.jobs.map(renderJobRow)}
                </div>
              );
            })
          ) : (
            activeJobs.map(renderJobRow)
          )}
        </div>
      )}
    </div>
  );
};
