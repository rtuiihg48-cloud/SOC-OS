import { useState, useEffect } from "react";
import { useRunSimulation, getGetDashboardQueryKey, getListEventsQueryKey, getListPatchesQueryKey, getGetThreatGraphQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Play, Shield, Terminal, Zap, CheckCircle2, AlertTriangle, Bug, Wrench } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

type SimStep = {
  id: string;
  title: string;
  description: string;
  type: 'info' | 'attack' | 'fix' | 'success';
};

export default function Simulation() {
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<SimStep[]>([]);
  const runSimulation = useRunSimulation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSimulate = () => {
    setIsRunning(true);
    setSteps([{ id: 'init', title: 'INITIALIZING SIMULATION', description: 'Starting autonomous self-healing cycle...', type: 'info' }]);
    
    runSimulation.mutate(undefined, {
      onSuccess: (result) => {
        // Animate the steps one by one
        let stepDelay = 1000;
        
        setTimeout(() => {
          setSteps(prev => [...prev, {
            id: 'base',
            title: 'THREAT DETECTED',
            description: `Base event: ${result.baseEvent.event} (Score: ${result.baseEvent.score})`,
            type: 'attack'
          }]);
        }, stepDelay);

        result.selfHealingEvents.forEach((healingEvent, idx) => {
          stepDelay += 1500;
          setTimeout(() => {
            setSteps(prev => [...prev, {
              id: `heal-attack-${idx}`,
              title: 'SELF-RED-TEAM ATTACK',
              description: `Testing vulnerability: ${healingEvent.attack}`,
              type: 'info'
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
          
          // Invalidate queries to refresh dashboard/events/patches
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListPatchesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetThreatGraphQueryKey() });
          
          toast({
            title: "SIMULATION SUCCESS",
            description: "Self-healing cycle completed successfully.",
          });
        }, stepDelay);

      },
      onError: () => {
        setIsRunning(false);
        setSteps(prev => [...prev, {
          id: 'error',
          title: 'SIMULATION FAILED',
          description: 'An error occurred during the self-healing cycle.',
          type: 'attack'
        }]);
        toast({
          title: "SIMULATION FAILED",
          description: "Could not complete the simulation cycle.",
          variant: "destructive",
        });
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
      <Card className="bg-card/50 backdrop-blur border-primary/20 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50"></div>
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-mono text-primary flex items-center gap-2">
            <Zap className="w-6 h-6" />
            Autonomous Self-Healing Simulation
          </CardTitle>
          <CardDescription className="font-mono text-sm text-muted-foreground">
            Trigger a controlled red-team scenario to test system defenses and auto-patching capabilities.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center p-8 bg-secondary/30 rounded-lg border border-border">
            <Button 
              onClick={handleSimulate} 
              disabled={isRunning}
              size="lg"
              className={`h-16 px-8 text-lg font-mono tracking-widest uppercase transition-all duration-300 ${
                isRunning 
                  ? "bg-secondary text-muted-foreground" 
                  : "bg-primary hover:bg-primary hover:shadow-[0_0_20px_hsl(var(--primary)_/_0.5)] text-primary-foreground"
              }`}
            >
              {isRunning ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin mr-3"></div>
                  [ EXECUTING CYCLE... ]
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 mr-3" />
                  INITIATE SIMULATION
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <AnimatePresence>
          {steps.map((step, index) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -20, height: 0 }}
              animate={{ opacity: 1, x: 0, height: 'auto' }}
              className="overflow-hidden"
            >
              <div className={`p-4 rounded-lg border flex gap-4 ${
                step.type === 'attack' ? 'bg-critical/10 border-critical/30' :
                step.type === 'fix' ? 'bg-safe/10 border-safe/30' :
                step.type === 'success' ? 'bg-safe/20 border-safe/50' :
                'bg-secondary/50 border-border'
              }`}>
                <div className="mt-1 shrink-0">
                  {getStepIcon(step.type)}
                </div>
                <div className="font-mono space-y-1">
                  <div className={`text-sm font-bold tracking-widest uppercase ${
                    step.type === 'attack' ? 'text-critical' :
                    step.type === 'fix' ? 'text-safe' :
                    step.type === 'success' ? 'text-safe' :
                    'text-primary'
                  }`}>
                    {step.title}
                  </div>
                  <div className="text-sm text-foreground/80">
                    {step.description}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {steps.length === 0 && !isRunning && (
          <div className="text-center py-12 font-mono text-muted-foreground/50 border border-dashed border-border/50 rounded-lg">
            AWAITING SIMULATION COMMAND
          </div>
        )}
      </div>
    </div>
  );
}
