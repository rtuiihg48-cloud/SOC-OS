import React, { useState } from "react";
import {
  useListTrafficFlows,
  useGetTrafficSummary,
  useGenerateSyntheticTraffic,
  getListTrafficFlowsQueryKey,
  getGetTrafficSummaryQueryKey,
  TrafficObservation
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { TrafficFlowWidget } from "@/components/TrafficFlowWidget";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Network, RefreshCw, Activity, AlertTriangle, Zap, Server, Filter, Database, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const formatBytes = (bytes?: number) => {
  if (bytes === undefined || bytes === null || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function TrafficAnalysis() {
  const [observationTypeFilter, setObservationTypeFilter] = useState<string>("ALL");
  const [directionFilter, setDirectionFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [protocolFilter, setProtocolFilter] = useState<string>("ALL");
  const [syntheticPreview, setSyntheticPreview] = useState<TrafficObservation[] | undefined>();

  const queryParams: any = {};
  if (observationTypeFilter !== "ALL") queryParams.observationType = observationTypeFilter;
  if (directionFilter !== "ALL") queryParams.direction = directionFilter;
  if (severityFilter !== "ALL") queryParams.severity = severityFilter;
  if (protocolFilter !== "ALL") queryParams.protocol = protocolFilter;

  const { data: summary, isError: isSummaryError } = useGetTrafficSummary({
    query: { queryKey: getGetTrafficSummaryQueryKey(), refetchInterval: 15_000 }
  });

  const { data: flows, isLoading, isError: isFlowsError } = useListTrafficFlows(queryParams, {
    query: { queryKey: getListTrafficFlowsQueryKey(queryParams), refetchInterval: 15_000 }
  });

  const generateSynthetic = useGenerateSyntheticTraffic();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const displayFlows = syntheticPreview ?? flows;

  const handleGenerateSynthetic = () => {
    generateSynthetic.mutate(undefined as any, {
      onSuccess: (preview) => {
        setSyntheticPreview(preview);
        toast({ title: "SYNTHETIC PREVIEW READY", description: "Demo-only results are marked synthetic and were not written to live traffic evidence." });
      },
      onError: (err: any) => {
        toast({ title: "GENERATION FAILED", description: err.message || "Unknown error", variant: "destructive" });
      }
    });
  };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetTrafficSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTrafficFlowsQueryKey(queryParams) });
  };

  return (
    <div className="flex flex-col h-full w-full max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div>
          <h1 className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-base font-bold tracking-widest text-primary sm:gap-3 sm:text-2xl">
            <Network className="w-6 h-6" />
            TRAFFIC_ANALYSIS <span className="text-sm font-normal text-muted-foreground sm:text-lg">/ NODE GATEWAYS</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Inspect normalized heartbeats and analyzed flow summaries</p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={handleGenerateSynthetic}
            disabled={generateSynthetic.isPending}
            className="gap-2 font-mono text-xs border-dashed border-primary/50 text-primary hover:bg-primary/10"
          >
            {generateSynthetic.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            PREVIEW_SYNTHETIC
          </Button>
          <Button variant="outline" size="icon" onClick={refreshAll} className="border-border bg-card">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      <TrafficFlowWidget flows={displayFlows} summary={summary} isLoading={isLoading && syntheticPreview === undefined} isSyntheticPreview={syntheticPreview !== undefined} />

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 shrink-0">
        <div className="bg-card border border-border p-3 rounded-md flex flex-col justify-between shadow-sm col-span-2">
          <div className="text-[10px] text-muted-foreground font-mono uppercase flex items-center justify-between">
            <span>Gateway Health</span>
            <Server className="w-3 h-3 text-primary" />
          </div>
          <div className="flex items-end gap-3 mt-2">
            <div className="flex-1">
              <div className="text-2xl font-mono font-semibold">{summary?.gatewayHealth?.total ?? "-"}</div>
              <div className="text-[9px] text-muted-foreground font-mono uppercase">TOTAL_NODES</div>
            </div>
            <div className="flex-1 text-safe">
              <div className="text-xl font-mono font-semibold">{summary?.gatewayHealth?.healthy ?? "-"}</div>
              <div className="text-[9px] font-mono uppercase">HEALTHY</div>
            </div>
            <div className="flex-1 text-critical">
              <div className="text-xl font-mono font-semibold">{summary?.gatewayHealth?.offline ?? "-"}</div>
              <div className="text-[9px] font-mono uppercase">OFFLINE</div>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border p-3 rounded-md flex flex-col justify-between shadow-sm">
          <span className="text-[10px] text-muted-foreground font-mono uppercase">Flow Count</span>
          <span className="text-2xl font-mono text-foreground font-semibold mt-2">{summary?.flowCount ?? "-"}</span>
        </div>

        <div className="bg-card border border-border p-3 rounded-md flex flex-col justify-between shadow-sm">
          <span className="text-[10px] text-muted-foreground font-mono uppercase">Heartbeat Count</span>
          <span className="text-2xl font-mono text-primary font-semibold mt-2">{summary?.heartbeatCount ?? "-"}</span>
        </div>

        <div className="bg-card border border-border p-3 rounded-md flex flex-col justify-between shadow-sm">
          <span className="text-[10px] text-muted-foreground font-mono uppercase">High Risk Flows</span>
          <span className="text-2xl font-mono text-critical font-semibold mt-2">{summary?.highRiskCount ?? "-"}</span>
        </div>

        <div className="bg-card border border-border p-3 rounded-md flex flex-col justify-between shadow-sm">
          <span className="text-[10px] text-muted-foreground font-mono uppercase">Isolated Actions</span>
          <span className="text-2xl font-mono text-warn font-semibold mt-2">{summary?.isolatedCount ?? "-"}</span>
        </div>

        <div className="bg-card border border-border p-3 rounded-md flex flex-col justify-between shadow-sm col-span-2">
          <div className="text-[10px] text-muted-foreground font-mono uppercase flex items-center justify-between">
            <span>Throughput</span>
            <Activity className="w-3 h-3 text-safe" />
          </div>
          <div className="flex items-end gap-3 mt-2">
            <div className="flex-1">
              <div className="text-lg font-mono font-semibold text-safe">{summary ? formatBytes(summary.bytesIn) : "-"}</div>
              <div className="text-[9px] text-muted-foreground font-mono uppercase">INBOUND</div>
            </div>
            <div className="flex-1">
              <div className="text-lg font-mono font-semibold text-primary">{summary ? formatBytes(summary.bytesOut) : "-"}</div>
              <div className="text-[9px] text-muted-foreground font-mono uppercase">OUTBOUND</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <Card className="bg-card/50 backdrop-blur border-border shrink-0">
        <CardContent className="p-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-muted-foreground mr-2">
            <Filter className="w-4 h-4" />
            <span className="font-mono text-sm uppercase tracking-widest">Filters:</span>
          </div>

          <Select value={observationTypeFilter} onValueChange={(value) => { setSyntheticPreview(undefined); setObservationTypeFilter(value); }}>
            <SelectTrigger className="w-[160px] font-mono text-xs bg-background">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL_TYPES</SelectItem>
              <SelectItem value="FLOW">FLOW</SelectItem>
              <SelectItem value="HEARTBEAT">HEARTBEAT</SelectItem>
            </SelectContent>
          </Select>

          <Select value={directionFilter} onValueChange={(value) => { setSyntheticPreview(undefined); setDirectionFilter(value); }}>
            <SelectTrigger className="w-[160px] font-mono text-xs bg-background">
              <SelectValue placeholder="Direction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL_DIRECTIONS</SelectItem>
              <SelectItem value="INBOUND">INBOUND</SelectItem>
              <SelectItem value="OUTBOUND">OUTBOUND</SelectItem>
              <SelectItem value="INTERNAL">INTERNAL</SelectItem>
              <SelectItem value="UNKNOWN">UNKNOWN</SelectItem>
            </SelectContent>
          </Select>

          <Select value={severityFilter} onValueChange={(value) => { setSyntheticPreview(undefined); setSeverityFilter(value); }}>
            <SelectTrigger className="w-[160px] font-mono text-xs bg-background">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL_SEVERITIES</SelectItem>
              <SelectItem value="LOW">LOW</SelectItem>
              <SelectItem value="MEDIUM">MEDIUM</SelectItem>
              <SelectItem value="HIGH">HIGH</SelectItem>
              <SelectItem value="CRITICAL">CRITICAL</SelectItem>
            </SelectContent>
          </Select>

          <Select value={protocolFilter} onValueChange={(value) => { setSyntheticPreview(undefined); setProtocolFilter(value); }}>
            <SelectTrigger className="w-[160px] font-mono text-xs bg-background">
              <SelectValue placeholder="Protocol" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL_PROTOCOLS</SelectItem>
              {["TCP", "UDP", "DNS", "HTTP", "HTTPS", "TLS", "QUIC", "ICMP", "UNKNOWN"].map((protocol) => (
                <SelectItem key={protocol} value={protocol}>{protocol}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setObservationTypeFilter("ALL");
              setDirectionFilter("ALL");
              setSeverityFilter("ALL");
              setProtocolFilter("ALL");
              setSyntheticPreview(undefined);
            }}
            className="font-mono text-xs ml-auto text-muted-foreground"
          >
            RESET
          </Button>
        </CardContent>
      </Card>

      {/* Main Table Area */}
      <Card className="flex-1 bg-card/50 backdrop-blur border-border overflow-hidden flex flex-col min-h-0">
        <div className="overflow-auto flex-1 custom-scrollbar">
          {isLoading ? (
            <div className="w-full h-full flex flex-col items-center justify-center font-mono text-muted-foreground animate-pulse p-12">
              <Network className="w-8 h-8 mb-4 opacity-50" />
              [ FETCHING TELEMETRY... ]
            </div>
          ) : isFlowsError || isSummaryError ? (
            <div className="w-full h-full flex flex-col items-center justify-center font-mono text-critical border border-dashed border-critical/30 m-4 rounded p-12">
              <AlertTriangle className="w-8 h-8 mb-4 opacity-70" />
              TRAFFIC TELEMETRY UNAVAILABLE
              <Button variant="outline" size="sm" onClick={refreshAll} className="mt-4 font-mono text-xs">
                RETRY
              </Button>
            </div>
          ) : !displayFlows || displayFlows.length === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center font-mono text-muted-foreground border border-dashed border-border m-4 rounded p-12">
              <Database className="w-8 h-8 mb-4 opacity-20" />
              NO OBSERVATIONS MATCH FILTER CRITERIA
            </div>
          ) : (
            <Table className="w-full">
              <TableHeader className="bg-secondary/50 sticky top-0 z-10 shadow-sm backdrop-blur-md">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[160px]">Observed At</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[120px]">Type / Gateway</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[120px]">Protocol / Dir</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest">Routing</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[200px]">Signals / SOC</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[100px]">Risk</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[120px] text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayFlows.map((obs: TrafficObservation) => (
                    <TableRow
                      key={obs.id}
                      className={`border-b border-border hover:bg-secondary/30 font-mono text-xs transition-colors group ${
                        obs.isSynthetic ? 'bg-primary/5' : ''
                      }`}
                    >
                      <TableCell className="text-muted-foreground whitespace-nowrap align-top pt-3">
                        <div className="text-foreground">{format(new Date(obs.observedAt), "yyyy-MM-dd")}</div>
                        <div className="text-[10px] mt-1 text-muted-foreground">{format(new Date(obs.observedAt), "HH:mm:ss.SSS")}</div>
                        {obs.isSynthetic && (
                          <Badge variant="outline" className="mt-2 text-[9px] px-1 py-0 h-4 border-primary/50 text-primary">SYNTHETIC</Badge>
                        )}
                      </TableCell>

                      <TableCell className="align-top pt-3">
                        <Badge variant="outline" className={`font-mono text-[9px] ${
                          obs.observationType === 'HEARTBEAT' ? 'border-secondary-foreground/30 text-secondary-foreground' : 'border-primary/50 text-primary'
                        }`}>
                          {obs.observationType}
                        </Badge>
                        <div className="mt-2 text-[10px] text-muted-foreground truncate max-w-[100px]" title={obs.gatewayId}>
                          GW: {obs.gatewayId.split('-')[0]}
                        </div>
                      </TableCell>

                      <TableCell className="align-top pt-3">
                        {obs.observationType === 'FLOW' ? (
                          <>
                            <div className="text-foreground font-semibold">{obs.protocol}</div>
                            <div className="text-[9px] mt-1 uppercase text-muted-foreground">{obs.direction}</div>
                          </>
                        ) : (
                          <div className="text-muted-foreground">-</div>
                        )}
                      </TableCell>

                      <TableCell className="align-top pt-3 max-w-[300px]">
                        {obs.observationType === 'FLOW' ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-[11px]">
                              <span className="text-muted-foreground truncate" title={obs.sourceAsset || 'Unknown'}>{obs.sourceAsset || '*'}</span>
                              {obs.sourcePort && <span className="text-primary/70">:{obs.sourcePort}</span>}
                              <ArrowRight className="w-3 h-3 text-border shrink-0" />
                              <span className="text-foreground truncate" title={obs.destinationAsset || 'Unknown'}>{obs.destinationAsset || '*'}</span>
                              {obs.destinationPort && <span className="text-primary/70">:{obs.destinationPort}</span>}
                            </div>

                            {(obs.dnsQueryName || obs.tlsServerName || obs.httpHost) && (
                              <div className="flex gap-2 flex-wrap text-[9px]">
                                {obs.dnsQueryName && <span className="bg-background border border-border px-1.5 py-0.5 rounded text-muted-foreground truncate max-w-[150px]" title={obs.dnsQueryName}>DNS: {obs.dnsQueryName}</span>}
                                {obs.tlsServerName && <span className="bg-background border border-border px-1.5 py-0.5 rounded text-muted-foreground truncate max-w-[150px]" title={obs.tlsServerName}>SNI: {obs.tlsServerName}</span>}
                                {obs.httpHost && <span className="bg-background border border-border px-1.5 py-0.5 rounded text-muted-foreground truncate max-w-[150px]" title={obs.httpHost}>HOST: {obs.httpHost}</span>}
                              </div>
                            )}

                            <div className="text-[9px] text-muted-foreground flex gap-3">
                              <span>↑ {formatBytes(obs.bytesOut)}</span>
                              <span>↓ {formatBytes(obs.bytesIn)}</span>
                              <span>{obs.durationMs}ms</span>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground uppercase">Status:</span>
                              <span className={`font-semibold ${
                                obs.heartbeatStatus === 'HEALTHY' ? 'text-safe' :
                                obs.heartbeatStatus === 'DEGRADED' ? 'text-warn' : 'text-critical'
                              }`}>{obs.heartbeatStatus}</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground uppercase">
                              Latency: <span className="text-foreground">{obs.heartbeatLatencyMs}ms</span>
                            </div>
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="align-top pt-3">
                        {(obs.signals?.length ?? 0) > 0 || (obs.correlatedEvents?.length ?? 0) > 0 ? (
                          <div className="flex gap-1 flex-wrap">
                            {obs.signals.map((sig, idx) => (
                              <Badge key={idx} variant="secondary" className="font-mono text-[9px] bg-secondary/50 hover:bg-secondary truncate max-w-[180px]" title={sig}>
                                {sig}
                              </Badge>
                            ))}
                            {obs.correlatedEvents?.map((event) => (
                              <Badge key={`event-${event.id}`} variant="outline" className="font-mono text-[9px] border-primary/50 text-primary" title={event.event}>
                                SOC #{event.id} · {event.action}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">-</span>
                        )}
                      </TableCell>

                      <TableCell className="align-top pt-3">
                        <div className="w-full flex items-center gap-2">
                          <span className={obs.riskScore > 75 ? 'text-critical font-bold' : obs.riskScore > 50 ? 'text-warn font-bold' : 'text-safe font-bold'}>{obs.riskScore}</span>
                          <div className="w-12 h-1 bg-secondary rounded-full overflow-hidden shrink-0">
                            <div className={`h-full ${obs.riskScore > 75 ? 'bg-critical' : obs.riskScore > 50 ? 'bg-warn' : 'bg-safe'}`} style={{ width: `${Math.min(100, Math.max(0, obs.riskScore))}%` }}></div>
                          </div>
                        </div>
                        <div className={`mt-1 text-[9px] uppercase ${
                          obs.severity === 'CRITICAL' ? 'text-critical' :
                          obs.severity === 'HIGH' ? 'text-warn' :
                          obs.severity === 'MEDIUM' ? 'text-primary' : 'text-safe'
                        }`}>
                          {obs.severity}
                        </div>
                      </TableCell>

                      <TableCell className="align-top pt-3 text-right">
                        <span className="font-bold text-[10px]" style={{
                          color: obs.recommendedAction === 'ALLOW' ? 'hsl(var(--safe))' :
                                 obs.recommendedAction === 'WARN' ? 'hsl(var(--warn))' :
                                 obs.recommendedAction === 'ISOLATE' ? 'hsl(var(--critical))' :
                                 'hsl(var(--primary))'
                        }}>
                          {obs.recommendedAction}
                        </span>
                      </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
