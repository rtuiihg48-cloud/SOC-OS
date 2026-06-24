import { useListPatches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitCommit, ShieldCheck, Wrench, Clock, Activity } from "lucide-react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function Patches() {
  const { data: patches, isLoading } = useListPatches();

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center font-mono text-primary animate-pulse">
        [ RETRIEVING PATCH REGISTRY... ]
      </div>
    );
  }

  // Calculate tactic summary for chart
  const tacticCounts = patches?.reduce((acc, patch) => {
    const t = patch.tactic || 'Unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const chartData = Object.entries(tacticCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <CardTitle className="text-xl font-mono text-safe flex items-center gap-2 uppercase tracking-widest">
              <ShieldCheck className="w-5 h-5" />
              Applied SOAR Patches
            </CardTitle>
            <CardDescription className="font-mono text-sm">
              Autonomous mitigations deployed by orchestration engine.
            </CardDescription>
          </CardHeader>
        </Card>
        
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase flex items-center gap-2">
              <Activity className="w-3 h-3" /> Patches by Tactic
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[100px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <XAxis dataKey="name" hide />
                <YAxis hide />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontFamily: "JetBrains Mono", fontSize: '12px' }} cursor={{ fill: "hsl(var(--secondary))" }} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={`c-${i}`} fill="hsl(var(--primary))" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

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
              transition={{ delay: Math.min(index * 0.05, 0.5) }}
              key={patch.id}
            >
              <Card className="bg-secondary/30 border-border hover:border-primary/50 transition-colors overflow-hidden relative">
                <div className="absolute top-0 left-0 w-1 h-full bg-safe"></div>
                <CardContent className="p-0">
                  <div className="flex flex-col md:flex-row">
                    <div className="p-4 md:w-1/2 border-b md:border-b-0 md:border-r border-border bg-background/50">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(patch.appliedAt), { addSuffix: true })}
                        </div>
                        {patch.tactic && (
                          <Badge variant="outline" className="font-mono text-[10px] bg-secondary">
                            {patch.tactic}
                          </Badge>
                        )}
                      </div>
                      <div className="font-mono text-sm text-critical uppercase tracking-widest mb-1 flex items-center gap-2">
                        <GitCommit className="w-4 h-4" />
                        ATTACK VECTOR
                      </div>
                      <div className="text-sm font-mono text-foreground/80 mt-2 pl-6">
                        {patch.attack}
                      </div>
                    </div>
                    <div className="p-4 md:w-1/2">
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
