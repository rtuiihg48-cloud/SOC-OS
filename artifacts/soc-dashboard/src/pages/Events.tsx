import { useState } from "react";
import { useListEvents, useUpdateEventStatus, getListEventsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion } from "framer-motion";
import { ShieldAlert, Crosshair, ArrowRight, Zap, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Events() {
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [tacticFilter, setTacticFilter] = useState<string>("ALL");

  const queryParams: any = {};
  if (actionFilter !== "ALL") queryParams.action = actionFilter;
  if (statusFilter !== "ALL") queryParams.status = statusFilter;
  if (tacticFilter !== "ALL") queryParams.tactic = tacticFilter;

  const { data: events, isLoading } = useListEvents(queryParams, {
    query: { queryKey: getListEventsQueryKey(queryParams) }
  });

  const updateStatus = useUpdateEventStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleUpdateStatus = (id: number, status: 'ACKNOWLEDGED' | 'INVESTIGATING' | 'RESOLVED') => {
    updateStatus.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey(queryParams) });
        toast({ title: "STATUS UPDATED", description: `Event #${id} status changed to ${status}` });
      }
    });
  };

  // Derive unique tactics for filter
  const allTactics = Array.from(new Set(events?.map(e => e.tactic).filter(Boolean))) as string[];

  // Counts
  const counts = {
    NEW: events?.filter(e => e.status === 'NEW').length || 0,
    ACK: events?.filter(e => e.status === 'ACKNOWLEDGED').length || 0,
    INV: events?.filter(e => e.status === 'INVESTIGATING').length || 0,
    RES: events?.filter(e => e.status === 'RESOLVED').length || 0,
    QUAR: events?.filter(e => e.status === 'QUARANTINED').length || 0,
  };

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-8rem)]">

      {/* Triage Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 shrink-0">
        <Card className="bg-critical/5 border-critical/20">
          <CardContent className="p-4 flex flex-col items-center">
            <div className="text-2xl font-mono font-bold text-critical">{counts.NEW}</div>
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">NEW</div>
          </CardContent>
        </Card>
        <Card className="bg-warn/5 border-warn/20">
          <CardContent className="p-4 flex flex-col items-center">
            <div className="text-2xl font-mono font-bold text-warn">{counts.ACK}</div>
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">ACKNOWLEDGED</div>
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex flex-col items-center">
            <div className="text-2xl font-mono font-bold text-primary">{counts.INV}</div>
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">INVESTIGATING</div>
          </CardContent>
        </Card>
        <Card className="bg-safe/5 border-safe/20">
          <CardContent className="p-4 flex flex-col items-center">
            <div className="text-2xl font-mono font-bold text-safe">{counts.RES}</div>
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">RESOLVED</div>
          </CardContent>
        </Card>
        <Card className="bg-critical/5 border-critical/20">
          <CardContent className="p-4 flex flex-col items-center">
            <div className="text-2xl font-mono font-bold text-critical">{counts.QUAR}</div>
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">QUARANTINED</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="bg-card/50 backdrop-blur border-border shrink-0">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="flex items-center gap-2 text-muted-foreground mr-4">
            <Filter className="w-4 h-4" />
            <span className="font-mono text-sm uppercase tracking-widest">Filters:</span>
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px] font-mono text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL STATUSES</SelectItem>
              <SelectItem value="NEW">NEW</SelectItem>
              <SelectItem value="ACKNOWLEDGED">ACKNOWLEDGED</SelectItem>
              <SelectItem value="INVESTIGATING">INVESTIGATING</SelectItem>
              <SelectItem value="QUARANTINED">QUARANTINED</SelectItem>
              <SelectItem value="RESOLVED">RESOLVED</SelectItem>
            </SelectContent>
          </Select>

          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-[180px] font-mono text-xs">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL ACTIONS</SelectItem>
              <SelectItem value="ALLOW">ALLOW</SelectItem>
              <SelectItem value="WARN">WARN</SelectItem>
              <SelectItem value="ISOLATE">ISOLATE</SelectItem>
              <SelectItem value="PATCHED">PATCHED</SelectItem>
            </SelectContent>
          </Select>

          <Select value={tacticFilter} onValueChange={setTacticFilter}>
            <SelectTrigger className="w-[180px] font-mono text-xs">
              <SelectValue placeholder="Tactic" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL TACTICS</SelectItem>
              {allTactics.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button variant="ghost" size="sm" onClick={() => {setActionFilter("ALL"); setStatusFilter("ALL"); setTacticFilter("ALL");}} className="font-mono text-xs ml-auto">
            RESET
          </Button>
        </CardContent>
      </Card>

      {/* Main Table Area */}
      <Card className="flex-1 bg-card/50 backdrop-blur border-border overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1 custom-scrollbar">
          {isLoading ? (
            <div className="w-full h-full flex items-center justify-center font-mono text-muted-foreground animate-pulse">
              [ SCANNING EVENT LOG... ]
            </div>
          ) : !events || events.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center font-mono text-muted-foreground border border-dashed border-border m-4 rounded">
              NO EVENTS MATCH FILTER CRITERIA
            </div>
          ) : (
            <Table className="w-full">
              <TableHeader className="bg-secondary/50 sticky top-0 z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[120px]">Time</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[100px]">Status</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest">Event / Technique</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[120px]">Tactic</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[100px]">Risk</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[100px]">Action</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[200px] text-right">Triage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => (
                    <motion.tr
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      key={ev.id}
                      className="border-b border-border hover:bg-secondary/20 font-mono text-xs transition-colors group"
                    >
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {new Date(ev.timestamp).toLocaleTimeString([], {hour12:false})}
                        <div className="text-[10px] opacity-50 mt-1">ID: {ev.hash.substring(0,8)}</div>
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className={`font-mono text-[10px] ${
                          ev.status === 'NEW' ? 'border-critical text-critical' :
                          ev.status === 'ACKNOWLEDGED' ? 'border-warn text-warn' :
                           ev.status === 'INVESTIGATING' ? 'border-primary text-primary' :
                           ev.status === 'QUARANTINED' ? 'border-critical text-critical' : 'border-safe text-safe'
                        }`}>
                          {ev.status}
                        </Badge>
                      </TableCell>

                      <TableCell className="max-w-[300px]">
                        <div className="flex items-center gap-2">
                          {ev.velocityFlag && <span className="text-critical shrink-0" title="Burst Detection">⚡</span>}
                          <span className="truncate" title={ev.event}>{ev.event}</span>
                        </div>
                        {ev.technique && (
                          <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                            <Crosshair className="w-3 h-3" /> {ev.technique} {ev.techniqueId && `(${ev.techniqueId})`}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        {ev.tactic ? (
                          <Badge variant="secondary" className="font-mono text-[10px] truncate max-w-[120px]">
                            {ev.tactic}
                          </Badge>
                        ) : '-'}
                      </TableCell>

                      <TableCell>
                        <div className="w-full flex items-center gap-2">
                          <span className={ev.score > 75 ? 'text-critical' : ev.score > 50 ? 'text-warn' : 'text-safe'}>{ev.score}</span>
                          <div className="w-12 h-1 bg-secondary rounded-full overflow-hidden shrink-0">
                            <div className={`h-full ${ev.score > 75 ? 'bg-critical' : ev.score > 50 ? 'bg-warn' : 'bg-safe'}`} style={{ width: `${ev.score}%` }}></div>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <span className="font-bold" style={{ color: ev.action === 'ALLOW' ? 'hsl(var(--safe))' : ev.action === 'WARN' ? 'hsl(var(--warn))' : ev.action === 'ISOLATE' ? 'hsl(var(--critical))' : 'hsl(var(--primary))' }}>
                          {ev.action}
                        </span>
                      </TableCell>

                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {ev.status === 'NEW' && (
                            <Button size="sm" variant="outline" className="h-6 text-[10px] font-mono border-warn text-warn hover:bg-warn/10" onClick={() => handleUpdateStatus(ev.id, 'ACKNOWLEDGED')}>
                              ACK
                            </Button>
                          )}
                          {ev.status === 'ACKNOWLEDGED' && (
                            <Button size="sm" variant="outline" className="h-6 text-[10px] font-mono border-primary text-primary hover:bg-primary/10" onClick={() => handleUpdateStatus(ev.id, 'INVESTIGATING')}>
                              INV
                            </Button>
                          )}
                          {ev.status === 'INVESTIGATING' && (
                            <Button size="sm" variant="outline" className="h-6 text-[10px] font-mono border-safe text-safe hover:bg-safe/10" onClick={() => handleUpdateStatus(ev.id, 'RESOLVED')}>
                              RES
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </motion.tr>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
