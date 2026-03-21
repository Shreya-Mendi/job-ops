import type { ExtractorManifest, ExtractorRuntimeContext } from "@shared/types/extractors";
import { runJobright } from "./src/run";

export const manifest: ExtractorManifest = {
  id: "jobright",
  displayName: "JobRight.ai",
  providesSources: ["jobright"],
  async run(context: ExtractorRuntimeContext) {
    if (context.shouldCancel?.()) return { success: true, jobs: [] };

    const result = await runJobright({
      searchTerms: context.searchTerms,
      country: context.settings.jobspyCountryIndeed ?? "usa",
      maxJobsPerTerm: 25,
      onProgress: (ev) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.({
          phase: "list",
          termsProcessed: ev.termIndex,
          termsTotal: ev.termTotal,
          currentUrl: `https://jobright.ai/jobs?keyword=${encodeURIComponent(ev.searchTerm)}`,
          detail: `JobRight: ${ev.termIndex}/${ev.termTotal} — ${ev.jobsFound} jobs (${ev.searchTerm})`,
        });
      },
    });

    return { success: result.success, jobs: result.jobs, error: result.error };
  },
};

export default manifest;
