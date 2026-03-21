import { toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { isDemoMode } from "@server/config/demo";
import { DEMO_PROJECT_CATALOG } from "@server/config/demo-defaults";
import {
  clearMasterResumeCache,
  getMasterResumeText,
  hasMasterResume,
  saveMasterResumeText,
} from "@server/services/master-resume";
import { clearProfileCache, getProfile } from "@server/services/profile";
import { extractProjectsFromProfile } from "@server/services/resumeProjects";
import { getResume, RxResumeAuthConfigError } from "@server/services/rxresume";
import { getConfiguredRxResumeBaseResumeId } from "@server/services/rxresume/baseResumeId";
import { type Request, type Response, Router } from "express";

export const profileRouter = Router();

/**
 * GET /api/profile/projects - Get all projects available in the base resume
 */
profileRouter.get("/projects", async (_req: Request, res: Response) => {
  try {
    if (isDemoMode()) {
      res.json({ success: true, data: DEMO_PROJECT_CATALOG });
      return;
    }
    const profile = await getProfile();
    const { catalog } = extractProjectsFromProfile(profile);
    ok(res, catalog);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * GET /api/profile - Get the full base resume profile
 */
profileRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const profile = await getProfile();
    ok(res, profile);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * GET /api/profile/status - Check if a resume is configured and accessible
 */
profileRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    // Check master resume first
    if (await hasMasterResume()) {
      ok(res, { exists: true, source: "master", error: null });
      return;
    }

    const { resumeId: rxresumeBaseResumeId } =
      await getConfiguredRxResumeBaseResumeId();

    if (!rxresumeBaseResumeId) {
      ok(res, {
        exists: false,
        source: null,
        error:
          "No resume configured. Upload your master resume in Settings, or select a Reactive Resume base resume.",
      });
      return;
    }

    try {
      const resume = await getResume(rxresumeBaseResumeId);
      if (!resume.data || typeof resume.data !== "object") {
        ok(res, { exists: false, source: null, error: "Selected resume is empty or invalid." });
        return;
      }
      ok(res, { exists: true, source: "rxresume", error: null });
    } catch (error) {
      if (error instanceof RxResumeAuthConfigError) {
        ok(res, { exists: false, source: null, error: error.message });
        return;
      }
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    ok(res, { exists: false, source: null, error: message });
  }
});

/**
 * POST /api/profile/refresh - Clear profile cache and refetch
 */
profileRouter.post("/refresh", async (_req: Request, res: Response) => {
  try {
    clearProfileCache();
    const profile = await getProfile(true);
    ok(res, profile);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * GET /api/profile/master-resume - Get the stored master resume text
 */
profileRouter.get("/master-resume", async (_req: Request, res: Response) => {
  try {
    const text = await getMasterResumeText();
    ok(res, { exists: text !== null, text: text ?? "" });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * POST /api/profile/master-resume - Save/replace the master resume text
 * Body: { text: string }
 */
profileRouter.post("/master-resume", async (req: Request, res: Response) => {
  try {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== "string" || text.trim().length < 50) {
      res.status(400).json({ error: "Resume text must be at least 50 characters." });
      return;
    }
    await saveMasterResumeText(text.trim());
    clearProfileCache();
    clearMasterResumeCache();
    ok(res, { saved: true, chars: text.trim().length });
  } catch (error) {
    fail(res, toAppError(error));
  }
});
