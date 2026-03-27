#!/usr/bin/env tsx
/**
 * update-master-resume.ts
 *
 * Scrapes your GitHub repos + contributions and prints a suggested
 * update for the MASTER.projects array in resume-pdf.ts.
 *
 * Usage:
 *   npx tsx scripts/update-master-resume.ts --token=ghp_xxxx   # recommended — needed for contribution search
 *   npx tsx scripts/update-master-resume.ts                     # public repos only, limited contribution scan
 *
 * To get a token: github.com → Settings → Developer settings → Personal access tokens → Fine-grained
 * Permissions needed: read:user, read:repo (public repos only is fine)
 *
 * The script ONLY prints suggestions — it never auto-edits resume-pdf.ts.
 * Review the output and paste what you want into MASTER.projects manually.
 */

import { execSync } from "node:child_process";

const GITHUB_USERNAME = "Shreya-Mendi";
const PINNED_REPOS = [
  "QuietSky",
  "Tradecraft",
  "When2Speak",
  "UAV-SAR",
  "AI-Audit",
  "Alba",
  "Inflationship",
  "Wordle-XAI-Bot",
  "supreme-court-ml",
  "sourcing-happiness",
  "BMW-Capstone",
];

// Pull --token from CLI args if provided
const tokenArg = process.argv.find((a) => a.startsWith("--token="));
const TOKEN = tokenArg ? tokenArg.split("=")[1] : process.env.GITHUB_TOKEN ?? "";

