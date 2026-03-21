/**
 * Repository for pipeline presets CRUD operations.
 */

import { randomUUID } from "node:crypto";
import { db } from "@server/db";
import { pipelinePresets } from "@server/db/schema";
import type { PipelinePreset, PipelinePresetInput } from "@shared/types";
import { eq } from "drizzle-orm";

function rowToPreset(row: typeof pipelinePresets.$inferSelect): PipelinePreset {
  return {
    id: row.id,
    name: row.name,
    searchTerms: JSON.parse(row.searchTerms || "[]") as string[],
    country: row.country,
    cityLocations: JSON.parse(row.cityLocations || "[]") as string[],
    topN: row.topN,
    minSuitabilityScore: row.minSuitabilityScore,
    runBudget: row.runBudget,
    jobType: (row.jobType as PipelinePreset["jobType"]) ?? null,
    scheduleEnabled: row.scheduleEnabled,
    scheduleHours: JSON.parse(row.scheduleHours || "[]") as number[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getAllPresets(): Promise<PipelinePreset[]> {
  const rows = await db.select().from(pipelinePresets).orderBy(pipelinePresets.createdAt);
  return rows.map(rowToPreset);
}

export async function getPresetById(id: string): Promise<PipelinePreset | null> {
  const rows = await db.select().from(pipelinePresets).where(eq(pipelinePresets.id, id));
  return rows.length > 0 ? rowToPreset(rows[0]) : null;
}

export async function createPreset(input: PipelinePresetInput): Promise<PipelinePreset> {
  const id = randomUUID();
  await db.insert(pipelinePresets).values({
    id,
    name: input.name,
    searchTerms: JSON.stringify(input.searchTerms),
    country: input.country,
    cityLocations: JSON.stringify(input.cityLocations),
    topN: input.topN,
    minSuitabilityScore: input.minSuitabilityScore,
    runBudget: input.runBudget,
    jobType: input.jobType ?? null,
    scheduleEnabled: input.scheduleEnabled,
    scheduleHours: JSON.stringify(input.scheduleHours),
  });
  const preset = await getPresetById(id);
  if (!preset) throw new Error("Failed to create preset");
  return preset;
}

export async function updatePreset(
  id: string,
  input: Partial<PipelinePresetInput>,
): Promise<PipelinePreset | null> {
  const existing = await getPresetById(id);
  if (!existing) return null;

  await db
    .update(pipelinePresets)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.searchTerms !== undefined && {
        searchTerms: JSON.stringify(input.searchTerms),
      }),
      ...(input.country !== undefined && { country: input.country }),
      ...(input.cityLocations !== undefined && {
        cityLocations: JSON.stringify(input.cityLocations),
      }),
      ...(input.topN !== undefined && { topN: input.topN }),
      ...(input.minSuitabilityScore !== undefined && {
        minSuitabilityScore: input.minSuitabilityScore,
      }),
      ...(input.runBudget !== undefined && { runBudget: input.runBudget }),
      ...("jobType" in input && { jobType: input.jobType ?? null }),
      ...(input.scheduleEnabled !== undefined && {
        scheduleEnabled: input.scheduleEnabled,
      }),
      ...(input.scheduleHours !== undefined && {
        scheduleHours: JSON.stringify(input.scheduleHours),
      }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(pipelinePresets.id, id));

  return getPresetById(id);
}

export async function deletePreset(id: string): Promise<boolean> {
  const result = await db
    .delete(pipelinePresets)
    .where(eq(pipelinePresets.id, id));
  return (result.changes ?? 0) > 0;
}

export async function getScheduledPresets(): Promise<PipelinePreset[]> {
  const all = await getAllPresets();
  return all.filter((p) => p.scheduleEnabled && p.scheduleHours.length > 0);
}
