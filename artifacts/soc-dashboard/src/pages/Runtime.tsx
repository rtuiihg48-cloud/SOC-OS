import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { Play, RotateCcw, AlertTriangle, CheckCircle2, Server, Database, Cpu, Activity, Clock, Box, ShieldAlert } from "lucide-react";

import { 
  useGetMetaCubeHealth, 
  useListMetaCubeExecutions,
  useCreateMetaCubeExecution,
  useRetryMetaCubeExecution,
  useRecoverMetaCubeExecution,
  useListMetaCubeDlq,
  useListMetaCubeCheckpoints,
  getGetMetaCubeHealthQueryKey,
  getListMetaCubeExecutionsQueryKey,
  getListMetaCubeDlqQueryKey,
  getListMetaCubeCheckpointsQueryKey
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const newExecutionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  payload: z.string().refine((val) => {
    try {
      JSON.parse(val);
      return true;
    } catch {
      return false;
    }
  }, "Must be valid JSON"),
  steps: z.string().min(1, "At least one step required (comma separated)"),
  idempotencyKey: z.string().optional(),
  maxRetries: z.coerce.number().min(0).max(10).default(3)
});

export default function Runtime() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("executions");

  const { data: health, isLoading: isHealthLoading } = useGetMetaCubeHealth({
    query: { refetchInterval: 5000, queryKey: getGetMetaCubeHealthQueryKey() }
  });

  const { data: executions, isLoading: isExecutionsLoading } = useListMetaCubeExecutions(
    { limit: 50 },
    { query: { refetchInterval: 5000, queryKey: getListMetaCubeExecutionsQueryKey({ limit: 50 }) } }
  );

  const { data: dlq, isLoading: isDlqLoading } = useListMetaCubeDlq(
    { limit: 50 },
    { query: { refetchInterval: 10000, queryKey: getListMetaCubeDlqQueryKey({ limit: 50 }) } }
  );

  const { data: checkpoints, isLoading: isCheckpointsLoading } = useListMetaCubeCheckpoints(
    selectedExecutionId ? { executionId: selectedExecutionId } : {},
    { query: { enabled: !!selectedExecutionId, refetchInterval: 5000, queryKey: getListMetaCubeCheckpointsQueryKey({ executionId: selectedExecutionId ?? undefined }) } }
  );

  const createExecution = useCreateMetaCubeExecution({
    mutation: {
      onSuccess: () => {
        toast({ title: "Execution submitted", description: "The execution has been enqueued." });
        queryClient.invalidateQueries({ queryKey: getListMetaCubeExecutionsQueryKey({ limit: 50 }) });
        setIsCreateOpen(false);
        form.reset();
      },
      onError: (err) => {
        toast({ variant: "destructive", title: "Submission failed", description: err.message || "Unknown error" });
      }
    }
  });

  const retryExecution = useRetryMetaCubeExecution({
    mutation: {
      onSuccess: () => {
        toast({ title: "Execution retrying", description: "The execution retry has been triggered." });
        queryClient.invalidateQueries({ queryKey: getListMetaCubeExecutionsQueryKey({ limit: 50 }) });
        queryClient.invalidateQueries({ queryKey: getListMetaCubeDlqQueryKey({ limit: 50 }) });
      }
    }
  });

  const recoverExecution = useRecoverMetaCubeExecution({
    mutation: {
      onSuccess: () => {
        toast({ title: "Execution recovered", description: "The dead letter execution has been marked as recovered." });
        queryClient.invalidateQueries({ queryKey: getListMetaCubeExecutionsQueryKey({ limit: 50 }) });
        queryClient.invalidateQueries({ queryKey: getListMetaCubeDlqQueryKey({ limit: 50 }) });
      }
    }
  });

  const form = useForm<z.infer<typeof newExecutionSchema>>({
    resolver: zodResolver(newExecutionSchema),
    defaultValues: {
      name: "",
      payload: "{}",
      steps: "step1,step2",
      idempotencyKey: "",
      maxRetries: 3
    }
  });

  const onSubmit = (data: z.infer<typeof newExecutionSchema>) => {
    createExecution.mutate({
      data: {
        name: data.name,
        payload: JSON.parse(data.payload),
        steps: data.steps.split(",").map(s => s.trim()).filter(Boolean),
        idempotencyKey: data.idempotencyKey || undefined,
        maxRetries: data.maxRetries
      }
    });
  };

  const selectedExecution = useMemo(() => {
    return executions?.find(e => e.id === selectedExecutionId);
  }, [executions, selectedExecutionId]);

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header Panel */}
      <div className="flex-shrink-0 grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs uppercase font-mono text-muted-foreground flex items-center gap-2">
              <Activity className="w-3 h-3" /> Core Service
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 px-4 flex justify-between items-center">
            <span className="font-mono text-lg font-bold">{health?.service || "META-CUBE"}</span>
            <Badge variant={health?.status === "ok" ? "default" : "destructive"} className="font-mono">
              {isHealthLoading ? "..." : health?.status?.toUpperCase()}
            </Badge>
          </CardContent>
        </Card>
        
        <Card className="bg-card">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs uppercase font-mono text-muted-foreground flex items-center gap-2">
              <Database className="w-3 h-3" /> Persistence
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 px-4 flex justify-between items-center">
            <span className="font-mono text-lg font-bold capitalize">{health?.persistence || "N/A"}</span>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-xs uppercase font-mono text-muted-foreground flex items-center gap-2">
              <Cpu className="w-3 h-3" /> Worker Plane
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 px-4 flex justify-between items-center">
            <span className="font-mono text-lg font-bold capitalize">{health?.worker || "N/A"}</span>
            {health?.worker === "running" && <div className="w-2 h-2 rounded-full bg-safe animate-pulse" />}
            {health?.worker === "idle" && <div className="w-2 h-2 rounded-full bg-warn" />}
            {health?.worker === "stopped" && <div className="w-2 h-2 rounded-full bg-critical" />}
          </CardContent>
        </Card>

        <Card className="bg-card flex flex-col justify-center px-4">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="w-full font-mono gap-2" variant="default" data-testid="button-create-execution">
                <Play className="w-4 h-4" /> SUBMIT EXECUTION
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] border-primary/20">
              <DialogHeader>
                <DialogTitle className="font-mono text-primary flex items-center gap-2">
                  <Box className="w-5 h-5" /> NEW EXECUTION
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  Inject a new determinisitic payload into the META-CUBE execution queue.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 font-mono text-sm">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Execution Name</FormLabel>
                        <FormControl>
                          <Input placeholder="sys-sync-001" {...field} data-testid="input-execution-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="steps"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pipeline Steps (comma separated)</FormLabel>
                        <FormControl>
                          <Input placeholder="extract,transform,load" {...field} data-testid="input-execution-steps" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="payload"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>JSON Payload</FormLabel>
                        <FormControl>
                          <Textarea placeholder="{}" className="h-32 font-mono text-xs" {...field} data-testid="input-execution-payload" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="idempotencyKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Idempotency Key (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="uuid..." {...field} data-testid="input-execution-idempotency" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="maxRetries"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Max Retries</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} data-testid="input-execution-retries" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={createExecution.isPending} data-testid="button-submit-execution">
                      {createExecution.isPending ? "SUBMITTING..." : "ENQUEUE"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </Card>
      </div>

      {/* Main split view */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column - List */}
        <Card className="lg:col-span-1 flex flex-col h-full bg-card border-border overflow-hidden">
          <CardHeader className="py-3 px-4 border-b border-border bg-muted/20">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-background">
                <TabsTrigger value="executions" className="font-mono text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary" data-testid="tab-executions">RECENT</TabsTrigger>
                <TabsTrigger value="dlq" className="font-mono text-xs data-[state=active]:bg-destructive/20 data-[state=active]:text-destructive" data-testid="tab-dlq">DEAD LETTER</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <ScrollArea className="flex-1">
            <div className="p-0">
              {activeTab === "executions" && (
                <div className="flex flex-col divide-y divide-border">
                  {isExecutionsLoading && Array(5).fill(0).map((_, i) => (
                    <div key={i} className="p-4"><Skeleton className="h-12 w-full" /></div>
                  ))}
                  {executions?.map(exec => (
                    <button 
                      key={exec.id} 
                      onClick={() => setSelectedExecutionId(exec.id)}
                      className={`text-left p-3 hover:bg-secondary/50 transition-all flex flex-col gap-2 relative overflow-hidden group ${selectedExecutionId === exec.id ? 'bg-secondary border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'}`}
                      data-testid={`btn-select-exec-${exec.id}`}
                    >
                      {/* Subtle hover reveal */}
                      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                      <div className="flex justify-between items-center w-full relative z-10">
                        <span className="font-mono text-sm font-bold truncate max-w-[150px]">{exec.name}</span>
                        <ExecutionStatusBadge status={exec.status} />
                      </div>
                      <div className="flex justify-between items-center w-full text-muted-foreground text-xs font-mono relative z-10">
                        <span className="truncate opacity-60" title={exec.id}>{exec.id.split("-")[0]}...</span>
                        <span className="flex items-center gap-1 opacity-80"><Clock className="w-3 h-3"/> {format(new Date(exec.createdAt), "HH:mm:ss")}</span>
                      </div>
                    </button>
                  ))}
                  {executions?.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground font-mono text-sm">NO EXECUTIONS</div>
                  )}
                </div>
              )}

              {activeTab === "dlq" && (
                <div className="flex flex-col divide-y divide-border">
                  {isDlqLoading && Array(5).fill(0).map((_, i) => (
                    <div key={i} className="p-4"><Skeleton className="h-12 w-full" /></div>
                  ))}
                  {dlq?.map(exec => (
                    <button 
                      key={exec.id} 
                      onClick={() => setSelectedExecutionId(exec.id)}
                      className={`text-left p-3 hover:bg-secondary/50 transition-all flex flex-col gap-2 relative overflow-hidden group ${selectedExecutionId === exec.id ? 'bg-secondary border-l-2 border-l-destructive' : 'border-l-2 border-l-transparent'}`}
                      data-testid={`btn-select-dlq-${exec.id}`}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-destructive/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                      <div className="flex justify-between items-center w-full relative z-10">
                        <span className="font-mono text-sm font-bold truncate max-w-[150px]">{exec.name}</span>
                        <ExecutionStatusBadge status={exec.status} />
                      </div>
                      <div className="flex justify-between items-center w-full text-muted-foreground text-xs font-mono relative z-10">
                        <span className="truncate opacity-60" title={exec.id}>{exec.id.split("-")[0]}...</span>
                        <span className="text-destructive opacity-80">ATTEMPTS: {exec.attempts}</span>
                      </div>
                    </button>
                  ))}
                  {dlq?.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground font-mono text-sm">DLQ EMPTY</div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* Right Column - Details */}
        <Card className="lg:col-span-2 flex flex-col h-full bg-card border-border overflow-hidden">
          {selectedExecution ? (
            <>
              <CardHeader className="py-4 px-6 border-b border-border bg-muted/10 flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="font-mono text-xl flex items-center gap-3">
                    {selectedExecution.name}
                    <ExecutionStatusBadge status={selectedExecution.status} />
                  </CardTitle>
                  <CardDescription className="font-mono mt-1 flex items-center gap-4">
                    <span>ID: {selectedExecution.id}</span>
                    <span>•</span>
                    <span>Created: {format(new Date(selectedExecution.createdAt), "MMM d, HH:mm:ss")}</span>
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {["failed", "dead_letter"].includes(selectedExecution.status) && (
                    <>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => retryExecution.mutate({ id: selectedExecution.id })}
                        disabled={retryExecution.isPending}
                        className="font-mono text-xs border-primary/30 hover:bg-primary/10"
                        data-testid="btn-retry-exec"
                      >
                        <RotateCcw className="w-3 h-3 mr-2" /> RETRY
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={() => recoverExecution.mutate({ id: selectedExecution.id })}
                        disabled={recoverExecution.isPending}
                        className="font-mono text-xs border-safe/30 hover:bg-safe/10 text-safe"
                        data-testid="btn-recover-exec"
                      >
                        <CheckCircle2 className="w-3 h-3 mr-2" /> MARK RECOVERED
                      </Button>
                    </>
                  )}
                </div>
              </CardHeader>
              <ScrollArea className="flex-1 p-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="p-6 space-y-8">
                  {/* Progress / Steps */}
                  <div className="space-y-3">
                    <h3 className="font-mono text-sm font-bold text-muted-foreground flex items-center gap-2 border-b border-border pb-2">
                      <Server className="w-4 h-4" /> EXECUTION PIPELINE
                    </h3>
                    <div className="flex gap-2 flex-wrap">
                      {selectedExecution.steps.map((step, idx) => {
                        const isCompleted = selectedExecution.completedSteps.includes(step);
                        const isNext = !isCompleted && (idx === 0 || selectedExecution.completedSteps.includes(selectedExecution.steps[idx - 1]));
                        const isFailed = isNext && ["failed", "dead_letter"].includes(selectedExecution.status);
                        
                        return (
                          <Badge 
                            key={step} 
                            variant={isCompleted ? "default" : isFailed ? "destructive" : "outline"}
                            className={`font-mono text-xs px-3 py-1 ${isCompleted ? 'bg-primary/20 text-primary hover:bg-primary/30 border-primary/50' : isFailed ? 'animate-pulse' : 'text-muted-foreground'}`}
                          >
                            {step}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>

                  {/* Error display if any */}
                  {selectedExecution.error && (
                    <div className="bg-destructive/10 border border-destructive/30 rounded-md p-4 space-y-2">
                      <h3 className="font-mono text-sm font-bold text-destructive flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4" /> FAULT TRACE
                      </h3>
                      <div className="font-mono text-xs text-destructive/90 whitespace-pre-wrap break-all bg-background/50 p-2 rounded">
                        {selectedExecution.error}
                      </div>
                    </div>
                  )}

                  {/* Payload Info */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <h3 className="font-mono text-sm font-bold text-muted-foreground flex items-center gap-2 border-b border-border pb-2">
                        <Box className="w-4 h-4" /> INPUT PAYLOAD
                      </h3>
                      <pre className="font-mono text-xs bg-muted/30 p-3 rounded-md border border-border overflow-x-auto text-muted-foreground max-h-[300px]">
                        {JSON.stringify(selectedExecution.payload, null, 2)}
                      </pre>
                    </div>

                    <div className="space-y-3">
                      <h3 className="font-mono text-sm font-bold text-muted-foreground flex items-center gap-2 border-b border-border pb-2">
                        <Database className="w-4 h-4" /> CHECKPOINTS
                      </h3>
                      {isCheckpointsLoading ? (
                        <div className="space-y-2">
                          <Skeleton className="h-10 w-full" />
                          <Skeleton className="h-10 w-full" />
                        </div>
                      ) : checkpoints?.length === 0 ? (
                        <div className="text-xs font-mono text-muted-foreground p-4 bg-muted/10 rounded-md text-center border border-border/50">
                          NO CHECKPOINTS COMMITTED
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                          {checkpoints?.map(cp => (
                            <div key={cp.id} className="border border-border rounded-md p-2 text-xs font-mono bg-background">
                              <div className="flex justify-between items-center text-muted-foreground mb-1">
                                <span>{cp.completedSteps[cp.completedSteps.length - 1] || 'init'}</span>
                                <span>{format(new Date(cp.createdAt), "HH:mm:ss")}</span>
                              </div>
                              <div className="truncate text-foreground max-w-full">
                                State keys: {Object.keys(cp.state).join(", ")}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Meta stats */}
                  <div className="grid grid-cols-4 gap-4 pt-4 border-t border-border">
                    <div className="font-mono">
                      <div className="text-[10px] text-muted-foreground uppercase">Node Attempts</div>
                      <div className="text-lg">{selectedExecution.attempts}</div>
                    </div>
                    <div className="font-mono">
                      <div className="text-[10px] text-muted-foreground uppercase">Steps Done</div>
                      <div className="text-lg">{selectedExecution.completedSteps.length} <span className="text-muted-foreground text-sm">/ {selectedExecution.steps.length}</span></div>
                    </div>
                    <div className="font-mono">
                      <div className="text-[10px] text-muted-foreground uppercase">Retry Limit</div>
                      <div className="text-lg">{selectedExecution.maxRetries}</div>
                    </div>
                    {selectedExecution.finishedAt && (
                      <div className="font-mono">
                        <div className="text-[10px] text-muted-foreground uppercase">Finished At</div>
                        <div className="text-lg">{format(new Date(selectedExecution.finishedAt), "HH:mm:ss.SSS")}</div>
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground font-mono">
              <div className="flex flex-col items-center gap-4 opacity-50">
                <Box className="w-12 h-12" />
                <span>SELECT AN EXECUTION TO INSPECT</span>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ExecutionStatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    queued: "outline",
    running: "default",
    succeeded: "default",
    failed: "destructive",
    retrying: "secondary",
    dead_letter: "destructive",
    recovered: "outline"
  };

  const colorMap: Record<string, string> = {
    queued: "text-muted-foreground border-border",
    running: "bg-primary/20 text-primary border-primary/30 animate-pulse",
    succeeded: "bg-safe/20 text-safe border-safe/30",
    failed: "bg-destructive/20 text-destructive border-destructive/30",
    retrying: "bg-warn/20 text-warn border-warn/30",
    dead_letter: "bg-destructive text-destructive-foreground",
    recovered: "bg-safe/10 text-safe border-safe/30"
  };

  return (
    <Badge variant={variantMap[status] || "outline"} className={`font-mono uppercase text-[10px] tracking-wider ${colorMap[status]}`}>
      {status.replace("_", " ")}
    </Badge>
  );
}
