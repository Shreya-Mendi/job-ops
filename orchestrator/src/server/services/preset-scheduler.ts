/**
 * Scheduler that runs pipeline presets at their configured UTC hours.
 * Supports multiple run-times per day (e.g. [9, 21] = twice daily).
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { runPipeline } from "@server/pipeline/index";
import { getScheduledPresets } from "@server/repositories/presets";
import { calculateNextTime } from "@server/utils/scheduler";
import type { PipelinePreset } from "@shared/types";

interface HourTimer {
  hour: number;
  timer: ReturnType<typeof setTimeout>;
  nextRunTime: Date;
}

// One timer per unique UTC hour across all active presets
const hourTimers = new Map<number, HourTimer>();

function scheduleHour(hour: number): void {
  // Cancel existing timer for this hour
  const existing = hourTimers.get(hour);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const nextRunTime = calculateNextTime(hour);
  const delay = nextRunTime.getTime() - Date.now();

  const timer = setTimeout(() => {
    void runPresetsForHour(hour);
  }, delay);

  hourTimers.set(hour, { hour, nextRunTime, timer });
  logger.info(`[preset-scheduler] Hour ${hour}:00 UTC scheduled for ${nextRunTime.toISOString()}`);
}

async function runPresetsForHour(hour: number): Promise<void> {
  logger.info(`[preset-scheduler] Firing presets for hour ${hour}:00 UTC`);

  // Reschedule this hour for the next day immediately
  scheduleHour(hour);

  let presets: PipelinePreset[];
  try {
    presets = await getScheduledPresets();
  } catch (error) {
    logger.error("[preset-scheduler] Failed to load scheduled presets", { error });
    return;
  }

  const matching = presets.filter((p) => p.scheduleHours.includes(hour));
  if (matching.length === 0) {
    logger.info(`[preset-scheduler] No presets scheduled for hour ${hour}`);
    return;
  }

  for (const preset of matching) {
    logger.info(`[preset-scheduler] Running preset "${preset.name}" (id: ${preset.id})`);
    runWithRequestContext({}, () => {
      runPipeline({
        topN: preset.topN,
        minSuitabilityScore: preset.minSuitabilityScore,
      }).catch((error) => {
        logger.error("[preset-scheduler] Preset pipeline run failed", {
          presetId: preset.id,
          presetName: preset.name,
          error,
        });
      });
    });
  }
}

/**
 * Start scheduled timers for all unique hours across all active presets.
 * Safe to call multiple times — re-reads presets from DB each time.
 */
export async function startPresetScheduler(): Promise<void> {
  // Stop all existing timers
  for (const { timer } of hourTimers.values()) {
    clearTimeout(timer);
  }
  hourTimers.clear();

  let presets: PipelinePreset[];
  try {
    presets = await getScheduledPresets();
  } catch (error) {
    logger.warn("[preset-scheduler] Could not load presets for scheduling", { error });
    return;
  }

  if (presets.length === 0) {
    logger.info("[preset-scheduler] No scheduled presets — scheduler idle.");
    return;
  }

  // Collect all unique hours
  const uniqueHours = new Set<number>();
  for (const preset of presets) {
    for (const hour of preset.scheduleHours) {
      uniqueHours.add(hour);
    }
  }

  for (const hour of uniqueHours) {
    scheduleHour(hour);
  }

  logger.info(
    `[preset-scheduler] Started. Hours active: [${[...uniqueHours].sort((a, b) => a - b).join(", ")}] UTC`,
  );
}

/**
 * Stop all preset schedule timers.
 */
export function stopPresetScheduler(): void {
  for (const { timer } of hourTimers.values()) {
    clearTimeout(timer);
  }
  hourTimers.clear();
  logger.info("[preset-scheduler] Stopped.");
}

export function getPresetSchedulerStatus(): { hours: number[]; nextRuns: Record<number, string> } {
  const hours = [...hourTimers.keys()].sort((a, b) => a - b);
  const nextRuns: Record<number, string> = {};
  for (const [hour, entry] of hourTimers.entries()) {
    nextRuns[hour] = entry.nextRunTime.toISOString();
  }
  return { hours, nextRuns };
}
