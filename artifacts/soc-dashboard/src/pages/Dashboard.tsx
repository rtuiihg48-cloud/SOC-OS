import { useGetDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";

export default function Dashboard() {
  const { data: dashboard, isLoading } = useGetDashboard({
    query: { refetchInterval: 5000 }
  });

  if (isLoading || !dashboard) {
    return (
      <div className="w-full h-full flex items-center justify-center font-mono text-primary animate-pulse">
        [ INITIALIZING TACTICAL OVERVIEW... ]
      </div>
    );
  }

  const threatData = [{
    name: "Threat Level",
    value: dashboard.threatLevel,
    fill: dashboard.threatLevel > 75 ? "hsl(var(--critical))" : dashboard.threatLevel > 50 ? "hsl(var(--warn))" : "hsl(var(--safe))"
  }];

  const actionsData = [
    { name: "ALLOW", count: dashboard.actionCounts.ALLOW, fill: "hsl(var(--safe))" },
    { name: "WARN", count: dashboard.actionCounts.WARN, fill: "hsl(var(--warn))" },
    { name: "ISOLATE", count: dashboard.actionCounts.ISOLATE, fill: "hsl(var(--critical))" },
    { name: "PATCHED", count: dashboard.actionCounts.PATCHED, fill: "hsl(var(--primary))" }
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="col-span-1 md:col-span-2 bg-card/50 backdrop-blur border-primary/20 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
          <CardHeader>
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              Threat Level
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[200px] flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart 
                cx="50%" cy="50%" innerRadius="70%" outerRadius="100%" 
                barSize={20} data={threatData} startAngle={180} endAngle={0}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar
                  background={{ fill: "hsl(var(--secondary))" }}
                  dataKey="value"
                  cornerRadius={10}
                />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center flex-col translate-y-4">
              <span className="text-4xl font-mono font-bold" style={{ color: threatData[0].fill }}>
                {dashboard.threatLevel}%
              </span>
              <span className="text-xs font-mono text-muted-foreground tracking-widest mt-1">
                SYSTEM RISK
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 md:col-span-2 bg-card/50 backdrop-blur border-primary/20">
          <CardHeader>
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-primary" />
              Action Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={actionsData} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontFamily: "JetBrains Mono" }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                  cursor={{ fill: "hsl(var(--secondary))" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardContent className="p-6 flex flex-col justify-center items-center text-center h-full">
            <div className="text-3xl font-mono font-bold text-primary mb-2">{dashboard.totalEvents}</div>
            <div className="text-xs font-mono text-muted-foreground tracking-widest">TOTAL EVENTS</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardContent className="p-6 flex flex-col justify-center items-center text-center h-full">
            <div className="text-3xl font-mono font-bold text-primary mb-2">{dashboard.totalPatches}</div>
            <div className="text-xs font-mono text-muted-foreground tracking-widest">AUTO PATCHES</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardContent className="p-6 flex flex-col justify-center items-center text-center h-full">
            <div className={`text-3xl font-mono font-bold mb-2 ${dashboard.avgRiskScore > 75 ? 'text-critical' : dashboard.avgRiskScore > 50 ? 'text-warn' : 'text-safe'}`}>
              {dashboard.avgRiskScore.toFixed(1)}
            </div>
            <div className="text-xs font-mono text-muted-foreground tracking-widest">AVG RISK SCORE</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardContent className="p-6 flex flex-col justify-center items-center text-center h-full">
            <div className={`text-xl font-mono font-bold mb-2 ${
              dashboard.systemStatus === 'SECURE' ? 'text-safe' : 
              dashboard.systemStatus === 'MONITORING' ? 'text-primary' : 
              dashboard.systemStatus === 'ALERT' ? 'text-warn' : 'text-critical'
            }`}>
              {dashboard.systemStatus}
            </div>
            <div className="text-xs font-mono text-muted-foreground tracking-widest">NETWORK STATUS</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur border-primary/20">
        <CardHeader>
          <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest">Recent Memory Chain</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {dashboard.recentEvents.slice(0, 5).map((ev, i) => (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                key={ev.id} 
                className="flex items-center gap-4 p-3 rounded-lg border border-border bg-secondary/50 font-mono text-sm"
              >
                <div className="w-20 shrink-0 text-muted-foreground">{new Date(ev.timestamp).toLocaleTimeString()}</div>
                <div className="w-16 shrink-0 font-bold" style={{
                  color: ev.action === 'ALLOW' ? 'hsl(var(--safe))' : 
                         ev.action === 'WARN' ? 'hsl(var(--warn))' : 
                         ev.action === 'ISOLATE' ? 'hsl(var(--critical))' : 'hsl(var(--primary))'
                }}>
                  {ev.action}
                </div>
                <div className="flex-1 truncate">{ev.event}</div>
                <div className="w-16 text-right shrink-0 text-muted-foreground">
                  Score: <span className="text-foreground">{ev.score}</span>
                </div>
              </motion.div>
            ))}
            {dashboard.recentEvents.length === 0 && (
              <div className="text-center p-8 text-muted-foreground font-mono text-sm">NO RECENT EVENTS DETECTED</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