const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function gh(path: string) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status} for ${path}: ${text}`);
  }
  return res.json();
}

async function getReadme(repo: string): Promise<string> {
  try {
    const data = await gh(`/repos/${GITHUB_USERNAME}/${repo}/readme`) as { content?: string };
    if (!data.content) return "";
    return Buffer.from(data.content, "base64").toString("utf-8").slice(0, 2000);
  } catch {
    return "";
  }
}

async function getLanguages(repo: string): Promise<string[]> {
  try {
    const data = await gh(`/repos/${GITHUB_USERNAME}/${repo}/languages`) as Record<string, number>;
    return Object.keys(data).slice(0, 5);
  } catch {
    return [];
  }
}

interface RepoInfo {
  name: string;
  description: string | null;
  html_url: string;
  pushed_at: string;
  fork: boolean;
  topics: string[];
}

async function getAllRepos(): Promise<RepoInfo[]> {
  const repos: RepoInfo[] = [];
  let page = 1;
  while (true) {
    const batch = await gh(
      `/users/${GITHUB_USERNAME}/repos?per_page=100&page=${page}&sort=pushed`,
    ) as RepoInfo[];
    if (!batch.length) break;
    repos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

async function getContributedRepos(): Promise<RepoInfo[]> {
  const repoNames = new Set<string>();

  // 1. Commits search API — finds all repos with commits authored by user
  //    Requires a token for best results (unauthenticated has low rate limits)
  try {
    const search = await gh(
      `/search/commits?q=author:${GITHUB_USERNAME}&per_page=100&sort=author-date`,
    ) as { items: Array<{ repository: { full_name: string } }> };
    for (const item of search.items ?? []) {
      const fullName = item.repository.full_name;
      if (!fullName.startsWith(`${GITHUB_USERNAME}/`)) {
        repoNames.add(fullName);
      }
    }
  } catch (e) {
    console.warn("⚠️  Commits search failed (needs token for full results):", (e as Error).message);
  }

  // 2. Events API — catches recent push events not in commits search
  try {
    const events = await gh(`/users/${GITHUB_USERNAME}/events/public?per_page=100`) as Array<{
      type: string;
      repo: { name: string };
    }>;
    for (const e of events) {
      if (e.type === "PushEvent" && !e.repo.name.startsWith(`${GITHUB_USERNAME}/`)) {
        repoNames.add(e.repo.name);
      }
    }
  } catch {
    // ignore
  }

  // 3. Fetch full repo metadata for each unique contributed repo
  const results: RepoInfo[] = [];
  for (const fullName of repoNames) {
    try {
      const repo = await gh(`/repos/${fullName}`) as RepoInfo;
      results.push(repo);
    } catch {
      // skip inaccessible / deleted repos
    }
  }
  return results;
}

function extractBullets(readme: string, repoName: string): string[] {
  // Pull the first 2 meaningful sentences from the README as bullet starters
  const clean = readme
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n+/g, " ")
    .trim();

  const sentences = clean.match(/[^.!?]+[.!?]/g) ?? [];
  const meaningful = sentences
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 200)
    .slice(0, 2);

  if (meaningful.length === 0) {
    return [`[ADD BULLET — describe what ${repoName} does and its impact]`];
  }
  return meaningful.length === 1
    ? [...meaningful, `[ADD SECOND BULLET — tech stack / results for ${repoName}]`]
    : meaningful;
}

// ─── KNOWN PROJECTS already in MASTER (skip re-adding) ───────────────────────
const ALREADY_IN_MASTER = new Set([
  "when2speak",
  "uav-sar",
  "bmw-capstone",
  "inflationship",
  "ai-audit",
  "alba",
  "wordle-xai-bot",
  "supreme-court",
  "sourcing-happiness",
  "quietsky",
  "tradecraft",
]);

async function main() {
  console.log("🔍 Fetching GitHub repos for", GITHUB_USERNAME, "...\n");

  const [ownRepos, contributedRepos] = await Promise.all([
    getAllRepos(),
    getContributedRepos(),
  ]);

  console.log(`Found ${ownRepos.length} own repos, ${contributedRepos.length} contributed repos.\n`);

  const allRepos = [
    ...ownRepos.filter((r) => !r.fork), // exclude your own forks of others' work
    ...contributedRepos,                 // always include repos you contributed to
  ];

  const newRepos = allRepos.filter(
    (r) => !ALREADY_IN_MASTER.has(r.name.toLowerCase().replace(/[-_\s]/g, "")),
  );

  if (newRepos.length === 0) {
    console.log("✅ No new repos found — your MASTER.projects is already up to date.\n");
    console.log("Current repos in MASTER:");
    for (const name of ALREADY_IN_MASTER) console.log(" •", name);
    return;
  }

  console.log(`📦 ${newRepos.length} new repo(s) found:\n`);
  console.log("─".repeat(70));
  console.log("Copy the entries you want into MASTER.projects in resume-pdf.ts");
  console.log("─".repeat(70), "\n");

  for (const repo of newRepos) {
    const [readme, languages] = await Promise.all([
      getReadme(repo.name),
      getLanguages(repo.name),
    ]);

    const bullets = extractBullets(readme, repo.name);
    const tech = [
      ...languages,
      ...(repo.topics ?? []).map((t) => t.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")),
    ].slice(0, 5).join(" · ") || "TODO";

    const isContrib = contributedRepos.some((r) => r.name === repo.name);
    const label = isContrib ? " [CONTRIBUTION]" : "";

    console.log(`// ${repo.html_url}${label}`);
    console.log(`{`);
    console.log(`  key: "${repo.name}",`);
    console.log(`  name: "${repo.name}",`);
    console.log(`  subtitle: "${repo.description ?? "TODO — add subtitle"}",`);
    console.log(`  tech: "${tech}",`);
    console.log(`  date: "${new Date(repo.pushed_at).getFullYear()}",`);
    console.log(`  bullets: [`);
    for (const b of bullets) {
      console.log(`    "${b.replace(/"/g, '\\"')}",`);
    }
    console.log(`  ],`);
    console.log(`},\n`);
  }

  console.log("─".repeat(70));
  console.log("After updating resume-pdf.ts, restart the server with ./start.sh");
  console.log("─".repeat(70));
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
