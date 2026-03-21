import type { JobListItem } from "@shared/types.js";
import { cn } from "@/lib/utils";

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
import { defaultStatusToken, statusTokens } from "./constants";

interface JobRowContentProps {
  job: JobListItem;
  isSelected?: boolean;
  showStatusDot?: boolean;
  showSourceBadge?: boolean;
  statusDotClassName?: string;
  className?: string;
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
  statusDotClassName,
  className,
}: JobRowContentProps) => {
  const hasScore = job.suitabilityScore != null;
  const statusToken = statusTokens[job.status] ?? defaultStatusToken;
  const suitabilityTone = getSuitabilityScoreTone(job.suitabilityScore ?? 0);

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
          {formatPostedDate(job.datePosted) && (
            <span className="before:content-['_·_'] text-muted-foreground/50">
              {formatPostedDate(job.datePosted)}
            </span>
          )}
        </div>
        {job.salary?.trim() && (
          <div className="truncate text-xs text-muted-foreground mt-0.5">
            {job.salary}
          </div>
        )}
      </div>

      {hasScore && (
        <div className="shrink-0 text-right">
          <span className={cn("text-xs tabular-nums", suitabilityTone)}>
            {job.suitabilityScore}
          </span>
        </div>
      )}
    </div>
  );
};
