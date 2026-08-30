import { useState } from "react";
import { useRunSimulation, useRunSelfTest, getGetDashboardQueryKey, getListEventsQueryKey, getListPatchesQueryKey, getGetThreatGraphQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Play, Shield, Terminal, Zap, CheckCircle2, AlertTriangle, Bug, Wrench, ShieldAlert } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

type SimStep = {
  id: string;
  title: string;
  description: string;
  type: 'info' | 'attack' | 'fix' | 'success';
  tactic?: string;
};

export default function Simulation() {
  const [isRunning, setIsRunning] = useState(false);
  const [isSelfTestRunning, setIsSelfTestRunning] = useState(false);
  const [steps, setSteps] = useState<SimStep[]>([]);
  const [selfTestResult, setSelfTestResult] = useState<any>(null);

  const runSimulation = useRunSimulation();
  const runSelfTest = useRunSelfTest();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSimulate = () => {
    setIsRunning(true);
    setSelfTestResult(null);
    setSteps([{ id: 'init', title: 'INITIALIZING SIMULATION', description: 'Starting autonomous self-healing cycle...', type: 'info' }]);

    runSimulation.mutate(undefined, {
      onSuccess: (result) => {
        let stepDelay = 1000;
        setTimeout(() => {
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
          setTimeout(() => {
            setSteps(prev => [...prev, {
              id: `heal-attack-${idx}`,
              title: 'SELF-RED-TEAM ATTACK',
              description: `Testing vulnerability: ${healingEvent.attack}`,
              type: 'info',
              tactic: healingEvent.tactic || undefined
            }]);
          }, stepDelay);

          stepDelay += 1500;
          setTimeout(() => {
            setSteps(prev => [...prev, {
              id: `heal-fix-${idx}`,
              title: 'AUTO-FIX APPLIED',
              description: `Deployed patch: ${healingEvent.fix}`,
              type: 'fix'
            }]);
          }, stepDelay);
        });

        stepDelay += 1000;
        setTimeout(() => {
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
      onError: () => {
        setIsRunning(false);
        setSteps(prev => [...prev, { id: 'error', title: 'SIMULATION FAILED', description: 'An error occurred during cycle.', type: 'attack' }]);
        toast({ title: "SIMULATION FAILED", variant: "destructive" });
      }
    });
  };

  const handleSelfTest = () => {
    setIsSelfTestRunning(true);
    setSteps([]);
    runSelfTest.mutate(undefined, {
      onSuccess: (res) => {
        setIsSelfTestRunning(false);
        setSelfTestResult(res);
        toast({ title: "SELF-TEST COMPLETE", description: `Found ${res.vulnerabilities.length} vectors.` });
      },
      onError: () => {
        setIsSelfTestRunning(false);
        toast({ title: "SELF-TEST FAILED", variant: "destructive" });
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
    <div className="max-w-4xl mx-auto space-y-6">
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
