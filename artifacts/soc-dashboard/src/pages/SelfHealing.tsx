import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Shield, Activity, HardDrive, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Play, Eye, Clock, Hash, Lock } from "lucide-react";
import {
  useListManagedResources,
  useListRestorePoints,
  useListSelfHealingActions,
  useRegisterManagedResource,
  usePreviewRestorePoint,
  useApplyRestorePoint,
  getListManagedResourcesQueryKey,
  getListRestorePointsQueryKey,
  getListSelfHealingActionsQueryKey,
} from "@workspace/api-client-react";

import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

function truncateHash(hash: string | null | undefined) {
  if (!hash) return "—";
  return hash.substring(0, 12) + "…";
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, { 
    month: 'short', day: 'numeric', 
    hour: '2-digit', minute: '2-digit', second: '2-digit' 
  });
}

function StatusBadge({ status }: { status: string }) {
  const normalized = (status || "").toUpperCase();
  if (["VERIFIED", "RESTORED", "READY", "SECURE", "OK"].includes(normalized)) {
    return <Badge variant="outline" className="border-safe/50 text-safe font-mono">{normalized}</Badge>;
  }
  if (["QUARANTINED", "REJECTED", "FAILED", "DEGRADED", "CRITICAL"].includes(normalized)) {
    return <Badge variant="outline" className="border-critical/50 text-critical font-mono">{normalized}</Badge>;
  }
  if (["RESTORING", "USED", "APPLY", "AUTO"].includes(normalized)) {
    return <Badge variant="outline" className="border-primary/50 text-primary font-mono">{normalized}</Badge>;
  }
  return <Badge variant="outline" className="font-mono text-muted-foreground">{normalized}</Badge>;
}

