/**
 * Cover letter generation service.
 * Generates a tailored cover letter via LLM and renders it to PDF.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger } from "@infra/logger";
import { getDataDir } from "../config/dataDir";
import { getSetting } from "../repositories/settings";
import { getMasterResumeText } from "./master-resume";
import { LlmService } from "./llm/service";
import type { JsonSchemaDefinition } from "./llm/types";

const OUTPUT_DIR = join(getDataDir(), "pdfs");
const DOCS_OUTPUT_DIR = join(homedir(), "Documents", "applications");

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-]/g, "_").replace(/_+/g, "_").slice(0, 60);
}

async function copyToDocuments(srcPath: string, destFilename: string): Promise<void> {
  try {
    if (!existsSync(DOCS_OUTPUT_DIR)) {
      await mkdir(DOCS_OUTPUT_DIR, { recursive: true });
    }
    await copyFile(srcPath, join(DOCS_OUTPUT_DIR, destFilename));
    logger.info("Copied cover letter to Documents", { dest: join(DOCS_OUTPUT_DIR, destFilename) });
  } catch (err) {
    logger.warn("Could not copy cover letter to Documents folder", { err });
  }
}

export interface CoverLetterResult {
  success: boolean;
  pdfPath?: string;
  coverLetterText?: string;
  error?: string;
}

interface CoverLetterData {
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  candidateLocation: string;
  recipientName: string;
  companyName: string;
  roleName: string;
  todayDate: string;
  opening: string;
  valueBody: string;
  fitBody: string;
  closing: string;
}

const COVER_LETTER_SCHEMA: JsonSchemaDefinition = {
  name: "cover_letter",
  schema: {
    type: "object",
    properties: {
      candidateName: { type: "string" },
      candidateEmail: { type: "string" },
      candidatePhone: { type: "string" },
      candidateLocation: { type: "string" },
      recipientName: { type: "string" },
      companyName: { type: "string" },
      roleName: { type: "string" },
      todayDate: { type: "string" },
      opening: { type: "string" },
      valueBody: { type: "string" },
      fitBody: { type: "string" },
      closing: { type: "string" },
    },
    required: [
      "candidateName", "candidateEmail", "candidatePhone", "candidateLocation",
      "recipientName", "companyName", "roleName", "todayDate",
      "opening", "valueBody", "fitBody", "closing",
    ],
    additionalProperties: false,
  },
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCoverLetterHtml(data: CoverLetterData): string {
  const bodyParagraphs = [data.opening, data.valueBody, data.fitBody, data.closing]
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join("\n");

  const contactLine = [data.candidateEmail, data.candidatePhone, data.candidateLocation]
    .filter(Boolean)
    .map(esc)
    .join("  |  ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Calibri', 'Arial', sans-serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #111;
    padding: 20mm 22mm 18mm 22mm;
  }
  .name {
    font-size: 18pt;
    font-weight: 700;
    letter-spacing: 0.3px;
    margin-bottom: 3px;
  }
  .contact {
    font-size: 9pt;
    color: #444;
    margin-bottom: 18px;
    border-bottom: 1px solid #ccc;
    padding-bottom: 10px;
  }
  .date {
    margin-bottom: 14px;
    color: #333;
    font-size: 10pt;
  }
  .recipient {
    margin-bottom: 14px;
    font-size: 10pt;
    color: #222;
  }
  .salutation {
    margin-bottom: 14px;
    font-weight: 600;
  }
  p {
    margin-bottom: 12px;
    text-align: justify;
  }
  .sign-block { margin-top: 22px; }
  .sign-off { margin-bottom: 28px; }
  .sign-name { font-weight: 700; font-size: 10.5pt; }
</style>
</head>
<body>
  <div class="name">${esc(data.candidateName)}</div>
  <div class="contact">${contactLine}</div>

  <div class="date">${esc(data.todayDate)}</div>

  <div class="recipient">
    ${data.recipientName && data.recipientName !== "Hiring Team" ? `<div>${esc(data.recipientName)}</div>` : ""}
    <div>${esc(data.companyName)}</div>
    <div>Re: ${esc(data.roleName)}</div>
  </div>

  <div class="salutation">Dear ${esc(data.recipientName)},</div>

  ${bodyParagraphs}

  <div class="sign-block">
    <div class="sign-off">Sincerely,</div>
    <div class="sign-name">${esc(data.candidateName)}</div>
  </div>
</body>
</html>`;
}

async function htmlToPdf(html: string, outputPath: string): Promise<void> {
  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }
}

/**
 * Generate a tailored cover letter PDF for a job.
 */
