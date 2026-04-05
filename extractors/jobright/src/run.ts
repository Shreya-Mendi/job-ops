import type { CreateJobInput } from "@shared/types/jobs";

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

interface JobrightNextJob {
  jobId?: string;
  jobTitle?: string;
  jobSeniority?: string;
  jobLocation?: string;
  isRemote?: boolean;
  publishTime?: string;
  employmentType?: string;
  jobSummary?: string;
  salaryMin?: number;
  salaryMax?: number;
  url?: string;
  applyLink?: string;
}

interface JobrightNextListItem {
  jobResult?: JobrightNextJob;
  companyResult?: {
    companyName?: string;
    companyDesc?: string;
  };
}

/** Fetch the current buildId from the JobRight homepage */
async function fetchBuildId(): Promise<string> {
  const res = await fetch("https://jobright.ai/", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) throw new Error(`Failed to fetch JobRight homepage: ${res.status}`);
  const html = await res.text();

  // Extract buildId from <script id="__NEXT_DATA__">{"buildId":"..."}
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (!match) throw new Error("Could not find __NEXT_DATA__ in JobRight homepage");

  const nextData = JSON.parse(match[1]) as { buildId?: string };
  if (!nextData.buildId) throw new Error("buildId not found in __NEXT_DATA__");

  return nextData.buildId;
}

/** Fetch jobs for a single search term using the Next.js data endpoint */
async function fetchJobsForTerm(
  buildId: string,
  term: string,
  country = "US",
): Promise<JobrightNextListItem[]> {
  const url = `https://jobright.ai/_next/data/${buildId}/jobs/search.json?country=${country}&value=${encodeURIComponent(term)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      Accept: "application/json, */*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `https://jobright.ai/jobs/search?country=${country}&value=${encodeURIComponent(term)}`,
    },
  });

  if (!res.ok) {
    throw new Error(`JobRight API returned ${res.status} for term '${term}'`);
  }

  const data = (await res.json()) as {
    pageProps?: {
      jobList?: JobrightNextListItem[];
    };
  };

  return data?.pageProps?.jobList ?? [];
}

function buildSalaryRange(job: JobrightNextJob): string | undefined {
  if (job.salaryMin != null || job.salaryMax != null) {
    const min = job.salaryMin ? `$${Math.round(job.salaryMin / 1000)}k` : "";
    const max = job.salaryMax ? `$${Math.round(job.salaryMax / 1000)}k` : "";
    if (min && max) return `${min} - ${max}`;
    return min || max || undefined;
  }
  return undefined;
}

function mapItem(item: JobrightNextListItem, searchTerm: string): CreateJobInput | null {
  const raw = item.jobResult;
  if (!raw) return null;

  const title = raw.jobTitle?.trim() ?? "";
  const company = item.companyResult?.companyName?.trim() ?? "";
  const jobId = raw.jobId?.trim() ?? "";

  if (!title || !company || !jobId) return null;

  const url =
    raw.url?.startsWith("http")
      ? raw.url
      : raw.applyLink?.startsWith("http")
        ? raw.applyLink
        : `https://jobright.ai/jobs/info/${jobId}`;

  const location = raw.isRemote
    ? "Remote"
    : (raw.jobLocation?.trim() ?? "");

  const salary = buildSalaryRange(raw);

  const jobType = raw.employmentType ?? raw.jobSeniority ?? undefined;

  return {
    title,
    employer: company,
    location,
    jobDescription: raw.jobSummary ?? "",
    jobUrl: url,
    source: "jobright" as const,
    salary,
    jobType,
    datePosted: raw.publishTime ?? undefined,
  };
}

export async function runJobright(options: JobrightOptions): Promise<JobrightResult> {
  const terms = options.searchTerms?.length ? options.searchTerms : ["software engineer intern"];
  const country = options.country ?? "US";
  const maxPerTerm = options.maxJobsPerTerm ?? 25;

  let buildId: string;
  try {
    buildId = await fetchBuildId();
    console.log(`[JobRight] Using buildId: ${buildId}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[JobRight] Failed to get buildId: ${msg}`);
    return { success: false, jobs: [], error: msg };
  }

  const allJobs: CreateJobInput[] = [];
  const seen = new Set<string>();

  // Fetch all terms in parallel, then process in order for deterministic dedup + progress
  const results = await Promise.allSettled(
    terms.map((term) => fetchJobsForTerm(buildId, term, country)),
  );

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    const result = results[i];
    let added = 0;

    if (result.status === "fulfilled") {
      for (const r of result.value) {
        const job = mapItem(r, term);
        if (!job) continue;
        const key = `${job.title}|${job.company}|${job.url}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        allJobs.push(job);
        added++;
        if (added >= maxPerTerm) break;
      }
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`[JobRight] Fetch failed for term '${term}': ${msg}`);
    }

    options.onProgress?.({
      termIndex: i + 1,
      termTotal: terms.length,
      searchTerm: term,
      jobsFound: added,
    });
  }

  return { success: true, jobs: allJobs };
}
