"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { clientCacheSet } from "@/lib/client/fetch-cache";
import { useClientCacheSnapshot } from "@/hooks/use-cached-json";

type Settings = {
  agentEnabled: boolean;
  provider: string;
  modelName: string;
  maxIterations: number;
  executionTimeoutMs: number;
  requireApprovalForRestricted: boolean;
  minEvidenceConfidence: string;
  maxBudgetUsd: number | null;
};

type SettingsPayload = { settings: Settings; secrets?: { openaiConfigured?: boolean } };

export default function SettingsPage() {
  const cached = useClientCacheSnapshot<SettingsPayload>("settings");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const view = settings ?? cached?.settings ?? null;

  useEffect(() => {
    if (cached?.settings && !settings) {
      setSettings(cached.settings);
      setOpenaiConfigured(Boolean(cached.secrets?.openaiConfigured));
    }
  }, [cached, settings]);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        clientCacheSet("settings", d);
        setSettings(d.settings);
        setOpenaiConfigured(d.secrets?.openaiConfigured);
      });
  }, []);

  async function save() {
    if (!view) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...view,
          requireApprovalForRestricted: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSettings(data.settings);
      clientCacheSet("settings", {
        settings: data.settings,
        secrets: { openaiConfigured },
      });
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      title="Settings"
      description="Non-secret agent configuration. API keys stay in environment variables."
      actions={
        <Button
          onClick={save}
          disabled={!view || saving}
          className="bg-blue-600 text-white hover:bg-blue-700"
        >
          {saving ? "Saving…" : "Save settings"}
        </Button>
      }
    >
      {!view ? (
        <div className="grid max-w-3xl gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-white" />
          ))}
        </div>
      ) : (
        <div className="grid max-w-3xl gap-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Order Operations Agent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="enabled">Agent enabled</Label>
                <Switch
                  id="enabled"
                  checked={view.agentEnabled}
                  onCheckedChange={(v) =>
                    setSettings({ ...view, agentEnabled: Boolean(v) })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="provider">AI provider</Label>
                <select
                  id="provider"
                  className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
                  value={view.provider}
                  onChange={(e) => setSettings({ ...view, provider: e.target.value })}
                >
                  <option value="openai">OpenAI</option>
                  <option value="simulated">Simulated LLM (demo)</option>
                  <option value="anthropic">Anthropic (interface only)</option>
                  <option value="xai">xAI Grok (interface only)</option>
                  <option value="ollama">Ollama (interface only)</option>
                </select>
                <p className="text-xs text-slate-500">
                  OpenAI key configured: {openaiConfigured ? "yes" : "no — will use simulated LLM"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">Model name</Label>
                <Input
                  id="model"
                  value={view.modelName}
                  onChange={(e) => setSettings({ ...view, modelName: e.target.value })}
                  list="model-suggestions"
                />
                <datalist id="model-suggestions">
                  <option value="gpt-5-mini" />
                  <option value="gpt-5-nano" />
                  <option value="gpt-4o-mini" />
                </datalist>
                <p className="text-xs text-slate-500">
                  Recommended: <code>gpt-5-mini</code> (better tool reasoning). Cheaper/faster:{" "}
                  <code>gpt-5-nano</code>.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="iters">Max iterations</Label>
                  <Input
                    id="iters"
                    type="number"
                    value={view.maxIterations}
                    onChange={(e) =>
                      setSettings({ ...view, maxIterations: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timeout">Timeout (ms)</Label>
                  <Input
                    id="timeout"
                    type="number"
                    value={view.executionTimeoutMs}
                    onChange={(e) =>
                      setSettings({
                        ...view,
                        executionTimeoutMs: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confidence">Evidence requirement</Label>
                <select
                  id="confidence"
                  className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
                  value={view.minEvidenceConfidence}
                  onChange={(e) =>
                    setSettings({ ...view, minEvidenceConfidence: e.target.value })
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="budget">Max task budget (USD)</Label>
                <Input
                  id="budget"
                  type="number"
                  step="0.01"
                  value={view.maxBudgetUsd ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...view,
                      maxBudgetUsd: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>

              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                Restricted actions (refunds, credits, cancellations, address changes,
                compensation) always require human approval. This safety rule cannot be
                disabled through settings.
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