export default function SelfHealing() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("resources");

  const [registerOpen, setRegisterOpen] = useState(false);
  const [regKey, setRegKey] = useState("");
  const [regLocation, setRegLocation] = useState("managed://");
  const [regState, setRegState] = useState("{\n  \n}");

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewingId, setPreviewingId] = useState<number | null>(null);

  const { data: resources = [], isLoading: loadingResources } = useListManagedResources({ limit: 100 }, {
    query: { queryKey: getListManagedResourcesQueryKey({ limit: 100 }), refetchInterval: 5000 }
  });

  const { data: restorePoints = [], isLoading: loadingPoints } = useListRestorePoints({ limit: 100 }, {
    query: { queryKey: getListRestorePointsQueryKey({ limit: 100 }), refetchInterval: 5000 }
  });

  const { data: actions = [], isLoading: loadingActions } = useListSelfHealingActions({ limit: 100 }, {
    query: { queryKey: getListSelfHealingActionsQueryKey({ limit: 100 }), refetchInterval: 5000 }
  });

  const registerMutation = useRegisterManagedResource({
    mutation: {
      onSuccess: () => {
        toast({ title: "RESOURCE REGISTERED", description: "Verified restore point created." });
        setRegisterOpen(false);
        setRegKey("");
        setRegLocation("managed://");
        setRegState("{\n  \n}");
        queryClient.invalidateQueries({ queryKey: getListManagedResourcesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListRestorePointsQueryKey() });
      },
      onError: (err: any) => {
        toast({ title: "REGISTRATION FAILED", description: err.message || "Invalid input", variant: "destructive" });
      }
    }
  });

  const previewMutation = usePreviewRestorePoint({
    mutation: {
      onSuccess: () => {
        setPreviewOpen(true);
        queryClient.invalidateQueries({ queryKey: getListSelfHealingActionsQueryKey() });
      },
      onError: (err: any) => {
        toast({ title: "PREVIEW FAILED", description: err.message || "Failed to generate preview", variant: "destructive" });
        setPreviewingId(null);
      }
    }
  });

  const applyMutation = useApplyRestorePoint({
    mutation: {
      onSuccess: () => {
        toast({ title: "ROLLBACK APPLIED", description: "State restored and integrity verified." });
        setPreviewOpen(false);
        setPreviewingId(null);
        queryClient.invalidateQueries({ queryKey: getListManagedResourcesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSelfHealingActionsQueryKey() });
      },
      onError: (err: any) => {
        toast({ title: "ROLLBACK FAILED", description: err.message || "Could not apply rollback", variant: "destructive" });
      }
    }
  });

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsedState = JSON.parse(regState);
      if (!parsedState || Array.isArray(parsedState) || typeof parsedState !== "object") {
        throw new Error("State must be a JSON object");
      }
      registerMutation.mutate({
        data: {
          resourceKey: regKey,
          location: regLocation,
          state: parsedState
        }
      });
    } catch (err) {
      toast({
        title: "INVALID JSON STATE",
        description: err instanceof Error ? err.message : "State must be a JSON object.",
        variant: "destructive",
      });
    }
  };

  const handlePreview = (id: number) => {
    setPreviewingId(id);
    previewMutation.mutate({ id });
  };

  const handleApply = () => {
    if (previewingId) {
      applyMutation.mutate({ id: previewingId, data: {} });
    }
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-mono uppercase tracking-widest text-primary flex items-center gap-2">
            <Shield className="w-6 h-6" /> Self-Healing Subsystem
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            Immutable resource management and state rollback. Only logical locations are governed.
          </p>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <Badge variant="outline" className="border-safe/40 text-safe font-mono tracking-widest px-3 py-1">
            <Lock className="w-3 h-3 mr-2 inline" /> HOST EXECUTION: DISABLED
          </Badge>
          <div className="text-xs font-mono text-muted-foreground">
            TARGET: managed://* RESTRICTED
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-primary/10 rounded-md">
              <HardDrive className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Managed Resources</div>
              <div className="text-2xl font-mono font-bold mt-1">{resources.length}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-safe/10 rounded-md">
              <RefreshCw className="w-6 h-6 text-safe" />
            </div>
            <div>
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Restore Points</div>
              <div className="text-2xl font-mono font-bold mt-1">{restorePoints.length}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border shadow-sm">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-secondary rounded-md">
              <Activity className="w-6 h-6 text-foreground" />
            </div>
            <div>
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Audit Actions</div>
              <div className="text-2xl font-mono font-bold mt-1">{actions.length}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none h-12 bg-transparent p-0 space-x-6">
          <TabsTrigger 
            value="resources" 
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-full px-2 font-mono uppercase tracking-widest text-xs"
          >
            Logical Resources
          </TabsTrigger>
          <TabsTrigger 
            value="restore-points" 
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-full px-2 font-mono uppercase tracking-widest text-xs"
          >
            Restore Points
          </TabsTrigger>
          <TabsTrigger 
            value="audit" 
            className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-full px-2 font-mono uppercase tracking-widest text-xs"
          >
            Recovery Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resources" className="pt-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium tracking-wide">Verified Resources</h3>
            <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="font-mono text-xs border-primary/50 text-primary hover:bg-primary/10">
                  <HardDrive className="w-4 h-4 mr-2" /> REGISTER RESOURCE
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px] border-primary/20 bg-card/95 backdrop-blur">
                <DialogHeader>
                  <DialogTitle className="font-mono text-primary flex items-center gap-2">
                    <HardDrive className="w-5 h-5" /> REGISTER MANAGED RESOURCE
                  </DialogTitle>
                  <DialogDescription className="font-mono text-xs mt-2">
                    Attach a logical resource to the self-healing subsystem.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleRegister} className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label className="font-mono text-xs uppercase text-muted-foreground">Resource Key</Label>
                    <Input 
                      className="font-mono bg-background/50 border-border" 
                      placeholder="e.g. system.config.network" 
                      value={regKey}
                      onChange={(e) => setRegKey(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-mono text-xs uppercase text-muted-foreground">Location</Label>
                    <Input 
                      className="font-mono bg-background/50 border-border" 
                      placeholder="managed://..." 
                      value={regLocation}
                      onChange={(e) => setRegLocation(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-mono text-xs uppercase text-muted-foreground">Initial State (JSON)</Label>
                    <Textarea 
                      className="font-mono text-sm bg-background/50 border-border min-h-[120px]" 
                      value={regState}
                      onChange={(e) => setRegState(e.target.value)}
                      required
                    />
                  </div>
                  <DialogFooter className="pt-4">
                    <Button type="button" variant="ghost" onClick={() => setRegisterOpen(false)} className="font-mono text-xs">
                      CANCEL
                    </Button>
                    <Button type="submit" disabled={registerMutation.isPending} className="font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90">
                      {registerMutation.isPending ? "REGISTERING..." : "REGISTER"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          
          <Card className="border-border bg-card/50 overflow-hidden">
            <Table>
              <TableHeader className="bg-secondary/50">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase w-[100px]">ID</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Key</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Location</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">State Hash</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Integrity</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingResources ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono text-sm animate-pulse">
                      [ SCANNING LOGICAL RESOURCES... ]
                    </TableCell>
                  </TableRow>
                ) : resources.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono text-sm">
                      No managed resources registered.
                    </TableCell>
                  </TableRow>
                ) : (
                  resources.map(res => (
                    <TableRow key={res.id} className="border-border hover:bg-secondary/30">
                      <TableCell className="font-mono text-xs text-muted-foreground">#{res.id}</TableCell>
                      <TableCell className="font-mono text-xs font-medium">{res.resourceKey}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{res.location}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground flex items-center gap-1">
                        <Hash className="w-3 h-3" /> {truncateHash(res.stateHash)}
                      </TableCell>
                      <TableCell><StatusBadge status={res.integrityStatus} /></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground text-right">{formatDate(res.updatedAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="restore-points" className="pt-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium tracking-wide">Immutable Restore Points</h3>
          </div>
          
          <Card className="border-border bg-card/50 overflow-hidden">
            <Table>
              <TableHeader className="bg-secondary/50">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase w-[100px]">ID</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Resource</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Hash</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Status</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Created</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingPoints ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono text-sm animate-pulse">
                      [ LOADING RESTORE POINTS... ]
                    </TableCell>
                  </TableRow>
                ) : restorePoints.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono text-sm">
                      No restore points generated.
                    </TableCell>
                  </TableRow>
                ) : (
                  restorePoints.map(point => (
                    <TableRow key={point.id} className="border-border hover:bg-secondary/30">
                      <TableCell className="font-mono text-xs text-muted-foreground">#{point.id}</TableCell>
                      <TableCell>
                        <div className="font-mono text-xs font-medium">{point.resourceKey}</div>
                        <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{point.location}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground flex items-center gap-1">
                        <Hash className="w-3 h-3" /> {truncateHash(point.stateHash)}
                      </TableCell>
                      <TableCell><StatusBadge status={point.status} /></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{formatDate(point.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="font-mono text-xs hover:bg-primary/20 hover:text-primary transition-colors"
                          onClick={() => handlePreview(point.id)}
                          disabled={previewMutation.isPending && previewingId === point.id}
                        >
                          <Eye className="w-3 h-3 mr-2" />
                          {previewMutation.isPending && previewingId === point.id ? "PREVIEWING..." : "PREVIEW"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="pt-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium tracking-wide">Self-Healing Execution Log</h3>
          </div>
          
          <Card className="border-border bg-card/50 overflow-hidden">
            <Table>
              <TableHeader className="bg-secondary/50">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase w-[100px]">Action ID</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Mode</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Target</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Hashes (Prev → New)</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase">Status</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase text-right">Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingActions ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono text-sm animate-pulse">
                      [ FETCHING AUDIT LOGS... ]
                    </TableCell>
                  </TableRow>
                ) : actions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground font-mono text-sm">
                      No self-healing actions executed.
                    </TableCell>
                  </TableRow>
                ) : (
                  actions.map(action => (
                    <TableRow key={action.id} className="border-border hover:bg-secondary/30">
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        <div>#{action.id}</div>
                        {action.eventId && <div className="text-[9px] mt-1 text-primary/70">EVT: #{action.eventId}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px] bg-background/50">
                          {action.mode}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs">{action.resourceKey}</div>
                        <div className="font-mono text-[10px] text-muted-foreground max-w-[200px] truncate" title={action.location}>
                          {action.location}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">
                        <div>{truncateHash(action.previousStateHash || "")}</div>
                        <div>↓</div>
                        <div className="text-foreground">{truncateHash(action.restoredStateHash || "")}</div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={action.status} />
                        <div className="font-mono text-[10px] text-muted-foreground mt-1 max-w-[200px] truncate" title={action.message}>
                          {action.message}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground text-right">
                        {formatDate(action.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={(open) => {
        setPreviewOpen(open);
        if (!open) setPreviewingId(null);
      }}>
        <DialogContent className="sm:max-w-[700px] border-primary/30 bg-card/95 backdrop-blur">
          <DialogHeader>
            <DialogTitle className="font-mono text-primary flex items-center gap-2 text-lg">
              <Play className="w-5 h-5" /> ROLLBACK PREVIEW
            </DialogTitle>
            <DialogDescription className="font-mono text-xs mt-2 border-b border-border pb-4">
              Review state divergence and integrity assertions before applying rollback.
            </DialogDescription>
          </DialogHeader>

          {previewMutation.data && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1 p-3 rounded border border-border bg-background/50">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase">Target Resource</div>
                  <div className="font-mono text-sm">{previewMutation.data.resourceKey}</div>
                  <div className="text-xs font-mono text-muted-foreground break-all">{previewMutation.data.location}</div>
                </div>
                <div className="space-y-1 p-3 rounded border border-border bg-background/50">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase">Restore Point</div>
                  <div className="font-mono text-sm">#{previewMutation.data.restorePointId}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {previewMutation.data.canRestore ? (
                      <Badge variant="outline" className="border-safe/40 text-safe font-mono text-[10px]">APPLICABLE</Badge>
                    ) : (
                      <Badge variant="outline" className="border-critical/40 text-critical font-mono text-[10px]">INCOMPATIBLE</Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase border-b border-border pb-1">Current State Hash</div>
                  <div className="font-mono text-xs bg-muted/30 p-2 rounded break-all text-critical/80">
                    {previewMutation.data.currentStateHash}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase border-b border-border pb-1">Target State Hash</div>
                  <div className="font-mono text-xs bg-muted/30 p-2 rounded break-all text-safe/80">
                    {previewMutation.data.targetStateHash}
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4 border-t border-border/50">
                <div className="flex items-center gap-2">
                  {previewMutation.data.integrityVerified ? (
                    <CheckCircle2 className="w-4 h-4 text-safe" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-warn" />
                  )}
                  <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Integrity</span>
                </div>
                <div className="flex items-center gap-2">
                  {previewMutation.data.sameLocation ? (
                    <CheckCircle2 className="w-4 h-4 text-safe" />
                  ) : (
                    <XCircle className="w-4 h-4 text-critical" />
                  )}
                  <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Location Match</span>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  {!previewMutation.data.executionAllowed ? (
                    <Lock className="w-4 h-4 text-safe" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-critical" />
                  )}
                  <span className="text-xs font-mono uppercase tracking-widest text-safe">Exec Blocked</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="pt-6 border-t border-border mt-4">
            <Button variant="ghost" onClick={() => setPreviewOpen(false)} className="font-mono text-xs">
              CANCEL
            </Button>
            <Button 
              onClick={handleApply} 
              disabled={applyMutation.isPending || !previewMutation.data?.canRestore}
              className="font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {applyMutation.isPending ? "APPLYING..." : "APPLY ROLLBACK"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
