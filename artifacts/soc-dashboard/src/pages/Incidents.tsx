import { Link } from "wouter";
import { ArrowRight, GitBranch, RefreshCw, ShieldAlert, Siren, Box } from "lucide-react";
import { getGetIncidentCenterQueryKey, useGetIncidentCenter, type IncidentCenterItem } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const severityClass: Record<string, string> = {
  CRITICAL: "border-critical/40 bg-critical/10 text-critical",
  HIGH: "border-warn/40 bg-warn/10 text-warn",
  MEDIUM: "border-primary/40 bg-primary/10 text-primary",
  LOW: "border-safe/40 bg-safe/10 text-safe",
};

function kindIcon(kind: IncidentCenterItem["kind"]) {
  if (kind === "CORRELATION") return GitBranch;
  if (kind === "QUARANTINE") return Box;
  return Siren;
}

export default function Incidents() {
  const { data, isLoading, isFetching, refetch } = useGetIncidentCenter({
    query: { queryKey: getGetIncidentCenterQueryKey(), staleTime: 15_000 },
  });

  if (isLoading) {
    return <div className="flex min-h-64 items-center justify-center font-mono text-primary animate-pulse">[ LOADING INCIDENT CENTER... ]</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-mono uppercase tracking-widest text-primary">
            <ShieldAlert className="h-6 w-6" /> Incident Center
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">One tenant-scoped view of active alerts, correlations and blocked captures.</p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="flex w-fit items-center gap-2 rounded border border-border px-3 py-2 text-xs font-mono text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> REFRESH
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard label="Open incidents" value={data?.openIncidents ?? 0} tone="text-primary" />
        <SummaryCard label="Critical incidents" value={data?.criticalIncidents ?? 0} tone="text-critical" />
        <SummaryCard label="Bounded feed" value={`${data?.items.length ?? 0}/60`} tone="text-safe" />
      </div>

      {!data?.items.length ? (
        <Card className="border-dashed border-safe/30 bg-safe/5">
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <ShieldAlert className="mb-4 h-12 w-12 text-safe" />
            <div className="font-mono uppercase tracking-widest text-safe">No open incidents</div>
            <p className="mt-2 text-sm text-muted-foreground">The tenant-scoped incident feed is clear.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((item) => <IncidentRow key={item.id} item={item} />)}
        </div>
      )}
      <p className="text-right text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        Read-only aggregation • generated {data ? new Date(data.generatedAt).toLocaleTimeString([], { hour12: false }) : "--:--:--"}
      </p>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <Card className="bg-card/60">
      <CardContent className="p-5">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className={`mt-2 text-3xl font-mono font-bold ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function IncidentRow({ item }: { item: IncidentCenterItem }) {
  const Icon = kindIcon(item.kind);
  return (
    <Card className="bg-card/60 transition-colors hover:border-primary/30">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <CardTitle className="truncate text-sm font-mono uppercase tracking-wide">{item.title}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
            </div>
          </div>
          <Badge variant="outline" className={`w-fit font-mono ${severityClass[item.severity] ?? severityClass.MEDIUM}`}>{item.severity}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2 text-[10px] font-mono uppercase text-muted-foreground">
          <span className="rounded border border-border px-2 py-1">{item.kind}</span>
          <span className="rounded border border-border px-2 py-1">{item.status}</span>
          <span className="rounded border border-border px-2 py-1">SOURCE #{item.sourceId}</span>
          <span className="rounded border border-border px-2 py-1">{new Date(item.createdAt).toLocaleString()}</span>
        </div>
        <Link href={item.targetPath} className="flex w-fit items-center gap-1 text-xs font-mono text-primary hover:text-primary/80">
          OPEN SOURCE <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}