# Custom Resume Optimizer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace RxResume PDF generation with a self-contained pipeline: upload resume PDF → Claude extracts structured JSON → per-job diff approval UI → Puppeteer renders clean PDF.

**Architecture:** PDF ingested once via Claude into a `baseResume` JSON stored in settings. Per-job tailoring generates diffs (not just text blobs). TailoringWorkspace shows Accept/Edit/Reject per field. PDF rendered locally via Puppeteer + owned HTML template.

**Tech Stack:** TypeScript, Express, Drizzle/SQLite, Vitest, Puppeteer (add to deps), pdf-parse (add to deps), React, existing LLM service

---

### Task 1: Add pdf-parse and puppeteer to dependencies

**Files:**
- Modify: `orchestrator/package.json`
- Modify: `Dockerfile`

**Step 1: Install deps**

```bash
cd /Users/shreyamendi/job-ops/orchestrator
npm install pdf-parse puppeteer
npm install --save-dev @types/pdf-parse
```

**Step 2: Verify Dockerfile gets chromium**

In `Dockerfile`, in the production stage after `FROM node:22-slim`, add:

```dockerfile
# Install Chromium for Puppeteer PDF rendering
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

Add this block right after the `FROM node:22-slim` line in the production stage (around line 75).

**Step 3: Commit**

```bash
git add orchestrator/package.json orchestrator/package-lock.json Dockerfile
git commit -m "feat: add pdf-parse and puppeteer dependencies"
```

---

### Task 2: Define baseResume JSON type and DB storage

**Files:**
- Create: `orchestrator/src/server/services/resume/types.ts`
- Modify: `orchestrator/src/server/db/schema.ts`

**Step 1: Create types file**

Create `orchestrator/src/server/services/resume/types.ts`:

```typescript
export interface BaseResumeExperience {
  id: string;
  company: string;
  title: string;
  startDate: string;
  endDate: string | null;
  bullets: Array<{ id: string; text: string }>;
}

export interface BaseResumeProject {
  id: string;
  name: string;
  description: string;
  bullets: Array<{ id: string; text: string }>;
}

export interface BaseResumeSkillGroup {
  name: string;
  keywords: string[];
}

export interface BaseResume {
  name: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  summary: string;
  skills: BaseResumeSkillGroup[];
  experience: BaseResumeExperience[];
  projects: BaseResumeProject[];
  education: Array<{
    institution: string;
    degree: string;
    field: string;
    startDate: string;
    endDate: string | null;
  }>;
}

export interface ResumeDiff {
  summary?: { original: string; suggested: string };
  headline?: { original: string; suggested: string };
  skills?: { original: BaseResumeSkillGroup[]; suggested: BaseResumeSkillGroup[] };
  bullets?: Array<{
    id: string;
    experienceId: string;
    original: string;
    suggested: string;
  }>;
}

export interface ApprovedDiff {
  summary?: string;
  headline?: string;
  skills?: BaseResumeSkillGroup[];
  approvedBullets?: Array<{ id: string; finalText: string }>;
}
```

**Step 2: Add baseResume column to settings table**

In `orchestrator/src/server/db/schema.ts`, find the `settings` table definition and add:

```typescript
baseResume: text("base_resume"), // JSON string of BaseResume
```

Add it after `tracerLinksApiToken` (or wherever the last settings column is).

**Step 3: Add tailoredBullets column to jobs table**

In `orchestrator/src/server/db/schema.ts`, find the `jobs` table and add after `selectedProjectIds`:

```typescript
tailoredBullets: text("tailored_bullets"), // JSON string of ApprovedDiff bullets
```

**Step 4: Run migration**

```bash
cd /Users/shreyamendi/job-ops/orchestrator
npm run db:push
```

Expected: migration runs without errors.

**Step 5: Commit**

```bash
git add orchestrator/src/server/services/resume/types.ts orchestrator/src/server/db/schema.ts
git commit -m "feat: add BaseResume types and DB columns for custom resume optimizer"
```

---

### Task 3: Build PDF ingestion service (PDF → Claude → BaseResume JSON)

**Files:**
- Create: `orchestrator/src/server/services/resume/ingest.ts`
- Test: `orchestrator/src/server/tests/resume-ingest.test.ts`

**Step 1: Write the failing test**

Create `orchestrator/src/server/tests/resume-ingest.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { extractResumeFromText } from "../services/resume/ingest";

