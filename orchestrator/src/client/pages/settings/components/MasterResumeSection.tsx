import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface MasterResumeSectionProps {
  /** Whether the settings form is loading */
  isLoading?: boolean;
}

interface MasterResumeStatus {
  exists: boolean;
  text: string;
}

export function MasterResumeSection({ isLoading }: MasterResumeSectionProps) {
  const [status, setStatus] = useState<MasterResumeStatus | null>(null);
  const [text, setText] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isLoading) return;
    setIsFetching(true);
    fetch("/api/profile/master-resume")
      .then((r) => r.json())
      .then((json) => {
        if (json?.data) {
          setStatus(json.data);
          setText(json.data.text || "");
        }
      })
      .catch(() => {
        // silently ignore
      })
      .finally(() => setIsFetching(false));
  }, [isLoading]);

  async function handleSave() {
    if (!text.trim() || text.trim().length < 50) {
      toast.error("Resume text must be at least 50 characters.");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/profile/master-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json?.data?.saved) {
        throw new Error(json?.error || "Save failed");
      }
      setStatus({ exists: true, text: text.trim() });
      setIsEditing(false);
      toast.success("Master resume saved. Pipeline will use it from now on.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save resume");
    } finally {
      setIsSaving(false);
    }
  }

  function handleEdit() {
    setIsEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function handleCancel() {
    setText(status?.text || "");
    setIsEditing(false);
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Master Resume</h3>
        <p className="text-muted-foreground text-xs mt-0.5">
          Paste your full resume as plain text. The pipeline will use this to
          generate tailored resume PDFs and cover letters — no Reactive Resume
          needed.
        </p>
      </div>

      {isFetching ? (
        <p className="text-muted-foreground text-xs">Loading…</p>
      ) : status?.exists && !isEditing ? (
        <div className="flex items-center gap-3">
          <span className="text-xs text-green-600 font-medium">
            ✓ Master resume uploaded ({status.text.length.toLocaleString()} chars)
          </span>
          <Button variant="outline" size="sm" onClick={handleEdit}>
            Replace
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="master-resume-text" className="text-xs">
            Resume text
          </Label>
          <Textarea
            id="master-resume-text"
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your full resume here (work experience, education, skills, projects…)"
            className="min-h-[220px] font-mono text-xs resize-y"
            disabled={isSaving}
          />
          <p className="text-muted-foreground text-xs">
            {text.length.toLocaleString()} characters
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || text.trim().length < 50}
            >
              {isSaving ? "Saving…" : "Save resume"}
            </Button>
            {status?.exists && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                disabled={isSaving}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