export async function generateCoverLetter(
  jobId: string,
  jobTitle: string,
  employer: string,
  jobDescription: string,
): Promise<CoverLetterResult> {
  logger.info("Generating cover letter", { jobId });

  try {
    if (!existsSync(OUTPUT_DIR)) {
      await mkdir(OUTPUT_DIR, { recursive: true });
    }

    const masterResumeText = await getMasterResumeText();
    if (!masterResumeText) {
      return {
        success: false,
        error: "No master resume uploaded. Please upload your resume in Settings.",
      };
    }

    const [overrideModel, overrideModelTailoring] = await Promise.all([
      getSetting("model"),
      getSetting("modelTailoring"),
    ]);
    const model =
      overrideModelTailoring ||
      overrideModel ||
      process.env.MODEL ||
      "google/gemini-3-flash-preview";

    const today = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const prompt = `You are writing a tailored cover letter for ${jobTitle} at ${employer} on behalf of the candidate below.

MASTER RESUME (source of all facts — do NOT invent any project, metric, company, or technology):
${masterResumeText}

JOB ROLE: ${jobTitle}
COMPANY: ${employer}
JOB DESCRIPTION:
${jobDescription.slice(0, 2500)}

STYLE GUIDE — write in this exact voice:
- Tone: technical, direct, confident. Academic-yet-applied. No corporate fluff.
- Length: 3-4 short paragraphs, ~250-300 words total. Tight and punchy.
- NEVER use these words: "passionate", "dynamic", "hardworking", "excited to", "thrilled", "leverage", "synergy", "I am writing to apply", "I look forward to hearing from you"
- Active voice. Every claim backed by a specific project name, metric, or tool from the master resume.
- Do NOT restate resume bullets — add framing, context, and connection to the JD.

EXAMPLE STYLE (mimic this voice, not the content):
"The [Role] position at [Company] sits at the intersection of [X] and [Y] — a pairing I've been working at the boundary of for the past year. My [ProjectName] work involved [specific detail], achieving [metric]; the same architecture challenges appear in [JD theme], and I have concrete intuitions about the tradeoffs involved. Beyond the ML work, my background in [complementary skill] means I can [specific operational value] — not just build models but own them end-to-end."

PARAGRAPH INSTRUCTIONS:

opening (2-3 sentences):
  - Open with the specific role and ONE concrete, non-generic reason this company specifically — reference something from the JD or their public work (product, research, team structure, mission).
  - Do NOT open with "I am writing to apply for…"

valueBody (3-4 sentences):
  - Name 2-3 of the candidate's most relevant PROJECTS by their exact title from the master resume.
  - For each, give one specific technical detail (model type, framework, metric, dataset) and connect it to a JD requirement.
  - Use only facts from the master resume — no invented metrics.

fitBody (2-3 sentences):
  - Highlight one non-obvious strength that makes the candidate more effective at this role — engineering rigor, MLOps, cross-functional collaboration, deployment experience, research methodology.
  - Anchor it to a specific role or experience from the master resume.

closing (1-2 sentences):
  - Reference something specific about ${employer}'s work — a product, research area, public initiative, or stated mission from the JD.
  - End with confidence, not desperation. No "I hope to hear from you."

OUTPUT FIELDS:
- candidateName, candidateEmail, candidatePhone, candidateLocation: extract from master resume header
- recipientName: "Hiring Team" unless a specific name is in the JD
- companyName: "${employer}"
- roleName: "${jobTitle}"
- todayDate: "${today}"
- opening, valueBody, fitBody, closing: the four paragraphs
- Return JSON only, no markdown fences`;

    const llm = new LlmService();
    const result = await llm.callJson<CoverLetterData>({
      model,
      messages: [{ role: "user", content: prompt }],
      jsonSchema: COVER_LETTER_SCHEMA,
      maxRetries: 1,
      jobId,
    });

    if (!result.success) {
      return { success: false, error: `LLM failed: ${result.error}` };
    }

    const outputPath = join(OUTPUT_DIR, `cover_letter_${jobId}.pdf`);
    const html = buildCoverLetterHtml(result.data);
    await htmlToPdf(html, outputPath);

    // Copy to Documents folder with human-readable filename
    await copyToDocuments(outputPath, `${sanitizeFilename(employer)}_cl.pdf`);

    // Build plain text version for storage
    const coverLetterText = [
      result.data.opening,
      result.data.valueBody,
      result.data.fitBody,
      result.data.closing,
    ]
      .filter(Boolean)
      .join("\n\n");

    logger.info("Cover letter generated", { jobId, outputPath });
    return { success: true, pdfPath: outputPath, coverLetterText };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Cover letter generation failed", { jobId, error });
    return { success: false, error: message };
  }
}