describe("extractResumeFromText", () => {
  it("returns a BaseResume with required fields from plain text", async () => {
    const sampleText = `
      Jane Doe
      jane@example.com | 555-123-4567 | New York, NY

      Software Engineer

      Summary
      Experienced engineer with 5 years building web applications.

      Experience
      Acme Corp — Software Engineer (2021–Present)
      - Built REST APIs serving 1M requests/day
      - Reduced latency by 40% through caching

      Skills
      Backend: Node.js, TypeScript, PostgreSQL
      Frontend: React, Tailwind CSS

      Education
      MIT — B.S. Computer Science (2017–2021)
    `;

    const result = await extractResumeFromText(sampleText);
    expect(result.name).toBeTruthy();
    expect(result.experience.length).toBeGreaterThan(0);
    expect(result.skills.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd /Users/shreyamendi/job-ops/orchestrator
npx vitest run src/server/tests/resume-ingest.test.ts
```

Expected: FAIL — "extractResumeFromText is not defined"

**Step 3: Create the ingest service**

Create `orchestrator/src/server/services/resume/ingest.ts`:

```typescript
import pdfParse from "pdf-parse";
import { getLlmService } from "../llm";
import type { BaseResume } from "./types";

const EXTRACT_SCHEMA = {
  name: "resume_extraction",
  schema: {
    type: "object" as const,
    properties: {
      name: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      location: { type: "string" },
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
      experience: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            company: { type: "string" },
            title: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            bullets: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  text: { type: "string" },
                },
                required: ["id", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["id", "company", "title", "startDate", "endDate", "bullets"],
          additionalProperties: false,
        },
      },
      projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            bullets: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  text: { type: "string" },
                },
                required: ["id", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["id", "name", "description", "bullets"],
          additionalProperties: false,
        },
      },
      education: {
        type: "array",
        items: {
          type: "object",
          properties: {
            institution: { type: "string" },
            degree: { type: "string" },
            field: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
          required: ["institution", "degree", "field", "startDate", "endDate"],
          additionalProperties: false,
        },
      },
    },
    required: ["name", "email", "phone", "location", "headline", "summary", "skills", "experience", "projects", "education"],
    additionalProperties: false,
  },
};

export async function extractResumeFromPdf(pdfBuffer: Buffer): Promise<BaseResume> {
  const parsed = await pdfParse(pdfBuffer);
  return extractResumeFromText(parsed.text);
}

export async function extractResumeFromText(text: string): Promise<BaseResume> {
  const llm = getLlmService();
  const result = await llm.request<BaseResume>({
    model: process.env["MODEL"] ?? "claude-haiku-4-5-20251001",
    messages: [
      {
        role: "system",
        content:
          "You are a resume parser. Extract all structured information from the resume text. " +
          "Generate short unique IDs (like 'exp-1', 'exp-2', 'bullet-1', etc.) for items that need IDs. " +
          "Use empty string for endDate if the position is current. " +
          "Group skills into logical categories.",
      },
      {
        role: "user",
        content: `Parse this resume into structured JSON:\n\n${text}`,
      },
    ],
    jsonSchema: EXTRACT_SCHEMA,
  });

  if (!result.success) {
    throw new Error(`Resume extraction failed: ${result.error}`);
  }
  return result.data;
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/server/tests/resume-ingest.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add orchestrator/src/server/services/resume/ingest.ts orchestrator/src/server/tests/resume-ingest.test.ts
git commit -m "feat: add resume PDF ingestion service via Claude"
```

---

### Task 4: Build PDF renderer (BaseResume JSON → Puppeteer PDF)

**Files:**
- Create: `orchestrator/src/server/services/resume/template.html`
- Create: `orchestrator/src/server/services/resume/renderer.ts`

**Step 1: Create HTML template**

Create `orchestrator/src/server/services/resume/template.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Georgia', serif; font-size: 10.5pt; color: #1a1a1a; max-width: 780px; margin: 0 auto; padding: 28px 36px; }
  h1 { font-size: 20pt; font-weight: bold; letter-spacing: 0.02em; }
  .contact { font-size: 9pt; color: #444; margin-top: 4px; }
  .headline { font-size: 11pt; color: #333; margin-top: 4px; font-style: italic; }
  h2 { font-size: 10.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #999; margin: 14px 0 6px; padding-bottom: 2px; }
  .summary { font-size: 10pt; line-height: 1.5; margin-bottom: 4px; }
  .entry { margin-bottom: 8px; }
  .entry-header { display: flex; justify-content: space-between; align-items: baseline; }
  .entry-title { font-weight: bold; font-size: 10.5pt; }
  .entry-sub { font-style: italic; font-size: 10pt; color: #333; }
  .entry-date { font-size: 9.5pt; color: #555; white-space: nowrap; }
  ul { margin: 3px 0 0 16px; }
  li { font-size: 10pt; line-height: 1.45; margin-bottom: 2px; }
  .skills-grid { display: flex; flex-wrap: wrap; gap: 4px 24px; }
  .skill-group { font-size: 10pt; }
  .skill-group strong { font-weight: bold; }
  .edu-entry { margin-bottom: 6px; }
</style>
</head>
<body>

<h1>{{NAME}}</h1>
<div class="contact">{{EMAIL}} &bull; {{PHONE}} &bull; {{LOCATION}}</div>
<div class="headline">{{HEADLINE}}</div>

<h2>Summary</h2>
<p class="summary">{{SUMMARY}}</p>

<h2>Experience</h2>
{{EXPERIENCE}}

<h2>Projects</h2>
{{PROJECTS}}

<h2>Skills</h2>
<div class="skills-grid">{{SKILLS}}</div>

<h2>Education</h2>
{{EDUCATION}}

</body>
</html>
```

**Step 2: Create renderer service**

Create `orchestrator/src/server/services/resume/renderer.ts`:

```typescript
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import type { BaseResume, ApprovedDiff } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, "template.html");

export async function renderResumeToPdf(
  base: BaseResume,
  approved: ApprovedDiff,
  outputPath: string,
): Promise<void> {
  // Merge approved diffs into base
  const resume = mergeApprovedDiff(base, approved);
  const html = buildHtml(resume);

  const browser = await puppeteer.launch({
    executablePath: process.env["PUPPETEER_EXECUTABLE_PATH"] || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
}

function mergeApprovedDiff(base: BaseResume, approved: ApprovedDiff): BaseResume {
  const merged = structuredClone(base);
  if (approved.summary) merged.summary = approved.summary;
  if (approved.headline) merged.headline = approved.headline;
  if (approved.skills) merged.skills = approved.skills;
  if (approved.approvedBullets) {
    for (const exp of merged.experience) {
      for (const bullet of exp.bullets) {
        const override = approved.approvedBullets.find((b) => b.id === bullet.id);
        if (override) bullet.text = override.finalText;
      }
    }
  }
  return merged;
}

function buildHtml(resume: BaseResume): string {
  const template = readFileSync(TEMPLATE_PATH, "utf-8");

  const experience = resume.experience
    .map(
      (exp) => `
      <div class="entry">
        <div class="entry-header">
          <span class="entry-title">${exp.company}</span>
          <span class="entry-date">${exp.startDate} – ${exp.endDate || "Present"}</span>
        </div>
        <div class="entry-sub">${exp.title}</div>
        <ul>${exp.bullets.map((b) => `<li>${b.text}</li>`).join("")}</ul>
      </div>`,
    )
    .join("");

  const projects = resume.projects
    .map(
      (p) => `
      <div class="entry">
        <div class="entry-title">${p.name}</div>
        <div class="entry-sub">${p.description}</div>
        <ul>${p.bullets.map((b) => `<li>${b.text}</li>`).join("")}</ul>
      </div>`,
    )
    .join("");

  const skills = resume.skills
    .map((g) => `<div class="skill-group"><strong>${g.name}:</strong> ${g.keywords.join(", ")}</div>`)
    .join("");

  const education = resume.education
    .map(
      (e) => `
      <div class="edu-entry">
        <div class="entry-header">
          <span class="entry-title">${e.institution}</span>
          <span class="entry-date">${e.startDate} – ${e.endDate || "Present"}</span>
        </div>
        <div class="entry-sub">${e.degree} in ${e.field}</div>
      </div>`,
    )
    .join("");

  return template
    .replace("{{NAME}}", resume.name)
    .replace("{{EMAIL}}", resume.email)
    .replace("{{PHONE}}", resume.phone)
    .replace("{{LOCATION}}", resume.location)
    .replace("{{HEADLINE}}", resume.headline)
    .replace("{{SUMMARY}}", resume.summary)
    .replace("{{EXPERIENCE}}", experience)
    .replace("{{PROJECTS}}", projects)
    .replace("{{SKILLS}}", skills)
    .replace("{{EDUCATION}}", education);
}
```

**Step 3: Commit**

```bash
git add orchestrator/src/server/services/resume/renderer.ts orchestrator/src/server/services/resume/template.html
git commit -m "feat: add Puppeteer PDF renderer with HTML template"
```

---

### Task 5: Add resume import API endpoint

**Files:**
- Create: `orchestrator/src/server/api/routes/resume.ts`
- Modify: `orchestrator/src/server/api/routes/index.ts` (or wherever routes are registered)

**Step 1: Create resume routes file**

Create `orchestrator/src/server/api/routes/resume.ts`:

```typescript
import { Router } from "express";
import multer from "multer";
import { extractResumeFromPdf } from "../../services/resume/ingest";
import { getSettings, updateSettings } from "../../repositories/settings";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

// POST /api/resume/import — upload PDF, extract BaseResume JSON, save to settings
router.post("/import", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No file uploaded" });
    }
    const baseResume = await extractResumeFromPdf(req.file.buffer);
    await updateSettings({ baseResume: JSON.stringify(baseResume) });
    return res.json({ ok: true, data: baseResume });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: message });
  }
});

// GET /api/resume/base — retrieve stored BaseResume JSON
router.get("/base", async (_req, res) => {
  try {
    const settings = await getSettings();
    if (!settings.baseResume) {
      return res.status(404).json({ ok: false, error: "No base resume uploaded yet" });
    }
    return res.json({ ok: true, data: JSON.parse(settings.baseResume) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ok: false, error: message });
  }
});

export default router;
```

**Step 2: Install multer**

```bash
cd /Users/shreyamendi/job-ops/orchestrator
npm install multer
npm install --save-dev @types/multer
```

**Step 3: Register route**

Find where routes are registered (likely `orchestrator/src/server/api/index.ts` or `app.ts`). Add:

```typescript
import resumeRouter from "./routes/resume";
// ...
app.use("/api/resume", resumeRouter);
```

**Step 4: Commit**

```bash
git add orchestrator/src/server/api/routes/resume.ts orchestrator/src/server/api/
git commit -m "feat: add POST /api/resume/import endpoint for PDF ingestion"
```

---

### Task 6: Extend summary service to return diffs

**Files:**
- Modify: `orchestrator/src/server/services/summary.ts`

**Step 1: Update `generateTailoring` to include bullet diffs**

In `orchestrator/src/server/services/summary.ts`, update `TAILORING_SCHEMA` to add `bulletDiffs`:

```typescript
bulletDiffs: {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      experienceId: { type: "string" },
      original: { type: "string" },
      suggested: { type: "string" },
    },
    required: ["id", "experienceId", "original", "suggested"],
    additionalProperties: false,
  },
},
```

Add `"bulletDiffs"` to the `required` array.

**Step 2: Update `buildTailoringPrompt` to include experience bullets**

In `buildTailoringPrompt`, after the skills section add:

```typescript
const experienceSection = profile.experience
  ?.map(
    (exp: { id: string; company: string; title: string; bullets: Array<{ id: string; text: string }> }) =>
      `${exp.company} - ${exp.title}:\n${exp.bullets.map((b) => `  [${b.id}] ${b.text}`).join("\n")}`,
  )
  .join("\n\n");

if (experienceSection) {
  parts.push(`Experience:\n${experienceSection}`);
  parts.push(
    "For each bullet point, suggest an improved version tailored to this job. Keep the same ID. " +
    "Only include bullets you are improving — skip bullets that are already a perfect fit.",
  );
}
```

**Step 3: Update `TailoredData` type**

Add to the interface:

```typescript
bulletDiffs?: Array<{
  id: string;
  experienceId: string;
  original: string;
  suggested: string;
}>;
```

**Step 4: Commit**

```bash
git add orchestrator/src/server/services/summary.ts
git commit -m "feat: extend generateTailoring to return bullet diffs"
```

---

### Task 7: Replace RxResume in pdf.ts with local renderer

**Files:**
- Modify: `orchestrator/src/server/services/pdf.ts`
- Modify: `orchestrator/src/server/pipeline/orchestrator.ts`

**Step 1: Rewrite `generatePdf` in pdf.ts**

Replace the entire body of `generatePdf` in `orchestrator/src/server/services/pdf.ts`:

```typescript
import { renderResumeToPdf } from "./resume/renderer";
import { getSettings } from "../repositories/settings";
import type { BaseResume, ApprovedDiff } from "./resume/types";

export async function generatePdf(
  jobId: string,
  tailoredContent: TailoredPdfContent,
  _jobDescription: string,
  selectedProjectIds: string[],
  approvedBullets: Array<{ id: string; finalText: string }> | null,
): Promise<PdfResult> {
  try {
    const settings = await getSettings();
    if (!settings.baseResume) {
      return { success: false, error: "No base resume uploaded. Go to Settings → Resume and upload your PDF." };
    }
    const base: BaseResume = JSON.parse(settings.baseResume);

    const approved: ApprovedDiff = {
      summary: tailoredContent.summary ?? undefined,
      headline: tailoredContent.headline ?? undefined,
      skills: tailoredContent.skills ?? undefined,
      approvedBullets: approvedBullets ?? undefined,
    };

    const outputPath = getPdfPath(jobId);
    await renderResumeToPdf(base, approved, outputPath);
    return { success: true, pdfPath: outputPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
```

**Step 2: Update orchestrator.ts call site**

In `orchestrator/src/server/pipeline/orchestrator.ts`, find `generateFinalPdf` and update the call to `generatePdf` to remove RxResume args and pass `approvedBullets` from the job record.

Find:
```typescript
await generatePdf(job.id, tailoredContent, job.jobDescription ?? "", ...)
```
Replace with the new signature (remove `baseResumePath`, add `approvedBullets`).

**Step 3: Commit**

```bash
git add orchestrator/src/server/services/pdf.ts orchestrator/src/server/pipeline/orchestrator.ts
git commit -m "feat: replace RxResume PDF generation with local Puppeteer renderer"
```

---

### Task 8: Add DiffRow UI component

**Files:**
- Create: `orchestrator/src/client/components/tailoring/DiffRow.tsx`

**Step 1: Create component**

Create `orchestrator/src/client/components/tailoring/DiffRow.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface DiffRowProps {
  label: string;
  original: string;
  suggested: string;
  onAccept: (text: string) => void;
  onReject: () => void;
}

export function DiffRow({ label, original, suggested, onAccept, onReject }: DiffRowProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(suggested);

  return (
    <div className="border rounded-lg p-3 mb-3 bg-muted/30">
      <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">{label}</div>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Original</div>
          <div className="text-sm bg-background rounded p-2 border text-muted-foreground">{original}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Suggested</div>
          {editing ? (
            <Textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="text-sm min-h-[80px]"
            />
          ) : (
            <div className="text-sm bg-green-50 dark:bg-green-950 rounded p-2 border border-green-200 dark:border-green-800">
              {suggested}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        {editing ? (
          <>
            <Button size="sm" onClick={() => { onAccept(editText); setEditing(false); }}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="default" onClick={() => onAccept(suggested)}>
              Accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={onReject}>
              Reject
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add orchestrator/src/client/components/tailoring/DiffRow.tsx
git commit -m "feat: add DiffRow component for approve/edit/reject diff UI"
```

---

### Task 9: Add resume upload widget to settings page

**Files:**
- Create: `orchestrator/src/client/components/resume/ResumeUpload.tsx`
- Modify: `orchestrator/src/client/api/client.ts`
- Modify: `orchestrator/src/client/pages/settings/` (main settings page)

**Step 1: Add API client functions**

In `orchestrator/src/client/api/client.ts`, add:

```typescript
export async function importResumePdf(file: File) {
  const form = new FormData();
  form.append("resume", file);
  const res = await fetch("/api/resume/import", { method: "POST", body: form });
  return res.json();
}

export async function getBaseResume() {
  const res = await fetch("/api/resume/base");
  return res.json();
}
```

**Step 2: Create ResumeUpload component**

Create `orchestrator/src/client/components/resume/ResumeUpload.tsx`:

```tsx
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { importResumePdf, getBaseResume } from "@/api/client";
import type { BaseResume } from "@shared/types"; // add to shared types if needed

export function ResumeUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    try {
      const result = await importResumePdf(file);
      if (result.ok) {
        setResumeName((result.data as BaseResume).name);
        setStatus("done");
      } else {
        setError(result.error ?? "Upload failed");
        setStatus("error");
      }
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        Upload your resume PDF once. Claude will extract the structured data and use it for all job tailoring.
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <Button
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={status === "uploading"}
      >
        {status === "uploading" ? "Uploading..." : "Upload Resume PDF"}
      </Button>
      {status === "done" && (
        <div className="text-sm text-green-600">
          ✓ Resume loaded for {resumeName}. You can re-upload to update it.
        </div>
      )}
      {status === "error" && (
        <div className="text-sm text-red-500">{error}</div>
      )}
    </div>
  );
}
```

**Step 3: Add to settings page**

Find the settings page (likely `orchestrator/src/client/pages/settings/index.tsx` or `Settings.tsx`). Add a new "Resume" section:

```tsx
import { ResumeUpload } from "@/components/resume/ResumeUpload";

// In the JSX, add a new section (alongside or replacing the RxResume section):
<section>
  <h2 className="text-lg font-semibold mb-3">Resume</h2>
  <ResumeUpload />
</section>
```

**Step 4: Commit**

```bash
git add orchestrator/src/client/components/resume/ResumeUpload.tsx orchestrator/src/client/api/client.ts orchestrator/src/client/pages/settings/
git commit -m "feat: add resume upload widget to settings page"
```

---

### Task 10: Delete RxResume service files

**Files:**
- Delete: `orchestrator/src/server/services/rxresume/` (entire folder)

**Step 1: Remove rxresume folder**

```bash
cd /Users/shreyamendi/job-ops
rm -rf orchestrator/src/server/services/rxresume/
```

**Step 2: Fix any import errors**

Run TypeScript check:

```bash
cd orchestrator
npx tsc --noEmit 2>&1 | grep "rxresume"
```

Fix any remaining import references to rxresume in other files.

**Step 3: Remove RxResume settings from settings schema and UI**

In `orchestrator/src/server/db/schema.ts`, remove (or leave as nullable unused) the RxResume columns. Leaving them nullable is fine — no migration needed.

In the settings page UI, remove the RxResume credentials section.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: remove RxResume service — replaced by local Puppeteer renderer"
```

---

### Task 11: Rebuild Docker container and verify end-to-end

**Step 1: Rebuild container**

```bash
cd /Users/shreyamendi/job-ops
docker compose build
docker compose up -d
```

**Step 2: Smoke test**

1. Open http://localhost:3005
2. Go to Settings → Resume → upload a PDF
3. Verify response returns parsed resume JSON
4. Pick a discovered job → click Tailor
5. Verify diffs appear in TailoringWorkspace
6. Accept/edit a few diffs
7. Click Generate PDF
8. Verify PDF downloads / appears in job record

**Step 3: Commit any fixes found during smoke test**

```bash
git add -A
git commit -m "fix: post-integration smoke test fixes"
```

---

## Notes

- `getLlmService()` — check the exact export name in `orchestrator/src/server/services/llm/index.ts`
- Settings repository — check exact function names in `orchestrator/src/server/repositories/settings.ts`
- Route registration — find the exact file that calls `app.use()` for routes
- Shared types path — `@shared/types` may need `BaseResume` added
- Multer may already be installed; check `package.json` before installing
