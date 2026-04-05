import type { JobListItem } from "@shared/types.js";
import { cn, sourceLabel } from "@/lib/utils";
import { defaultStatusToken, statusTokens } from "./constants";
import { normalizeJobType } from "./useFilteredJobs";

function formatPostedDate(datePosted: string | null | undefined): string | null {
  if (!datePosted) return null;
  const ts = Number(datePosted);
  const d = isNaN(ts) ? new Date(datePosted) : new Date(ts);
  if (isNaN(d.getTime())) return null;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1d ago";
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 60) return "1mo ago";
  return `${Math.floor(diffDays / 30)}mo ago`;
}

interface JobRowContentProps {
  job: JobListItem;
  isSelected?: boolean;
  showStatusDot?: boolean;
  showSourceBadge?: boolean;
  statusDotClassName?: string;
  className?: string;
}

const jobTypeColors: Record<string, string> = {
  "Internship": "bg-blue-500/15 text-blue-400",
  "Co-op": "bg-purple-500/15 text-purple-400",
  "Full-time": "bg-emerald-500/15 text-emerald-400",
  "Part-time": "bg-yellow-500/15 text-yellow-400",
  "Contract": "bg-orange-500/15 text-orange-400",
};

function JobTypeBadge({ type }: { type: string }) {
  return (
    <span className={cn(
      "rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide leading-none",
      jobTypeColors[type] ?? "bg-muted/60 text-muted-foreground/70",
    )}>
      {type}
    </span>
  );
}

function getSuitabilityScoreTone(score: number): string {
  if (score >= 70) return "text-emerald-400/90";
  if (score >= 50) return "text-foreground/60";
  return "text-muted-foreground/60";
}

export const JobRowContent = ({
  job,
  isSelected = false,
  showStatusDot = true,
  showSourceBadge = false,
  statusDotClassName,
  className,
}: JobRowContentProps) => {
  const hasScore = job.suitabilityScore != null;
  const statusToken = statusTokens[job.status] ?? defaultStatusToken;
  const suitabilityTone = getSuitabilityScoreTone(job.suitabilityScore ?? 0);
  const postedDate = formatPostedDate(job.datePosted);

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-3", className)}>
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          statusToken.dot,
          !isSelected && "opacity-70",
          statusDotClassName,
          !showStatusDot && "hidden",
        )}
        title={statusToken.label}
      />

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm leading-tight",
            isSelected ? "font-semibold" : "font-medium",
          )}
        >
          {job.title}
        </div>
        <div className="truncate text-xs text-muted-foreground mt-0.5">
          {job.employer}
          {job.location && (
            <span className="before:content-['_in_']">{job.location}</span>
          )}
          {postedDate && (
            <span className="before:content-['_·_'] text-muted-foreground/50">
              {postedDate}
            </span>
          )}
        </div>
        {job.salary?.trim() && (
          <div className="truncate text-xs text-muted-foreground mt-0.5">
            {job.salary}
          </div>
        )}
      </div>

      {(showSourceBadge || hasScore || job.jobType) && (
        <div className="shrink-0 flex flex-col items-end gap-1">
          {showSourceBadge && (
            <span className="rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide bg-muted/60 text-muted-foreground/70 leading-none">
              {sourceLabel[job.source]}
            </span>
          )}
          {normalizeJobType(job.jobType) && (
            <JobTypeBadge type={normalizeJobType(job.jobType)!} />
          )}
          {hasScore && (
            <span className={cn("text-xs tabular-nums", suitabilityTone)}>
              {job.suitabilityScore}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
