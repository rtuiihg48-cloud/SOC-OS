import {
  useListCorrelations,
  getListCorrelationsQueryKey,
  useResolveCorrelation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link2, CheckCircle, Activity } from "lucide-react";

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: "bg-critical/10 text-critical border-critical/30",
  HIGH:     "bg-warn/10 text-warn border-warn/30",
  MEDIUM:   "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  LOW:      "bg-safe/10 text-safe border-safe/30",
};

const THREAT_ICONS: Record<string, string> = {
  CHAIN_ATTACK:               "⛓️",
  CREDENTIAL_STUFFING:        "🔑",
  APT_SEQUENCE:               "🎯",
  EXFIL_CHAIN:                "📤",
  PRIVILEGE_ESCALATION_CHAIN: "⬆️",
  RANSOMWARE_PRECURSOR:       "💀",
  C2_COMMUNICATION:           "📡",
  CREDENTIAL_DUMP_CHAIN:      "🗄️",
};

export default function Correlations() {
  const qc = useQueryClient();
  const { data: correlations = [], isLoading } = useListCorrelations();
  const { mutate: resolve } = useResolveCorrelation();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListCorrelationsQueryKey() });

  function handleResolve(id: number) {
    resolve({ id }, { onSuccess: invalidate });
  }

  const open = correlations.filter((c) => !c.resolvedAt);
  const resolved = correlations.filter((c) => c.resolvedAt);
  const critical = open.filter((c) => c.severity === "CRITICAL").length;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "TOTAL CHAINS", value: correlations.length, color: "text-primary" },
          { label: "OPEN", value: open.length, color: "text-warn" },
          { label: "CRITICAL", value: critical, color: "text-critical" },
          { label: "RESOLVED", value: resolved.length, color: "text-safe" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-card border border-border rounded-lg p-4 font-mono">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">{kpi.label}</div>
            <div className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold font-mono flex items-center gap-2">
          <Link2 className="w-5 h-5 text-primary" />
          ATTACK CHAIN CORRELATIONS
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Correlation engine detects multi-step attack patterns across event sequences
        </p>
      </div>

      {/* How it works */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
        <div className="text-xs font-mono text-primary mb-2 uppercase tracking-widest">CORRELATION ENGINE — DETECTION PATTERNS</div>
        <div className="grid grid-cols-2 gap-2 text-xs font-mono text-muted-foreground">
          <span>⛓️ scan + exploit → <span className="text-warn">CHAIN_ATTACK</span></span>
          <span>🔑 bruteforce + login → <span className="text-warn">CREDENTIAL_STUFFING</span></span>
          <span>🎯 scan + exploit + lateral → <span className="text-critical">APT_SEQUENCE</span></span>
          <span>📤 malware + exfil → <span className="text-critical">EXFIL_CHAIN</span></span>
          <span>💀 lateral + ransomware → <span className="text-critical">RANSOMWARE_PRECURSOR</span></span>
          <span>📡 malware + c2 → <span className="text-warn">C2_COMMUNICATION</span></span>
        </div>
      </div>

      {/* Correlations list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground font-mono">LOADING CORRELATIONS...</div>
      ) : correlations.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Activity className="w-12 h-12 text-muted-foreground mx-auto" />
          <div className="text-muted-foreground font-mono">NO CORRELATIONS DETECTED YET</div>
          <div className="text-xs text-muted-foreground">Process events with scan + exploit patterns to trigger chain detection</div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Open correlations */}
          {open.length > 0 && (
            <>
              <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">ACTIVE CHAINS ({open.length})</div>
              {open.map((corr) => (
                <div
                  key={corr.id}
                  className={`bg-card border rounded-lg p-5 ${
                    corr.severity === "CRITICAL" ? "border-critical/40" :
                    corr.severity === "HIGH" ? "border-warn/40" : "border-border"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 flex-wrap mb-2">
                        <span className="text-xl">{THREAT_ICONS[corr.threatType] ?? "⚠️"}</span>
                        <span className="font-mono font-bold text-sm">{corr.threatType.replace(/_/g, " ")}</span>
                        <span className={`text-xs px-2 py-0.5 rounded border font-mono ${SEVERITY_STYLES[corr.severity] ?? ""}`}>
                          {corr.severity}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">
                          CONFIDENCE: <span className="text-primary">{Math.round(corr.confidence * 100)}%</span>
                        </span>
                      </div>
                      <p className="text-sm text-foreground/80 mb-3">{corr.summary}</p>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-secondary rounded-full h-1.5 max-w-[160px]">
                          <div
                            className={`h-1.5 rounded-full ${
                              corr.confidence > 0.9 ? "bg-critical" :
                              corr.confidence > 0.75 ? "bg-warn" : "bg-primary"
                            }`}
                            style={{ width: `${corr.confidence * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">
                          {new Date(corr.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleResolve(corr.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-safe/10 text-safe border border-safe/30 rounded font-mono text-xs hover:bg-safe/20 transition-colors flex-shrink-0"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      RESOLVE
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Resolved */}
          {resolved.length > 0 && (
            <>
              <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mt-4">RESOLVED ({resolved.length})</div>
              {resolved.map((corr) => (
                <div key={corr.id} className="bg-card border border-border/40 rounded-lg p-4 opacity-50">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{THREAT_ICONS[corr.threatType] ?? "⚠️"}</span>
                    <span className="font-mono text-sm line-through text-muted-foreground">
                      {corr.threatType.replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto text-xs font-mono text-safe flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> RESOLVED
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
