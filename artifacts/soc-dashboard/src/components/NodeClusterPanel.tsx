import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  NodeTaskKind,
  CyberRangeScenario,
  NodeCapability,
  NodeTaskPriority,
  useGetNodeCluster,
  getGetNodeClusterQueryKey,
  useDispatchNodeClusterTask,
  type NodeStatus,
  type NodeRelayStatus,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Server, Send, ShieldCheck, BoxSelect, Cpu } from "lucide-react";

const scenarios = [
  { value: CyberRangeScenario.MESI_COHERENCE, label: "MESI Cache Coherence" },
  { value: CyberRangeScenario.NUMA_LATENCY, label: "NUMA Latency Pressure" },
  { value: CyberRangeScenario.PIPELINE_STALL, label: "Pipeline Stall" },
  { value: CyberRangeScenario.SCHEDULER_PRESSURE, label: "Scheduler Pressure" },
  { value: CyberRangeScenario.QUARANTINE_PROPAGATION, label: "Quarantine Propagation" },
] as const;

const capabilityLabels = [
  { value: NodeCapability.CPU, label: "CPU" },
  { value: NodeCapability.MEMORY, label: "MEM" },
  { value: NodeCapability.NUMA, label: "NUMA" },
  { value: NodeCapability.CACHE, label: "CACHE" },
  { value: NodeCapability.TELEMETRY, label: "TEL" },
] as const;

const priorityLabels = [
  { value: NodeTaskPriority.LOW, label: "LOW" },
  { value: NodeTaskPriority.NORMAL, label: "NORMAL" },
  { value: NodeTaskPriority.HIGH, label: "HIGH" },
] as const;

const kindLabels = [
  { value: NodeTaskKind.SIMULATION, label: "SIMULATION" },
  { value: NodeTaskKind.OBSERVATION, label: "OBSERVATION" },
] as const;

const nodeStatusBg: Record<NodeStatus, string> = {
  ONLINE: "bg-safe shadow-[0_0_8px_hsl(var(--safe)/0.5)]",
  BUSY: "bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.5)] animate-pulse",
  DEGRADED: "bg-warn shadow-[0_0_8px_hsl(var(--warn)/0.5)]",
  OFFLINE: "bg-muted-foreground",
  QUARANTINED: "bg-critical shadow-[0_0_8px_hsl(var(--critical)/0.5)]",
  DRAINING: "bg-warn/60",
};

const msgStatusStyle: Record<NodeRelayStatus, string> = {
  CREATED: "border-muted bg-muted/20 text-muted-foreground",
  QUEUED: "border-warn/40 bg-warn/10 text-warn",
  ACCEPTED: "border-primary/40 bg-primary/10 text-primary",
  REJECTED: "border-critical/40 bg-critical/10 text-critical",
  EXPIRED: "border-critical/40 bg-critical/10 text-critical",
  EXECUTED: "border-safe/40 bg-safe/10 text-safe",
  FAILED: "border-critical/40 bg-critical/10 text-critical",
};

function Metric({ label, value, color = "text-foreground" }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded border border-border bg-background/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) + '.' + d.getMilliseconds().toString().padStart(3, '0');
  } catch {
    return iso;
  }
}

