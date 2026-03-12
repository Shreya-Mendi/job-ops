# Custom Resume Optimizer — Design Doc
**Date:** 2026-03-12

## Problem
The current PDF generation step requires RxResume (an external service). The user wants to replace it with a self-contained optimizer: upload their own resume PDF, have Claude suggest tailored diffs per job, approve each change, and generate a clean PDF — no external dependencies.

## Decision
**Option A: Replace RxResume entirely inside job-ops.**
- Parse user's PDF resume once into structured JSON via Claude
- Store as `baseResume` in settings DB
- Claude produces per-field diffs (not just text blobs) for each job
- User approves/edits/rejects each diff in the existing TailoringWorkspace UI
- Puppeteer renders an owned HTML template → PDF
- Delete all `services/rxresume/` code

---

## Architecture

### One-Time Setup Flow
```
Upload resume PDF → POST /api/resume/import
  → Claude extracts structured JSON (name, headline, summary, skills[], experience[], projects[])
  → Stored as baseResume in settings DB
```

### Per-Job Tailoring Flow
```
POST /api/jobs/:id/summarize
  → Claude reads job description + baseResume
  → Returns diffs: { summary, headline, skills[], bullets: [{id, original, suggested}] }
  → Stored on job record

TailoringWorkspace UI
  → Shows DiffRow per field: Original | Suggested | [Accept] [Edit] [Reject]
  → PATCH /api/jobs/:id saves approved content

POST /api/jobs/:id/generate-pdf
  → Merges baseResume + approved diffs → final resume JSON
  → Puppeteer renders HTML template → PDF
  → Saves to /data/pdfs/resume_{jobId}.pdf
```

---

## Components

### New Server Files
| File | Purpose |
|------|---------|
| `services/resume/ingest.ts` | PDF → Claude → structured JSON |
| `services/resume/renderer.ts` | resume JSON + HTML template → Puppeteer PDF |
| `services/resume/template.html` | ATS-friendly HTML resume template |
| `api/routes/resume.ts` | `POST /api/resume/import` endpoint |

### Modified Server Files
| File | Change |
|------|--------|
| `services/summary.ts` | Return per-field diffs instead of text blobs |
| `services/pdf.ts` | Replace RxResume calls with `renderer.ts` |
| `services/rxresume/` | **Delete entire folder** |

### New Client Files
| File | Purpose |
|------|---------|
| `components/tailoring/DiffRow.tsx` | Single row: Original \| Suggested \| Accept/Edit/Reject |
| `components/resume/ResumeUpload.tsx` | Settings page upload widget |

### Modified Client Files
| File | Change |
|------|--------|
| `TailoringWorkspace.tsx` | Render `DiffRow` per field |
| `pages/settings/` | Add Resume section, remove RxResume section |

### DB Changes
- Add `tailoredBullets` column to jobs table — JSON array of `{id, accepted: bool, finalText: string}`

---

## What Gets Deleted
- `services/rxresume/` — entire folder (index.ts, tailoring.ts, schema/v4.ts, schema/v5.ts)
- RxResume settings fields: `rxresumeMode`, `rxresumeEmail`, `rxresumePassword`, `rxresumeApiKey`, `rxresumeBaseResumeId`
- RxResume UI section in settings page
