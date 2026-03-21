import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface SourceResumePdfStatus {
  exists: boolean;
  chars: number;
}

export function SourceResumeSection() {
  const [status, setStatus] = useState<SourceResumePdfStatus | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsFetching(true);
    fetch("/api/settings/source-resume-pdf/status")
      .then((r) => r.json())
      .then((json) => {
        if (json?.data) {
          setStatus(json.data);
        }
      })
      .catch(() => {
        // silently ignore
      })
      .finally(() => setIsFetching(false));
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".pdf") && file.type !== "application/pdf") {
      toast.error("Only PDF files are accepted.");
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/settings/source-resume-pdf", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (!res.ok || !json?.data?.chars) {
        throw new Error(json?.error || "Upload failed");
      }

      setStatus({ exists: true, chars: json.data.chars });
      toast.success(`Source resume PDF uploaded (${json.data.chars.toLocaleString()} chars extracted).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload PDF");
    } finally {
      setIsUploading(false);
      // Reset file input so the same file can be re-uploaded if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Source Resume PDF (Template)</h3>
        <p className="text-muted-foreground text-xs mt-0.5">
          Upload your resume PDF once. It will be used as the exact template for
          all generated resumes. Takes priority over the master resume text above.
        </p>
      </div>

      {isFetching ? (
        <p className="text-muted-foreground text-xs">Loading…</p>
      ) : status?.exists ? (
        <div className="flex items-center gap-3">
          <span className="text-xs text-green-600 font-medium">
            ✓ Resume PDF loaded ({status.chars.toLocaleString()} chars)
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? "Uploading…" : "Replace"}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs">Not uploaded yet</span>
          <Button
            variant="outline"
            size="sm"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? "Uploading…" : "Upload PDF"}
          </Button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
