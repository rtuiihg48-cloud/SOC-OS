import { useState } from "react";
import {
  useListRules,
  getListRulesQueryKey,
  useCreateRule,
  useToggleRule,
  useDeleteRule,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Zap, CheckCircle, XCircle } from "lucide-react";

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-critical/10 text-critical border-critical/30",
  high:     "bg-warn/10 text-warn border-warn/30",
  medium:   "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  low:      "bg-safe/10 text-safe border-safe/30",
};

const ACTION_STYLES: Record<string, string> = {
  ISOLATE: "bg-critical/10 text-critical border-critical/30",
  WARN:    "bg-warn/10 text-warn border-warn/30",
};

export default function RulesEngine() {
  const qc = useQueryClient();
  const { data: rules = [], isLoading } = useListRules();
  const { mutate: createRule, isPending: isCreating } = useCreateRule();
  const { mutate: toggleRule } = useToggleRule();
  const { mutate: deleteRule } = useDeleteRule();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    matchPattern: "",
    scoreBoost: 0,
    forceAction: "" as "" | "WARN" | "ISOLATE",
    severity: "medium" as "low" | "medium" | "high" | "critical",
  });

  const invalidateRules = () => qc.invalidateQueries({ queryKey: getListRulesQueryKey() });

  function handleCreate() {
    if (!form.name.trim() || !form.matchPattern.trim()) return;
    createRule(
      {
        data: {
          name: form.name,
          description: form.description || null,
          matchPattern: form.matchPattern,
          scoreBoost: Number(form.scoreBoost),
          forceAction: form.forceAction || null,
          severity: form.severity,
          enabled: true,
        },
      },
      {
        onSuccess: () => {
          invalidateRules();
          setShowCreate(false);
          setForm({ name: "", description: "", matchPattern: "", scoreBoost: 0, forceAction: "", severity: "medium" });
        },
      }
    );
  }

  function handleToggle(id: number, enabled: boolean) {
    toggleRule({ id, data: { enabled } }, { onSuccess: invalidateRules });
  }

  function handleDelete(id: number) {
    deleteRule({ id }, { onSuccess: invalidateRules });
  }

  const totalRules = rules.length;
  const activeRules = rules.filter((r) => r.enabled).length;
  const totalHits = rules.reduce((a, r) => a + r.hitCount, 0);
  const criticalRules = rules.filter((r) => r.severity === "critical" || r.forceAction === "ISOLATE").length;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "TOTAL RULES", value: totalRules, color: "text-primary" },
          { label: "ACTIVE", value: activeRules, color: "text-safe" },
          { label: "TOTAL HITS", value: totalHits, color: "text-warn" },
          { label: "CRITICAL RULES", value: criticalRules, color: "text-critical" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-card border border-border rounded-lg p-4 font-mono">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">{kpi.label}</div>
            <div className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold font-mono flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            DETECTION RULES
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">No-code SIEM rules — define patterns, boost scores, force actions</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md font-mono text-sm hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          NEW RULE
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-card border border-primary/30 rounded-lg p-6 space-y-4">
          <h3 className="font-mono text-sm font-semibold text-primary">CREATE DETECTION RULE</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">RULE NAME *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. SQL Injection Detector"
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">MATCH PATTERN *</label>
              <input
                value={form.matchPattern}
                onChange={(e) => setForm((f) => ({ ...f, matchPattern: e.target.value }))}
                placeholder="e.g. sql inject"
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">DESCRIPTION</label>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Optional rule description"
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">SCORE BOOST (0–20)</label>
              <input
                type="number" min={0} max={20}
                value={form.scoreBoost}
                onChange={(e) => setForm((f) => ({ ...f, scoreBoost: parseInt(e.target.value) || 0 }))}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">FORCE ACTION</label>
              <select
                value={form.forceAction}
                onChange={(e) => setForm((f) => ({ ...f, forceAction: e.target.value as "" | "WARN" | "ISOLATE" }))}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:border-primary outline-none"
              >
                <option value="">None (use score)</option>
                <option value="WARN">WARN</option>
                <option value="ISOLATE">ISOLATE</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">SEVERITY</label>
              <select
                value={form.severity}
                onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as typeof form.severity }))}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:border-primary outline-none"
              >
                <option value="low">LOW</option>
                <option value="medium">MEDIUM</option>
                <option value="high">HIGH</option>
                <option value="critical">CRITICAL</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={isCreating || !form.name.trim() || !form.matchPattern.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded font-mono text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isCreating ? "CREATING..." : "CREATE RULE"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-secondary text-foreground rounded font-mono text-sm hover:bg-secondary/80 transition-colors"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Rules List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground font-mono">LOADING RULES...</div>
      ) : rules.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground font-mono">NO RULES CONFIGURED</div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`bg-card border rounded-lg p-4 transition-all ${rule.enabled ? "border-border" : "border-border/40 opacity-60"}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono font-semibold text-sm">{rule.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded border font-mono uppercase ${SEVERITY_STYLES[rule.severity] ?? ""}`}>
                      {rule.severity}
                    </span>
                    {rule.forceAction && (
                      <span className={`text-xs px-2 py-0.5 rounded border font-mono ${ACTION_STYLES[rule.forceAction] ?? ""}`}>
                        FORCE: {rule.forceAction}
                      </span>
                    )}
                    {!rule.enabled && (
                      <span className="text-xs px-2 py-0.5 rounded border border-muted-foreground/30 text-muted-foreground font-mono">DISABLED</span>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-xs text-muted-foreground mt-1">{rule.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs font-mono text-muted-foreground">
                    <span>PATTERN: <span className="text-primary">{rule.matchPattern}</span></span>
                    <span>BOOST: <span className="text-warn">+{rule.scoreBoost}</span></span>
                    <span>HITS: <span className="text-foreground font-semibold">{rule.hitCount}</span></span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleToggle(rule.id, !rule.enabled)}
                    title={rule.enabled ? "Disable" : "Enable"}
                    className={`p-2 rounded transition-colors ${rule.enabled ? "text-safe hover:bg-safe/10" : "text-muted-foreground hover:bg-secondary"}`}
                  >
                    {rule.enabled ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    title="Delete rule"
                    className="p-2 rounded text-muted-foreground hover:text-critical hover:bg-critical/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
