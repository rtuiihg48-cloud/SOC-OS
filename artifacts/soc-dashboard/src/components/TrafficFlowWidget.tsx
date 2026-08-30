import { useMemo } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Gauge,
  Radio,
  TriangleAlert,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrafficObservation, TrafficSummary } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type TrafficFlowWidgetProps = {
  flows?: TrafficObservation[];
  summary?: TrafficSummary;
  isLoading?: boolean;
};

type ThroughputPoint = {
  label: string;
  inbound: number;
  outbound: number;
};

const PROTOCOL_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--safe))",
  "hsl(var(--warn))",
  "hsl(var(--critical))",
  "hsl(var(--muted-foreground))",
];

const SYNTHETIC_THROUGHPUT = [
  { inbound: 420, outbound: 280 },
  { inbound: 510, outbound: 320 },
  { inbound: 470, outbound: 360 },
  { inbound: 620, outbound: 410 },
  { inbound: 580, outbound: 390 },
  { inbound: 760, outbound: 470 },
  { inbound: 690, outbound: 520 },
  { inbound: 820, outbound: 560 },
  { inbound: 740, outbound: 500 },
  { inbound: 910, outbound: 610 },
  { inbound: 860, outbound: 590 },
  { inbound: 980, outbound: 680 },
];

const SYNTHETIC_PROTOCOLS = [
  { name: "HTTPS", value: 52 },
  { name: "TLS", value: 24 },
  { name: "TCP", value: 16 },
  { name: "DNS", value: 8 },
];

function formatRate(value: number, unit: "Kbps" | "Mbps") {
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

function formatShortTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TrafficTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: any[];
  label?: string;
  unit: "Kbps" | "Mbps";
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded border border-border bg-card px-3 py-2 shadow-xl" aria-label="Chart tooltip">
      <div className="mb-1 font-mono text-[10px] text-muted-foreground">{label}</div>
      {payload.map((item) => (
        <div key={item.name} className="flex items-center justify-between gap-5 font-mono text-xs">
          <span style={{ color: item.color }}>{item.name === "inbound" ? "INBOUND" : "OUTBOUND"}</span>
          <span className="text-foreground">{formatRate(Number(item.value ?? 0), unit)}</span>
        </div>
      ))}
    </div>
  );
}

