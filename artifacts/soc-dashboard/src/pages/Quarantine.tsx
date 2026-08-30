import {
  getListQuarantineCapturesQueryKey,
  useListQuarantineCaptures,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Box, FileLock2, Network, ShieldBan } from "lucide-react";

function snapshotText(snapshot: Record<string, unknown>, key: string, fallback = "—") {
  const value = snapshot[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : fallback;
}

export default function Quarantine() {
  const params = { limit: 100 };
  const { data: captures = [], isLoading } = useListQuarantineCaptures(params, {
    query: {
      queryKey: getListQuarantineCapturesQueryKey(params),
      refetchInterval: 5000,
    },
  });

  const active = captures.filter((capture) => capture.status === "QUARANTINED").length;
  const executionBlocked = captures.filter((capture) => !capture.executionAllowed).length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-mono uppercase tracking-widest text-critical flex items-center gap-2">
            <Box className="w-6 h-6" /> Quarantine Shell
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            Read-only isolation envelopes. Captured payloads are evidence only and cannot execute.
          </p>
        </div>
        <Badge variant="outline" className="w-fit border-safe/40 text-safe font-mono">
          HOST EXECUTION: DISABLED
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-critical/5 border-critical/25">
          <CardContent className="p-5">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Active captures</div>
            <div className="text-3xl font-mono font-bold text-critical mt-2">{active}</div>
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/25">
          <CardContent className="p-5">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Evidence records</div>
            <div className="text-3xl font-mono font-bold text-primary mt-2">{captures.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-safe/5 border-safe/25">
          <CardContent className="p-5">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Execution blocked</div>
            <div className="text-3xl font-mono font-bold text-safe mt-2">{executionBlocked}</div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="min-h-64 flex items-center justify-center font-mono text-primary animate-pulse">
          [ OPENING ISOLATION VAULT... ]
        </div>
      ) : captures.length === 0 ? (
        <Card className="border-dashed border-border bg-card/40">
          <CardContent className="py-20 text-center">
            <FileLock2 className="w-12 h-12 text-safe mx-auto mb-4" />
            <div className="font-mono text-safe uppercase tracking-widest">Quarantine empty</div>
            <div className="text-sm text-muted-foreground mt-2">No ISOLATE events have been captured.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {captures.map((capture) => (
            <Card key={capture.id} className="bg-card/60 border-critical/25 overflow-hidden">
              <div className="h-1 bg-critical" />
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <CardTitle className="font-mono text-base flex items-center gap-2">
                      <ShieldBan className="w-4 h-4 text-critical" />
                      {snapshotText(capture.snapshot, "event", `Security event #${capture.eventId}`)}
                    </CardTitle>
                    <div className="font-mono text-[11px] text-muted-foreground mt-2 break-all">
                      {capture.isolationId}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-critical/50 text-critical font-mono">
                      {capture.status}
                    </Badge>
                    <Badge variant="outline" className="border-primary/40 text-primary font-mono">
                      {capture.shellType}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[
                    ["Risk", snapshotText(capture.snapshot, "score")],
                    ["Severity", snapshotText(capture.snapshot, "severity")],
                    ["Action", snapshotText(capture.snapshot, "action")],
                    ["Tactic", snapshotText(capture.snapshot, "tactic")],
                    ["Technique", snapshotText(capture.snapshot, "techniqueId")],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded border border-border bg-secondary/30 p-3">
                      <div className="text-[10px] font-mono text-muted-foreground uppercase">{label}</div>
                      <div className="text-sm font-mono mt-1 truncate" title={value}>{value}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded border border-border bg-background/50 p-4 space-y-2">
                  <div className="text-sm">{capture.reason}</div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs font-mono text-muted-foreground">
                    <span className="flex items-center gap-1"><ShieldBan className="w-3 h-3" /> EXECUTION DISABLED</span>
                    <span className="flex items-center gap-1"><Network className="w-3 h-3" /> NETWORK DISABLED</span>
                    <span>HASH {snapshotText(capture.snapshot, "hash").slice(0, 16)}…</span>
                    <span>{new Date(capture.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}