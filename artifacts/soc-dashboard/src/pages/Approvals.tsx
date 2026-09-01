import { ArrowRight, ClipboardCheck, Clock3, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { getListSelfHealingActionsQueryKey, useListSelfHealingActions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Approvals() {
  const { data: actions = [], isLoading } = useListSelfHealingActions(
    { limit: 100 },
    { query: { queryKey: getListSelfHealingActionsQueryKey({ limit: 100 }), staleTime: 15_000 } },
  );
  const ready = actions.filter((action) => action.status === "READY");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-mono uppercase tracking-widest text-primary">
          <ClipboardCheck className="h-6 w-6" /> Readiness Review
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">Review completed previews before opening the capability-gated recovery workflow. This page is not an authorization boundary.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Summary label="Ready previews" value={ready.length} tone="text-warn" />
        <Summary label="Recent actions" value={actions.length} tone="text-primary" />
        <Summary label="Execution from here" value="DISABLED" tone="text-safe" />
      </div>
      {isLoading ? (
        <div className="flex min-h-48 items-center justify-center font-mono text-primary animate-pulse">[ LOADING APPROVAL QUEUE... ]</div>
      ) : ready.length === 0 ? (
        <Card className="border-dashed border-safe/30 bg-safe/5">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <ShieldCheck className="mb-4 h-12 w-12 text-safe" />
            <div className="font-mono uppercase tracking-widest text-safe">No previews ready for review</div>
            <p className="mt-2 text-sm text-muted-foreground">There are no READY self-healing previews in this tenant.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {ready.map((action) => (
            <Card key={action.id} className="bg-card/60">
              <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2 font-mono text-sm uppercase">
                    <Clock3 className="h-4 w-4 text-warn" /> Restore action #{action.id}
                    <Badge variant="outline" className="border-warn/40 text-warn">{action.status}</Badge>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{action.resourceKey} • {action.location}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{action.message}</div>
                </div>
                <Link href="/self-healing" className="flex w-fit items-center gap-1 text-xs font-mono text-primary hover:text-primary/80">
                  REVIEW IN SELF-HEALING <ArrowRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <Card className="bg-card/60">
      <CardHeader className="pb-2"><CardTitle className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent className={`text-2xl font-mono font-bold ${tone}`}>{value}</CardContent>
    </Card>
  );
}