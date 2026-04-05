import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtractorManifest, ExtractorRuntimeContext } from "@shared/types/extractors";
import { fetchRecommended } from "./src/recommended";
import { runJobright } from "./src/run";

const DEFAULT_SESSION_PATH = join(homedir(), ".job-ops", "jobright-session.json");

async function sessionFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export const manifest: ExtractorManifest = {
  id: "jobright",
  displayName: "JobRight.ai",
  providesSources: ["jobright", "jobright-recommended"],
  async run(context: ExtractorRuntimeContext) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    const sessionFile =
      context.settings["JOBRIGHT_SESSION_FILE"] ?? DEFAULT_SESSION_PATH;

    const hasSession = await sessionFileExists(sessionFile);

    if (hasSession) {
      console.log(`[Jobright] Using saved session from: ${sessionFile}`);
      context.onProgress?.({
        phase: "list",
        detail: "Jobright: loading personalized recommendations…",
        currentUrl: "https://jobright.ai/jobs/recommended",
      });

      return fetchRecommended({
        sessionFile,
        maxJobs: 100,
        onProgress: (found) => {
          if (context.shouldCancel?.()) return;
          context.onProgress?.({
            phase: "list",
            jobCardsFound: found,
            detail: `Jobright: found ${found} recommended jobs`,
            currentUrl: "https://jobright.ai/jobs/recommended",
          });
        },
      });
    }

    // Fallback: public keyword search (no login required)
    console.log("[Jobright] No session file found — falling back to keyword search.");
    console.log(`[Jobright] To use personalized recommendations, run: node --import tsx/esm extractors/jobright/src/save-session.ts`);

    const result = await runJobright({
      searchTerms: context.searchTerms,
      country: "US",
      maxJobsPerTerm: 25,
      onProgress: (ev) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.({
          phase: "list",
          termsProcessed: ev.termIndex,
          termsTotal: ev.termTotal,
          currentUrl: `https://jobright.ai/jobs?keyword=${encodeURIComponent(ev.searchTerm)}`,
          detail: `Jobright: ${ev.termIndex}/${ev.termTotal} — ${ev.jobsFound} jobs (${ev.searchTerm})`,
        });
      },
    });

    return { success: result.success, jobs: result.jobs, error: result.error };
  },
};

export default manifest;
