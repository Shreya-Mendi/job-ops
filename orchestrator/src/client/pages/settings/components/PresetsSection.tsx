import {
  EXTRACTOR_SOURCE_METADATA,
  PIPELINE_EXTRACTOR_SOURCE_IDS,
  sourceLabel,
} from "@shared/extractors";
import type { ExtractorSourceId } from "@shared/extractors";
import {
  formatCountryLabel,
  normalizeCountryKey,
  SUPPORTED_COUNTRY_KEYS,
} from "@shared/location-support.js";
import type { PipelinePreset, PipelinePresetInput } from "@shared/types";
import { Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableDropdown } from "@/components/ui/searchable-dropdown";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const JOB_TYPE_OPTIONS = [
  { value: "", label: "Any type" },
  { value: "internship", label: "Internship" },
  { value: "co-op", label: "Co-op" },
  { value: "full-time", label: "Full-time" },
];

const JOB_TYPE_LABELS: Record<string, string> = {
  internship: "Internship",
  "co-op": "Co-op",
  "full-time": "Full-time",
};

const HIDDEN_COUNTRY_KEYS = new Set(["usa/ca"]);

function normalizeUiCountryKey(value: string): string {
  const normalized = normalizeCountryKey(value);
  if (normalized === "usa/ca") return "united states";
  return normalized;
}

const DEFAULT_SOURCES: ExtractorSourceId[] = ["indeed", "linkedin", "glassdoor", "jobright"];

const ORDERED_PIPELINE_SOURCES = [...PIPELINE_EXTRACTOR_SOURCE_IDS].sort(
  (a, b) => EXTRACTOR_SOURCE_METADATA[a].order - EXTRACTOR_SOURCE_METADATA[b].order,
);

type FormState = {
  name: string;
  jobType: string;
  country: string;
  cityLocations: string; // comma-separated
  searchTerms: string; // one per line
  topN: string;
  minSuitabilityScore: string;
  runBudget: string;
  sources: ExtractorSourceId[];
  scheduleEnabled: boolean;
  scheduleHours: string; // comma-separated UTC hours e.g. "9, 21"
};

const DEFAULT_FORM: FormState = {
  name: "",
  jobType: "",
  country: "united states",
  cityLocations: "",
  searchTerms:
    "software engineer intern\nmachine learning intern\ndata science intern",
  topN: "10",
  minSuitabilityScore: "50",
  runBudget: "500",
  sources: DEFAULT_SOURCES,
  scheduleEnabled: false,
  scheduleHours: "9, 21",
};

function presetToForm(preset: PipelinePreset): FormState {
  return {
    name: preset.name,
    jobType: preset.jobType ?? "",
    country: preset.country,
    cityLocations: preset.cityLocations.join(", "),
    searchTerms: preset.searchTerms.join("\n"),
    topN: String(preset.topN),
    minSuitabilityScore: String(preset.minSuitabilityScore),
    runBudget: String(preset.runBudget),
    sources: preset.sources?.length ? preset.sources : DEFAULT_SOURCES,
    scheduleEnabled: preset.scheduleEnabled,
    scheduleHours: preset.scheduleHours.join(", "),
  };
}

function parseFormToInput(form: FormState): PipelinePresetInput {
  const searchTerms = form.searchTerms
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const cityLocations = form.cityLocations
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const scheduleHours = form.scheduleHours
    .split(",")
    .map((h) => Number.parseInt(h.trim(), 10))
    .filter((h) => !Number.isNaN(h) && h >= 0 && h <= 23);

  return {
    name: form.name.trim(),
    jobType: (form.jobType || null) as PipelinePreset["jobType"],
    country: normalizeUiCountryKey(form.country) || "united states",
    cityLocations,
    searchTerms,
    topN: Math.max(1, Math.min(50, Number.parseInt(form.topN, 10) || 10)),
    minSuitabilityScore: Math.max(
      0,
      Math.min(100, Number.parseInt(form.minSuitabilityScore, 10) || 50),
    ),
    runBudget: Math.max(
      1,
      Math.min(1000, Number.parseInt(form.runBudget, 10) || 500),
    ),
    sources: form.sources.length ? form.sources : DEFAULT_SOURCES,
    scheduleEnabled: form.scheduleEnabled,
    scheduleHours,
  };
}

function PresetForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial: FormState;
  onSave: (input: PipelinePresetInput) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);

  const countryOptions = useMemo(
    () =>
      SUPPORTED_COUNTRY_KEYS.filter((c) => !HIDDEN_COUNTRY_KEYS.has(c)).map(
        (c) => ({ value: c, label: formatCountryLabel(c) }),
      ),
    [],
  );

  const set = (key: keyof FormState, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Preset name is required.");
      return;
    }
    const terms = form.searchTerms
      .split(/[\n,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length === 0) {
      toast.error("At least one search term is required.");
      return;
    }
    await onSave(parseFormToInput(form));
  };

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Preset name *</Label>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Internships – RTP"
            disabled={isSaving}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Job type</Label>
          <select
            value={form.jobType}
            onChange={(e) => set("jobType", e.target.value)}
            disabled={isSaving}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {JOB_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Search terms (one per line or comma-separated) *</Label>
        <Textarea
          value={form.searchTerms}
          onChange={(e) => set("searchTerms", e.target.value)}
          placeholder="software engineer intern&#10;machine learning intern"
          className="min-h-[80px] font-mono text-xs resize-y"
          disabled={isSaving}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Sources</Label>
        <div className="flex flex-wrap gap-1.5">
          {ORDERED_PIPELINE_SOURCES.map((src) => {
            const active = form.sources.includes(src);
            return (
              <button
                key={src}
                type="button"
                disabled={isSaving}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    sources: active
                      ? f.sources.filter((s) => s !== src)
                      : [...f.sources, src],
                  }))
                }
                className={`rounded px-2 py-1 text-xs font-medium border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-foreground/30"
                }`}
              >
                {sourceLabel(src)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Country</Label>
          <SearchableDropdown
            value={form.country}
            options={countryOptions}
            onValueChange={(v) => set("country", v)}
            placeholder="Select country"
            searchPlaceholder="Search..."
            emptyText="No matches"
            triggerClassName="h-9 w-full"
            ariaLabel={formatCountryLabel(form.country)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Cities (comma-separated, optional)</Label>
          <Input
            value={form.cityLocations}
            onChange={(e) => set("cityLocations", e.target.value)}
            placeholder="Raleigh, Durham, Chapel Hill"
            disabled={isSaving}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Resumes tailored</Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={form.topN}
            onChange={(e) => set("topN", e.target.value)}
            disabled={isSaving}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Min score (0–100)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={form.minSuitabilityScore}
            onChange={(e) => set("minSuitabilityScore", e.target.value)}
            disabled={isSaving}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Max jobs discovered</Label>
          <Input
            type="number"
            min={1}
            max={1000}
            value={form.runBudget}
            onChange={(e) => set("runBudget", e.target.value)}
            disabled={isSaving}
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Switch
            id="schedule-enabled"
            checked={form.scheduleEnabled}
            onCheckedChange={(v) => set("scheduleEnabled", v)}
            disabled={isSaving}
          />
          <Label htmlFor="schedule-enabled" className="text-xs cursor-pointer">
            Auto-schedule
          </Label>
        </div>
        {form.scheduleEnabled && (
          <div className="space-y-1.5">
            <Label className="text-xs">
              Run at these UTC hours (comma-separated, 0–23)
            </Label>
            <Input
              value={form.scheduleHours}
              onChange={(e) => set("scheduleHours", e.target.value)}
              placeholder="9, 21"
              disabled={isSaving}
            />
            <p className="text-muted-foreground text-xs">
              e.g. "9, 21" runs at 9 AM and 9 PM UTC (twice daily).
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={() => void handleSubmit()} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Save preset
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PresetCard({
  preset,
  onEdit,
  onDelete,
  onRun,
  isRunning,
}: {
  preset: PipelinePreset;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  return (
    <div className="flex items-start justify-between rounded-lg border border-border px-4 py-3 gap-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{preset.name}</span>
          {preset.jobType && (
            <Badge variant="secondary" className="text-xs shrink-0">
              {JOB_TYPE_LABELS[preset.jobType]}
            </Badge>
          )}
          {preset.scheduleEnabled && preset.scheduleHours.length > 0 && (
            <Badge variant="outline" className="text-xs shrink-0">
              ⏰ {preset.scheduleHours.map((h) => `${h}:00`).join(", ")} UTC
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-xs truncate">
          {formatCountryLabel(preset.country)}
          {preset.cityLocations.length > 0 &&
            ` · ${preset.cityLocations.slice(0, 3).join(", ")}${preset.cityLocations.length > 3 ? "…" : ""}`}
          {" · "}
          {preset.searchTerms.slice(0, 2).join(", ")}
          {preset.searchTerms.length > 2 &&
            ` +${preset.searchTerms.length - 2} more`}
        </p>
        {preset.sources?.length > 0 && (
          <p className="text-muted-foreground/60 text-xs truncate">
            {preset.sources.map(sourceLabel).join(", ")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Run now"
          disabled={isRunning}
          onClick={onRun}
        >
          {isRunning ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Edit"
          onClick={onEdit}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive hover:text-destructive"
          title="Delete"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function PresetsSection() {
  const [presets, setPresets] = useState<PipelinePreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const fetchPresets = async () => {
    try {
      const res = await fetch("/api/presets");
      const json = await res.json();
      if (json?.data) setPresets(json.data as PipelinePreset[]);
    } catch {
      // silently ignore
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchPresets();
  }, []);

  const handleCreate = async (input: PipelinePresetInput) => {
    setIsSaving(true);
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create preset");
      setPresets((prev) => [...prev, json.data as PipelinePreset]);
      setShowForm(false);
      toast.success(`Preset "${input.name}" created.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create preset");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (id: string, input: PipelinePresetInput) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/presets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to update preset");
      setPresets((prev) =>
        prev.map((p) => (p.id === id ? (json.data as PipelinePreset) : p)),
      );
      setEditingId(null);
      toast.success(`Preset "${input.name}" updated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update preset");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (preset: PipelinePreset) => {
    if (!confirm(`Delete preset "${preset.name}"?`)) return;
    try {
      const res = await fetch(`/api/presets/${preset.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setPresets((prev) => prev.filter((p) => p.id !== preset.id));
      toast.success(`Preset "${preset.name}" deleted.`);
    } catch {
      toast.error("Failed to delete preset");
    }
  };

  const handleRun = async (preset: PipelinePreset) => {
    setRunningId(preset.id);
    try {
      const res = await fetch(`/api/presets/${preset.id}/run`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to start pipeline");
      toast.success(`Pipeline started with preset "${preset.name}".`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run preset");
    } finally {
      setRunningId(null);
    }
  };

  return (
    <AccordionItem value="presets" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline py-4">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">Pipeline Presets</span>
          {presets.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {presets.length}
            </Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs">
            Save named pipeline configurations for different job searches. Each
            preset can be run manually or scheduled to run automatically at set
            times.
          </p>

          {isLoading ? (
            <p className="text-muted-foreground text-xs">Loading…</p>
          ) : presets.length === 0 && !showForm ? (
            <p className="text-muted-foreground text-xs italic">
              No presets yet. Create one to save a search configuration.
            </p>
          ) : (
            <div className="space-y-2">
              {presets.map((preset) =>
                editingId === preset.id ? (
                  <PresetForm
                    key={preset.id}
                    initial={presetToForm(preset)}
                    onSave={(input) => handleUpdate(preset.id, input)}
                    onCancel={() => setEditingId(null)}
                    isSaving={isSaving}
                  />
                ) : (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    onEdit={() => {
                      setShowForm(false);
                      setEditingId(preset.id);
                    }}
                    onDelete={() => void handleDelete(preset)}
                    onRun={() => void handleRun(preset)}
                    isRunning={runningId === preset.id}
                  />
                ),
              )}
            </div>
          )}

          {showForm && (
            <PresetForm
              initial={DEFAULT_FORM}
              onSave={handleCreate}
              onCancel={() => setShowForm(false)}
              isSaving={isSaving}
            />
          )}

          {!showForm && editingId === null && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setShowForm(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add preset
            </Button>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