export function TrafficFlowWidget({ flows, summary, isLoading }: TrafficFlowWidgetProps) {
  const isInitialLoading = isLoading && flows === undefined;

  const flowRows = useMemo(
    () => (flows ?? []).filter((flow) => flow.observationType === "FLOW"),
    [flows],
  );
  
  const isSyntheticPreview = !isInitialLoading && flowRows.length === 0;

  const throughput = useMemo<ThroughputPoint[]>(() => {
    if (isSyntheticPreview) {
      return SYNTHETIC_THROUGHPUT.map((point, index) => ({
        ...point,
        label: `${String(index + 1).padStart(2, "0")}:00`,
      }));
    }

    const buckets = new Map<
      number,
      { inboundBytes: number; outboundBytes: number }
    >();

    for (const flow of flowRows) {
      const timestamp = new Date(flow.observedAt).getTime();
      const bucket = Math.floor(timestamp / 60000) * 60000;
      const current = buckets.get(bucket) ?? {
        inboundBytes: 0,
        outboundBytes: 0,
      };
      current.inboundBytes += flow.bytesIn;
      current.outboundBytes += flow.bytesOut;
      buckets.set(bucket, current);
    }

    const maxBucket = buckets.size > 0 
      ? Math.max(...Array.from(buckets.keys()))
      : Math.floor(Date.now() / 60000) * 60000;

    const filled: ThroughputPoint[] = [];
    for (let i = 11; i >= 0; i--) {
      const b = maxBucket - i * 60000;
      const values = buckets.get(b) ?? { inboundBytes: 0, outboundBytes: 0 };
      filled.push({
        label: formatShortTime(new Date(b).toISOString()),
        inbound: (values.inboundBytes * 8) / 60000,
        outbound: (values.outboundBytes * 8) / 60000,
      });
    }

    return filled;
  }, [flowRows, isSyntheticPreview]);

  const protocols = useMemo(() => {
    if (isSyntheticPreview) return SYNTHETIC_PROTOCOLS;

    const counts = new Map<string, number>();
    for (const flow of flowRows) {
      const protocol = flow.protocol.trim().toUpperCase() || "UNKNOWN";
      counts.set(protocol, (counts.get(protocol) ?? 0) + 1);
    }

    const sorted = [...counts.entries()]
      .sort(([, left], [, right]) => right - left)
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));
    return sorted;
  }, [flowRows, isSyntheticPreview]);

  const { unit, latestInbound, latestOutbound, peakState, peakRatio, chartData } = useMemo(() => {
    const allRates = throughput.flatMap((point) => [point.inbound, point.outbound]);
    const maxRate = Math.max(...allRates, 0);
    const usesMbps = maxRate >= 1000;
    const scale = usesMbps ? 1000 : 1;
    
    const scaled = throughput.map((point) => ({
      ...point,
      inbound: point.inbound / scale,
      outbound: point.outbound / scale,
    }));
    
    const latest = scaled.at(-1) ?? { inbound: 0, outbound: 0 };
    const previous = scaled.slice(0, -1);
    const previousAverage = previous.length
      ? previous.reduce((total, point) => total + point.inbound + point.outbound, 0) / previous.length
      : 0;
    const latestTotal = latest.inbound + latest.outbound;
    const ratio = previousAverage > 0 ? latestTotal / previousAverage : 0;

    return {
      chartData: scaled,
      unit: usesMbps ? ("Mbps" as const) : ("Kbps" as const),
      latestInbound: latest.inbound,
      latestOutbound: latest.outbound,
      peakState: isSyntheticPreview
        ? "PREVIEW"
        : ratio >= 1.75
          ? "PEAK LOAD"
          : ratio >= 1.25
            ? "ELEVATED"
            : "NORMAL",
      peakRatio: ratio,
    };
  }, [isSyntheticPreview, throughput]);

  const protocolTotal = protocols.reduce((total, protocol) => total + protocol.value, 0);
  const lastUpdated = summary?.generatedAt
    ? new Date(summary.generatedAt).toLocaleTimeString([], { hour12: false })
    : "—";

  return (
    <Card className="shrink-0 overflow-hidden border-primary/20 bg-card/50 backdrop-blur">
      <CardHeader className="flex flex-col items-stretch gap-4 border-b border-border/60 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="flex items-start gap-2 font-mono text-xs uppercase leading-relaxed tracking-widest text-primary sm:items-center sm:text-sm">
            <Activity className="h-4 w-4" />
            REAL-TIME TRAFFIC FLOW
          </CardTitle>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Node gateway throughput and active protocol mix
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
          <Badge
            variant="outline"
            className={isSyntheticPreview ? "border-warn text-warn" : "border-safe text-safe"}
          >
            <Radio className="mr-1 h-3 w-3" />
            {isSyntheticPreview ? "SYNTHETIC PREVIEW" : "LIVE TELEMETRY"}
          </Badge>
          <span className="font-mono text-[10px] text-muted-foreground">UPDATED {lastUpdated}</span>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        {isInitialLoading ? (
          <div className="flex h-[280px] items-center justify-center">
            <div className="flex flex-col items-center gap-3 font-mono text-xs uppercase tracking-wider text-muted-foreground animate-pulse">
              <Activity className="h-8 w-8 opacity-50" />
              [ INITIALIZING SENSORS... ]
            </div>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.9fr)]">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap gap-4">
                  <div>
                    <div className="flex items-center gap-1 font-mono text-[10px] uppercase text-muted-foreground">
                      <ArrowDownToLine className="h-3 w-3 text-primary" /> Inbound
                    </div>
                    <div className="font-mono text-lg font-bold text-primary">
                      {formatRate(latestInbound, unit)}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 font-mono text-[10px] uppercase text-muted-foreground">
                      <ArrowUpFromLine className="h-3 w-3 text-safe" /> Outbound
                    </div>
                    <div className="font-mono text-lg font-bold text-safe">
                      {formatRate(latestOutbound, unit)}
                    </div>
                  </div>
                </div>
                <div className="text-right font-mono text-[10px] text-muted-foreground">
                  <div>UNIT: {unit}</div>
                  <div>WINDOW: LAST 12 MINUTES</div>
                </div>
              </div>
              <div className="h-[220px] w-full" aria-label="Traffic throughput chart">
                <ResponsiveContainer width="100%" height="100%" debounce={0}>
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${value}`}
                    />
                    <Tooltip content={<TrafficTooltip unit={unit} />} isAnimationActive={false} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} />
                    <Line type="monotone" dataKey="inbound" name="inbound" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="outbound" name="outbound" stroke="hsl(var(--safe))" strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    <Gauge className="h-3.5 w-3.5 text-warn" />
                    Peak load
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      peakState === "PEAK LOAD"
                        ? "border-critical text-critical"
                        : peakState === "ELEVATED"
                          ? "border-warn text-warn"
                          : "border-safe text-safe"
                    }
                  >
                    {peakState}
                  </Badge>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {peakState === "PREVIEW"
                    ? "Synthetic preview is not an operational signal."
                    : peakRatio > 0
                      ? `${peakRatio.toFixed(1)}× versus the loaded baseline`
                      : "Waiting for a second traffic interval"}
                </div>
                <div className="mt-2 flex items-center gap-1 font-mono text-[10px] uppercase text-muted-foreground">
                  <TriangleAlert className="h-3 w-3 text-warn" />
                  Advisory only • no automatic isolation
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/40 p-3">
                <div className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                  Protocol mix
                </div>
                {protocols.length === 0 ? (
                  <div className="flex h-[110px] items-center justify-center font-mono text-[10px] uppercase text-muted-foreground">
                    No flow protocols available
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="h-[110px] w-[110px] shrink-0" aria-label="Protocol distribution pie chart">
                      <ResponsiveContainer width="100%" height="100%" debounce={0}>
                        <PieChart>
                          <Pie data={protocols} dataKey="value" nameKey="name" innerRadius={30} outerRadius={48} paddingAngle={3} stroke="none" isAnimationActive={false}>
                            {protocols.map((protocol, index) => (
                              <Cell key={protocol.name} fill={PROTOCOL_COLORS[index % PROTOCOL_COLORS.length]} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      {protocols.map((protocol, index) => (
                        <div key={protocol.name} className="flex items-center justify-between gap-2 font-mono text-[10px]">
                          <span className="flex min-w-0 items-center gap-1.5 truncate text-muted-foreground">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: PROTOCOL_COLORS[index % PROTOCOL_COLORS.length] }} />
                            {protocol.name}
                          </span>
                          <span className="text-foreground">
                            {protocolTotal ? Math.round((protocol.value / protocolTotal) * 100) : 0}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
