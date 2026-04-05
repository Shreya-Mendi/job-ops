/**
 * Render a JSON Resume object to a PDF using Puppeteer.
 * Keeps the same structure as the master resume — only tailored content differs.
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, "template.html");

export interface JsonResume {
  basics: {
    name: string;
    label?: string;
    email: string;
    phone: string;
    url?: string;
    summary: string;
    location?: { city?: string; region?: string; countryCode?: string };
    profiles?: Array<{ network: string; url: string }>;
  };
  work?: Array<{
    name: string;
    position: string;
    startDate: string;
    endDate?: string;
    location?: string;
    highlights?: string[];
  }>;
  projects?: Array<{
    name: string;
    description?: string;
    keywords?: string[];
    highlights?: string[];
    visible?: boolean; // false = skip
  }>;
  skills?: Array<{ name: string; keywords: string[] }>;
  education?: Array<{
    institution: string;
    studyType?: string;
    area?: string;
    startDate?: string;
    endDate?: string;
    score?: string;
    location?: string;
    courses?: string[];
  }>;
  volunteer?: Array<{
    organization: string;
    position: string;
    startDate?: string;
    endDate?: string;
  }>;
}

export async function renderResumeToPdf(
  resume: JsonResume,
  outputPath: string,
): Promise<void> {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const html = buildHtml(resume);

  const browser = await puppeteer.launch({
    executablePath: process.env["PUPPETEER_EXECUTABLE_PATH"] ?? undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.pdf({
      path: outputPath,
      format: "Letter",
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(d?: string): string {
  if (!d) return "Present";
  const date = new Date(d);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

function buildHtml(r: JsonResume): string {
  const template = readFileSync(TEMPLATE_PATH, "utf-8");

  const location = [r.basics.location?.city, r.basics.location?.region]
    .filter(Boolean)
    .join(", ");

  const profileLinks = (r.basics.profiles ?? [])
    .map((p) => `<a href="${esc(p.url)}">${esc(p.network)}</a>`)
    .join(" · ");

  // Skills
  const skills = (r.skills ?? [])
    .map(
      (s) =>
        `<tr><td>${esc(s.name)}</td><td>${s.keywords.map(esc).join(", ")}</td></tr>`,
    )
    .join("\n");

  // Experience
  const experience = (r.work ?? [])
    .map((w) => {
      const bullets = (w.highlights ?? [])
        .map((h) => `<li>${esc(h)}</li>`)
        .join("");
      return `
        <div class="entry">
          <div class="entry-header">
            <span class="entry-org">${esc(w.name)}</span>
            <span class="entry-date">${formatDate(w.startDate)} – ${formatDate(w.endDate)}</span>
          </div>
          <div class="entry-header">
            <span class="entry-role">${esc(w.position)}</span>
            ${w.location ? `<span class="entry-loc">${esc(w.location)}</span>` : ""}
          </div>
          <ul>${bullets}</ul>
        </div>`;
    })
    .join("");

  // Projects — skip those explicitly hidden
  const projects = (r.projects ?? [])
    .filter((p) => p.visible !== false)
    .map((p) => {
      const bullets = (p.highlights ?? [])
        .map((h) => `<li>${esc(h)}</li>`)
        .join("");
      const keywords = (p.keywords ?? []).length
        ? `<div style="font-size:8pt;color:#555;margin-top:1px;">${p.keywords!.map(esc).join(", ")}</div>`
        : "";
      return `
        <div class="entry">
          <div class="entry-header">
            <span class="entry-org">${esc(p.name)}</span>
          </div>
          ${p.description ? `<div class="entry-role">${esc(p.description)}</div>` : ""}
          ${keywords}
          <ul>${bullets}</ul>
        </div>`;
    })
    .join("");

  // Education
  const education = (r.education ?? [])
    .map((e) => {
      const degree = [e.studyType, e.area].filter(Boolean).join(", ");
      return `
        <div class="edu-entry">
          <div class="entry-header">
            <span class="entry-org">${esc(e.institution)}</span>
            <span class="entry-date">${formatDate(e.startDate)} – ${formatDate(e.endDate)}</span>
          </div>
          <div class="entry-role">${esc(degree)}${e.score ? ` · GPA: ${esc(e.score)}` : ""}</div>
          ${e.location ? `<div class="entry-loc">${esc(e.location)}</div>` : ""}
        </div>`;
    })
    .join("");

  // Volunteering (compact)
  const volEntries = (r.volunteer ?? []).filter((v) => v.organization);
  const volunteering = volEntries.length
    ? `<h2>Leadership & Service</h2>
       ${volEntries
         .map(
           (v) =>
             `<div class="vol-entry"><strong>${esc(v.organization)}</strong> — ${esc(v.position)}${v.startDate ? ` (${formatDate(v.startDate)}${v.endDate ? ` – ${formatDate(v.endDate)}` : ""})` : ""}</div>`,
         )
         .join("")}`
    : "";

  return template
    .replace("{{NAME}}", esc(r.basics.name))
    .replace("{{EMAIL}}", esc(r.basics.email))
    .replace("{{PHONE}}", esc(r.basics.phone))
    .replace("{{LOCATION}}", esc(location))
    .replace("{{PROFILE_LINKS}}", profileLinks)
    .replace("{{SUMMARY}}", esc(r.basics.summary))
    .replace("{{SKILLS}}", skills)
    .replace("{{EXPERIENCE}}", experience)
    .replace("{{PROJECTS}}", projects)
    .replace("{{EDUCATION}}", education)
    .replace("{{VOLUNTEERING}}", volunteering);
}
