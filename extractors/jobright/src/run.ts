import type { CreateJobInput } from "@shared/types/jobs";

const SEARCH_BASE = "https://jobright.ai/api/v1/jobs/search";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://jobright.ai/",
  Origin: "https://jobright.ai",
};

export interface JobrightProgressEvent {
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFound: number;
}

export interface JobrightOptions {
  searchTerms?: string[];
  country?: string;
  maxJobsPerTerm?: number;
  onProgress?: (ev: JobrightProgressEvent) => void;
}

export interface JobrightResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface JobrightApiJob {
  id?: string | number;
  title?: string;
  jobTitle?: string;
  company?: string;
  companyName?: string;
  location?: string;
  city?: string;
  state?: string;
  url?: string;
  jobUrl?: string;
  applyUrl?: string;
  description?: string;
  jobDescription?: string;
  salary?: string;
  salaryRange?: string;
  jobType?: string;
  employmentType?: string;
  postedDate?: string;
  createdAt?: string;
  source?: string;
}

function extractJobs(data: unknown): JobrightApiJob[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  // Handle various response shapes
  if (Array.isArray(d)) return d as JobrightApiJob[];
  if (Array.isArray(d.jobs)) return d.jobs as JobrightApiJob[];
  if (Array.isArray(d.data)) return d.data as JobrightApiJob[];
  if (d.data && typeof d.data === "object") {
    const inner = d.data as Record<string, unknown>;
    if (Array.isArray(inner.jobs)) return inner.jobs as JobrightApiJob[];
    if (Array.isArray(inner.list)) return inner.list as JobrightApiJob[];
  }
  if (Array.isArray(d.results)) return d.results as JobrightApiJob[];
  if (Array.isArray(d.list)) return d.list as JobrightApiJob[];
  return [];
}

function mapJob(raw: JobrightApiJob, searchTerm: string): CreateJobInput | null {
  const title = raw.title ?? raw.jobTitle ?? "";
  const company = raw.company ?? raw.companyName ?? "";
  const url = raw.url ?? raw.jobUrl ?? raw.applyUrl ?? "";
  if (!title || !company || !url) return null;

  const location = raw.location ?? [raw.city, raw.state].filter(Boolean).join(", ") ?? "";
  const description = raw.description ?? raw.jobDescription ?? "";
  const salary = raw.salary ?? raw.salaryRange ?? null;
  const jobType = raw.jobType ?? raw.employmentType ?? null;

  return {
    title,
    company,
    location,
    description,
    url,
    source: "jobright" as const,
    salaryRange: salary ?? undefined,
    jobType: jobType ?? undefined,
    postedAt: raw.postedDate ?? raw.createdAt ?? null,
    searchTerm,
  };
}

async function fetchJobsForTerm(term: string, maxJobs: number): Promise<JobrightApiJob[]> {
  const jobs: JobrightApiJob[] = [];
  const pageSize = Math.min(maxJobs, 20);

  // Try the primary search API endpoint
  const params = new URLSearchParams({
    keyword: term,
    page: "1",
    size: String(pageSize),
    sortBy: "date",
  });

  try {
    const resp = await fetch(`${SEARCH_BASE}?${params}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.ok) {
      const data = await resp.json();
      const found = extractJobs(data);
      jobs.push(...found.slice(0, maxJobs));
      if (jobs.length > 0) return jobs;
    }
  } catch {
    // fall through to alternative endpoint
  }

  // Fallback: try alternative endpoint patterns
  const altUrls = [
    `https://jobright.ai/api/jobs?keyword=${encodeURIComponent(term)}&page=1&size=${pageSize}`,
    `https://jobright.ai/api/v2/jobs?q=${encodeURIComponent(term)}&limit=${pageSize}`,
  ];

  for (const url of altUrls) {
    try {
      const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12_000) });
      if (resp.ok) {
        const data = await resp.json();
        const found = extractJobs(data);
        jobs.push(...found.slice(0, maxJobs));
        if (jobs.length > 0) break;
      }
    } catch {
      continue;
    }
  }

  return jobs;
}

export async function runJobright(options: JobrightOptions): Promise<JobrightResult> {
  const terms = options.searchTerms?.length ? options.searchTerms : ["software engineer"];
  const maxPerTerm = options.maxJobsPerTerm ?? 25;
  const allJobs: CreateJobInput[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    try {
      const raw = await fetchJobsForTerm(term, maxPerTerm);
      let added = 0;
      for (const r of raw) {
        const job = mapJob(r, term);
        if (!job) continue;
        const key = `${job.title}|${job.company}|${job.url}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        allJobs.push(job);
        added++;
      }
      options.onProgress?.({ termIndex: i + 1, termTotal: terms.length, searchTerm: term, jobsFound: added });
    } catch (err) {
      options.onProgress?.({ termIndex: i + 1, termTotal: terms.length, searchTerm: term, jobsFound: 0 });
    }
  }

  return { success: true, jobs: allJobs };
}
