import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CyberRangeScenario,
  getGetCyberRangeQueryKey,
  type CyberRangeCube,
  type CyberRangeCubeStatus,
  useGetCyberRange,
  usePauseCyberRange,
  useResetCyberRange,
  useStartCyberRange,
} from "@workspace/api-client-react";
import { Boxes, Cpu, MemoryStick, Network, Pause, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const scenarios = [
  { value: CyberRangeScenario.MESI_COHERENCE, label: "MESI Cache Coherence" },
  { value: CyberRangeScenario.NUMA_LATENCY, label: "NUMA Latency Pressure" },
  { value: CyberRangeScenario.PIPELINE_STALL, label: "Pipeline Stall" },
  { value: CyberRangeScenario.SCHEDULER_PRESSURE, label: "Scheduler Pressure" },
  { value: CyberRangeScenario.QUARANTINE_PROPAGATION, label: "Quarantine Propagation" },
] as const;

const statusStyle: Record<CyberRangeCubeStatus, string> = {
  IDLE: "border-border bg-secondary/30 text-muted-foreground hover:border-primary/40",
  RUNNING: "border-primary bg-primary/15 text-primary shadow-[0_0_14px_hsl(var(--primary)/0.18)] animate-pulse",
  PAUSED: "border-warn/50 bg-warn/10 text-warn",
  SUCCESS: "border-safe/50 bg-safe/10 text-safe",
  ISOLATED: "border-warn bg-warn/15 text-warn",
  FAILED: "border-critical bg-critical/15 text-critical",
};

function Metric({ label, value, color = "text-foreground" }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded border border-border bg-background/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export function CyberRangePanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [scenario, setScenario] = useState<CyberRangeScenario>(CyberRangeScenario.MESI_COHERENCE);
  const [selectedCubeId, setSelectedCubeId] = useState("CUBE-001");
  const [statusFilter, setStatusFilter] = useState<"ALL" | CyberRangeCubeStatus>("ALL");
  const queryKey = getGetCyberRangeQueryKey();
  const range = useGetCyberRange({
    query: {
      queryKey,
      refetchInterval: (query) => query.state.data?.status === "RUNNING" ? 350 : 2500,
    },
  });
  const sync = (data: unknown) => queryClient.setQueryData(queryKey, data);
  const mutationError = (title: string) => () => toast({ title, description: "The process-worker control plane rejected the request.", variant: "destructive" });
  const start = useStartCyberRange({ mutation: { onSuccess: sync, onError: mutationError("RANGE START FAILED") } });
  const pause = usePauseCyberRange({ mutation: { onSuccess: sync, onError: mutationError("RANGE PAUSE FAILED") } });
  const reset = useResetCyberRange({ mutation: { onSuccess: sync, onError: mutationError("RANGE RESET FAILED") } });

  const selectedCube = useMemo(
    () => range.data?.cubes.find((cube) => cube.id === selectedCubeId) ?? range.data?.cubes[0],
    [range.data, selectedCubeId],
  );
  const visibleCubes = useMemo(
    () => range.data?.cubes.filter((cube) => statusFilter === "ALL" || cube.status === statusFilter) ?? [],
    [range.data, statusFilter],
  );
  const busy = start.isPending || pause.isPending || reset.isPending;

  return (
    <Card className="overflow-hidden border-primary/25 bg-card/70 backdrop-blur">
      <div className="h-1 bg-gradient-to-r from-primary via-safe to-primary" />
      <CardHeader className="gap-4 border-b border-border/80">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <CardTitle className="flex items-center gap-2 font-mono text-xl text-primary">
              <Boxes className="h-6 w-6" /> CYBER RANGE PROCESS LAB
            </CardTitle>
            <CardDescription className="mt-2 max-w-2xl font-mono text-xs leading-5">
              100 logical cubes execute fixed deterministic workloads in short-lived trusted processes. This is not VM or container isolation and must not run untrusted code.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-safe/40 bg-safe/10 font-mono text-[10px] text-safe">
              <ShieldCheck className="mr-1 h-3 w-3" /> FIXED-CODE PROCESS
            </Badge>
            <Badge variant="outline" className="border-warn/40 bg-warn/10 font-mono text-[10px] text-warn">
              ARBITRARY EXECUTION DISABLED
            </Badge>
            <Badge variant="outline" className="border-critical/40 bg-critical/10 font-mono text-[10px] text-critical">
              INSTANCE-LOCAL / VOLATILE
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {range.data?.status ?? "CONNECTING"}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          <Metric label="Total cubes" value={range.data?.totalCubes ?? 100} color="text-primary" />
          <Metric label="Active OS procs" value={range.data?.activeProcessWorkers ?? 0} color="text-primary" />
          <Metric label="Running" value={range.data?.runningCubes ?? 0} color="text-primary" />
          <Metric label="Completed" value={range.data?.completedCubes ?? 0} color="text-safe" />
          <Metric label="Success" value={range.data?.successCubes ?? 0} color="text-safe" />
          <Metric label="Isolated" value={range.data?.isolatedCubes ?? 0} color="text-warn" />
          <Metric label="Failed" value={range.data?.failedCubes ?? 0} color="text-critical" />
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded border border-border bg-background/50 px-3">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Scenario</span>
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value as CyberRangeScenario)}
              disabled={range.data?.status === "RUNNING"}
              className="h-10 min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
            >
              {scenarios.map((item) => <option key={item.value} value={item.value} className="bg-card">{item.label}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => start.mutate({ data: { scenario } })}
              disabled={busy || range.data?.status === "RUNNING"}
              className="gap-2 font-mono text-xs tracking-wider"
            >
              <Play className="h-4 w-4" /> START 100 CUBES
            </Button>
            <Button onClick={() => pause.mutate()} disabled={busy || range.data?.status !== "RUNNING"} variant="outline" className="gap-2 font-mono text-xs">
              <Pause className="h-4 w-4" /> PAUSE
            </Button>
            <Button onClick={() => reset.mutate()} disabled={busy} variant="outline" className="gap-2 font-mono text-xs">
              <RotateCcw className="h-4 w-4" /> RESET
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 lg:p-6">
        {range.isError ? (
          <div className="rounded border border-critical/40 bg-critical/10 p-6 text-center font-mono text-sm text-critical">
            CYBER RANGE CONTROL PLANE UNAVAILABLE
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  10 × 10 isolation matrix
                </div>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as "ALL" | CyberRangeCubeStatus)}
                  className="h-8 rounded border border-border bg-background px-2 font-mono text-[10px] outline-none"
                >
                  {["ALL", "IDLE", "RUNNING", "PAUSED", "SUCCESS", "ISOLATED", "FAILED"].map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10" aria-label="100 isolated cyber range cubes">
                {visibleCubes.map((cube) => (
                  <button
                    key={cube.id}
                    type="button"
                    onClick={() => setSelectedCubeId(cube.id)}
                    className={`group relative aspect-square min-h-11 overflow-hidden rounded border p-1 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${statusStyle[cube.status]} ${selectedCube?.id === cube.id ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
                    aria-label={`${cube.id} ${cube.status}`}
                    title={`${cube.id} · ${cube.status} · ${cube.progress}%`}
                  >
                    <span className="block truncate font-mono text-[8px] font-semibold sm:text-[9px]">{String(cube.index + 1).padStart(3, "0")}</span>
                    <span className="absolute inset-x-1 bottom-1 h-0.5 overflow-hidden rounded bg-foreground/10">
                      <span className="block h-full bg-current transition-[width]" style={{ width: `${cube.progress}%` }} />
                    </span>
                  </button>
                ))}
              </div>
              {statusFilter !== "ALL" && visibleCubes.length === 0 && (
                <div className="rounded border border-dashed border-border p-8 text-center font-mono text-xs text-muted-foreground">
                  NO CUBES MATCH {statusFilter}
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-2 font-mono text-[9px] uppercase text-muted-foreground">
                {Object.entries(statusStyle).map(([status, style]) => (
                  <span key={status} className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-sm border ${style.split(" ").slice(0, 2).join(" ")}`} /> {status}
                  </span>
                ))}
              </div>
            </div>

            <CubeDetails cube={selectedCube} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CubeDetails({ cube }: { cube?: CyberRangeCube }) {
  if (!cube) {
    return <div className="rounded border border-border bg-background/40 p-5 font-mono text-xs text-muted-foreground">SELECT A CUBE</div>;
  }
  return (
    <aside className="rounded border border-border bg-background/50 p-4">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="font-mono text-lg font-bold text-primary">{cube.id}</div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">{cube.scenario}</div>
        </div>
        <Badge variant="outline" className={`font-mono text-[9px] ${statusStyle[cube.status]}`}>{cube.status}</Badge>
      </div>
      <div className="mt-4 space-y-3 font-mono text-xs">
        <Layer icon={Cpu} label="L1 · EXECUTION CORES" value={cube.cores ? `${cube.cores} CORES` : "STANDBY"} />
        <Layer icon={MemoryStick} label="L2 · NUMA FABRIC" value={cube.numaNodes ? `${cube.numaNodes} NODES · ${cube.numaLatencyNs}ns` : "UNMAPPED"} />
        <Layer icon={Network} label="L3 · MESI COHERENCE" value={cube.cacheState ? `${cube.cacheState} · ${Math.round((cube.cacheHitRate ?? 0) * 100)}% HIT` : "INVALID"} />
        <Layer icon={Boxes} label="L4 · CYCLE ENGINE" value={cube.cycles ? `${cube.cycles} CYCLES` : "0 CYCLES"} />
      </div>
      <div className="mt-4 rounded border border-border bg-card/60 p-3">
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Latest observation</div>
        <div className="mt-2 break-words font-mono text-xs text-foreground">{cube.event ?? "No observation recorded"}</div>
        {cube.error && <div className="mt-2 font-mono text-[10px] text-critical">{cube.error}</div>}
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between font-mono text-[9px] text-muted-foreground"><span>PROGRESS</span><span>{cube.progress}%</span></div>
        <div className="h-1.5 overflow-hidden rounded bg-secondary">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${cube.progress}%` }} />
        </div>
      </div>
    </aside>
  );
}

function Layer({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded border border-border/70 p-2.5">
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <div className="truncate text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-0.5 truncate text-[11px] text-foreground">{value}</div>
      </div>
    </div>
  );
}