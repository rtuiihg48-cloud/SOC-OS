import { ArrowRight, Box, BrainCircuit, CheckCircle2, GitCommit, Network, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const playbooks = [
  { name: "Investigate incident", description: "Review alerts, correlations, event evidence and the operator timeline.", path: "/incidents", icon: ShieldCheck, mode: "READ ONLY", color: "text-primary" },
  { name: "Quarantine preview", description: "Inspect an isolation envelope while execution remains disabled.", path: "/quarantine", icon: Box, mode: "PREVIEW", color: "text-critical" },
  { name: "Self-healing preview", description: "Validate a managed restore point before a separately capability-gated apply action.", path: "/self-healing", icon: GitCommit, mode: "CAPABILITY GATED", color: "text-warn" },
  { name: "Node route verify", description: "Recompute signed route integrity without implying delivery or execution.", path: "/node-exchange", icon: Network, mode: "VERIFY", color: "text-safe" },
  { name: "Strategy sandbox", description: "Compare fast, balanced and deep strategies without production mutation.", path: "/dashboard", icon: BrainCircuit, mode: "DRY RUN", color: "text-primary" },
];

export default function Playbooks() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-mono uppercase tracking-widest text-primary">
          <ShieldCheck className="h-6 w-6" /> Response Playbooks
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Operator-guided paths into existing policy-gated tools. This catalog does not execute actions or create background workers.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {playbooks.map((playbook) => {
          const Icon = playbook.icon;
          return (
            <Card key={playbook.name} className="bg-card/60 transition-colors hover:border-primary/30">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Icon className={`h-5 w-5 ${playbook.color}`} />
                    <CardTitle className="text-base font-mono uppercase tracking-wide">{playbook.name}</CardTitle>
                  </div>
                  <Badge variant="outline" className="shrink-0 border-border font-mono text-[9px]">{playbook.mode}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex items-end justify-between gap-4">
                <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{playbook.description}</p>
                <Link href={playbook.path} className="flex shrink-0 items-center gap-1 text-xs font-mono text-primary hover:text-primary/80">
                  OPEN <ArrowRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="rounded border border-safe/20 bg-safe/5 p-4 text-[11px] font-mono text-safe">
        SAFETY BOUNDARY: playbooks navigate to existing audited workflows. No playbook grants capability or bypasses operator approval.
      </div>
    </div>
  );
}