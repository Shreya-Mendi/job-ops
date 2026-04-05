import * as api from "@client/api";
import { useDemoInfo } from "@client/hooks/useDemoInfo";
import { useSettings } from "@client/hooks/useSettings";
import { SettingsInput } from "@client/pages/settings/components/SettingsInput";
import {
  getLlmProviderConfig,
  LLM_PROVIDER_LABELS,
  LLM_PROVIDERS,
  normalizeLlmProvider,
} from "@client/pages/settings/utils";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type { ValidationResult } from "@shared/types.js";
import { Check } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ValidationState = ValidationResult & { checked: boolean };

type OnboardingFormData = {
  llmProvider: string;
  llmBaseUrl: string;
  llmApiKey: string;
};

const EMPTY_VALIDATION_STATE: ValidationState = {
  valid: false,
  message: null,
  checked: false,
};

function getStepPrimaryLabel(input: {
  currentStep: string | null;
  llmValidated: boolean;
  resumeValidated: boolean;
}): string {
  const toLabel = (isValidated: boolean): string =>
    isValidated ? "Revalidate" : "Validate";

  if (input.currentStep === "llm") return toLabel(input.llmValidated);
  if (input.currentStep === "resume") return toLabel(input.resumeValidated);
  return "Validate";
}

export const OnboardingGate: React.FC = () => {
  const {
    settings,
    isLoading: settingsLoading,
    refreshSettings,
  } = useSettings();

  const [isSavingEnv, setIsSavingEnv] = useState(false);
  const [isValidatingLlm, setIsValidatingLlm] = useState(false);
  const [isValidatingResume, setIsValidatingResume] = useState(false);
  const [llmValidation, setLlmValidation] = useState<ValidationState>(
    EMPTY_VALIDATION_STATE,
  );
  const [resumeValidation, setResumeValidation] = useState<ValidationState>(
    EMPTY_VALIDATION_STATE,
  );
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const demoInfo = useDemoInfo();
  const demoMode = demoInfo?.demoMode ?? false;

  // Master resume inline state
  const [masterResumeText, setMasterResumeText] = useState("");
  const [masterResumeExists, setMasterResumeExists] = useState(false);
  const [isSavingResume, setIsSavingResume] = useState(false);
  const [isFetchingResume, setIsFetchingResume] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { control, watch, getValues, reset, setValue } =
    useForm<OnboardingFormData>({
      defaultValues: {
        llmProvider: "",
        llmBaseUrl: "",
        llmApiKey: "",
      },
    });

  const llmProvider = watch("llmProvider");

  const selectedProvider = normalizeLlmProvider(
    llmProvider || settings?.llmProvider?.value || "openrouter",
  );
  const providerConfig = getLlmProviderConfig(selectedProvider);
  const {
    normalizedProvider,
    showApiKey,
    showBaseUrl,
    requiresApiKey: requiresLlmKey,
  } = providerConfig;

  const llmKeyHint = settings?.llmApiKeyHint ?? null;
  const hasLlmKey = Boolean(llmKeyHint);

  const validateLlm = useCallback(async () => {
    const values = getValues();
    const provCfg = getLlmProviderConfig(
      normalizeLlmProvider(values.llmProvider || settings?.llmProvider?.value || "openrouter"),
    );

    setIsValidatingLlm(true);
    try {
      const result = await api.validateLlm({
        provider: normalizeLlmProvider(values.llmProvider || settings?.llmProvider?.value || "openrouter"),
        baseUrl: provCfg.showBaseUrl ? values.llmBaseUrl.trim() || undefined : undefined,
        apiKey: provCfg.requiresApiKey ? values.llmApiKey.trim() || undefined : undefined,
      });
      setLlmValidation({ ...result, checked: true });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "LLM validation failed";
      const result = { valid: false, message };
      setLlmValidation({ ...result, checked: true });
      return result;
    } finally {
      setIsValidatingLlm(false);
    }
  }, [getValues, settings?.llmProvider]);

  const validateResume = useCallback(async () => {
    setIsValidatingResume(true);
    try {
      const result = await api.validateResumeConfig();
      setResumeValidation({ ...result, checked: true });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Resume validation failed";
      const result = { valid: false, message };
      setResumeValidation({ ...result, checked: true });
      return result;
    } finally {
      setIsValidatingResume(false);
    }
  }, []);

  const llmValidated = requiresLlmKey ? llmValidation.valid : true;
  const hasCheckedValidations =
    (requiresLlmKey ? llmValidation.checked : true) && resumeValidation.checked;
  const shouldOpen =
    !demoMode &&
    Boolean(settings && !settingsLoading) &&
    hasCheckedValidations &&
    !(llmValidated && resumeValidation.valid);

  // Initialize form from settings
  useEffect(() => {
    if (settings) {
      reset({
        llmProvider: settings.llmProvider?.value || "",
        llmBaseUrl: settings.llmBaseUrl?.value || "",
        llmApiKey: "",
      });
    }
  }, [settings, reset]);

  // Clear base URL when provider doesn't require it
  useEffect(() => {
    if (!showBaseUrl) {
      setValue("llmBaseUrl", "");
    }
  }, [showBaseUrl, setValue]);

  // Reset LLM validation when provider changes
  useEffect(() => {
    if (!selectedProvider) return;
    setLlmValidation({ valid: false, message: null, checked: false });
  }, [selectedProvider]);

  // Fetch master resume status when resume step is shown
  useEffect(() => {
    if (!shouldOpen) return;
    setIsFetchingResume(true);
    fetch("/api/profile/master-resume")
      .then((r) => r.json())
      .then((json) => {
        if (json?.data) {
          setMasterResumeExists(json.data.exists);
          setMasterResumeText(json.data.text || "");
        }
      })
      .catch(() => {})
      .finally(() => setIsFetchingResume(false));
  }, [shouldOpen]);

  const steps = useMemo(
    () => [
      {
        id: "llm",
        label: "LLM Provider",
        subtitle: "Provider + credentials",
        complete: llmValidated,
        disabled: false,
      },
      {
        id: "resume",
        label: "Upload Resume",
        subtitle: "Paste your resume text",
        complete: resumeValidation.valid,
        disabled: false,
      },
    ],
    [llmValidated, resumeValidation.valid],
  );

  const defaultStep = steps.find((step) => !step.complete)?.id ?? steps[0]?.id;

  useEffect(() => {
    if (!shouldOpen) return;
    if (!currentStep && defaultStep) {
      setCurrentStep(defaultStep);
    }
  }, [currentStep, defaultStep, shouldOpen]);

  const runAllValidations = useCallback(async () => {
    if (!settings) return;
    const promises: Promise<ValidationResult>[] = [];
    if (requiresLlmKey) {
      promises.push(validateLlm());
    } else {
      setLlmValidation({ valid: true, message: null, checked: true });
    }
    promises.push(validateResume());
    const results = await Promise.allSettled(promises);
    const failed = results.find((r) => r.status === "rejected");
    if (failed && failed.status === "rejected") {
      const message = failed.reason instanceof Error ? failed.reason.message : "Validation failed";
      toast.error(message);
    }
  }, [settings, requiresLlmKey, validateLlm, validateResume]);

  // Run validations on mount
  useEffect(() => {
    if (demoMode) return;
    if (!settings || settingsLoading) return;
    const needsValidation =
      (requiresLlmKey ? !llmValidation.checked : false) || !resumeValidation.checked;
    if (!needsValidation) return;
    void runAllValidations();
  }, [
    settings,
    settingsLoading,
    requiresLlmKey,
    llmValidation.checked,
    resumeValidation.checked,
    runAllValidations,
    demoMode,
  ]);

  const handleSaveLlm = async (): Promise<boolean> => {
    const values = getValues();
    const apiKeyValue = values.llmApiKey.trim();
    const baseUrlValue = values.llmBaseUrl.trim();

    if (requiresLlmKey && !apiKeyValue && !hasLlmKey) {
      toast.info("Add your LLM API key to continue");
      return false;
    }

    try {
      const validation = requiresLlmKey
        ? await validateLlm()
        : { valid: true, message: null };

      if (!validation.valid) {
        toast.error(validation.message || "LLM validation failed");
        return false;
      }

      const update: Partial<UpdateSettingsInput> = {
        llmProvider: normalizedProvider,
        llmBaseUrl: showBaseUrl ? baseUrlValue || null : null,
      };

      if (showApiKey && apiKeyValue) {
        update.llmApiKey = apiKeyValue;
      }

      setIsSavingEnv(true);
      await api.updateSettings(update);
      await refreshSettings();
      setValue("llmApiKey", "");
      toast.success("LLM provider connected");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save LLM settings";
      toast.error(message);
      return false;
    } finally {
      setIsSavingEnv(false);
    }
  };

  const handleSaveMasterResume = async (): Promise<boolean> => {
    const trimmed = masterResumeText.trim();
    if (!trimmed || trimmed.length < 50) {
      toast.error("Resume text must be at least 50 characters.");
      return false;
    }
    setIsSavingResume(true);
    try {
      const res = await fetch("/api/profile/master-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const json = await res.json();
      if (!res.ok || !json?.data?.saved) {
        throw new Error(json?.error || "Save failed");
      }
      setMasterResumeExists(true);
      const validation = await validateResume();
      if (!validation.valid) {
        toast.error(validation.message || "Resume validation failed");
        return false;
      }
      toast.success("Resume saved.");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save resume");
      return false;
    } finally {
      setIsSavingResume(false);
    }
  };

  const resolvedStepIndex = currentStep
    ? steps.findIndex((step) => step.id === currentStep)
    : 0;
  const stepIndex = resolvedStepIndex >= 0 ? resolvedStepIndex : 0;
  const completedSteps = steps.filter((step) => step.complete).length;
  const progressValue =
    steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;
  const isBusy =
    isSavingEnv ||
    settingsLoading ||
    isValidatingLlm ||
    isValidatingResume ||
    isSavingResume;
  const canGoBack = stepIndex > 0;

  const handlePrimaryAction = async () => {
    if (!currentStep) return;
    if (currentStep === "llm") {
      const ok = await handleSaveLlm();
      if (ok) setCurrentStep("resume");
      return;
    }
    if (currentStep === "resume") {
      if (masterResumeExists) {
        await validateResume();
      } else {
        await handleSaveMasterResume();
      }
      return;
    }
  };

  const handleBack = () => {
    if (!canGoBack) return;
    setCurrentStep(steps[stepIndex - 1]?.id ?? currentStep);
  };

  if (!shouldOpen || !currentStep) return null;

  return (
    <AlertDialog open>
      <AlertDialogContent
        className="max-w-3xl max-h-[90vh] overflow-hidden p-0"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <div className="space-y-6 px-6 py-6 max-h-[calc(90vh-3.5rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Welcome to Job Ops</AlertDialogTitle>
            <AlertDialogDescription>
              Let's get your workspace ready. Add your LLM key and resume once,
              then the pipeline can run end-to-end.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Tabs value={currentStep} onValueChange={setCurrentStep}>
            <TabsList className="grid h-auto w-full grid-cols-1 gap-2 border-b border-border/60 bg-transparent p-0 text-left sm:grid-cols-2">
              {steps.map((step, index) => {
                const isActive = step.id === currentStep;
                const isComplete = step.complete;

                return (
                  <FieldLabel
                    key={step.id}
                    className={cn(
                      "w-full [&>[data-slot=field]]:border-0 [&>[data-slot=field]]:p-0 [&>[data-slot=field]]:rounded-none",
                      step.disabled && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <TabsTrigger
                      value={step.id}
                      disabled={step.disabled}
                      className={cn(
                        "w-full rounded-md hover:bg-muted/60 border-b-2 border-transparent px-3 py-4 text-left shadow-none",
                        isActive
                          ? "border-primary !bg-muted/60 text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <Field orientation="horizontal" className="items-start">
                        <FieldContent>
                          <FieldTitle>{step.label}</FieldTitle>
                          <FieldDescription>{step.subtitle}</FieldDescription>
                        </FieldContent>
                        <span
                          className={cn(
                            "mt-0.5 flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold",
                            isComplete
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {isComplete ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            index + 1
                          )}
                        </span>
                      </Field>
                    </TabsTrigger>
                  </FieldLabel>
                );
              })}
            </TabsList>

            <TabsContent value="llm" className="space-y-4 pt-6">
              <div>
                <p className="text-sm font-semibold">Connect LLM provider</p>
                <p className="text-xs text-muted-foreground">
                  Used for job scoring, summaries, and tailoring.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="llmProvider" className="text-sm font-medium">
                    Provider
                  </label>
                  <Controller
                    name="llmProvider"
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={selectedProvider}
                        onValueChange={(value) => {
                          field.onChange(value);
                        }}
                        disabled={isSavingEnv}
                      >
                        <SelectTrigger id="llmProvider">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent>
                          {LLM_PROVIDERS.map((provider) => (
                            <SelectItem key={provider} value={provider}>
                              {LLM_PROVIDER_LABELS[provider]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <p className="text-xs text-muted-foreground">
                    {providerConfig.providerHint}
                  </p>
                </div>
                {showBaseUrl && (
                  <Controller
                    name="llmBaseUrl"
                    control={control}
                    render={({ field }) => (
                      <SettingsInput
                        label="LLM base URL"
                        inputProps={{
                          name: "llmBaseUrl",
                          value: field.value,
                          onChange: field.onChange,
                        }}
                        placeholder={providerConfig.baseUrlPlaceholder}
                        helper={providerConfig.baseUrlHelper}
                        current={settings?.llmBaseUrl?.value || "—"}
                        disabled={isSavingEnv}
                      />
                    )}
                  />
                )}
                {showApiKey && (
                  <Controller
                    name="llmApiKey"
                    control={control}
                    render={({ field }) => (
                      <SettingsInput
                        label="LLM API key"
                        inputProps={{
                          name: "llmApiKey",
                          value: field.value,
                          onChange: field.onChange,
                        }}
                        type="password"
                        placeholder="Enter key"
                        helper={
                          llmKeyHint
                            ? `${providerConfig.keyHelper}. Leave blank to use the saved key.`
                            : providerConfig.keyHelper
                        }
                        disabled={isSavingEnv}
                      />
                    )}
                  />
                )}
              </div>
            </TabsContent>

            <TabsContent value="resume" className="space-y-4 pt-6">
              <div>
                <p className="text-sm font-semibold">Upload your resume</p>
                <p className="text-xs text-muted-foreground">
                  Paste your full resume as plain text. The pipeline will use
                  this to generate tailored resume PDFs and cover letters.
                </p>
              </div>

              {isFetchingResume ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : masterResumeExists ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-green-600 font-medium">
                      ✓ Resume uploaded ({masterResumeText.length.toLocaleString()} chars)
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMasterResumeExists(false)}
                      disabled={isBusy}
                    >
                      Replace
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Click Validate to confirm your resume is ready, or Replace to update it.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="onboarding-resume-text" className="text-xs">
                    Resume text
                  </Label>
                  <Textarea
                    id="onboarding-resume-text"
                    ref={textareaRef}
                    value={masterResumeText}
                    onChange={(e) => setMasterResumeText(e.target.value)}
                    placeholder="Paste your full resume here (work experience, education, skills, projects…)"
                    className="min-h-[220px] font-mono text-xs resize-y"
                    disabled={isSavingResume}
                  />
                  <p className="text-xs text-muted-foreground">
                    {masterResumeText.length.toLocaleString()} characters
                  </p>
                  <Button
                    size="sm"
                    onClick={handleSaveMasterResume}
                    disabled={isSavingResume || masterResumeText.trim().length < 50}
                  >
                    {isSavingResume ? "Saving…" : "Save resume"}
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={!canGoBack || isBusy}
            >
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Button onClick={handlePrimaryAction} disabled={isBusy}>
                {isBusy
                  ? "Validating..."
                  : getStepPrimaryLabel({
                      currentStep,
                      llmValidated,
                      resumeValidated: resumeValidation.valid,
                    })}
              </Button>
            </div>
          </div>

          <Progress value={progressValue} className="h-2" />
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
