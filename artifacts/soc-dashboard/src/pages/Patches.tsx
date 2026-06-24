import { useListPatches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { GitCommit, ShieldCheck, Wrench, Clock } from "lucide-react";
import { motion } from "framer-motion";

export default function Patches() {
  const { data: patches, isLoading } = useListPatches();

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center font-mono text-primary animate-pulse">
        [ RETRIEVING PATCH REGISTRY... ]
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle className="text-xl font-mono text-safe flex items-center gap-2 uppercase tracking-widest">
            <ShieldCheck className="w-5 h-5" />
            Applied SOAR Patches
          </CardTitle>
          <CardDescription className="font-mono text-sm">
            Autonomous mitigations deployed by the self-healing orchestration engine.
          </CardDescription>
        </CardHeader>
      </Card>

      {!patches || patches.length === 0 ? (
        <div className="py-16 text-center font-mono text-muted-foreground border border-dashed border-border rounded-lg">
          NO AUTOMATED PATCHES APPLIED YET
        </div>
      ) : (
        <div className="space-y-4">
          {patches.map((patch, index) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              key={patch.id}
            >
              <Card className="bg-secondary/30 border-border hover:border-primary/50 transition-colors overflow-hidden relative">
                <div className="absolute top-0 left-0 w-1 h-full bg-safe"></div>
                <CardContent className="p-0">
                  <div className="flex flex-col md:flex-row">
                    <div className="p-4 md:p-6 md:w-1/3 border-b md:border-b-0 md:border-r border-border bg-background/50">
                      <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-3">
                        <Clock className="w-3 h-3" />
                        {new Date(patch.appliedAt).toLocaleString()}
                      </div>
                      <div className="font-mono text-sm text-critical uppercase tracking-widest mb-1 flex items-center gap-2">
                        <GitCommit className="w-4 h-4" />
                        ATTACK VECTOR
                      </div>
                      <div className="text-sm font-mono text-foreground/80 mt-2 pl-6">
                        {patch.attack}
                      </div>
                    </div>
                    <div className="p-4 md:p-6 md:w-2/3">
                      <div className="font-mono text-sm text-safe uppercase tracking-widest mb-1 flex items-center gap-2">
                        <Wrench className="w-4 h-4" />
                        FIX APPLIED
                      </div>
                      <div className="text-sm font-mono text-foreground/90 mt-2 pl-6 bg-safe/5 p-3 rounded border border-safe/20">
                        {patch.fix}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