export function NodeClusterPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [taskKind, setTaskKind] = useState<typeof NodeTaskKind[keyof typeof NodeTaskKind]>(NodeTaskKind.SIMULATION);
  const [scenario, setScenario] = useState<typeof CyberRangeScenario[keyof typeof CyberRangeScenario]>(CyberRangeScenario.MESI_COHERENCE);
  const [capabilities, setCapabilities] = useState<(typeof NodeCapability[keyof typeof NodeCapability])[]>([NodeCapability.CPU]);
  const [priority, setPriority] = useState<typeof NodeTaskPriority[keyof typeof NodeTaskPriority]>(NodeTaskPriority.NORMAL);

  const queryKey = getGetNodeClusterQueryKey();
  const cluster = useGetNodeCluster({
    query: {
      queryKey,
      refetchInterval: (query) => {
        const state = query.state.data;
        if (state && (state.activeTasks > 0 || state.queueDepth > 0)) return 800;
        return 3500;
      },
    },
  });

  const dispatch = useDispatchNodeClusterTask({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey });
        toast({ title: "TASK DISPATCHED", description: `Task routed to queue. ID: ${data.taskId.substring(0, 8)}` });
      },
      onError: () => {
        toast({ title: "DISPATCH FAILED", description: "Relay rejected the task payload.", variant: "destructive" });
      }
    }
  });

  const handleDispatch = () => {
    const data = taskKind === NodeTaskKind.SIMULATION
      ? {
          kind: NodeTaskKind.SIMULATION,
          scenario,
          requiredCapabilities: capabilities,
          priority,
        }
      : {
          kind: NodeTaskKind.OBSERVATION,
          scenario: null,
          requiredCapabilities: capabilities,
          priority,
        };
    dispatch.mutate({
      data,
    });
  };

  const state = cluster.data;

  return (
    <Card className="overflow-hidden border-primary/25 bg-card/70 backdrop-blur">
      <div className="h-1 bg-gradient-to-r from-primary via-safe to-primary" />
      <CardHeader className="gap-4 border-b border-border/80">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <CardTitle className="flex items-center gap-2 font-mono text-xl text-primary">
              <Server className="h-6 w-6" /> NODE CLUSTER RELAY
            </CardTitle>
            <CardDescription className="mt-2 max-w-2xl font-mono text-xs leading-5">
              Ten logical process slots spawn fixed-code workers through Ed25519-signed local IPC. Allowlisted metadata only; instance-local and volatile, with no VM or container isolation.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-safe/40 bg-safe/10 font-mono text-[10px] text-safe">
              <ShieldCheck className="mr-1 h-3 w-3" /> SIGNED LOCAL IPC
            </Badge>
            <Badge variant="outline" className="border-warn/40 bg-warn/10 font-mono text-[10px] text-warn">
              ALLOWLISTED METADATA
            </Badge>
            <Badge variant="outline" className="border-critical/40 bg-critical/10 font-mono text-[10px] text-critical">
              <Cpu className="mr-1 h-3 w-3" /> LOCAL VOLATILE
            </Badge>
          </div>
        </div>

        {state && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            <Metric label="Active Tasks" value={state.activeTasks} color="text-primary" />
            <Metric label="Queue Depth" value={state.queueDepth} color={state.queueDepth > 0 ? "text-warn" : "text-safe"} />
            <Metric label="Completed" value={state.completedTasks} color="text-safe" />
            <Metric label="Rejected" value={state.rejectedTasks} color={state.rejectedTasks > 0 ? "text-critical" : "text-muted-foreground"} />
            <Metric label="Live Nodes" value={state.nodes.filter(n => n.status === "ONLINE" || n.status === "BUSY").length + " / " + state.maxNodes} color="text-foreground" />
          </div>
        )}
      </CardHeader>

      <CardContent className="p-4 lg:p-6">
        {!state ? (
          <div className="flex h-64 items-center justify-center rounded border border-dashed border-border/50 bg-background/30 font-mono text-sm text-muted-foreground">
            {cluster.isError ? "CLUSTER CONTROL PLANE UNAVAILABLE" : "CONNECTING TO RELAY..."}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-12">
            {/* Dispatch Panel */}
            <div className="lg:col-span-3 space-y-4">
              <div className="rounded border border-border bg-background/50 p-4 flex flex-col gap-4">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-primary font-bold">
                  <BoxSelect className="h-3 w-3" /> DISPATCH TASK
                </div>
                
                <div className="space-y-2">
                  <label className="text-[9px] font-mono uppercase text-muted-foreground">Task Kind</label>
                  <div className="flex gap-1.5">
                    {kindLabels.map(k => (
                       <button 
                         key={k.value} 
                         onClick={() => setTaskKind(k.value)}
                         className={`flex-1 py-1.5 text-[10px] font-mono border rounded transition-colors ${taskKind === k.value ? 'bg-primary/20 border-primary text-primary shadow-[0_0_8px_hsl(var(--primary)/0.2)]' : 'bg-transparent border-border text-muted-foreground hover:bg-secondary/50'}`}
                       >{k.label}</button>
                    ))}
                  </div>
                </div>

                {taskKind === NodeTaskKind.SIMULATION && (
                  <div className="space-y-2">
                    <label className="text-[9px] font-mono uppercase text-muted-foreground">Scenario</label>
                    <select 
                      value={scenario} 
                      onChange={e => setScenario(e.target.value as typeof scenario)}
                      className="w-full h-8 bg-background border border-border rounded text-[10px] font-mono px-2 outline-none focus:border-primary"
                    >
                       {scenarios.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[9px] font-mono uppercase text-muted-foreground">Capabilities Required</label>
                  <div className="flex flex-wrap gap-1.5">
                    {capabilityLabels.map(cap => (
                       <button 
                         key={cap.value} 
                         onClick={() => setCapabilities(c => c.includes(cap.value) ? (c.length > 1 ? c.filter(x => x !== cap.value) : c) : [...c, cap.value])}
                         className={`px-2 py-1 text-[9px] font-mono border rounded transition-colors ${capabilities.includes(cap.value) ? 'bg-primary/20 border-primary text-primary' : 'bg-transparent border-border text-muted-foreground hover:bg-secondary/50'}`}
                       >{cap.label}</button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[9px] font-mono uppercase text-muted-foreground">Priority</label>
                  <div className="flex gap-1.5">
                    {priorityLabels.map(p => (
                       <button 
                         key={p.value} 
                         onClick={() => setPriority(p.value)}
                         className={`flex-1 py-1.5 text-[10px] font-mono border rounded transition-colors ${priority === p.value ? 'bg-primary/20 border-primary text-primary' : 'bg-transparent border-border text-muted-foreground hover:bg-secondary/50'}`}
                       >{p.label}</button>
                    ))}
                  </div>
                </div>

                <Button onClick={handleDispatch} disabled={dispatch.isPending} className="w-full h-9 text-xs font-mono mt-2 gap-2 tracking-wider">
                    <Send className="h-3 w-3" /> DISPATCH TASK
                </Button>
              </div>
            </div>

            {/* Nodes List */}
            <div className="lg:col-span-5 flex flex-col min-h-[400px]">
              <div className="rounded border border-border bg-background/50 overflow-hidden flex flex-col h-full">
                <div className="grid grid-cols-[80px_1fr_40px_35px] gap-3 px-3 py-2 border-b border-border bg-secondary/30 text-[9px] font-mono text-muted-foreground uppercase tracking-wider">
                   <div>Node ID</div>
                   <div>Utilization</div>
                   <div className="text-right">Tsk</div>
                   <div className="text-right">Hlth</div>
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                  {state.nodes.map(node => (
                     <div key={node.nodeId} className="grid grid-cols-[80px_1fr_40px_35px] items-center gap-3 px-2 py-2 rounded bg-background border border-border/40 hover:border-border transition-colors">
                       <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${nodeStatusBg[node.status]}`} title={node.status} />
                          <span className="font-mono text-[10px] font-medium truncate text-foreground/90">{node.nodeId}</span>
                       </div>
                       <div className="flex flex-col gap-1.5">
                          <div className="flex-1 h-1.5 bg-secondary rounded overflow-hidden">
                             <div className={`h-full transition-[width] ${node.healthScore < 50 ? 'bg-critical' : node.healthScore < 80 ? 'bg-warn' : 'bg-primary'}`} style={{ width: `${(node.activeTasks / node.capacity) * 100}%` }} />
                          </div>
                          <div className="flex gap-0.5 shrink-0">
                             {node.capabilities.map(cap => (
                               <span key={cap} className="w-3 h-3 rounded bg-secondary/60 flex items-center justify-center text-[7px] font-mono text-muted-foreground" title={cap}>
                                 {cap.charAt(0)}
                               </span>
                             ))}
                          </div>
                       </div>
                       <div className="font-mono text-[10px] text-right text-foreground/80">{node.activeTasks}/{node.capacity}</div>
                       <div className={`font-mono text-[10px] text-right ${node.healthScore < 80 ? 'text-warn' : 'text-safe'}`}>{node.healthScore}%</div>
                     </div>
                  ))}
                  {state.nodes.length === 0 && (
                     <div className="p-4 text-center text-xs font-mono text-muted-foreground">NO NODES ALLOCATED</div>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="lg:col-span-4 flex flex-col min-h-[400px]">
              <div className="rounded border border-border bg-background/50 flex flex-col h-full overflow-hidden">
                <div className="px-3 py-2 border-b border-border bg-secondary/30 text-[9px] uppercase tracking-widest text-muted-foreground flex justify-between font-mono">
                  <span>Relay Messages</span>
                  <span className="text-primary">{state.messages.length} TRACES</span>
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                  {state.messages.map(msg => (
                     <div key={msg.messageId} className="border border-border/60 rounded bg-background p-2.5 hover:border-border transition-colors">
                       <div className="flex justify-between items-start mb-1.5">
                         <span className="text-[9px] font-mono text-muted-foreground">{formatTime(msg.submittedAt)}</span>
                         <Badge variant="outline" className={`text-[8px] font-mono h-4 px-1.5 py-0 ${msgStatusStyle[msg.status]}`}>{msg.status}</Badge>
                       </div>
                       <div className="flex items-center gap-1.5">
                         <span className={`text-[10px] font-mono font-bold ${msg.kind === 'SIMULATION' ? 'text-warn' : 'text-primary'}`}>{msg.kind}</span>
                         {msg.scenario && <span className="text-[9px] font-mono text-muted-foreground truncate flex-1">· {msg.scenario}</span>}
                       </div>
                       
                       {msg.resultObservation && (
                         <div className="mt-1.5 rounded bg-secondary/40 p-1.5 text-[9px] font-mono text-foreground/80 border border-border/40">
                           {msg.resultObservation}
                         </div>
                       )}
                        {msg.taskSignatureVerified && (
                          <div className="mt-1.5 text-[8px] font-mono uppercase tracking-wider text-safe">
                            Ed25519 task signature verified
                          </div>
                        )}

                       <div className="flex justify-between items-center mt-2.5">
                          <div className="flex gap-1 text-[8px] font-mono uppercase">
                            <span className={msg.priority === 'HIGH' ? 'text-critical font-bold' : msg.priority === 'LOW' ? 'text-muted-foreground' : 'text-foreground/70'}>
                              {msg.priority}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground">{msg.taskId.substring(0, 6)}</span>
                          </div>
                          <span className="text-[9px] font-mono text-safe bg-safe/10 px-1 rounded border border-safe/20">
                            {msg.destinationNodeId ? msg.destinationNodeId : 'QUEUE'}
                          </span>
                       </div>
                     </div>
                  ))}
                  {state.messages.length === 0 && (
                    <div className="p-4 text-center text-xs font-mono text-muted-foreground">NO MESSAGES</div>
                  )}
                </div>
              </div>
            </div>
            
          </div>
        )}
      </CardContent>
    </Card>
  );
}
