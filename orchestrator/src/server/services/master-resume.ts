/**
 * Master resume service — stores the user's resume as plain text and
 * optionally parses it into a ResumeProfile for the pipeline.
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@infra/logger";
import type { ResumeProfile } from "@shared/types";
import { getDataDir } from "../config/dataDir";
import { LlmService } from "./llm/service";
import { getSetting } from "../repositories/settings";
import type { JsonSchemaDefinition } from "./llm/types";

const MASTER_RESUME_PATH = join(getDataDir(), "master-resume.txt");

let cachedProfile: ResumeProfile | null = null;
let cachedResumeText: string | null = null;

/** JSON schema for parsing resume text into structured profile */
const PARSE_RESUME_SCHEMA: JsonSchemaDefinition = {
  name: "resume_profile",
  schema: {
    type: "object",
    properties: {
      basics: {
        type: "object",
        properties: {
          name: { type: "string" },
          headline: { type: "string" },
          label: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          location: { type: "string" },
          summary: { type: "string" },
          url: { type: "string" },
        },
        required: ["name", "headline", "summary"],
        additionalProperties: false,
      },
      sections: {
        type: "object",
        properties: {
          summary: {
            type: "object",
            properties: { content: { type: "string" } },
            required: ["content"],
            additionalProperties: false,
          },
          experience: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    company: { type: "string" },
                    position: { type: "string" },
                    date: { type: "string" },
                    summary: { type: "string" },
                    visible: { type: "boolean" },
                  },
                  required: ["company", "position", "date", "summary"],
                  additionalProperties: false,
                },
              },
            },
            required: ["items"],
            additionalProperties: false,
          },
          education: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    institution: { type: "string" },
                    studyType: { type: "string" },
                    area: { type: "string" },
                    score: { type: "string" },
                    date: { type: "string" },
                    summary: { type: "string" },
                    visible: { type: "boolean" },
                  },
                  required: ["institution", "studyType", "area", "date"],
                  additionalProperties: false,
                },
              },
            },
            required: ["items"],
            additionalProperties: false,
          },
          projects: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    date: { type: "string" },
                    summary: { type: "string" },
                    keywords: { type: "array", items: { type: "string" } },
                    url: { type: "string" },
                    visible: { type: "boolean" },
                  },
                  required: ["name", "date", "summary"],
                  additionalProperties: false,
                },
              },
            },
            required: ["items"],
            additionalProperties: false,
          },
          skills: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    keywords: { type: "array", items: { type: "string" } },
                    visible: { type: "boolean" },
                  },
                  required: ["name", "keywords"],
                  additionalProperties: false,
                },
              },
            },
            required: ["items"],
            additionalProperties: false,
          },
        },
        required: ["summary", "experience", "education", "projects", "skills"],
        additionalProperties: false,
      },
    },
    required: ["basics", "sections"],
    additionalProperties: false,
  },
};

/**
 * Check if a master resume text file exists.
 */
export async function hasMasterResume(): Promise<boolean> {
  try {
    await access(MASTER_RESUME_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the master resume text.
 */
export async function getMasterResumeText(): Promise<string | null> {
  try {
    const text = await readFile(MASTER_RESUME_PATH, "utf-8");
    return text.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Save master resume text, clearing the parsed profile cache.
 */
export async function saveMasterResumeText(text: string): Promise<void> {
  await writeFile(MASTER_RESUME_PATH, text, "utf-8");
  cachedProfile = null;
  cachedResumeText = null;
  logger.info("Master resume saved", { chars: text.length });
}

/**
 * Parse master resume text into ResumeProfile via LLM.
 * Results are cached until the resume text changes.
 */
export async function parseMasterResumeToProfile(
  text: string,
): Promise<ResumeProfile> {
  if (cachedProfile && cachedResumeText === text) {
    return cachedProfile;
  }

  logger.info("Parsing master resume text into profile structure");
  const llm = new LlmService();
  const configuredModel = (await getSetting("model")) || process.env.MODEL || "gpt-4o-mini";

  const prompt = `You are a resume parser. Extract the structured information from this resume text into JSON.
Be thorough — capture all experience, education, projects, and skills.
For the "sections.summary.content" field, copy the professional summary verbatim.
For experience, education, and projects: set "date" to a human-readable date range like "Jan 2022 - Present".
For skills: group into logical categories like "Frontend", "Backend", "Languages", "Tools", etc.

RESUME TEXT:
${text}`;

  const result = await llm.callJson<ResumeProfile>({
    model: configuredModel,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: PARSE_RESUME_SCHEMA,
    maxRetries: 1,
  });

  if (!result.success) {
    logger.warn("Failed to parse master resume, returning minimal profile", {
      error: result.error,
    });
    // Return a minimal profile using raw text in summary
    return {
      basics: { name: "Candidate", summary: text.slice(0, 500) },
      sections: {
        summary: { content: text.slice(0, 1200) },
        skills: { items: [] },
        experience: { items: [] },
        education: { items: [] },
        projects: { items: [] },
      },
    } as unknown as ResumeProfile;
  }

  cachedProfile = result.data;
  cachedResumeText = text;
  logger.info("Master resume parsed into profile");
  return result.data;
}

/**
 * Get the full ResumeProfile from the master resume file.
 * Returns null if no master resume is stored.
 */
export async function getMasterResumeProfile(): Promise<ResumeProfile | null> {
  const text = await getMasterResumeText();
  if (!text) return null;
  return parseMasterResumeToProfile(text);
}

/**
 * Clear the parsed profile cache (e.g., after re-upload).
 */
export function clearMasterResumeCache(): void {
  cachedProfile = null;
  cachedResumeText = null;
}
