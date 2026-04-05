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

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert plain cover letter text (with newlines) into HTML paragraphs.
 * Lines that are clearly header/address/date lines are wrapped in <div class="meta">,
 * blank lines are ignored, and body prose lines are accumulated into <p> tags.
 */
/**
 * Parses LLM cover letter text and renders it as HTML matching net_cl.pdf style:
 * - Calibri/sans-serif font throughout
 * - Name large at top, contact info on separate lines
 * - No date / Re: block — just name → contact → Dear → body → Sincerely
 */
function coverLetterTextToHtml(text: string): string {
  const lines = text.split(/\r?\n/);

  const bodyParagraphs: string[] = [];
  let salutationHtml = "";
  let signoffHtml = "";

  type Phase = "preamble" | "body" | "signoff";
  let phase: Phase = "preamble";
  let currentPara: string[] = [];

  function flushPara() {
    const t = currentPara.join(" ").trim();
    if (t) bodyParagraphs.push(t);
    currentPara = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (phase === "preamble") {
      // Skip everything until we hit the salutation (Dear ...)
      if (/^Dear\s/i.test(line)) {
        salutationHtml = esc(line);
        phase = "body";
      }
      continue;
    }

    if (phase === "body") {
      if (/^Sincerely[,.]?\s*$/i.test(line)) {
        flushPara();
        signoffHtml = esc(line);
        phase = "signoff";
        continue;
      }
      if (!line) {
        flushPara();
        continue;
      }
      currentPara.push(line);
      continue;
    }
    // signoff phase — ignore trailing lines (name is hardcoded)
  }

  if (currentPara.length > 0) flushPara();

  const bodyHtml = bodyParagraphs.map((p) => `<p>${esc(p)}</p>`).join("\n");

  // Hardcoded contact info matching net_cl.pdf layout exactly
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @font-face {
    font-family: 'Calibri';
    src: local('Calibri');
  }
  body {
    font-family: 'Calibri', 'Trebuchet MS', 'Arial', sans-serif;
    font-size: 11.5pt;
    line-height: 1.6;
    color: #111;
    padding: 22mm 30mm 20mm 30mm;
  }
  .name {
    font-size: 18pt;
    font-weight: 700;
    margin-bottom: 2px;
    letter-spacing: 0.2px;
  }
  .contact-block {
    font-size: 10.5pt;
    color: #222;
    margin-bottom: 18px;
    line-height: 1.5;
  }
  .salutation {
    font-size: 11.5pt;
    margin-bottom: 14px;
    margin-top: 2px;
  }
  p {
    margin-bottom: 12px;
    text-align: left;
    font-size: 11.5pt;
  }
  .sign-block { margin-top: 22px; }
  .sign-off {
    font-size: 11.5pt;
    margin-bottom: 28px;
  }
  .sign-name {
    font-weight: 700;
    font-size: 11.5pt;
  }
</style>
</head>
<body>
  <div class="name">Shreya Mendi</div>
  <div class="contact-block">
    Durham, NC<br>
    shreya.mendi@duke.edu<br>
    linkedin.com/in/shreya-mendi<br>
    Portfolio: https://portfolio-website-five-theta-67.vercel.app/
  </div>

  <div class="salutation">${salutationHtml || "Dear Hiring Team,"}</div>

  ${bodyHtml}

  <div class="sign-block">
    <div class="sign-off">${signoffHtml || "Sincerely,"}</div>
    <div class="sign-name">Shreya Mendi</div>
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

    const prompt = `You are writing a professional cover letter for Shreya Mendi applying to a specific job.

CANDIDATE INFO:
- Name: Shreya Mendi
- Current degree: Master of Engineering in Artificial Intelligence at Duke University (Jul 2025 – May 2027)
- Previous: BTech ECE at Manipal Institute of Technology (GPA 8.71/10)
- Email: shreya.mendi@duke.edu
- Phone: (919) 608-0547
- Location: Durham, NC
- LinkedIn: linkedin.com/in/shreya-mendi
- Portfolio: https://portfolio-website-five-theta-67.vercel.app/

PROJECTS (reference the most relevant 1-2):
- When2Speak: RL policy for multi-agent dialogue, reduced unnecessary interventions by 25%, PyTorch/NLP, validated on 10,000-dialogue simulation suite
- UAV-SAR: Fine-tuned Faster R-CNN on thermal SAR imagery, 20% recall improvement under adverse conditions with <5% clean-data accuracy loss
- BMW Capstone: Interpretable ML for industrial decision-making at BMW, balancing model performance with deployment constraints and stakeholder explainability
- AI Audit: EU AI Act compliance classifier (TF-IDF + logistic regression + rule-based checks), deployed FastAPI + Streamlit on GCP Cloud Run with MLflow tracking
- Inflationship: Macroeconomic forecasting fusing port-traffic alternative data with CPI using SARIMAX, achieved 0.67–1.69% MAPE across major CPI categories
- Alba: Privacy-first Chrome extension computing LLM energy/carbon/water footprints client-side

WORK EXPERIENCE:
- DevOps Engineer @ Assetmantle Pvt. Ltd. (Sept 2023 – May 2025): Reduced AWS/Hetzner infrastructure costs by 38% through architecture optimization and automated CI/CD (Docker, Kubernetes), maintained 99%+ uptime. Deployed Dockerized microservices with observability pipelines (Grafana, Prometheus).
- Software Development Intern @ Hewlett Packard Enterprise GlobalSoft (Jan 2023 – Jul 2023): Developed REST APIs in Python/Flask, automated data validation workflows reducing manual QA time by 30%, collaborated on firmware analytics dashboards.

LEADERSHIP:
- Teaching Assistant, Managing AI in Business — Duke University (2026–Present)
- AI Representative, Student Advisory Board — Duke University (2025)

EXAMPLE COVER LETTERS (written by Shreya — match this exact voice and structure):

Example 1 (Coinbase ML Internship):
---
Shreya Mendi
Durham, NC | shreya.mendi@duke.edu | linkedin.com/in/shreya-mendi | Portfolio: https://portfolio-website-five-theta-67.vercel.app/

Dear Coinbase Hiring Team,

I am excited to apply for the Machine Learning Internship at Coinbase. I am currently pursuing a Master of Engineering in Artificial Intelligence, and I am particularly motivated by applying machine learning to financial systems that are transparent, programmable, and global by design. Coinbase's mission to increase economic freedom through crypto and blockchain technology strongly resonates with both my technical interests and my prior experience working in this space.

My interest in crypto-native ML comes from working on financial systems where behavior is noisy, incentives matter, and data reflects real economic activity rather than curated labels. I've worked at a cryptocurrency startup and on applied ML projects that required reasoning about uncertainty, user behavior, and risk under imperfect information. In Inflationship, I built forecasting pipelines using alternative economic signals and rolling validation, which sharpened how I think about drift, signal reliability, and long-horizon effects—issues that are especially relevant in on-chain environments. More recently, I partnered with ATM.com to model the probability that a creditor would return funds, where feature design, class imbalance, and robustness were central concerns.

From a technical perspective, I'm excited by Coinbase's focus on blockchain-aware ML systems—models that operate on on-chain activity, graph-structured data, and evolving protocols. I'm comfortable building end-to-end ML pipelines in Python using PyTorch and scikit-learn, and I care deeply about deploying models that are interpretable, resilient, and secure. I'm particularly interested in applications around fraud detection, personalization, and discovery, where ML systems must adapt to adversarial behavior and rapidly changing distributions inherent to crypto ecosystems.

What draws me most to Coinbase is the combination of technical ambition and responsibility. Building ML systems that help users safely explore on-chain activity, understand new protocols, and participate confidently in a decentralized financial system feels both challenging and meaningful. I'm motivated by environments that expect high ownership, welcome feedback, and push engineers to solve hard problems that genuinely matter.

I would welcome the opportunity to contribute my ML background, financial modeling experience, and enthusiasm for crypto-native systems to Coinbase this summer. Thank you for your time and consideration.

Sincerely,

Shreya Mendi
---

Example 2 (Netflix Analytics Engineer):
---
Shreya Mendi
Durham, NC | shreya.mendi@duke.edu | linkedin.com/in/shreya-mendi | Portfolio: https://portfolio-website-five-theta-67.vercel.app/

Dear Netflix Hiring Team,

I am excited to apply for the Analytics Engineer Internship at Netflix. I am currently pursuing a Master of Engineering in Artificial Intelligence, and I am drawn to roles where analytics is treated as core infrastructure that enables better decisions at scale. Netflix's emphasis on using data to move quickly and confidently across content, product, and business aligns closely with how I want to build and grow as an engineer.

My work has focused on building analytics systems that are reliable, reusable, and designed for long-term use rather than one-off insights. In Inflationship, I developed a reproducible time-series analytics pipeline on noisy data, prioritizing stable metrics and rigorous validation. In AI Audit, I designed structured data and ML workflows with clear interfaces, documentation, and user-facing components so downstream users could reliably explore and act on results. These experiences shaped how I think about analytics engineering as a discipline centered on trust and consistency.

I also bring a strong systems mindset from my industry experience as a DevOps Engineer. Working with cloud infrastructure, CI/CD pipelines, and observability tools taught me how important automation, reliability, and simplicity are when building platforms others depend on. I am comfortable working with SQL-based analytics, Python, and orchestration concepts, and I enjoy simplifying complex systems so they are easy for others to use correctly.

What excites me most about Netflix is the opportunity to help build analytics platforms that multiply the impact of data practitioners across the organization. I thrive in environments with high ownership, strong technical standards, and a clear connection between data systems and real decisions. I would welcome the opportunity to contribute my energy and systems thinking to Netflix's analytics engineering team.

Sincerely,

Shreya Mendi
---

COVER LETTER STYLE REQUIREMENTS:
- Start directly with: "Dear ${employer} Hiring Team,"
- Do NOT include a date, address block, or "Re:" line — go straight to the salutation
- 4 paragraphs, each 3-5 sentences, no bullets
- Paragraph 1: Open with "I am excited to apply for [role] at [company]." Second sentence: "I am currently pursuing a Master of Engineering in Artificial Intelligence." Then: concrete reason this company/role specifically excites her — reference the company's actual mission, product, or stated values from the JD.
- Paragraph 2: Most relevant 1-2 projects with specific metrics and technical details that map directly to the JD requirements. Name projects by exact title.
- Paragraph 3: Work experience or a second angle (engineering systems, deployment, cross-functional work) that adds another dimension relevant to the role.
- Paragraph 4: Brief enthusiastic closing — reference something specific about ${employer}'s work or culture from the JD. End with an invitation to contribute, not a plea.
- Sign-off: "Sincerely,"
- Blank line, then: "Shreya Mendi"
- Tone: Professional, confident, genuine — NOT generic or buzzword-heavy
- Use "I am" not "I'm" consistently (formal tone)
- Do NOT use: "passionate", "dynamic", "hardworking", "thrilled", "leverage", "synergy", "I believe I would be a great fit", "I look forward to hearing from you", or any mention of visa sponsorship or salary

JOB: ${employer} — ${jobTitle}
JOB DESCRIPTION:
${jobDescription.slice(0, 3000)}

Return a JSON object with a single field "coverLetter" containing the cover letter body text only — starting with "Dear ${employer} Hiring Team," and ending with "Shreya Mendi" after the sign-off. Do NOT include any header, name, contact info, date, or address block — those are handled separately. No HTML, no markdown, no extra explanations. Use plain text with newlines (\\n) for line breaks between paragraphs.`;

    const COVER_LETTER_SCHEMA: JsonSchemaDefinition = {
      name: "cover_letter",
      schema: {
        type: "object",
        properties: {
          coverLetter: {
            type: "string",
            description: "The complete cover letter text, starting with the candidate name header",
          },
        },
        required: ["coverLetter"],
        additionalProperties: false,
      },
    };

    const llm = new LlmService();
    const result = await llm.callJson<{ coverLetter: string }>({
      model,
      messages: [{ role: "user", content: prompt }],
      jsonSchema: COVER_LETTER_SCHEMA,
      maxRetries: 1,
      jobId,
    });

    if (!result.success) {
      return { success: false, error: `LLM failed: ${result.error}` };
    }

    const coverLetterText = (result.data.coverLetter ?? "").trim();

    const outputPath = join(OUTPUT_DIR, `cover_letter_${jobId}.pdf`);
    const html = coverLetterTextToHtml(coverLetterText);
    await htmlToPdf(html, outputPath);

    // Copy to Documents folder with human-readable filename
    await copyToDocuments(outputPath, `${sanitizeFilename(employer)}_cl.pdf`);

    logger.info("Cover letter generated", { jobId, outputPath });
    return { success: true, pdfPath: outputPath, coverLetterText };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Cover letter generation failed", { jobId, error });
    return { success: false, error: message };
  }
}
