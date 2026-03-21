import { logger } from "@infra/logger";
import type { ResumeProfile } from "@shared/types";
import { getMasterResumeProfile, hasMasterResume } from "./master-resume";
import { getResume, RxResumeAuthConfigError } from "./rxresume";
import { getConfiguredRxResumeBaseResumeId } from "./rxresume/baseResumeId";

let cachedProfile: ResumeProfile | null = null;
let cachedResumeId: string | null = null;

/**
 * Get the base resume profile.
 *
 * Priority:
 * 1. Master resume text file (if uploaded via Settings)
 * 2. Reactive Resume (legacy, if configured)
 *
 * Results are cached until clearProfileCache() is called.
 *
 * @param forceRefresh Force reload from source.
 * @throws Error if neither source is configured.
 */
export async function getProfile(forceRefresh = false): Promise<ResumeProfile> {
  // 1. Try master resume text first
  if (await hasMasterResume()) {
    if (cachedProfile && cachedResumeId === "master" && !forceRefresh) {
      return cachedProfile;
    }
    try {
      logger.info("Loading profile from master resume text");
      const profile = await getMasterResumeProfile();
      if (profile) {
        cachedProfile = profile;
        cachedResumeId = "master";
        return cachedProfile;
      }
    } catch (error) {
      logger.warn("Failed to load master resume profile, trying RxResume", {
        error,
      });
    }
  }

  // 2. Fall back to Reactive Resume
  const { resumeId: rxresumeBaseResumeId } =
    await getConfiguredRxResumeBaseResumeId();

  if (!rxresumeBaseResumeId) {
    throw new Error(
      "No resume configured. Please upload your master resume in Settings, or select a base resume from your RxResume account.",
    );
  }

  // Return cached profile if valid
  if (
    cachedProfile &&
    cachedResumeId === rxresumeBaseResumeId &&
    !forceRefresh
  ) {
    return cachedProfile;
  }

  try {
    logger.info("Fetching profile from Reactive Resume", {
      resumeId: rxresumeBaseResumeId,
    });
    const resume = await getResume(rxresumeBaseResumeId);

    if (!resume.data || typeof resume.data !== "object") {
      throw new Error("Resume data is empty or invalid");
    }

    cachedProfile = resume.data as unknown as ResumeProfile;
    cachedResumeId = rxresumeBaseResumeId;
    logger.info("Profile loaded from Reactive Resume", {
      resumeId: rxresumeBaseResumeId,
    });
    return cachedProfile;
  } catch (error) {
    if (error instanceof RxResumeAuthConfigError) {
      throw new Error(error.message);
    }
    logger.error("Failed to load profile from Reactive Resume", {
      resumeId: rxresumeBaseResumeId,
      error,
    });
    throw error;
  }
}

/**
 * Get the person's name from the profile.
 */
export async function getPersonName(): Promise<string> {
  const profile = await getProfile();
  return profile?.basics?.name || "Resume";
}

/**
 * Clear the profile cache.
 */
export function clearProfileCache(): void {
  cachedProfile = null;
  cachedResumeId = null;
}
