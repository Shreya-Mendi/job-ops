import { exec } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AppError,
  badRequest,
  serviceUnavailable,
  statusToCode,
  upstreamError,
} from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { isDemoMode, sendDemoBlocked } from "@server/config/demo";
import { getDataDir } from "@server/config/dataDir";
import { setBackupSettings } from "@server/services/backup/index";
import {
  extractProjectsFromResume,
  getResume,
  listResumes,
  RxResumeAuthConfigError,
  RxResumeRequestError,
  validateResumeSchema,
} from "@server/services/rxresume";
import { getEffectiveSettings } from "@server/services/settings";
import { applySettingsUpdates } from "@server/services/settings-update";
import { updateSettingsSchema } from "@shared/settings-schema";
import { type Request, type Response, Router } from "express";
import multer from "multer";

export const settingsRouter = Router();

/**
 * GET /api/settings - Get app settings (effective + defaults)
 */
settingsRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    const data = await getEffectiveSettings();
    ok(res, data);
  }),
);

/**
 * PATCH /api/settings - Update settings overrides
 */
settingsRouter.patch(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    if (isDemoMode()) {
      return sendDemoBlocked(
        res,
        "Saving settings is disabled in the public demo.",
        { route: "PATCH /api/settings" },
      );
    }

    const input = updateSettingsSchema.parse(req.body);
    const plan = await applySettingsUpdates(input);

    const data = await getEffectiveSettings();

    if (plan.shouldRefreshBackupScheduler) {
      setBackupSettings({
        enabled: data.backupEnabled.value,
        hour: data.backupHour.value,
        maxCount: data.backupMaxCount.value,
      });
    }
    ok(res, data);
  }),
);

/**
 * GET /api/settings/rx-resumes - Fetch list of resumes from Reactive Resume (v4/v5 adapter)
 */
function failRxResume(res: Response, error: unknown): void {
  if (error instanceof RxResumeAuthConfigError) {
    fail(res, badRequest(error.message));
    return;
  }
  if (error instanceof RxResumeRequestError) {
    if (error.status === 401) {
      fail(
        res,
        badRequest(
          "Reactive Resume authentication failed. Check your configured mode credentials.",
        ),
      );
      return;
    }
    if (error.status && error.status >= 500) {
      fail(res, upstreamError(error.message));
      return;
    }
    if (error.status && error.status >= 400 && error.status < 500) {
      fail(
        res,
        new AppError({
          status: error.status,
          code: statusToCode(error.status),
          message: error.message,
        }),
      );
      return;
    }
    if (error.status === 0) {
      fail(
        res,
        serviceUnavailable(
          "Reactive Resume is unavailable. Check the URL and try again.",
        ),
      );
      return;
    }
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  logger.error("Reactive Resume route request failed", { message, error });
  fail(res, upstreamError(message));
}

settingsRouter.get(
  "/rx-resumes",
  asyncRoute(async (req: Request, res: Response) => {
    try {
      const modeParam =
        typeof req.query.mode === "string" ? req.query.mode : undefined;
      const mode =
        modeParam === "v4" || modeParam === "v5" ? modeParam : undefined;
      const resumes = await listResumes({ mode });

      ok(res, {
        resumes: resumes.map((resume) => ({
          id: resume.id,
          name: resume.name,
        })),
      });
    } catch (error) {
      failRxResume(res, error);
    }
  }),
);

/**
 * GET /api/settings/rx-resumes/:id/projects - Fetch project catalog from Reactive Resume (v4/v5 adapter)
 */
settingsRouter.get(
  "/rx-resumes/:id/projects",
  asyncRoute(async (req: Request, res: Response) => {
    try {
      const resumeId = req.params.id;
      if (!resumeId) {
        fail(res, badRequest("Resume id is required."));
        return;
      }

      const modeParam =
        typeof req.query.mode === "string" ? req.query.mode : undefined;
      const mode =
        modeParam === "v4" || modeParam === "v5" ? modeParam : undefined;

      const resume = await getResume(resumeId, { mode });
      const validated = await validateResumeSchema(resume.data ?? {}, { mode });
      if (!validated.ok) {
        fail(res, badRequest(validated.message));
        return;
      }
      const { catalog } = extractProjectsFromResume(resume.data ?? {}, {
        mode: validated.mode,
      });

      ok(res, { projects: catalog });
    } catch (error) {
      failRxResume(res, error);
    }
  }),
);

/**
 * POST /api/settings/source-resume-pdf
 * Upload a PDF resume, extract text via pdftotext, store in data/source-resume.txt
 */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

settingsRouter.post(
  "/source-resume-pdf",
  upload.single("file"),
  asyncRoute(async (req: Request, res: Response) => {
    if (!req.file) {
      fail(res, badRequest("No file uploaded. Provide a PDF in the 'file' field."));
      return;
    }
    if (req.file.mimetype !== "application/pdf" && !req.file.originalname.endsWith(".pdf")) {
      fail(res, badRequest("Only PDF files are accepted."));
      return;
    }

    const savedPath = join(getDataDir(), "source-resume.pdf");
    const txtPath = join(getDataDir(), "source-resume.txt");

    // Write the uploaded PDF buffer to disk
    await writeFile(savedPath, req.file.buffer);

    // Extract text using pdftotext
    const text = await new Promise<string>((resolve, reject) => {
      const cmd = `/opt/homebrew/bin/pdftotext -layout "${savedPath}" -`;
      exec(cmd, { maxBuffer: 1024 * 1024 * 4 }, (err, stdout, stderr) => {
        if (err) {
          logger.warn("pdftotext failed on uploaded source resume", { stderr });
          reject(new Error(`pdftotext failed: ${stderr || err.message}`));
        } else {
          resolve(stdout.trim());
        }
      });
    });

    if (!text) {
      fail(res, badRequest("Could not extract text from the uploaded PDF. Ensure pdftotext is installed and the file is a valid PDF."));
      return;
    }

    await writeFile(txtPath, text, "utf-8");
    logger.info("Source resume PDF uploaded and extracted", { chars: text.length });
    ok(res, { chars: text.length });
  }),
);

/**
 * GET /api/settings/source-resume-pdf/status
 * Check if a source-resume.txt exists and how many chars it contains.
 */
settingsRouter.get(
  "/source-resume-pdf/status",
  asyncRoute(async (_req: Request, res: Response) => {
    const txtPath = join(getDataDir(), "source-resume.txt");
    try {
      await access(txtPath);
      const text = await readFile(txtPath, "utf-8");
      ok(res, { exists: true, chars: text.trim().length });
    } catch {
      ok(res, { exists: false, chars: 0 });
    }
  }),
);
