/**
 * Tailor a JSON resume for a specific job description using Claude.
 * Keeps the same structure — only swaps skill keywords, updates summary/headline,
 * and sets project visibility based on relevance.
 */

import { logger } from "@infra/logger";
import { getSetting } from "../../repositories/settings";
import { LlmService } from "../llm/service";
import type { JsonSchemaDefinition } from "../llm/types";
import type { JsonResume } from "./renderer";

interface TailoredFields {
  headline: string;
  summary: string;
  skills: Array<{ name: string; keywords: string[] }>;
  visibleProjectNames: string[]; // names of projects to show (max 4-5 for one page)
}

const TAILOR_SCHEMA: JsonSchemaDefinition = {
  name: "resume_tailoring",
  schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      summary: { type: "string" },
      skills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            keywords: { type: "array", items: { type: "string" } },
          },
          required: ["name", "keywords"],
          additionalProperties: false,
        },
      },
      visibleProjectNames: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["headline", "summary", "skills", "visibleProjectNames"],
    additionalProperties: false,
  },
};

export async function tailorResumeForJob(
  base: JsonResume,
  jobDescription: string,
): Promise<JsonResume> {
  const [overrideModel] = await Promise.all([getSetting("modelTailoring")]);
  const model =
    overrideModel ||
    (await getSetting("model")) ||
    process.env.MODEL ||
    "gpt-4.1-mini";

  const projectNames = (base.projects ?? []).map((p) => p.name);
  const skillGroups = (base.skills ?? []).map((s) => ({
    name: s.name,
    keywords: s.keywords,
  }));

  const prompt = `You are an expert resume tailoring assistant. Given a candidate's resume and a job description, return a modified version of the resume content optimized for ATS and recruiter review.

RULES:
1. Keep the same skill group names and overall structure. Only swap/reorder keywords to match JD terminology exactly (e.g. "ML" → "Machine Learning" if the JD uses that).
2. The headline must match the job title from the JD exactly.
3. The summary must mirror the JD's "what we're looking for" section — keep it concise and factual. Do NOT invent experience.
4. Select 4–5 most relevant project names from the list for a one-page resume. Prioritize projects that match the JD's domain.
5. Do NOT add new keywords that aren't in the candidate's existing skillset.

CANDIDATE SKILLS:
${JSON.stringify(skillGroups, null, 2)}

CANDIDATE PROJECTS:
${projectNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}

CURRENT SUMMARY:
${base.basics.summary}

JOB DESCRIPTION:
${jobDescription}

Return JSON with: headline, summary, skills (same groups, adjusted keywords), and visibleProjectNames (array of project names to show).`;

  const llm = new LlmService();
  const result = await llm.callJson<TailoredFields>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: TAILOR_SCHEMA,
  });

  if (!result.success) {
    logger.warn("Resume tailoring failed, using base resume as fallback", {
      error: result.error,
    });
    return base;
  }

  const { headline, summary, skills, visibleProjectNames } = result.data;
  const visibleSet = new Set(visibleProjectNames);

  return {
    ...base,
    basics: {
      ...base.basics,
      label: headline,
      summary,
    },
    skills,
    projects: (base.projects ?? []).map((p) => ({
      ...p,
      visible: visibleSet.has(p.name),
    })),
  };
}
