/**
 * Resume PDF generation using Puppeteer.
 *
 * PRIMARY APPROACH: Claude vision API analyzes the actual resume PDF and
 * generates perfectly tailored HTML that matches the original layout.
 *
 * FALLBACK: Hardcoded HTML template with LLM project/skill selection.
 *
 * Section order matches Shreya's real resume:
 *   Name + Contact
 *   EDUCATION
 *   PROJECTS  (prominent — before work experience)
 *   WORK EXPERIENCE
 *   LEADERSHIP
 *   SKILLS
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger } from "@infra/logger";
import { getDataDir } from "../config/dataDir";
import { LlmService } from "./llm/service";
import { getSetting } from "../repositories/settings";
import type { JsonSchemaDefinition } from "./llm/types";

const RESUME_PDF_PATH = join(homedir(), "Documents", "applications", "Shreya_Mendi_Resume.pdf");

const OUTPUT_DIR = join(getDataDir(), "pdfs");
const DOCS_OUTPUT_DIR = join(homedir(), "Documents", "applications");

// ─────────────────────────────────────────────────────────────────────────────
// MASTER RESUME DATA  (hardcoded — never sent to LLM)
// ─────────────────────────────────────────────────────────────────────────────

const MASTER = {
  name: "Shreya Mendi",
  location: "Durham, NC",
  phone: "(919) 608-0547",
  email: "shreya.mendi@duke.edu",
  linkedin: "linkedin.com/in/shreya-mendi",
  githubHref: "https://github.com/shreyamendi",
  githubLabel: "GitHub",
  portfolioHref: "https://portfolio-website-five-theta-67.vercel.app/",
  portfolioLabel: "Portfolio",

  education: [
    {
      institution: "Duke University",
      degree: "MEng, Artificial Intelligence",
      date: "Jul 2025 – May 2027",
      gpa: "",
    },
    {
      institution: "Manipal Institute of Technology",
      degree: "BTech, Electronics & Communication Engineering",
      date: "Jul 2019 – Jul 2023",
      gpa: "8.71/10",
    },
  ],

  projects: [
    {
      key: "When2Speak",
      name: "When2Speak",
      subtitle: "LLM Intervention Policy Agent",
      tech: "NLP · Reinforcement Learning · PyTorch",
      date: "Jan 2026 – Present",
      bullets: [
        "Trained a lightweight RL policy network for multi-agent dialogue intervention using PyTorch and NLP; reduced unnecessary interventions by 25% while maintaining task success rate, validated on a 10,000-dialogue simulation suite via A/B testing.",
        "Applied role-prompting, prompt engineering, and policy gradient methods to optimize agent behavior in real-time conversational AI systems.",
      ],
    },
    {
      key: "UAV-SAR",
      name: "UAV-SAR",
      subtitle: "Aerial Human Detection (Search & Rescue)",
      tech: "Computer Vision · Object Detection",
      date: "Jan 2026 – Present",
      bullets: [
        "Fine-tuned Faster R-CNN on thermal SAR imagery with domain-specific augmentations (snow, smoke, sensor noise); achieved 20% recall improvement under adverse conditions with <5% clean-data accuracy loss.",
        "Built end-to-end CV pipeline in PyTorch with custom data loaders, augmentation strategies, and model evaluation metrics optimized for safety-critical deployment.",
      ],
    },
    {
      key: "BMW Capstone",
      name: "BMW Capstone",
      subtitle: "Industrial AI Decision System",
      tech: "Interpretable ML · Production AI",
      date: "Jan 2026 – Present",
      bullets: [
        "Scoping and prototyping an interpretable ML solution for industrial decision-making at BMW, balancing model performance with deployment constraints and stakeholder explainability requirements.",
      ],
    },
    {
      key: "Inflationship",
      name: "Inflationship",
      subtitle: "Macroeconomic Forecasting",
      tech: "Time-Series · SARIMAX · Feature Engineering",
      date: "Sept 2025",
      bullets: [
        "Engineered a forecasting pipeline fusing port-traffic alternative data with CPI using SARIMAX and ML; achieved 0.67–1.69% MAPE across major CPI categories, outperforming CPI-only baselines via rolling cross-validation.",
      ],
    },
    {
      key: "AI Audit",
      name: "AI Audit",
      subtitle: "EU AI Act Compliance System",
      tech: "MLOps · FastAPI · NLP · Cloud Run",
      date: "Nov 2025",
      bullets: [
        "Built an explainable compliance classifier (TF-IDF + logistic regression + rule-based checks) mapping system behavior to EU AI Act articles; deployed FastAPI + Streamlit UI on GCP Cloud Run with MLflow experiment tracking.",
      ],
    },
    {
      key: "Alba",
      name: "Alba",
      subtitle: "AI Carbon Footprint Tracker",
      tech: "Chrome Extension · Privacy Engineering",
      date: "Nov 2025",
      bullets: [
        "Shipped a privacy-first Chrome extension computing LLM energy, carbon, and water footprints client-side using emissions heuristics; included prompt optimization suggestions and a daily sustainability dashboard.",
      ],
    },
    {
      key: "Wordle XAI Bot",
      name: "Wordle XAI Bot",
      subtitle: "Multimodal XAI Agent",
      tech: "Multimodal Agent · Vision + NLP · Grad-CAM · XAI",
      date: "Nov 2025",
      bullets: [
        "Built a multimodal agent that plays Wordle using vision + NLP models, surfacing token-level saliency to explain decisions in real time.",
        "Integrated Grad-CAM style explainability to trace errors and visualize transparent human–AI interactions.",
      ],
    },
    {
      key: "Supreme Court",
      name: "Supreme Court Case Outcome Prediction",
      subtitle: "Explainable ML · SCDB 2025",
      tech: "Random Forest · PDP/ICE/ALE · Explainability",
      date: "Oct 2025",
      bullets: [
        "Modeled ~13K Supreme Court cases with Random Forest; used PDP/ICE/ALE to explain predictive drivers of judicial outcomes.",
        "Improved F1-score by ~15% and achieved ~70% accuracy on held-out case outcome prediction.",
      ],
    },
    {
      key: "Paper Trail",
      name: "Paper Trail",
      subtitle: "Epstein Case Public-Docs NLP System",
      tech: "FastAPI · RAG · NER · Consequence Classification · Timeline UI",
      date: "2026",
      bullets: [
        "Built an NLP pipeline to classify legal consequences for individuals using public documents; includes RAG-based chatbot, NER, and multi-tier consequence classification with an interactive timeline UI.",
      ],
    },
    {
      key: "Sourcing Happiness",
      name: "Sourcing Happiness",
      subtitle: "World Happiness Report Analysis",
      tech: "Data Analysis · Visualization",
      date: "2026",
      bullets: [
        "Analyzed World Happiness Report data (2019–2024) to study regional/country trends; built animated and comparative visualizations.",
      ],
    },
  ],

  experience: [
    {
      title: "DevOps Engineer",
      company: "Assetmantle Pvt. Ltd. (Blockchain Infrastructure)",
      date: "Sept 2023 – May 2025",
      bullets: [
        "Architected and optimized AWS/Hetzner infrastructure and CI/CD pipelines (Docker, Kubernetes), reducing operational costs by 38% while improving reliability and uptime.",
        "Engineered automated rollout/rollback policies to reduce deployment risk and improve mean time to recovery (MTTR) across production environments.",
        "Managed containerized microservices for a blockchain-based platform, maintaining 99%+ availability across distributed nodes; improved security posture across cloud resources.",
      ],
    },
    {
      title: "Software Development Intern",
      company: "Hewlett Packard Enterprise GlobalSoft",
      date: "Jan 2023 – Jul 2023",
      bullets: [
        "Developed and deployed Dockerized services on Linux; automated deployments with Jenkins and shell scripting.",
        "Integrated REST APIs in Python for monitoring; expanded observability coverage with Grafana/Prometheus to improve stability and reduce incident detection time.",
        "Streamlined CI/CD release processes across service teams, accelerating deployment cycles and reducing release friction.",
      ],
    },
  ],

  leadership: [
    {
      role: "Teaching Assistant, Managing AI in Business",
      org: "Duke University",
      date: "2026 – Present",
    },
    {
      role: "AI Representative, Student Advisory Board",
      org: "Duke University",
      date: "2025",
    },
  ],

  skillCategories: {
    "ML/AI": "Machine Learning, Deep Learning, NLP, Computer Vision, LLMs, Reinforcement Learning, Transformer Models, Finetuning, Prompt Engineering, Time-Series Forecasting, Explainable AI (XAI), Model Evaluation, A/B Testing",
    "Frameworks & Tools": "Python, PyTorch, TensorFlow, Scikit-learn, HuggingFace, FastAPI, Flask, MLflow, Streamlit, SQL, Bash",
    "Cloud & DevOps": "AWS, GCP (Cloud Run), Docker, Kubernetes, CI/CD, Git, Linux, Prometheus, Grafana",
  } as Record<string, string>,
};

// ─────────────────────────────────────────────────────────────────────────────
// LLM SELECTION SCHEMA  (simple — just project names, coursework, skill order)
// ─────────────────────────────────────────────────────────────────────────────

interface ResumeSelection {
  selectedProjects: string[];
  bulletOverrides: Record<string, string[]>;
  experienceOverrides: Record<string, string[]>;
  tailoredObjective: string;
  coursework: string[];
  skills: Array<{ category: string; items: string }>;
}

const SELECTION_SCHEMA: JsonSchemaDefinition = {
  name: "resume_selection",
  schema: {
    type: "object",
    properties: {
      selectedProjects: {
        type: "array",
        items: { type: "string" },
        description: "4–5 exact project names ordered by relevance",
      },
      bulletOverrides: {
        type: "object",
        description: "For EVERY selected project, rewrite ALL bullets to use the EXACT keyword phrases from the JD. Every JD keyword that is factually applicable to this project MUST appear verbatim. Each key is the exact project name.",
        additionalProperties: {
          type: "array",
          items: { type: "string" },
        },
      },
      experienceOverrides: {
        type: "object",
        description: "For EVERY work experience entry, rewrite ALL bullets to use EXACT JD keyword phrases wherever factually accurate. Keys must be 'DevOps Engineer' and 'Software Development Intern'.",
        additionalProperties: {
          type: "array",
          items: { type: "string" },
        },
      },
      tailoredObjective: {
        type: "string",
        description: "1–2 sentence objective/summary that MUST contain the top 6–8 exact keyword phrases from the JD verbatim. Pack as many JD keywords as possible while staying factual. Example: 'AI/ML intern seeking to apply PyTorch-based deep learning, transformer model fine-tuning, and AWS SageMaker experience to large-scale ML research at [Company].'",
      },
      coursework: {
        type: "array",
        items: { type: "string" },
        description: "5–7 course names most relevant to the JD",
      },
      skills: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string" },
            items: { type: "string", description: "comma-separated skill items, JD-matching first" },
          },
          required: ["category", "items"],
          additionalProperties: false,
        },
      },
    },
    required: ["selectedProjects", "bulletOverrides", "experienceOverrides", "tailoredObjective", "coursework", "skills"],
    additionalProperties: false,
  },
};

const SELECTION_PROMPT_TEMPLATE = `You are an expert ATS resume optimizer. Your ONLY goal is to maximize keyword match between this resume and the job description. Every important term from the JD must appear verbatim somewhere in the resume.

JOB DESCRIPTION:
{jobDescription}

CANDIDATE BACKGROUND:
- Work Experience: DevOps Engineer at Assetmantle (AWS/Hetzner, Docker, Kubernetes, CI/CD, blockchain microservices, 99%+ uptime); Software Dev Intern at HP Enterprise (Docker, Jenkins, REST APIs, Grafana/Prometheus, CI/CD)
- Available Projects (pick 4-5):
  * When2Speak — RL policy network for multi-agent dialogue, PyTorch, NLP, A/B testing, 10K-dialogue simulation
  * UAV-SAR — Faster R-CNN fine-tuning on thermal imagery, PyTorch, CV pipeline, custom data loaders, safety-critical
  * BMW Capstone — Interpretable ML for industrial decision-making, explainability, stakeholder requirements, production constraints
  * Inflationship — SARIMAX + ML forecasting, alternative data, feature engineering, 0.67-1.69% MAPE, cross-validation
  * AI Audit — EU AI Act compliance classifier, TF-IDF + logistic regression, FastAPI, Streamlit, GCP Cloud Run, MLflow
  * Alba — Privacy-first Chrome extension, LLM emissions tracking, client-side computation, sustainability dashboard
  * Wordle XAI Bot — Multimodal agent, vision + NLP, Grad-CAM explainability, real-time saliency
  * Supreme Court — Random Forest on 13K cases, PDP/ICE/ALE explainability, 70% accuracy, 15% F1 improvement
  * Paper Trail — RAG chatbot, NER, consequence classification, FastAPI, timeline UI, public document NLP
  * Sourcing Happiness — Data analysis, animated visualizations, World Happiness Report (2019-2024)

COURSEWORK OPTIONS: Deep Learning, LLMs & Intelligent Agents, Reinforcement Learning, Computer Vision, Explainable AI, Alternative Data, AI Security

MASTER SKILLS:
- ML/AI: Machine Learning, Deep Learning, NLP, Computer Vision, LLMs, Reinforcement Learning, Transformer Models, Finetuning, Prompt Engineering, Time-Series Forecasting, Explainable AI (XAI), Model Evaluation, A/B Testing
- Frameworks & Tools: Python, PyTorch, TensorFlow, Scikit-learn, HuggingFace, FastAPI, Flask, MLflow, Streamlit, SQL, Bash
- Cloud & DevOps: AWS, GCP (Cloud Run), Docker, Kubernetes, CI/CD, Git, Linux, Prometheus, Grafana

STEP 1 — Extract keywords: Read the JD and list every technical term, tool, method, and skill mentioned. Note which ones are in the master skills/background already, and which are NEW (only add new ones if factually accurate).

STEP 2 — Build the resume fields:

1. "selectedProjects": 4-5 project names ordered by relevance to JD.

2. "bulletOverrides": For EVERY selected project, rewrite ALL bullets to inject JD keywords verbatim. Rules:
   - Use the EXACT phrasing from the JD (e.g. JD says "large language models" → use "large language models" not "LLMs")
   - Every bullet must contain at least 1-2 exact JD keyword phrases
   - Keep all facts true — only change PHRASING to use JD terminology
   - 2 bullets per project, each 1 sentence, dense with keywords

3. "experienceOverrides": Rewrite bullets for BOTH work experience entries to inject JD keywords. Keys: "DevOps Engineer" and "Software Development Intern". Same rules as bulletOverrides. 3 bullets each.

4. "tailoredObjective": 1-2 sentences containing 6-8 EXACT keyword phrases from the JD packed in. Must be factual to Shreya's background. Start with the role title from JD if possible.

5. "coursework": 5-7 courses most relevant to JD.

6. "skills": Reorder each category so JD-matching terms appear first. If the JD mentions a skill/tool that's in the master list, put it first. Keep all existing items.

Return JSON only — no explanation, no markdown fences:
{
  "selectedProjects": ["exact project name 1", ...],
  "bulletOverrides": {
    "Project Name": ["bullet with exact JD keywords", "bullet 2"]
  },
  "experienceOverrides": {
    "DevOps Engineer": ["rewritten bullet 1 using JD terms", "bullet 2", "bullet 3"],
    "Software Development Intern": ["rewritten bullet 1 using JD terms", "bullet 2", "bullet 3"]
  },
  "tailoredObjective": "Dense 1-2 sentences with 6-8 exact JD keyword phrases",
  "coursework": ["Course1", ...],
  "skills": [
    {"category": "ML/AI", "items": "JD-matching terms first, comma-separated"},
    {"category": "Frameworks & Tools", "items": "JD-matching terms first"},
    {"category": "Cloud & DevOps", "items": "JD-matching terms first"}
  ]
}`;

// ─────────────────────────────────────────────────────────────────────────────
// HTML TEMPLATE RENDERER
// ─────────────────────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  const str =
    s == null ? ""
    : Array.isArray(s) ? (s as unknown[]).join(", ")
    : typeof s === "object" ? JSON.stringify(s)
    : String(s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildResumeHtmlFromData(selection: ResumeSelection): string {
  const BLUE = "#1a52a0";

  // ── Contact line ──────────────────────────────────────────────────────────
  const contactParts: string[] = [
    esc(MASTER.location),
    esc(MASTER.phone),
    `<a href="mailto:${esc(MASTER.email)}" style="color:#222;text-decoration:none;">${esc(MASTER.email)}</a>`,
    `<a href="https://${esc(MASTER.linkedin)}" style="color:#222;text-decoration:none;">${esc(MASTER.linkedin)}</a>`,
    `<a href="${esc(MASTER.githubHref)}" style="color:#222;text-decoration:none;">${esc(MASTER.githubLabel)}</a>`,
    `<a href="${esc(MASTER.portfolioHref)}" style="color:#222;text-decoration:none;">${esc(MASTER.portfolioLabel)}</a>`,
  ];

  // ── Education ─────────────────────────────────────────────────────────────
  const courseStr = (selection.coursework ?? []).join(", ");
  const educationHtml = MASTER.education.map((e, i) => {
    const degreeGpa = e.gpa ? `${esc(e.degree)} | GPA: ${esc(e.gpa)}` : esc(e.degree);
    const courseworkLine = i === 0 && courseStr
      ? `<div class="coursework">Coursework: ${esc(courseStr)}</div>`
      : "";
    return `
      <div class="row" style="margin-bottom:1px;">
        <span><span class="bold">${esc(e.institution)}</span> — ${degreeGpa}</span>
        <span class="date">${esc(e.date)}</span>
      </div>
      ${courseworkLine}`;
  }).join("");

  // ── Projects ─────────────────────────────────────────────────────────────
  const selectedKeys = (selection.selectedProjects ?? []).map((s) => s.trim().toLowerCase());

  // Robust matching: exact key/name, OR starts-with, OR LLM name starts with key
  function projectMatches(p: typeof MASTER.projects[number], k: string): boolean {
    const kl = k.toLowerCase();
    const pl = p.key.toLowerCase();
    const nl = p.name.toLowerCase();
    return kl === pl || kl === nl
      || kl.startsWith(pl) || kl.startsWith(nl)
      || pl.startsWith(kl) || nl.startsWith(kl);
  }

  const selectedProjects = MASTER.projects.filter((p) =>
    selectedKeys.some((k) => projectMatches(p, k))
  );
  // Preserve LLM ordering
  const orderedProjects = selectedKeys
    .map((k) => selectedProjects.find((p) => projectMatches(p, k)))
    .filter(Boolean) as typeof MASTER.projects;

  // Deduplicate (same project could match multiple keys)
  const seen = new Set<string>();
  const deduped = orderedProjects.filter((p) => {
    if (seen.has(p.key)) return false;
    seen.add(p.key);
    return true;
  });

  const projectsHtml = deduped.map((p) => {
    // Use LLM-rewritten bullets when available, otherwise fall back to master bullets
    const overrides = selection.bulletOverrides?.[p.name] ?? selection.bulletOverrides?.[p.key];
    const bullets = (overrides && overrides.length > 0) ? overrides : p.bullets;
    return `
    <div class="row" style="margin-top:4px;">
      <span><span class="bold">${esc(p.name)} — ${esc(p.subtitle)}</span> <span class="tech">| ${esc(p.tech)}</span></span>
      <span class="date">${esc(p.date)}</span>
    </div>
    <ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  }).join("");

  // ── Work Experience ───────────────────────────────────────────────────────
  const experienceHtml = MASTER.experience.map((e) => {
    const expOverride = selection.experienceOverrides?.[e.title];
    const expBullets = (expOverride && expOverride.length > 0) ? expOverride : e.bullets;
    return `
    <div class="row" style="margin-top:4px;">
      <span><span class="bold">${esc(e.title)}</span> | ${esc(e.company)}</span>
      <span class="date">${esc(e.date)}</span>
    </div>
    <ul>${expBullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
  }).join("");

  // ── Leadership ────────────────────────────────────────────────────────────
  const leadershipHtml = MASTER.leadership.map((l) => `
    <div class="leader-row">
      <span>${esc(l.role)} | ${esc(l.org)}</span>
      <span class="date">${esc(l.date)}</span>
    </div>`
  ).join("");

  // ── Skills ────────────────────────────────────────────────────────────────
  // Use LLM-reordered skills (JD-matching first); fall back to MASTER if missing
  const skillsMap = Object.fromEntries(
    (selection.skills ?? []).map((s) => [s.category, s.items])
  );
  const skillsHtml = ["ML/AI", "Frameworks & Tools", "Cloud & DevOps"].map((cat) =>
    `<div class="skill-line"><strong>${esc(cat)}:</strong> ${esc(skillsMap[cat] || MASTER.skillCategories[cat] || "")}</div>`
  ).join("");

  // ── Section helper ────────────────────────────────────────────────────────
  const section = (title: string, content: string) => `
  <div class="section">
    <div class="section-title">${title}</div>
    ${content}
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Calibri', Arial, sans-serif;
    font-size: 9.2pt;
    line-height: 1.35;
    color: #111;
    padding: 13mm 14mm 11mm 14mm;
  }
  h1 {
    font-size: 22pt;
    font-weight: 700;
    color: ${BLUE};
    text-align: center;
    margin-bottom: 2px;
  }
  .contact {
    font-size: 8.5pt;
    text-align: center;
    color: #222;
    margin-bottom: 6px;
  }
  .section { margin-top: 6px; }
  .section-title {
    font-size: 9.2pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: ${BLUE};
    border-bottom: 1.5px solid ${BLUE};
    padding-bottom: 1px;
    margin-bottom: 3px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .bold { font-weight: 700; }
  .italic { font-style: italic; }
  .date { font-style: italic; font-size: 8.8pt; color: #333; white-space: nowrap; padding-left: 6px; }
  .tech { font-style: italic; font-weight: 400; }
  .coursework { font-size: 8.6pt; color: #333; margin-bottom: 2px; }
  ul { margin: 1px 0 1px 13px; }
  li { margin-bottom: 0.5px; font-size: 9pt; line-height: 1.35; }
  .leader-row { display: flex; justify-content: space-between; margin-bottom: 1px; font-size: 9.1pt; }
  .skill-line { font-size: 9pt; margin-bottom: 1.5px; }
  .objective { font-size: 8.8pt; color: #222; text-align: center; margin-bottom: 4px; font-style: italic; }
</style>
</head>
<body>
  <h1>${esc(MASTER.name)}</h1>
  <div class="contact">${contactParts.join(" | ")}</div>
  ${selection.tailoredObjective ? `<div class="objective">${esc(selection.tailoredObjective)}</div>` : ""}
  ${section("Education", educationHtml)}
  ${deduped.length > 0 ? section("Projects", projectsHtml) : "<!-- NO PROJECTS MATCHED -->"}
  ${section("Work Experience", experienceHtml)}
  ${section("Leadership", leadershipHtml)}
  ${section("Skills", skillsHtml)}
</body>
</html>`;
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-]/g, "_").replace(/_+/g, "_").slice(0, 60);
}

async function copyToDocuments(srcPath: string, destFilename: string): Promise<void> {
  try {
    if (!existsSync(DOCS_OUTPUT_DIR)) {
      await mkdir(DOCS_OUTPUT_DIR, { recursive: true });
    }
    await copyFile(srcPath, join(DOCS_OUTPUT_DIR, destFilename));
    logger.info("Copied PDF to Documents", { dest: join(DOCS_OUTPUT_DIR, destFilename) });
  } catch (err) {
    logger.warn("Could not copy PDF to Documents folder", { err });
  }
}

export interface ResumePdfResult {
  success: boolean;
  pdfPath?: string;
  error?: string;
}

export interface TailoredResumeContent {
  summary?: string | null;
  headline?: string | null;
  skills?: Array<{ name: string; keywords: string[] }> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY buildResumeHtml (kept for backward compatibility if called elsewhere)
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated — use buildResumeHtmlFromData instead */
interface ResumeData {
  name: string;
  location: string;
  phone: string;
  email: string;
  linkedin: string;
  github: string;
  portfolio: string;
  education: Array<{ institution: string; degree: string; date: string; coursework: string; gpa: string }>;
  projects: Array<{ name: string; tech: string; date: string; bullets: string[] }>;
  experience: Array<{ title: string; company: string; date: string; bullets: string[] }>;
  leadership: Array<{ role: string; org: string; date: string }>;
  skills: Array<{ category: string; items: string }>;
}

function toArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === "string" && val.trim()) {
    try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) return parsed as T[]; } catch {}
    return val.split(",").map((s) => s.trim()).filter(Boolean) as unknown as T[];
  }
  return [];
}

/** @deprecated */
function buildResumeHtml(data: ResumeData): string {
  const education = toArray<ResumeData["education"][number]>(data.education);
  const projects = toArray<ResumeData["projects"][number]>(data.projects);
  const experience = toArray<ResumeData["experience"][number]>(data.experience);
  const leadership = toArray<ResumeData["leadership"][number]>(data.leadership);
  const skills = toArray<ResumeData["skills"][number]>(data.skills);
  const BLUE = "#1a52a0";
  function contactItem(val: string): string {
    if (!val) return "";
    const t = val.trim();
    if (t.includes("linkedin.com") || t.includes("github.com") || t.startsWith("http")) {
      const href = t.startsWith("http") ? t : `https://${t}`;
      return `<a href="${esc(href)}" style="color:#222;text-decoration:none;">${esc(t)}</a>`;
    }
    return esc(t);
  }
  const contactParts = [data.location, data.phone, data.email, data.linkedin, data.github, data.portfolio]
    .filter(Boolean).map(contactItem).join(" | ");
  const educationHtml = education.map((e) => {
    const degreeGpa = e.gpa ? `${esc(e.degree)} | GPA: ${esc(e.gpa)}` : esc(e.degree);
    return `<div class="edu-row"><span><strong>${esc(e.institution)}</strong> — ${degreeGpa}</span><span class="entry-date">${esc(e.date)}</span></div>${e.coursework ? `<div class="coursework">Coursework: ${esc(e.coursework)}</div>` : ""}`;
  }).join("");
  const projectsHtml = projects.map((p) => `<div class="proj-header"><span><strong>${esc(p.name)}</strong>${p.tech ? ` <span class="tech">| ${esc(p.tech)}</span>` : ""}</span><span class="entry-date">${esc(p.date)}</span></div><ul>${toArray<string>(p.bullets).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`).join("");
  const experienceHtml = experience.map((e) => `<div class="proj-header"><span><strong>${esc(e.title)}</strong>${e.company ? ` | ${esc(e.company)}` : ""}</span><span class="entry-date">${esc(e.date)}</span></div><ul>${toArray<string>(e.bullets).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`).join("");
  const leadershipHtml = leadership.map((l) => `<div class="leader-row"><span>${esc(l.role)}${l.org ? ` | ${esc(l.org)}` : ""}</span><span class="entry-date">${esc(l.date)}</span></div>`).join("");
  const skillsHtml = skills.map((s) => `<div class="skill-row"><strong>${esc(s.category)}:</strong> ${esc(Array.isArray(s.items) ? (s.items as unknown as string[]).join(", ") : String(s.items || ""))}</div>`).join("");
  const section = (title: string, content: string) => `<div class="section"><div class="section-title" style="color:${BLUE};border-bottom:1.5px solid ${BLUE};">${title}</div>${content}</div>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Calibri','Arial',sans-serif;font-size:9.3pt;line-height:1.35;color:#111;padding:13mm 15mm 11mm 15mm;}h1{font-size:22pt;font-weight:700;color:${BLUE};text-align:center;margin-bottom:3px;}.contact{font-size:8.5pt;color:#222;text-align:center;margin-bottom:7px;}.section{margin-top:7px;}.section-title{font-size:9.3pt;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;padding-bottom:1px;margin-bottom:4px;}.edu-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:1px;}.coursework{font-size:8.6pt;color:#333;margin-bottom:3px;}.proj-header{display:flex;justify-content:space-between;align-items:baseline;margin-top:4px;}.tech{font-weight:400;font-style:italic;font-size:9pt;}.entry-date{font-style:italic;font-size:8.8pt;color:#333;white-space:nowrap;padding-left:8px;}ul{margin-top:1px;margin-bottom:1px;padding-left:13px;}li{margin-bottom:1px;font-size:9pt;line-height:1.38;}.leader-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;font-size:9.2pt;}.skill-row{font-size:9pt;margin-bottom:2px;line-height:1.38;}</style></head><body><h1>${esc(data.name)}</h1><div class="contact">${contactParts}</div>${education.length > 0 ? section("Education", educationHtml) : ""}${projects.length > 0 ? section("Projects", projectsHtml) : ""}${experience.length > 0 ? section("Work Experience", experienceHtml) : ""}${leadership.length > 0 ? section("Leadership", leadershipHtml) : ""}${skills.length > 0 ? section("Skills", skillsHtml) : ""}</body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUPPETEER PDF RENDERER
// ─────────────────────────────────────────────────────────────────────────────

async function htmlToPdf(html: string, outputPath: string): Promise<void> {
  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    const bodyHeight = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      return Math.max(body.scrollHeight, body.offsetHeight, html.scrollHeight, html.offsetHeight);
    });

    const A4_HEIGHT_PX = 1123;
    if (bodyHeight > A4_HEIGHT_PX + 20) {
      const scale = Math.max(0.6, A4_HEIGHT_PX / bodyHeight);
      await page.addStyleTag({
        content: `
          html, body { height: ${A4_HEIGHT_PX}px !important; overflow: hidden !important; }
          body { transform: scale(${scale.toFixed(3)}); transform-origin: top left !important;
                 width: ${(100 / scale).toFixed(1)}% !important; }
        `,
      });
    }

    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: false,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      pageRanges: "1",
    });
  } finally {
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLAUDE VISION API — resume tailoring via PDF analysis
// ─────────────────────────────────────────────────────────────────────────────

const VISION_SYSTEM_PROMPT = `You are an expert resume writer. You will be given a resume PDF and a job description.
Your job is to return complete, valid HTML for a customized single-page resume that:
1. STRICTLY matches the visual layout of the provided resume (same fonts, colors, spacing, section order)
2. Tailors projects and skills ordering to match the job description keywords
3. Keeps ALL content factual — only include what is in the original resume, NO hallucination
4. Must fit in exactly ONE page (A4) — do not add content, only reorder/select
5. Include ALL links: email, LinkedIn, GitHub (https://github.com/shreyamendi), Portfolio (https://portfolio-website-five-theta-67.vercel.app/)
6. The name "Shreya Mendi" must appear in large blue (#1a52a0) bold text centered at top
7. Section headers must be in blue (#1a52a0) with a blue underline, uppercase
8. Dates must be right-aligned italic
9. Project tech stacks in italic after pipe character
10. Return ONLY the HTML, no markdown, no explanation, no code fences

CONTACT INFO (hardcoded — use exactly):
- Name: Shreya Mendi
- Location: Durham, NC
- Phone: (919) 608-0547
- Email: shreya.mendi@duke.edu
- LinkedIn: linkedin.com/in/shreya-mendi
- GitHub: https://github.com/shreyamendi (display as "GitHub")
- Portfolio: https://portfolio-website-five-theta-67.vercel.app/ (display as "Portfolio")

SECTION ORDER: Education → Projects → Work Experience → Leadership → Skills

CSS REQUIREMENTS:
- Font: Calibri or Arial, 9.2pt
- Body padding: 13mm 14mm 11mm 14mm
- Name: 22pt bold blue #1a52a0 centered
- Section headers: 9.2pt bold uppercase blue #1a52a0, border-bottom: 1.5px solid #1a52a0
- Dates: italic 8.8pt right-aligned #333
- Bullet lists: padding-left 13px, 9pt
- Skills bold category label, items comma-separated on same line`;

async function generateResumeViaClaudeVision(
  jobId: string,
  jobDescription: string,
  apiKey: string,
): Promise<string | null> {
  // Read resume PDF as base64
  if (!existsSync(RESUME_PDF_PATH)) {
    logger.warn("Resume PDF not found for vision API", { jobId, path: RESUME_PDF_PATH });
    return null;
  }

  let pdfBase64: string;
  try {
    const pdfBuffer = await readFile(RESUME_PDF_PATH);
    pdfBase64 = pdfBuffer.toString("base64");
    logger.info("Read resume PDF for vision API", { jobId, bytes: pdfBuffer.length });
  } catch (err) {
    logger.warn("Failed to read resume PDF", { jobId, err });
    return null;
  }

  const userPrompt = `Here is my current resume (attached as a PDF document) and a job description below.

Please analyze my resume carefully and generate complete, valid HTML for a tailored version that:
- Selects the 4-5 most relevant projects for this specific job
- Reorders skills to put job-relevant ones first
- Maintains the exact visual style of my current resume
- Fits on exactly one A4 page

JOB DESCRIPTION:
${jobDescription.slice(0, 4000)}`;

  const requestBody = {
    model: "claude-opus-4-6",
    max_tokens: 8192,
    system: VISION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          {
            type: "text",
            text: userPrompt,
          },
        ],
      },
    ],
  };

  let responseText: string;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "(unreadable)");
      logger.warn("Claude vision API returned error", { jobId, status: response.status, errText });
      return null;
    }

    const json = await response.json() as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message: string };
    };

    if (json.error) {
      logger.warn("Claude vision API error in response", { jobId, error: json.error.message });
      return null;
    }

    const textBlock = json.content?.find((b) => b.type === "text");
    responseText = textBlock?.text ?? "";
    if (!responseText) {
      logger.warn("Claude vision API returned empty content", { jobId });
      return null;
    }
  } catch (err) {
    logger.warn("Claude vision API fetch failed", { jobId, err });
    return null;
  }

  // Strip markdown code fences if present
  let html = responseText.trim();
  if (html.startsWith("```html")) {
    html = html.slice(7);
  } else if (html.startsWith("```")) {
    html = html.slice(3);
  }
  if (html.endsWith("```")) {
    html = html.slice(0, -3);
  }
  html = html.trim();

  if (!html.toLowerCase().includes("<!doctype") && !html.toLowerCase().includes("<html")) {
    logger.warn("Claude vision API response does not look like HTML", { jobId });
    return null;
  }

  logger.info("Claude vision API returned tailored HTML", { jobId, htmlLength: html.length });
  return html;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a tailored one-page PDF resume.
 *
 * Primary approach (Claude vision API):
 *  1. Read the actual resume PDF from disk as base64.
 *  2. Call Claude (claude-opus-4-5) with the PDF + job description.
 *  3. Claude returns complete tailored HTML.
 *  4. Convert to PDF via Puppeteer.
 *
 * Fallback (hardcoded template):
 *  If the vision API call fails, falls back to the LLM project/skill selection
 *  approach using the hardcoded MASTER data template.
 */
export async function generateResumePdf(
  jobId: string,
  tailoredContent: TailoredResumeContent,
  jobDescription: string,
  employer?: string,
): Promise<ResumePdfResult> {
  logger.info("Generating resume via Claude vision API", { jobId });

  try {
    if (!existsSync(OUTPUT_DIR)) {
      await mkdir(OUTPUT_DIR, { recursive: true });
    }

    const outputPath = join(OUTPUT_DIR, `resume_${jobId}.pdf`);

    // ── LLM selection + structured template (guaranteed keyword injection) ─────
    // Note: Claude vision path was removed — the structured template gives full
    // control over ATS keyword placement in bullets, experience, skills, and objective.
    let html: string | null = null;

    {
      const [overrideModel, overrideModelTailoring] = await Promise.all([
        getSetting("model"),
        getSetting("modelTailoring"),
      ]);
      const model =
        overrideModelTailoring ||
        overrideModel ||
        process.env.MODEL ||
        "gpt-4o";

      const prompt = SELECTION_PROMPT_TEMPLATE.replace(
        "{jobDescription}",
        jobDescription.slice(0, 5000),
      );

      const llm = new LlmService();
      const result = await llm.callJson<ResumeSelection>({
        model,
        messages: [{ role: "user", content: prompt }],
        jsonSchema: SELECTION_SCHEMA,
        maxRetries: 1,
        jobId,
      });

      const DEFAULT_SELECTION: ResumeSelection = {
        selectedProjects: ["When2Speak", "UAV-SAR", "AI Audit", "BMW Capstone"],
        bulletOverrides: {},
        experienceOverrides: {},
        tailoredObjective: "",
        coursework: ["Deep Learning", "LLMs & Intelligent Agents", "Reinforcement Learning", "Computer Vision", "Explainable AI"],
        skills: [
          { category: "ML/AI", items: MASTER.skillCategories["ML/AI"] },
          { category: "Frameworks & Tools", items: MASTER.skillCategories["Frameworks & Tools"] },
          { category: "Cloud & DevOps", items: MASTER.skillCategories["Cloud & DevOps"] },
        ],
      };

      let selection: ResumeSelection;
      if (!result.success || !result.data) {
        logger.warn("LLM selection failed — using defaults", { jobId, error: !result.success ? result.error : "no data" });
        selection = DEFAULT_SELECTION;
      } else {
        selection = result.data;
        logger.info("LLM selection received", {
          jobId,
          selectedProjects: selection.selectedProjects,
          coursework: selection.coursework,
        });
        if (!selection.selectedProjects || selection.selectedProjects.length === 0) {
          logger.warn("LLM returned empty selectedProjects — using defaults", { jobId });
          selection.selectedProjects = DEFAULT_SELECTION.selectedProjects;
        }
        // Validate skills — fall back to master per category if LLM returned nothing
        if (!selection.skills || selection.skills.length === 0) {
          selection.skills = DEFAULT_SELECTION.skills;
        }
      }

      html = buildResumeHtmlFromData(selection);
    }

    // ── Convert HTML to PDF ───────────────────────────────────────────────────
    await htmlToPdf(html, outputPath);

    // ── Copy to ~/Documents/applications ─────────────────────────────────────
    if (employer) {
      await copyToDocuments(outputPath, `${sanitizeFilename(employer)}_resume.pdf`);
    }

    logger.info("Resume PDF generated", { jobId, outputPath, method: "structured-template" });
    return { success: true, pdfPath: outputPath };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Resume PDF generation failed", { jobId, error });
    return { success: false, error: message };
  }
}
