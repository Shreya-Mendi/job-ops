import type { CreateJobInput } from "@shared/types/jobs";
import type { BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

export interface RecommendedOptions {
  sessionFile: string;
  maxJobs?: number;
  onProgress?: (found: number) => void;
}

export interface RecommendedResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

// Shape of a raw job object returned by Jobright's internal API
interface RawJobrightJob {
  jobId?: string;
  jobTitle?: string;
  jobLocation?: string;
  isRemote?: boolean;
  publishTime?: string;
  employmentType?: string;
  jobSeniority?: string;
  jobSummary?: string;
  salaryMin?: number;
  salaryMax?: number;
  url?: string;
  applyLink?: string;
  [key: string]: unknown;
}

interface RawJobrightListItem {
  jobResult?: RawJobrightJob;
  companyResult?: { companyName?: string };
  [key: string]: unknown;
}

function buildSalary(job: RawJobrightJob): string | undefined {
  const { salaryMin, salaryMax } = job;
  if (salaryMin == null && salaryMax == null) return undefined;
  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}/mo`;
  if (salaryMin != null && salaryMax != null) return `${fmt(salaryMin)} – ${fmt(salaryMax)}`;
  return fmt((salaryMin ?? salaryMax)!);
}

function mapItem(item: RawJobrightListItem): CreateJobInput | null {
  const raw = item.jobResult;
  if (!raw) return null;

  const title = raw.jobTitle?.trim() ?? "";
  const company = item.companyResult?.companyName?.trim() ?? "";
  const jobId = raw.jobId?.trim() ?? "";
  if (!title || !company || !jobId) return null;

  const jobUrl =
    raw.url?.startsWith("http") ? raw.url
    : raw.applyLink?.startsWith("http") ? raw.applyLink
    : `https://jobright.ai/jobs/info/${jobId}`;

  return {
    title,
    employer: company,
    location: raw.isRemote ? "Remote" : (raw.jobLocation?.trim() ?? ""),
    jobDescription: raw.jobSummary ?? "",
    jobUrl,
    source: "jobright-recommended" as const,
    salary: buildSalary(raw),
    jobType: raw.employmentType ?? raw.jobSeniority ?? undefined,
    datePosted: raw.publishTime ?? undefined,
  };
}

/**
 * Extract jobs from any JSON response blob. Jobright returns lists either as:
 *  - a top-level array of list items
 *  - { jobList: [...] }
 *  - { pageProps: { jobList: [...] } }   (Next.js data endpoint)
 */
function extractItemsFromPayload(data: unknown): RawJobrightListItem[] {
  if (Array.isArray(data)) return data as RawJobrightListItem[];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.jobList)) return d.jobList as RawJobrightListItem[];
    if (d.pageProps && typeof d.pageProps === "object") {
      const pp = d.pageProps as Record<string, unknown>;
      if (Array.isArray(pp.jobList)) return pp.jobList as RawJobrightListItem[];
    }
    // Some endpoints wrap in { data: { jobs: [...] } }
    if (d.data && typeof d.data === "object") {
      const inner = d.data as Record<string, unknown>;
      if (Array.isArray(inner.jobs)) return inner.jobs as RawJobrightListItem[];
      if (Array.isArray(inner.jobList)) return inner.jobList as RawJobrightListItem[];
    }
    if (Array.isArray(d.jobs)) return d.jobs as RawJobrightListItem[];
  }
  return [];
}

async function scrapeRecommended(
  context: BrowserContext,
  maxJobs: number,
  onProgress?: (found: number) => void,
): Promise<CreateJobInput[]> {
  const page: Page = await context.newPage();
  const jobs: CreateJobInput[] = [];
  const seen = new Set<string>();

  function ingest(items: RawJobrightListItem[]) {
    for (const item of items) {
      const job = mapItem(item);
      if (!job) continue;
      if (seen.has(job.jobUrl)) continue;
      seen.add(job.jobUrl);
      jobs.push(job);
      onProgress?.(jobs.length);
      if (jobs.length >= maxJobs) break;
    }
  }

  // Intercept API responses that contain job lists
  page.on("response", async (response) => {
    if (jobs.length >= maxJobs) return;
    const url = response.url();
    if (!url.includes("jobright.ai")) return;
    const ct = response.headers()["content-type"] ?? "";
    if (!ct.includes("json")) return;
    try {
      const data = await response.json();
      const items = extractItemsFromPayload(data);
      if (items.length > 0) ingest(items);
    } catch {
      // non-JSON or empty — skip
    }
  });

  // Navigate to the recommended feed
  await page.goto("https://jobright.ai/jobs/recommended", {
    waitUntil: "networkidle",
    timeout: 60_000,
  });

  // Scroll to trigger pagination / lazy loading
  for (let i = 0; i < 10 && jobs.length < maxJobs; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2_000);
  }

  await page.close();
  return jobs;
}

export async function fetchRecommended(options: RecommendedOptions): Promise<RecommendedResult> {
  const maxJobs = options.maxJobs ?? 100;

  let context: BrowserContext | undefined;
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      storageState: options.sessionFile,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    });

    const jobs = await scrapeRecommended(context, maxJobs, options.onProgress);
    return { success: true, jobs };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[Jobright Recommended] Error: ${error}`);
    return { success: false, jobs: [], error };
  } finally {
    await context?.close();
    await browser?.close();
  }
}
