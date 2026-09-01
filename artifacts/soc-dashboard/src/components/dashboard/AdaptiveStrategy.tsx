import { useState } from "react";
import { BrainCircuit, Gauge, Shield, Play, Target, Activity, Settings, Database, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  usePreviewStrategySandbox,
  type StrategyCycle,
  type StrategyOverview,
  type StrategySandboxCandidate,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AdaptiveStrategy({ strategy }: { strategy?: StrategyOverview }) {
  const [activeTab, setActiveTab] = useState<"overview" | "recent" | "sandbox">("overview");

  if (!strategy || !strategy.latest) {
    return (
      <Card className="bg-card/50 backdrop-blur border-primary/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest flex items-center justify-between gap-4">
            <span className="flex items-center gap-2"><BrainCircuit className="w-4 h-4 text-primary" /> M0 Adaptive Strategy</span>
            <span className="text-[10px] text-safe">OBSERVER ONLY</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-6 text-center font-mono text-xs text-muted-foreground">AWAITING STRATEGY CYCLE...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 backdrop-blur border-primary/30 flex flex-col overflow-hidden">
      <CardHeader className="pb-0 border-b border-border/50 bg-secondary/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
          <CardTitle className="text-sm font-mono text-primary uppercase tracking-widest flex items-center gap-2">
            <BrainCircuit className="w-4 h-4" /> M0 Adaptive Strategy
          </CardTitle>
          <div className="flex items-center gap-3">
            <div className="px-2 py-0.5 rounded-full bg-secondary/40 border border-border text-[10px] font-mono text-muted-foreground">
              GLOBAL SYNTHETIC
            </div>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[10px] font-mono text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              OBSERVER ACTIVE
            </div>
          </div>
        </div>

        <div className="flex gap-6 text-xs font-mono">
          <button 
            onClick={() => setActiveTab("overview")}
            className={`pb-3 border-b-2 transition-colors ${activeTab === "overview" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            TACTICAL OVERVIEW
          </button>
          <button 
            onClick={() => setActiveTab("recent")}
            className={`pb-3 border-b-2 transition-colors ${activeTab === "recent" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            RECENT CYCLES
          </button>
          <button 
            onClick={() => setActiveTab("sandbox")}
            className={`pb-3 border-b-2 transition-colors ${activeTab === "sandbox" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            SANDBOX PREVIEW
          </button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <AnimatePresence mode="wait">
          {activeTab === "overview" && (
            <motion.div key="overview" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="p-6">
              <OverviewTab strategy={strategy} latest={strategy.latest} />
            </motion.div>
          )}
          {activeTab === "recent" && (
            <motion.div key="recent" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="p-6">
              <RecentCyclesTab strategy={strategy} />
            </motion.div>
          )}
          {activeTab === "sandbox" && (
            <motion.div key="sandbox" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="p-6 bg-secondary/5">
              <SandboxTab strategy={strategy} />
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function OverviewTab({ strategy, latest }: { strategy: StrategyOverview; latest: StrategyCycle }) {
  const drift = strategy.drift;
  const limits = strategy.sandboxLimits;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="space-y-6 md:col-span-2">
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded border border-primary/30 bg-primary/5 p-4 flex flex-col justify-between">
            <div className="text-[10px] font-mono text-muted-foreground flex items-center justify-between">
              SELECTED MODE
              <Target className="w-3 h-3 text-primary/50" />
            </div>
            <div>
              <div className={`mt-2 text-3xl font-mono font-bold uppercase ${
                latest.mode === "deep" ? "text-critical" :
                latest.mode === "fast" ? "text-safe" : "text-primary"
              }`}>{latest.mode}</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${latest.confidence * 100}%` }} />
                </div>
                <div className="text-xs font-mono text-muted-foreground">{Math.round(latest.confidence * 100)}%</div>
              </div>
            </div>
          </div>

          <div className="rounded border border-border bg-secondary/30 p-4 flex flex-col justify-between">
            <div className="text-[10px] font-mono text-muted-foreground flex items-center justify-between">
              COMPUTE BUDGET
              <Gauge className="w-3 h-3 text-muted-foreground/50" />
            </div>
            <div>
              <div className="mt-2 text-3xl font-mono font-bold text-foreground">
                {latest.computeBudget} <span className="text-sm text-muted-foreground">U</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <Activity className="w-3 h-3" /> Cost efficiency active
              </div>
            </div>
          </div>
        </div>

        <div className="rounded border border-border bg-card p-4 space-y-3">
          <div className="text-[10px] font-mono text-muted-foreground uppercase">Reasoning Context</div>
          <div className="font-mono text-sm text-primary uppercase">{latest.attackFamily.replaceAll("_", " ")}</div>
          <p className="text-sm text-foreground/90 leading-relaxed font-sans">{latest.reason}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <div className="px-2 py-1 rounded bg-secondary/50 text-[10px] font-mono text-muted-foreground border border-border/50">
              PHASE: {latest.context.phase.toUpperCase()}
            </div>
            <div className="px-2 py-1 rounded bg-secondary/50 text-[10px] font-mono text-muted-foreground border border-border/50">
              OBJECTIVE: {latest.context.objective.toUpperCase()}
            </div>
            <div className="px-2 py-1 rounded bg-secondary/50 text-[10px] font-mono text-muted-foreground border border-border/50">
              EVIDENCE: {latest.context.evidenceFreshness.toUpperCase()}
            </div>
            <div className="px-2 py-1 rounded bg-secondary/50 text-[10px] font-mono text-muted-foreground border border-border/50">
              NODE: {latest.nodeRun.node} • LATENCY: {latest.nodeRun.latencyMs}ms • Q: {Math.round(latest.nodeRun.quality * 100)}%
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 flex flex-col">
        <div className="rounded border border-border bg-card p-4 flex-1">
          <div className="text-[10px] font-mono text-muted-foreground mb-4 uppercase flex items-center gap-2">
            <Settings className="w-3 h-3" /> System Drift & Limits
          </div>
          
          <div className="space-y-4">
            <div className="flex justify-between items-end border-b border-border/50 pb-2">
              <span className="text-xs font-mono text-muted-foreground">Status</span>
              <span className={`text-xs font-mono font-bold uppercase ${drift.syntheticTrend === 'stable' ? 'text-safe' : drift.syntheticTrend === 'rising' ? 'text-critical' : 'text-primary'}`}>
                {drift.syntheticTrend}
              </span>
            </div>
            <div className="flex justify-between items-end border-b border-border/50 pb-2">
              <span className="text-xs font-mono text-muted-foreground">Synthetic Model Quality</span>
              <span className="text-xs font-mono">{Math.round(drift.modelQualityEstimate * 100)}%</span>
            </div>
            <div className="flex justify-between items-end border-b border-border/50 pb-2">
              <span className="text-xs font-mono text-muted-foreground">Synthetic Risk Delta</span>
              <span className={`text-xs font-mono ${drift.syntheticRiskDelta > 0 ? 'text-critical' : 'text-safe'}`}>
                {drift.syntheticRiskDelta > 0 ? '+' : ''}{drift.syntheticRiskDelta.toFixed(1)}
              </span>
            </div>
            <div className="flex justify-between items-end border-b border-border/50 pb-2">
              <span className="text-xs font-mono text-muted-foreground">Comparison Window</span>
              <span className="text-xs font-mono">{drift.windowSize} cycles</span>
            </div>
            <div className="flex justify-between items-end border-b border-border/50 pb-2">
              <span className="text-xs font-mono text-muted-foreground">Max Depth</span>
              <span className="text-xs font-mono">{limits.maxDepth}</span>
            </div>
            <div className="flex justify-between items-end border-b border-border/50 pb-2">
              <span className="text-xs font-mono text-muted-foreground">Max Scenarios</span>
              <span className="text-xs font-mono">{limits.maxScenarios}</span>
            </div>
          </div>
          
          {drift.operatorReviewRequired && (
             <div className="mt-4 p-2 bg-warn/10 border border-warn/30 text-warn text-[10px] font-mono rounded flex items-start gap-2">
               <Shield className="w-3 h-3 shrink-0 mt-0.5" />
               EVIDENCE OR RISK DRIFT NEEDS OPERATOR REVIEW
             </div>
          )}
          <p className="mt-4 text-[10px] font-mono leading-relaxed text-muted-foreground">
            {strategy.interpretation}
          </p>
        </div>
      </div>
    </div>
  );
}

function RecentCyclesTab({ strategy }: { strategy: StrategyOverview }) {
  const [filter, setFilter] = useState<"all" | StrategyCycle["mode"]>("all");
  const recent = strategy.recent || [];
  
  const filtered = recent.filter((cycle) => filter === "all" || cycle.mode === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 mb-4">
        {(["all", "fast", "balanced", "deep"] as const).map((value) => (
          <button
            type="button"
            key={value}
            onClick={() => setFilter(value)}
            className={`px-3 py-1 text-xs font-mono rounded border ${filter === value ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-secondary/20 border-border text-muted-foreground hover:bg-secondary/40'}`}
          >
            {value.toUpperCase()}
          </button>
        ))}
      </div>
      
      <div className="rounded border border-border bg-card overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm font-mono">
          <thead className="bg-secondary/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-normal border-b border-border">TIME</th>
              <th className="px-4 py-2 text-left font-normal border-b border-border">MODE</th>
              <th className="px-4 py-2 text-left font-normal border-b border-border">ATTACK FAMILY</th>
              <th className="px-4 py-2 text-right font-normal border-b border-border">RISK</th>
              <th className="px-4 py-2 text-right font-normal border-b border-border">CONFIDENCE</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.map((cycle) => (
              <tr key={cycle.id} className="hover:bg-secondary/10">
                <td className="px-4 py-2 whitespace-nowrap text-muted-foreground text-xs">
                  {new Date(cycle.createdAt).toLocaleTimeString([], { hour12: false })}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className={`uppercase text-xs ${
                    cycle.mode === "deep" ? "text-critical" :
                    cycle.mode === "fast" ? "text-safe" : "text-primary"
                  }`}>{cycle.mode}</span>
                </td>
                <td className="px-4 py-2 truncate max-w-[200px] text-xs">
                  {cycle.attackFamily.replaceAll("_", " ").toUpperCase()}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-right text-xs">
                  {cycle.riskScore}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-right text-xs text-muted-foreground">
                  {Math.round(cycle.confidence * 100)}%
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No cycles found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SandboxTab({ strategy }: { strategy: StrategyOverview }) {
  const previewMutation = usePreviewStrategySandbox();
  const limits = strategy.sandboxLimits;
  
  const [form, setForm] = useState({
    riskScore: 75,
    residualRisk: 25,
    confidence: 0.85,
    sampleCount: 100,
    defenseSuccessRate: 0.9,
    markovConfidence: 0.8
  });

  const handlePreview = (e: React.FormEvent) => {
    e.preventDefault();
    previewMutation.mutate({ data: form });
  };

  const updateForm = (key: string, value: number) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const InputRow = ({ label, id, val, max, step }: { label: string, id: string, val: number, max: number, step: number }) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center text-xs font-mono">
        <label htmlFor={id} className="text-muted-foreground">{label}</label>
        <span className="text-primary">{val}</span>
      </div>
      <input
        type="range"
        id={id}
        min="0"
        max={max}
        step={step}
        value={val}
        onChange={(e) => updateForm(id, Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
      <div className="space-y-6">
        <div className="text-xs font-mono text-muted-foreground mb-2 flex items-center justify-between">
          <span>DRY-RUN PARAMETERS</span>
          <span className="px-1.5 py-0.5 rounded bg-secondary/50 border border-border/50 text-[9px]">MAX {limits.maxScenarios} SCENARIOS</span>
        </div>
        
        <form onSubmit={handlePreview} className="space-y-5 bg-card border border-border/50 p-4 rounded">
          <InputRow label="Initial Risk" id="riskScore" val={form.riskScore} max={100} step={1} />
          <InputRow label="Target Residual" id="residualRisk" val={form.residualRisk} max={100} step={1} />
          <InputRow label="Req. Confidence" id="confidence" val={form.confidence} max={1} step={0.01} />
          <InputRow label="Sample Count" id="sampleCount" val={form.sampleCount} max={5000} step={10} />
          <InputRow label="Est. Success Rate" id="defenseSuccessRate" val={form.defenseSuccessRate} max={1} step={0.01} />
          <InputRow label="Markov Confidence" id="markovConfidence" val={form.markovConfidence} max={1} step={0.01} />
          
          <button
            type="submit"
            disabled={previewMutation.isPending}
            className="w-full mt-4 bg-primary hover:bg-primary/90 text-primary-foreground font-mono text-xs py-2.5 rounded flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {previewMutation.isPending ? "COMPUTING..." : (
              <>
                <Play className="w-3 h-3" />
                EXECUTE SANDBOX
              </>
            )}
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-3">
        {previewMutation.isError && (
          <div role="alert" className="rounded border border-critical/30 bg-critical/10 p-3 text-xs font-mono text-critical">
            SANDBOX PREVIEW FAILED. NO STATE WAS CHANGED.
          </div>
        )}
        {previewMutation.data ? (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-safe" />
              <h4 className="text-sm font-mono text-foreground tracking-widest uppercase">Simulation Complete</h4>
              <span className="ml-auto text-[10px] font-mono text-muted-foreground">ID: {previewMutation.data.correlationId}</span>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {previewMutation.data.candidates.map((candidate: StrategySandboxCandidate) => (
                <div key={candidate.mode} className={`p-4 rounded border flex flex-col justify-between ${candidate.selected ? 'bg-primary/10 border-primary/50 ring-1 ring-primary/20' : 'bg-card border-border/50'}`}>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-mono font-bold uppercase ${candidate.mode === 'deep' ? 'text-critical' : candidate.mode === 'fast' ? 'text-safe' : 'text-primary'}`}>{candidate.mode}</span>
                      {candidate.selected && <span className="text-[9px] font-mono bg-primary text-primary-foreground px-1.5 rounded">RECOMMENDED</span>}
                    </div>
                    <div className="space-y-1 mt-4">
                      <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                        <span>Quality</span>
                        <span>{Math.round(candidate.expectedQuality * 100)}%</span>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                        <span>Cost Est.</span>
                        <span>{candidate.expectedCost} U</span>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                        <span>Budget</span>
                        <span>{candidate.computeBudget} U</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-4 p-4 rounded bg-secondary/10 border border-border/50">
              <div className="text-[10px] font-mono text-muted-foreground mb-2">ADVISORY POLICY ENFORCED</div>
              <p className="text-xs font-mono text-foreground/80 leading-relaxed border-l-2 border-primary/50 pl-3">
                {previewMutation.data.policy}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-mono text-muted-foreground sm:grid-cols-4">
                <span>{previewMutation.data.execution.scenariosEvaluated} SCENARIOS</span>
                <span>DEPTH {previewMutation.data.execution.depthUsed}</span>
                <span>{previewMutation.data.execution.runtimeMs.toFixed(2)} MS</span>
                <span>DEADLINE ENFORCED</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-border/50 rounded bg-secondary/5">
            <Database className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-mono text-muted-foreground">Configure parameters and execute to generate deterministic candidate comparisons.</p>
            <p className="text-[10px] font-mono text-muted-foreground/50 mt-2">Does not mutate production state.</p>
          </div>
        )}
      </div>
    </div>
  );
}
