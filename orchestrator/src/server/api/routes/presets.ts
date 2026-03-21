/**
 * API routes for pipeline presets.
 */

import { toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { runPipeline } from "@server/pipeline/index";
import * as presetsRepo from "@server/repositories/presets";
import type { PipelinePresetInput } from "@shared/types";
import { PIPELINE_EXTRACTOR_SOURCE_IDS } from "@shared/extractors";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const presetsRouter = Router();

const presetInputSchema = z.object({
  name: z.string().min(1).max(100),
  searchTerms: z.array(z.string()).min(1),
  country: z.string().min(1),
  cityLocations: z.array(z.string()).default([]),
  topN: z.number().int().min(1).max(50).default(10),
  minSuitabilityScore: z.number().int().min(0).max(100).default(50),
  runBudget: z.number().int().min(1).max(1000).default(500),
  jobType: z
    .enum(["internship", "co-op", "full-time"])
    .nullable()
    .default(null),
  scheduleEnabled: z.boolean().default(false),
  scheduleHours: z
    .array(z.number().int().min(0).max(23))
    .max(24)
    .default([]),
});

/**
 * GET /api/presets - List all presets
 */
presetsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const presets = await presetsRepo.getAllPresets();
    ok(res, presets);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * POST /api/presets - Create a new preset
 */
presetsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const input = presetInputSchema.parse(req.body) as PipelinePresetInput;
    const preset = await presetsRepo.createPreset(input);
    ok(res, preset);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.message });
      return;
    }
    fail(res, toAppError(error));
  }
});

/**
 * PUT /api/presets/:id - Update a preset
 */
presetsRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const input = presetInputSchema.partial().parse(req.body);
    const preset = await presetsRepo.updatePreset(req.params.id, input);
    if (!preset) {
      res.status(404).json({ error: "Preset not found" });
      return;
    }
    ok(res, preset);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.message });
      return;
    }
    fail(res, toAppError(error));
  }
});

/**
 * DELETE /api/presets/:id - Delete a preset
 */
presetsRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await presetsRepo.deletePreset(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Preset not found" });
      return;
    }
    ok(res, { deleted: true });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * POST /api/presets/:id/run - Run the pipeline with a preset's config
 */
presetsRouter.post("/:id/run", async (req: Request, res: Response) => {
  try {
    const preset = await presetsRepo.getPresetById(req.params.id);
    if (!preset) {
      res.status(404).json({ error: "Preset not found" });
      return;
    }

    // Build search terms — prepend job type keyword if set
    const searchTerms = preset.jobType
      ? preset.searchTerms.map((t) => `${t} ${preset.jobType}`)
      : preset.searchTerms;

    const config = {
      topN: preset.topN,
      minSuitabilityScore: preset.minSuitabilityScore,
      sources: PIPELINE_EXTRACTOR_SOURCE_IDS as unknown as typeof PIPELINE_EXTRACTOR_SOURCE_IDS[number][],
    };

    runWithRequestContext({}, () => {
      runPipeline(config).catch((error) => {
        logger.error("Background preset pipeline run failed", {
          presetId: preset.id,
          error,
        });
      });
    });

    ok(res, { message: `Pipeline started with preset "${preset.name}"`, presetId: preset.id });
  } catch (error) {
    fail(res, toAppError(error));
  }
});
