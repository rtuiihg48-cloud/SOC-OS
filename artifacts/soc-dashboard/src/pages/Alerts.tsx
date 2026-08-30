import { useListEvents, useUpdateEventStatus, getListEventsQueryKey, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Clock, ArrowRight, ShieldCheck, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

export default function Alerts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Use a custom query for Alerts specifically (ISOLATE/WARN, NEW/ACKNOWLEDGED)
  const { data: isolateNew, isLoading: load1 } = useListEvents(
    { action: "ISOLATE", status: "NEW", limit: 20 },
    { query: { queryKey: getListEventsQueryKey({ action: "ISOLATE", status: "NEW", limit: 20 }), refetchInterval: 10000 } }
  );
  
  const { data: warnNew, isLoading: load2 } = useListEvents(
    { action: "WARN", status: "NEW", limit: 20 },
    { query: { queryKey: getListEventsQueryKey({ action: "WARN", status: "NEW", limit: 20 }), refetchInterval: 10000 } }
  );

  const { data: isolateAck, isLoading: load3 } = useListEvents(
    { action: "ISOLATE", status: "ACKNOWLEDGED", limit: 20 },
    { query: { queryKey: getListEventsQueryKey({ action: "ISOLATE", status: "ACKNOWLEDGED", limit: 20 }), refetchInterval: 10000 } }
  );
  
  const { data: warnAck, isLoading: load4 } = useListEvents(
    { action: "WARN", status: "ACKNOWLEDGED", limit: 20 },
    { query: { queryKey: getListEventsQueryKey({ action: "WARN", status: "ACKNOWLEDGED", limit: 20 }), refetchInterval: 10000 } }
  );

  const { data: isolateQuarantined, isLoading: load5 } = useListEvents(
    { action: "ISOLATE", status: "QUARANTINED", limit: 20 },
    { query: { queryKey: getListEventsQueryKey({ action: "ISOLATE", status: "QUARANTINED", limit: 20 }), refetchInterval: 10000 } }
  );

  const updateStatus = useUpdateEventStatus();

  if (load1 || load2 || load3 || load4 || load5) {
    return (
      <div className="w-full h-full flex items-center justify-center font-mono text-primary animate-pulse">
        [ FETCHING ACTIVE ALERTS... ]
      </div>
    );
  }

  const allAlerts = [
    ...(isolateNew || []), 
    ...(warnNew || []),
    ...(isolateAck || []),
    ...(warnAck || []),
    ...(isolateQuarantined || [])
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const handleUpdateStatus = (id: number, status: 'ACKNOWLEDGED' | 'INVESTIGATING' | 'RESOLVED') => {
    updateStatus.mutate(
      { id, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          toast({
            title: "STATUS UPDATED",
            description: `Alert #${id} marked as ${status}`,
          });
        }
      }
    );
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-mono uppercase tracking-widest text-primary flex items-center gap-2">
          <ShieldAlert className="w-6 h-6" /> ACTIVE ALERTS
        </h2>
        <div className="font-mono text-sm text-muted-foreground flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-critical animate-pulse"></div>
          AUTO-REFRESH: ACTIVE (10s)
        </div>
      </div>

      {allAlerts.length === 0 ? (
        <Card className="bg-safe/5 border-safe/20 backdrop-blur">
          <CardContent className="flex flex-col items-center justify-center py-24 text-safe font-mono space-y-4">
            <ShieldCheck className="w-16 h-16 opacity-80" />
            <div className="text-xl tracking-widest uppercase">System Secure</div>
            <div className="text-sm opacity-60">No Active Alerts</div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {allAlerts.map((alert) => (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className={`border ${alert.action === 'ISOLATE' ? 'bg-critical/5 border-critical/30' : 'bg-warn/5 border-warn/30'} overflow-hidden relative group`}>
                  <div className={`absolute top-0 left-0 w-1 h-full ${alert.action === 'ISOLATE' ? 'bg-critical' : 'bg-warn'}`}></div>
                  
                  <CardHeader className="pb-3 flex flex-row items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`font-mono font-bold uppercase tracking-wider ${alert.status === 'NEW' ? 'text-critical border-critical' : 'text-warn border-warn'}`}>
                          {alert.status}
                        </Badge>
                        <Badge variant="outline" className={`font-mono uppercase ${alert.action === 'ISOLATE' ? 'text-critical border-critical/50' : 'text-warn border-warn/50'}`}>
                          {alert.action}
                        </Badge>
                        {alert.tactic && (
                          <Badge variant="secondary" className="font-mono bg-secondary/50">
                            {alert.tactic}
                          </Badge>
                        )}
                        {alert.velocityFlag && (
                          <Badge variant="destructive" className="font-mono bg-destructive/20 text-destructive-foreground hover:bg-destructive/30">
                            ⚡ BURST
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-lg mt-2">{alert.event}</CardTitle>
                    </div>
                    <div className="flex flex-col items-end text-sm font-mono text-muted-foreground gap-1">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </div>
                      <div className="text-xs opacity-70">ID: {alert.hash.substring(0,8)}</div>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="py-0 pb-4">
                    {alert.technique && (
                      <div className="text-sm font-mono text-muted-foreground mb-3 flex items-center gap-2">
                        <Search className="w-3 h-3" /> Technique: {alert.technique} {alert.techniqueId ? `(${alert.techniqueId})` : ''}
                      </div>
                    )}
                    <div className="w-full bg-secondary/30 h-1.5 rounded-full overflow-hidden flex">
                      <div className={`h-full ${alert.score > 75 ? 'bg-critical' : alert.score > 50 ? 'bg-warn' : 'bg-safe'}`} style={{ width: `${alert.score}%` }}></div>
                    </div>
                    <div className="text-xs font-mono mt-1 text-muted-foreground text-right">Risk Score: {alert.score}</div>
                  </CardContent>

                  <CardFooter className="bg-secondary/20 pt-4 flex gap-3 justify-end border-t border-border/50">
                    {alert.status === 'NEW' && (
                      <Button variant="outline" size="sm" onClick={() => handleUpdateStatus(alert.id, 'ACKNOWLEDGED')} className="font-mono text-xs border-warn/50 text-warn hover:bg-warn/10">
                        ACKNOWLEDGE
                      </Button>
                    )}
                    {(alert.status === 'NEW' || alert.status === 'ACKNOWLEDGED') && (
                      <Button variant="outline" size="sm" onClick={() => handleUpdateStatus(alert.id, 'INVESTIGATING')} className="font-mono text-xs border-primary/50 text-primary hover:bg-primary/10">
                        INVESTIGATE <ArrowRight className="w-3 h-3 ml-1" />
                      </Button>
                    )}
                    <Button variant="default" size="sm" onClick={() => handleUpdateStatus(alert.id, 'RESOLVED')} className="font-mono text-xs bg-safe hover:bg-safe/90 text-safe-foreground">
                      RESOLVE
                    </Button>
                  </CardFooter>
                </Card>
              </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
