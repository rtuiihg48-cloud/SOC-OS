import {
  useGetDashboard,
  useGetSystemMetrics,
  useGetMitreStats,
  useGetRiskTimeline,
  useGetStrategyOverview,
  getGetDashboardQueryKey,
  getGetSystemMetricsQueryKey,
  getGetMitreStatsQueryKey,
  getGetRiskTimelineQueryKey,
  getGetStrategyOverviewQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell } from "recharts";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, Activity, Cpu, Database, Server, Crosshair, TrendingUp, BellRing, BrainCircuit, Gauge } from "lucide-react";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const { data: dashboard, isLoading: loadDash } = useGetDashboard({ query: { refetchInterval: 5000, queryKey: getGetDashboardQueryKey() } });
  const { data: metrics, isLoading: loadMetrics } = useGetSystemMetrics({ query: { refetchInterval: 3000, queryKey: getGetSystemMetricsQueryKey() } });
  const { data: mitreStats, isLoading: loadMitre } = useGetMitreStats({ query: { refetchInterval: 10000, queryKey: getGetMitreStatsQueryKey() } });
  const { data: riskTimeline, isLoading: loadRisk } = useGetRiskTimeline({ query: { refetchInterval: 10000, queryKey: getGetRiskTimelineQueryKey() } });
  const { data: strategy } = useGetStrategyOverview({ query: { refetchInterval: 15000, queryKey: getGetStrategyOverviewQueryKey() } });

  const [liveEvents, setLiveEvents] = useState<any[]>([]);

  useEffect(() => {
    if (dashboard?.recentEvents && liveEvents.length === 0) {
      setLiveEvents(dashboard.recentEvents);
    }
  }, [dashboard?.recentEvents]);

  useEffect(() => {
    const es = new EventSource('/api/events/stream');
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        setLiveEvents(prev => {
          const newEvents = [event, ...prev].slice(0, 10);
          return newEvents;
        });
      } catch (err) {
        // ignore
      }
    };
    return () => es.close();
  }, []);

  if (loadDash || !dashboard) {
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
    { name: "ALLOW", count: dashboard.actionCounts?.ALLOW || 0, fill: "hsl(var(--safe))" },
    { name: "WARN", count: dashboard.actionCounts?.WARN || 0, fill: "hsl(var(--warn))" },
    { name: "ISOLATE", count: dashboard.actionCounts?.ISOLATE || 0, fill: "hsl(var(--critical))" },
    { name: "PATCHED", count: dashboard.actionCounts?.PATCHED || 0, fill: "hsl(var(--primary))" }
  ];

  const getMetricColor = (val: number) => val > 80 ? 'bg-critical' : val > 60 ? 'bg-warn' : 'bg-safe';

  return (
    <div className="space-y-6">
      {/* Top Row KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <Card className="col-span-1 md:col-span-1 bg-card/50 backdrop-blur border-primary/20 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-widest flex items-center justify-between">
              <span className="flex items-center gap-2"><Shield className="w-3 h-3 text-primary" /> Threat Level</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[140px] flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart cx="50%" cy="50%" innerRadius="70%" outerRadius="100%" barSize={15} data={threatData} startAngle={180} endAngle={0}>
                <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                <RadialBar background={{ fill: "hsl(var(--secondary))" }} dataKey="value" cornerRadius={10} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center flex-col translate-y-2">
              <span className="text-3xl font-mono font-bold" style={{ color: threatData[0].fill }}>{dashboard.threatLevel}%</span>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 md:col-span-1 bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <BellRing className="w-3 h-3 text-warn" /> Open Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center h-[140px]">
            <div className="flex flex-col items-center">
              <div className="text-4xl font-mono font-bold text-warn">{dashboard.openAlerts}</div>
              <div className="text-xs font-mono text-muted-foreground mt-2">{dashboard.resolvedAlerts} Resolved</div>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 md:col-span-3 bg-card/50 backdrop-blur border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-3 h-3 text-primary" /> System Vitals
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-mono">
                <span className="flex items-center gap-1"><Cpu className="w-3 h-3"/> CPU</span>
                <span>{metrics?.cpuPercent.toFixed(1) || 0}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className={`h-full ${getMetricColor(metrics?.cpuPercent || 0)}`} style={{ width: `${metrics?.cpuPercent || 0}%` }}></div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-mono">
                <span className="flex items-center gap-1"><Database className="w-3 h-3"/> MEM</span>
                <span>{metrics?.memPercent.toFixed(1) || 0}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className={`h-full ${getMetricColor(metrics?.memPercent || 0)}`} style={{ width: `${metrics?.memPercent || 0}%` }}></div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-mono">
                <span className="flex items-center gap-1"><Server className="w-3 h-3"/> LOAD</span>
                <span>{metrics?.loadAvg1m.toFixed(2) || 0}</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div className={`h-full ${getMetricColor((metrics?.loadAvg1m || 0) * 10)}`} style={{ width: `${Math.min(100, (metrics?.loadAvg1m || 0) * 20)}%` }}></div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur border-primary/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest flex items-center justify-between gap-4">
            <span className="flex items-center gap-2"><BrainCircuit className="w-4 h-4 text-primary" /> M0 Adaptive Strategy</span>
            <span className="text-[10px] text-safe">OBSERVER ONLY</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {strategy?.latest ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[160px_1fr_220px] lg:items-center">
              <div className="rounded border border-primary/30 bg-primary/5 p-4">
                <div className="text-[10px] font-mono text-muted-foreground">SELECTED MODE</div>
                <div className={`mt-1 text-2xl font-mono font-bold uppercase ${
                  strategy.latest.mode === "deep" ? "text-critical" :
                  strategy.latest.mode === "fast" ? "text-safe" : "text-primary"
                }`}>{strategy.latest.mode}</div>
                <div className="mt-1 text-xs font-mono text-muted-foreground">{Math.round(strategy.latest.confidence * 100)}% confidence</div>
              </div>
              <div className="space-y-2">
                <div className="font-mono text-xs text-primary">{strategy.latest.attackFamily.replaceAll("_", " ").toUpperCase()}</div>
                <p className="text-sm text-foreground/80">{strategy.latest.reason}</p>
                <p className="text-[11px] font-mono text-muted-foreground">N7 allocate → N2 compute → N3 learn • no production mutation</p>
              </div>
              <div className="rounded border border-border bg-secondary/30 p-4">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="flex items-center gap-2 text-muted-foreground"><Gauge className="h-3.5 w-3.5" /> COMPUTE BUDGET</span>
                  <span className="text-primary">{strategy.latest.computeBudget} units</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded bg-secondary">
                  <div className="h-full bg-primary" style={{ width: `${strategy.latest.computeBudget}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center font-mono text-[10px] text-muted-foreground">
                  <span>FAST {strategy.modeCounts.fast}</span>
                  <span>BAL {strategy.modeCounts.balanced}</span>
                  <span>DEEP {strategy.modeCounts.deep}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center font-mono text-xs text-muted-foreground">AWAITING STRATEGY CYCLE...</div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Risk Timeline */}
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Risk Timeline (24h)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={riskTimeline || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRisk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--critical))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--critical))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(val) => val.split('T')[1]?.substring(0,5) || val} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontFamily: "JetBrains Mono", fontSize: '12px' }} />
                <Area type="monotone" dataKey="avgScore" stroke="hsl(var(--critical))" fillOpacity={1} fill="url(#colorRisk)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* MITRE Heatmap */}
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-primary" /> MITRE ATT&CK TACTICS
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={mitreStats || []} margin={{ top: 0, right: 30, left: 30, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={true} vertical={false} />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <YAxis dataKey="tactic" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} width={100} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontFamily: "JetBrains Mono", fontSize: '12px' }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {(mitreStats || []).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.avgScore > 75 ? 'hsl(var(--critical))' : entry.avgScore > 50 ? 'hsl(var(--warn))' : 'hsl(var(--safe))'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="col-span-1 lg:col-span-1 bg-card/50 backdrop-blur border-border">
          <CardHeader>
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-primary" /> Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={actionsData} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontFamily: "JetBrains Mono" }} cursor={{ fill: "hsl(var(--secondary))" }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {actionsData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Live Feed */}
        <Card className="col-span-1 lg:col-span-2 bg-card/50 backdrop-blur border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest">
              Live Event Feed
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-ping"></div>
              <span className="text-xs font-mono text-primary">STREAMING</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
              {liveEvents.map((ev) => (
                  <motion.div
                    initial={{ opacity: 0, x: -20, backgroundColor: 'hsl(var(--primary)/0.2)' }}
                    animate={{ opacity: 1, x: 0, backgroundColor: 'transparent' }}
                    transition={{ duration: 0.5 }}
                    key={`${ev.id}-${ev.timestamp}`}
                    className="flex items-center gap-3 p-2 rounded border border-border bg-secondary/30 font-mono text-xs"
                  >
                    <div className="w-16 shrink-0 text-muted-foreground">{new Date(ev.timestamp).toLocaleTimeString([], {hour12:false})}</div>
                    <div className="w-16 shrink-0 font-bold" style={{
                      color: ev.action === 'ALLOW' ? 'hsl(var(--safe))' :
                             ev.action === 'WARN' ? 'hsl(var(--warn))' :
                             ev.action === 'ISOLATE' ? 'hsl(var(--critical))' : 'hsl(var(--primary))'
                    }}>
                      {ev.action}
                    </div>
                    {ev.velocityFlag && <span className="text-critical shrink-0">⚡</span>}
                    <div className="flex-1 truncate">{ev.event}</div>
                    <div className="w-24 shrink-0 truncate text-muted-foreground">{ev.tactic || '-'}</div>
                    <div className="w-12 text-right shrink-0">
                      <span className={ev.score > 75 ? 'text-critical' : ev.score > 50 ? 'text-warn' : 'text-safe'}>{ev.score}</span>
                    </div>
                  </motion.div>
              ))}
              {liveEvents.length === 0 && (
                <div className="text-center p-8 text-muted-foreground font-mono text-sm border border-dashed border-border rounded">AWAITING EVENTS...</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
