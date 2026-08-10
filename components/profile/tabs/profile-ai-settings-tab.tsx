"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/ui/utils";
import { API, APP_NAME } from "@/lib/config/constants";
import { AI_MODEL_CATALOG, getModelSpec } from "@/lib/ai/model-catalog";
import { Loader2, Eye, EyeOff, RotateCcw, Power } from "lucide-react";
import { AiSettingsTabSkeleton } from "./ai-settings-tab-skeleton";
import type { ProfileTabProps } from "../types";

function formatTokens(n: number): string {
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

interface AiConfig {
  useVulnradarAi: boolean;
  aiDisabled: boolean;
  provider: string | null;
  modelId: string | null;
  apiKeyLast4: string | null;
  baseUrl: string | null;
}

export function ProfileAiSettingsTab({
  setError,
  setSuccess,
  loading,
}: ProfileTabProps) {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [fetching, setFetching] = useState(true);

  // Form state
  const [aiDisabled, setAiDisabled] = useState(false);
  const [togglingAi, setTogglingAi] = useState(false);
  const [useOwn, setUseOwn] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [showApiKeyText, setShowApiKeyText] = useState(false);

  // Action state
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (loading) return;
    (async () => {
      try {
        const res = await fetch(API.ACCOUNT_AI_CONFIG);
        if (res.ok) {
          const data: AiConfig = await res.json();
          setConfig(data);
          setAiDisabled(data.aiDisabled ?? false);
          setUseOwn(!data.useVulnradarAi);
          if (data.provider) setSelectedProvider(data.provider);
          if (data.modelId) setSelectedModel(data.modelId);
        }
      } catch {
        // Non-fatal: we'll just show the default state
      } finally {
        setFetching(false);
      }
    })();
  }, [loading]);

  const providerDef = AI_MODEL_CATALOG.find((p) => p.id === selectedProvider);
  const modelSpec = getModelSpec(selectedProvider, selectedModel);

  async function handleToggleAi() {
    setTogglingAi(true);
    setError(null);
    try {
      const next = !aiDisabled;
      const res = await fetch(API.ACCOUNT_AI_CONFIG, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiDisabled: next }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update AI setting.");
        return;
      }
      setAiDisabled(next);
      setSuccess(next ? "AI features disabled." : "AI features enabled.");
    } catch {
      setError("Failed to update AI setting.");
    } finally {
      setTogglingAi(false);
    }
  }

  async function handleSave() {
    if (!selectedProvider || !selectedModel) {
      setError("Select a provider and model before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        useVulnradarAi: false,
        provider: selectedProvider,
        modelId: selectedModel,
        baseUrl: providerDef?.baseUrl ?? null,
      };
      if (apiKey.trim()) {
        body.apiKey = apiKey.trim();
      }

      const res = await fetch(API.ACCOUNT_AI_CONFIG, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to save AI config.");
        return;
      }

      setConfig((prev) => ({
        useVulnradarAi: false,
        aiDisabled: prev?.aiDisabled ?? false,
        provider: selectedProvider,
        modelId: selectedModel,
        apiKeyLast4: apiKey ? apiKey.slice(-4) : (prev?.apiKeyLast4 ?? null),
        baseUrl: providerDef?.baseUrl ?? null,
      }));
      setApiKey("");
      setShowKeyInput(false);
      setShowApiKeyText(false);
      setSuccess("AI provider saved.");
    } catch {
      setError("Failed to save AI config.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    setError(null);
    try {
      const res = await fetch(API.ACCOUNT_AI_CONFIG, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to reset AI config.");
        return;
      }
      setConfig((prev) => ({
        useVulnradarAi: true,
        aiDisabled: prev?.aiDisabled ?? false,
        provider: null,
        modelId: null,
        apiKeyLast4: null,
        baseUrl: null,
      }));
      setUseOwn(false);
      setSelectedProvider("");
      setSelectedModel("");
      setApiKey("");
      setShowKeyInput(false);
      setSuccess(`Reset to ${APP_NAME} AI.`);
    } catch {
      setError("Failed to reset AI config.");
    } finally {
      setResetting(false);
    }
  }

  if (loading || fetching) {
    return <AiSettingsTabSkeleton />;
  }

  const hasExistingKey = !!config?.apiKeyLast4;

  return (
    <div className="flex flex-col gap-8">
      {/* AI on/off toggle */}
      <section>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="flex items-center justify-between gap-4 py-5">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  "p-2 rounded-lg shrink-0",
                  aiDisabled ? "bg-muted" : "bg-primary/10",
                )}
              >
                <Power
                  className={cn(
                    "h-4 w-4",
                    aiDisabled ? "text-muted-foreground" : "text-primary",
                  )}
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  AI features
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {aiDisabled
                    ? "AI is off. Chat widget and scan verification are hidden."
                    : "AI is on. Chat widget and scan verification are available."}
                </p>
              </div>
            </div>
            <Switch
              checked={!aiDisabled}
              onCheckedChange={handleToggleAi}
              disabled={togglingAi}
              aria-label="AI features"
            />
          </CardContent>
        </Card>
      </section>

      {/* `inert` keeps this section out of the tab order and the AT tree
          while AI is off, not just visually dimmed, so a keyboard or screen
          reader user can't land on controls that quietly do nothing. */}
      <section
        inert={aiDisabled ? true : undefined}
        className={cn(aiDisabled && "opacity-40 select-none")}
      >
        <div className="mb-4">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            AI provider
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Which AI analyzes scanned websites for vulnerabilities on your
            behalf
          </p>
        </div>

        {/* Choice cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={() => setUseOwn(false)}
            className={cn(
              "text-left p-4 rounded-xl border transition-all",
              !useOwn
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card hover:border-border/80 hover:bg-muted/30",
            )}
          >
            <p className="text-sm font-semibold text-foreground">
              {APP_NAME}'s AI
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Managed by {APP_NAME}. No setup required.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setUseOwn(true)}
            className={cn(
              "text-left p-4 rounded-xl border transition-all",
              useOwn
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card hover:border-border/80 hover:bg-muted/30",
            )}
          >
            <p className="text-sm font-semibold text-foreground">
              My own AI provider
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Use your own API key with OpenAI, Claude, Gemini, Groq, or others.
            </p>
          </button>
        </div>

        {/* VulnRadar AI selected state */}
        {!useOwn && (
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-5 pb-5">
              {config?.useVulnradarAi === false ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                  <p className="text-sm text-muted-foreground">
                    Switching back to {APP_NAME}'s built-in AI will remove your
                    saved provider config.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    disabled={resetting}
                    className="shrink-0 gap-2"
                  >
                    {resetting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    Use {APP_NAME} AI
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {APP_NAME}'s built-in AI is active. Scan results are analyzed
                  without any extra configuration.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Custom provider form */}
        {useOwn && (
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-6 flex flex-col gap-5">
              {/* Provider select */}
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="provider-select"
                  className="text-sm font-medium"
                >
                  Provider
                </Label>
                <select
                  id="provider-select"
                  value={selectedProvider}
                  onChange={(e) => {
                    setSelectedProvider(e.target.value);
                    setSelectedModel("");
                  }}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-base sm:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Choose a provider</option>
                  {AI_MODEL_CATALOG.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Model select — only shown once a provider is picked */}
              {selectedProvider && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="model-select" className="text-sm font-medium">
                    Model
                  </Label>
                  <select
                    id="model-select"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-base sm:text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Choose a model</option>
                    {providerDef?.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  {modelSpec &&
                    (modelSpec.contextWindow || modelSpec.maxOutputTokens) && (
                      <p className="text-xs text-muted-foreground">
                        {modelSpec.contextWindow &&
                          `${formatTokens(modelSpec.contextWindow)} context`}
                        {modelSpec.contextWindow &&
                          modelSpec.maxOutputTokens &&
                          " · "}
                        {modelSpec.maxOutputTokens &&
                          `${formatTokens(modelSpec.maxOutputTokens)} max output`}
                        {modelSpec.note && ` · ${modelSpec.note}`}
                      </p>
                    )}
                </div>
              )}

              {/* API key */}
              {selectedProvider && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="api-key-input"
                      className="text-sm font-medium"
                    >
                      API Key
                    </Label>
                    {hasExistingKey && !showKeyInput && (
                      <button
                        type="button"
                        onClick={() => setShowKeyInput(true)}
                        className="text-xs text-primary hover:underline"
                      >
                        Change key
                      </button>
                    )}
                  </div>

                  {hasExistingKey && !showKeyInput ? (
                    <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-border bg-muted/30 text-sm text-muted-foreground font-mono">
                      {"••••••••" + config!.apiKeyLast4}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="api-key-input"
                          type={showApiKeyText ? "text" : "password"}
                          placeholder={providerDef?.keyPlaceholder ?? "API key"}
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          className="bg-card pr-10"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKeyText((v) => !v)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={
                            showApiKeyText ? "Hide API key" : "Show API key"
                          }
                        >
                          {showApiKeyText ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      {hasExistingKey && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowKeyInput(false);
                            setApiKey("");
                          }}
                          className="shrink-0"
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  )}

                  {providerDef?.keyHint && (
                    <p className="text-xs text-muted-foreground">
                      {providerDef.keyHint}
                    </p>
                  )}
                </div>
              )}

              {/* Info note */}
              <div className="rounded-lg bg-muted/50 border border-border p-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Your API key is encrypted at rest. It is used only when
                  scanning websites you submit. {APP_NAME} does not use it for
                  anything else.
                </p>
              </div>

              {/* Save */}
              <div className="flex items-center justify-between gap-3 pt-1">
                {config && !config.useVulnradarAi && (
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={resetting}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                  >
                    {resetting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Reset to {APP_NAME} AI
                  </button>
                )}
                <div className="ml-auto">
                  <Button
                    onClick={handleSave}
                    disabled={
                      saving ||
                      !selectedProvider ||
                      !selectedModel ||
                      (!apiKey && !hasExistingKey)
                    }
                    className="gap-2"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save provider
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
