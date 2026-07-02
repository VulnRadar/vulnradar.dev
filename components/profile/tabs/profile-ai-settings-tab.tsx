"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/ui/utils";
import { API } from "@/lib/config/constants";
import { Loader2, Bot, Eye, EyeOff, RotateCcw } from "lucide-react";
import type { ProfileTabProps } from "../types";

const AI_PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o mini" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    ],
    keyPlaceholder: "sk-...",
    keyHint: "Find your API key at platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      { id: "claude-opus-4-8", name: "Claude Opus" },
      { id: "claude-sonnet-5", name: "Claude Sonnet" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku" },
    ],
    keyPlaceholder: "sk-ant-...",
    keyHint: "Find your API key at console.anthropic.com",
  },
  {
    id: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
    ],
    keyPlaceholder: "AIzaSy...",
    keyHint: "Find your API key at aistudio.google.com",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B (fast)" },
    ],
    keyPlaceholder: "gsk_...",
    keyHint: "Find your API key at console.groq.com",
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    models: [
      { id: "MiniMax-Text-01", name: "MiniMax Text 01" },
      { id: "abab6.5s-chat", name: "ABAB 6.5S" },
    ],
    keyPlaceholder: "your-api-key",
    keyHint: "Find your API key at platform.minimax.io",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ],
    keyPlaceholder: "sk-...",
    keyHint: "Find your API key at platform.deepseek.com",
  },
];

interface AiConfig {
  useVulnradarAi: boolean;
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

  const providerDef = AI_PROVIDERS.find((p) => p.id === selectedProvider);

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
      setConfig({
        useVulnradarAi: true,
        provider: null,
        modelId: null,
        apiKeyLast4: null,
        baseUrl: null,
      });
      setUseOwn(false);
      setSelectedProvider("");
      setSelectedModel("");
      setApiKey("");
      setShowKeyInput(false);
      setSuccess("Reset to VulnRadar AI.");
    } catch {
      setError("Failed to reset AI config.");
    } finally {
      setResetting(false);
    }
  }

  if (loading || fetching) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasExistingKey = !!config?.apiKeyLast4;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              AI Provider
            </h2>
            <p className="text-sm text-muted-foreground">
              Which AI analyzes scanned websites for vulnerabilities on your
              behalf
            </p>
          </div>
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
              VulnRadar's AI
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Managed by VulnRadar. No setup required.
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
                    Switching back to VulnRadar's built-in AI will remove your
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
                    Use VulnRadar AI
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  VulnRadar's built-in AI is active. Scan results are analyzed
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
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Choose a provider</option>
                  {AI_PROVIDERS.map((p) => (
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
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Choose a model</option>
                    {providerDef?.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
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
                  scanning websites you submit. VulnRadar does not use it for
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
                    Reset to VulnRadar AI
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
