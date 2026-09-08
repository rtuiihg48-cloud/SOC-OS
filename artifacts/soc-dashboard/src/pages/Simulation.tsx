import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useRunSimulation, useRunSelfTest, getGetDashboardQueryKey, getListEventsQueryKey, getListPatchesQueryKey, getGetThreatGraphQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Play, Shield, Terminal, Zap, CheckCircle2, AlertTriangle, Bug, Wrench, ShieldAlert } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { CyberRangePanel } from "@/components/CyberRangePanel";
import { NodeClusterPanel } from "@/components/NodeClusterPanel";

type SimStep = {
  id: string;
  title: string;
  description: string;
  type: 'info' | 'attack' | 'fix' | 'success';
  tactic?: string;
};

type SelfTestResult = {
  systemStatus: string;
  patchesApplied: number;
  vulnerabilities: Array<{ attack: string; score: number; tactic?: string | null }>;
};

export default function Simulation() {
  const [isRunning, setIsRunning] = useState(false);
  const [isSelfTestRunning, setIsSelfTestRunning] = useState(false);
  const [steps, setSteps] = useState<SimStep[]>([]);
  const [selfTestResult, setSelfTestResult] = useState<SelfTestResult | null>(null);

  const runSimulation = useRunSimulation();
  const runSelfTest = useRunSelfTest();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [quota, setQuota] = useState<{ freeUsed: number; freeRemaining: number; freeLimit: number; paidAccess: boolean } | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/billing/status", { credentials: "include" })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => {
        if (!cancelled) setQuota(value);
      })
      .catch(() => {
        if (!cancelled) setQuota(null);
      });

    return () => {
      cancelled = true;
      isMountedRef.current = false;
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);
  const handleQuotaError = (error: unknown) => {
    const candidate = error as { response?: { data?: { code?: string } }; data?: { code?: string } };
    if (candidate.response?.data?.code === "PAYMENT_REQUIRED" || candidate.data?.code === "PAYMENT_REQUIRED") {
      toast({ title: "FREE TEST QUOTA REACHED", description: "Open Billing to continue with SOC OS Pro.", variant: "destructive" });
      setLocation("/billing");
      return true;
    }
    return false;
  };

  const scheduleStep = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timersRef.current = timersRef.current.filter((scheduledTimer) => scheduledTimer !== timer);
      if (isMountedRef.current) callback();
    }, delay);
    timersRef.current.push(timer);
  };

  const getErrorDescription = (error: unknown) => {
    const candidate = error as { response?: { data?: { message?: string } }; data?: { message?: string } };
    return candidate.response?.data?.message ?? candidate.data?.message ?? (error instanceof Error ? error.message : "An unexpected error occurred.");
  };

  const handleSimulate = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setIsRunning(true);
    setSelfTestResult(null);
    setSteps([{ id: 'init', title: 'INITIALIZING SIMULATION', description: 'Starting autonomous self-healing cycle...', type: 'info' }]);

    runSimulation.mutate(undefined, {
      onSuccess: (result) => {
        if (!isMountedRef.current) return;
        let stepDelay = 1000;
        scheduleStep(() => {
          setSteps(prev => [...prev, {
            id: 'base',
            title: 'THREAT DETECTED',
            description: `Base event: ${result.baseEvent.event} (Score: ${result.baseEvent.score})`,
            type: 'attack',
            tactic: result.baseEvent.tactic || undefined
          }]);
        }, stepDelay);

        result.selfHealingEvents.forEach((healingEvent, idx) => {
          stepDelay += 1500;
          scheduleStep(() => {
            setSteps(prev => [...prev, {
              id: `heal-attack-${idx}`,
              title: 'SELF-RED-TEAM ATTACK',
              description: `Testing vulnerability: ${healingEvent.attack}`,
              type: 'info',
              tactic: healingEvent.tactic || undefined
            }]);
          }, stepDelay);

          stepDelay += 1500;
          scheduleStep(() => {
            setSteps(prev => [...prev, {
              id: `heal-fix-${idx}`,
              title: 'AUTO-FIX APPLIED',
              description: `Deployed patch: ${healingEvent.fix}`,
              type: 'fix'
            }]);
          }, stepDelay);
        });

        stepDelay += 1000;
        scheduleStep(() => {
          setSteps(prev => [...prev, {
            id: 'complete',
            title: 'SIMULATION COMPLETE',
            description: `Total processed: ${result.totalProcessed} | Patches applied: ${result.patchesApplied}`,
            type: 'success'
          }]);
          setIsRunning(false);

          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListPatchesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetThreatGraphQueryKey() });

          toast({ title: "SIMULATION SUCCESS", description: "Self-healing cycle completed successfully." });
        }, stepDelay);
      },
      onError: (error) => {
        if (!isMountedRef.current) return;
        setIsRunning(false);
        if (handleQuotaError(error)) return;
        const description = getErrorDescription(error);
        setSteps(prev => [...prev, { id: 'error', title: 'SIMULATION FAILED', description, type: 'attack' }]);
        toast({ title: "SIMULATION FAILED", description, variant: "destructive" });
      }
    });
  };

  const handleSelfTest = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setIsSelfTestRunning(true);
    setSteps([]);
    runSelfTest.mutate(undefined, {
      onSuccess: (res) => {
        if (!isMountedRef.current) return;
        setIsSelfTestRunning(false);
        if (!Array.isArray(res?.vulnerabilities)) {
          setSelfTestResult(null);
          toast({ title: "SELF-TEST FAILED", description: "The server returned an invalid result.", variant: "destructive" });
          return;
        }
        setSelfTestResult(res);
        toast({ title: "SELF-TEST COMPLETE", description: `Found ${res.vulnerabilities.length} vectors.` });
      },
      onError: (error) => {
        if (!isMountedRef.current) return;
        setIsSelfTestRunning(false);
        if (handleQuotaError(error)) return;
        toast({ title: "SELF-TEST FAILED", description: getErrorDescription(error), variant: "destructive" });
      }
    });
  };

  const getStepIcon = (type: SimStep['type']) => {
    switch(type) {
      case 'info': return <Terminal className="w-5 h-5 text-primary" />;
      case 'attack': return <Bug className="w-5 h-5 text-critical" />;
      case 'fix': return <Wrench className="w-5 h-5 text-safe" />;
      case 'success': return <CheckCircle2 className="w-5 h-5 text-safe" />;
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-mono">
        <span className="text-muted-foreground">SECURITY TEST QUOTA</span>
        <span className={quota?.paidAccess ? "text-safe" : "text-primary"}>{quota?.paidAccess ? "PRO ACCESS ACTIVE" : `${quota?.freeRemaining ?? "—"} / ${quota?.freeLimit ?? 3} FREE TESTS REMAINING`}</span>
      </div>
      <CyberRangePanel />
      <NodeClusterPanel />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card/50 backdrop-blur border-primary/20 overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-primary/50"></div>
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-mono text-primary flex items-center gap-2">
              <Zap className="w-6 h-6" /> Self-Healing Simulation
            </CardTitle>
            <CardDescription className="font-mono text-sm">Trigger autonomous scenario</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleSimulate} disabled={isRunning || isSelfTestRunning} className="w-full h-12 font-mono tracking-widest bg-primary hover:bg-primary/90 text-primary-foreground">
              {isRunning ? "[ EXECUTING CYCLE... ]" : "INITIATE SIMULATION"}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-warn/20 overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-warn/50"></div>
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-mono text-warn flex items-center gap-2">
              <ShieldAlert className="w-6 h-6" /> System Self-Test
            </CardTitle>
            <CardDescription className="font-mono text-sm">Scan for active vulnerabilities</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleSelfTest} disabled={isRunning || isSelfTestRunning} variant="outline" className="w-full h-12 font-mono tracking-widest border-warn text-warn hover:bg-warn/10">
              {isSelfTestRunning ? "[ SCANNING SYSTEM... ]" : "RUN SELF-TEST"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {selfTestResult && (
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest">Self-Test Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="p-3 bg-secondary rounded border border-border">
                  <div className="text-xs text-muted-foreground font-mono">STATUS</div>
                  <div className="font-mono font-bold text-warn">{selfTestResult.systemStatus}</div>
                </div>
                <div className="p-3 bg-secondary rounded border border-border">
                  <div className="text-xs text-muted-foreground font-mono">PATCHES APPLIED</div>
                  <div className="font-mono font-bold">{selfTestResult.patchesApplied}</div>
                </div>
              </div>
              <div className="space-y-2">
                {selfTestResult.vulnerabilities.map((v: any, i: number) => (
                  <div key={i} className="p-3 rounded border border-critical/30 bg-critical/5 flex items-center justify-between font-mono text-sm">
                    <div className="flex items-center gap-3">
                      <Bug className="w-4 h-4 text-critical" />
                      <span>{v.attack}</span>
                    </div>
                    <div className="flex gap-2">
                      {v.tactic && <Badge variant="outline" className="text-[10px]">{v.tactic}</Badge>}
                      <Badge className="bg-critical hover:bg-critical text-critical-foreground text-[10px]">Score: {v.score}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {steps.map((step) => (
            <motion.div key={step.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden">
              <div className={`p-4 rounded-lg border flex flex-col sm:flex-row sm:items-center gap-4 ${
                step.type === 'attack' ? 'bg-critical/10 border-critical/30' :
                step.type === 'fix' ? 'bg-safe/10 border-safe/30' :
                step.type === 'success' ? 'bg-safe/20 border-safe/50' : 'bg-secondary/50 border-border'
              }`}>
                <div className="flex items-center gap-4 flex-1">
                  <div className="shrink-0">{getStepIcon(step.type)}</div>
                  <div className="font-mono space-y-1">
                    <div className={`text-sm font-bold tracking-widest uppercase ${
                      step.type === 'attack' ? 'text-critical' : step.type === 'fix' ? 'text-safe' : step.type === 'success' ? 'text-safe' : 'text-primary'
                    }`}>
                      {step.title}
                    </div>
                    <div className="text-sm text-foreground/80">{step.description}</div>
                  </div>
                </div>
                {step.tactic && (
                  <Badge variant="outline" className="shrink-0 font-mono text-xs border-primary text-primary">
                    {step.tactic}
                  </Badge>
                )}
              </div>
            </motion.div>
        ))}
      </div>
    </div>
  );
}
