import { useState } from "react";
import {
  useGetNodeExchangeHealth,
  getGetNodeExchangeHealthQueryKey,
  useListNodeExchangeMessages,
  getListNodeExchangeMessagesQueryKey,
  useGetNodeExchangeRoute,
  getGetNodeExchangeRouteQueryKey,
  useVerifyNodeExchangeRoute,
  type NodeExchangeChecks,
  type NodeExchangeHealth,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Radio, Search, Activity, ShieldCheck, ShieldAlert, Cpu, Hash, FileSignature, ArrowRight, CornerDownRight, Check, X, Shield, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const checkLabels: Record<keyof NodeExchangeChecks, string> = {
  payloadHash: "PAYLOAD HASH VERIFICATION",
  envelopeHash: "ENVELOPE HASH VERIFICATION",
  signature: "CRYPTOGRAPHIC SIGNATURE",
  previousBlock: "PREVIOUS BLOCK LINK",
  blockHash: "BLOCK HASH VERIFICATION",
  hopHash: "HOP HASH VERIFICATION",
  routeChain: "ROUTE CONTINUITY CHAIN",
  routePolicy: "ROUTE COMPLIANCE POLICY"
};

export default function NodeExchange() {
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: health, isLoading: isLoadingHealth } = useGetNodeExchangeHealth({
    query: { refetchInterval: 10000, queryKey: getGetNodeExchangeHealthQueryKey() }
  });

  const { data: messages, isLoading: isLoadingMessages } = useListNodeExchangeMessages({
    query: { refetchInterval: 10000, queryKey: getListNodeExchangeMessagesQueryKey() }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setSelectedMessageId(searchQuery.trim());
    }
  };

  return (
    <div className="h-full flex flex-col gap-6">
      {/* Header / Health */}
      <HealthOverview health={health} isLoading={isLoadingHealth} />

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Messages List / Search */}
        <div className="lg:col-span-4 flex flex-col gap-4 min-h-[300px]">
          <Card className="bg-card/50 backdrop-blur border-border flex flex-col h-full overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest flex items-center justify-between">
                <span>Recorded Exchanges</span>
                <Radio className="w-4 h-4 text-primary" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
              <div className="p-4 border-b border-border/50 bg-secondary/10">
                <form onSubmit={handleSearch} className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="MESSAGE_ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-input border border-border text-foreground font-mono text-xs h-9 pl-9 pr-3 rounded focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none"
                    />
                  </div>
                  <button type="submit" className="px-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-xs font-mono tracking-widest uppercase transition-colors">
                    Find
                  </button>
                </form>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                {isLoadingMessages ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-3 text-muted-foreground">
                    <Activity className="w-5 h-5 animate-pulse" />
                    <span className="font-mono text-[10px] tracking-widest">LOADING MESSAGES...</span>
                  </div>
                ) : messages && messages.length > 0 ? (
                  messages.map((msg) => (
                    <button
                      key={msg.messageId}
                      onClick={() => setSelectedMessageId(msg.messageId)}
                      className={`w-full text-left p-3 rounded border transition-all ${selectedMessageId === msg.messageId ? 'bg-primary/10 border-primary/50 ring-1 ring-primary/20' : 'bg-card border-border hover:bg-secondary/30 hover:border-border/80'}`}
                    >
                      <div className="flex items-start justify-between mb-1.5">
                        <span className="text-[10px] font-mono text-primary font-bold">MSG: {msg.messageId.substring(0, 12)}...</span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${msg.recordedStatus === 'RECORDED' ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted text-muted-foreground border border-border'}`}>
                          {msg.recordedStatus}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground mb-2">
                        <span className="truncate">{msg.sourceNodeId}</span>
                        <ArrowRight className="w-3 h-3 shrink-0" />
                        <span className="truncate">{msg.destinationNodeId}</span>
                      </div>
                      <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground/60">
                        <span>{msg.hopCount} HOPS</span>
                        <span>{new Date(msg.lastAcceptedAt).toLocaleTimeString()}</span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 gap-3 text-muted-foreground">
                    <span className="font-mono text-[10px] tracking-widest">NO MESSAGES RECORDED</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Route Viewer */}
        <div className="lg:col-span-8 h-full min-h-[500px]">
          <RouteViewer key={selectedMessageId ?? "no-selection"} messageId={selectedMessageId} />
        </div>
      </div>
    </div>
  );
}

function HealthOverview({ health, isLoading }: { health?: NodeExchangeHealth, isLoading: boolean }) {
  if (isLoading || !health) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border h-24 flex items-center justify-center animate-pulse">
        <span className="font-mono text-xs text-muted-foreground tracking-widest">INITIALIZING NODE EXCHANGE...</span>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 backdrop-blur border-border shrink-0">
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="space-y-1">
          <div className="text-[9px] font-mono text-muted-foreground uppercase">Network Status</div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${health.status === 'HEALTHY' ? 'bg-safe animate-pulse' : 'bg-critical'}`} />
            <span className="text-sm font-mono font-bold text-foreground">{health.status}</span>
          </div>
        </div>
        
        <div className="space-y-1">
          <div className="text-[9px] font-mono text-muted-foreground uppercase">Ledger Head</div>
          <div className="flex items-center gap-2">
            {health.headConsistent ? (
              <ShieldCheck className="w-4 h-4 text-safe" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-critical" />
            )}
            <span className={`text-sm font-mono font-bold ${health.headConsistent ? 'text-safe' : 'text-critical'}`}>
              {health.headConsistent ? 'CONSISTENT' : 'MISMATCH'}
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[9px] font-mono text-muted-foreground uppercase">Active Nodes</div>
          <div className="flex items-center gap-2 text-sm font-mono text-foreground font-bold">
            <Cpu className="w-4 h-4 text-primary" />
            {health.activeNodeKeys}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[9px] font-mono text-muted-foreground uppercase">Head Seq</div>
          <div className="flex items-center gap-2 text-sm font-mono text-foreground font-bold">
            <Hash className="w-4 h-4 text-primary" />
            {health.headSequence}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[9px] font-mono text-muted-foreground uppercase">Security Policy</div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
            <FileSignature className="w-3 h-3" />
            <div className="flex flex-col leading-tight">
              <span>{health.hashAlgorithm}</span>
              <span>{health.signatureAlgorithm}</span>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[9px] font-mono text-muted-foreground uppercase">Last Accepted</div>
          <div className="text-xs font-mono text-foreground">
            {health.lastAcceptedAt ? new Date(health.lastAcceptedAt).toLocaleTimeString() : '-'}
          </div>
        </div>
      </div>
    </Card>
  );
}

function RouteViewer({ messageId }: { messageId: string | null }) {
  const verifyMutation = useVerifyNodeExchangeRoute();
  
  const { data: route, isLoading, isError } = useGetNodeExchangeRoute(messageId || '', {
    query: {
      enabled: !!messageId,
      queryKey: getGetNodeExchangeRouteQueryKey(messageId || '')
    }
  });

  if (!messageId) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border h-full flex items-center justify-center border-dashed">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Radio className="w-8 h-8 opacity-20" />
          <span className="font-mono text-xs tracking-widest uppercase">Select message to inspect route</span>
        </div>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-primary animate-pulse">
          <Activity className="w-8 h-8" />
          <span className="font-mono text-xs tracking-widest uppercase">RETRIEVING ROUTE TOPOLOGY...</span>
        </div>
      </Card>
    );
  }

  if (isError || !route) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border h-full flex items-center justify-center bg-critical/5 border-critical/20">
        <div className="flex flex-col items-center gap-3 text-critical">
          <ShieldAlert className="w-8 h-8" />
          <span className="font-mono text-xs tracking-widest uppercase">ROUTE NOT FOUND OR UNAVAILABLE</span>
        </div>
      </Card>
    );
  }

  // Use mutation data if available to overlay recomputed integrity
  const displayRoute = verifyMutation.data || route;
  const isRecomputed = !!verifyMutation.data;

  const handleVerify = () => {
    verifyMutation.mutate({ data: { messageId } });
  };

  return (
    <Card className="bg-card/50 backdrop-blur border-border h-full flex flex-col overflow-hidden relative">
      <CardHeader className="pb-3 border-b border-border/50 shrink-0 bg-secondary/10 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-sm font-mono text-foreground uppercase tracking-widest flex items-center gap-2">
            Route Inspection
            {displayRoute.integrityVerified ? (
              <span className={`px-2 py-0.5 text-[9px] rounded-full border ${isRecomputed ? 'bg-safe/20 border-safe/40 text-safe' : 'bg-primary/20 border-primary/40 text-primary'}`}>
                 {isRecomputed ? 'RECOMPUTED VERIFIED' : 'ROUTE VERIFIED'}
              </span>
            ) : (
              <span className="px-2 py-0.5 text-[9px] rounded-full border bg-critical/20 border-critical/40 text-critical">
                INTEGRITY FAILED
              </span>
            )}
          </CardTitle>
          <CardDescription className="text-[10px] font-mono mt-1">
            MSG: {displayRoute.messageId}
          </CardDescription>
        </div>
        
        <button
          onClick={handleVerify}
          disabled={verifyMutation.isPending}
          className="flex items-center gap-2 px-3 py-1.5 bg-secondary hover:bg-secondary/80 border border-border rounded text-xs font-mono transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${verifyMutation.isPending ? 'animate-spin' : ''}`} />
          {verifyMutation.isPending ? 'VERIFYING...' : 'RECOMPUTE VERIFICATION'}
        </button>
      </CardHeader>
      
      <CardContent className="p-0 flex-1 overflow-hidden flex flex-col">
        <div className="bg-muted/30 p-2 text-[9px] font-mono text-muted-foreground border-b border-border/50 flex justify-between">
          <span>POLICY: {displayRoute.policy}</span>
          <span className="text-warn text-[8px] max-w-[50%] text-right">DISCLAIMER: Verification validates cryptographic hashes only. Immutability, execution, and delivery are not guaranteed by this check.</span>
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8 relative">
          {/* Vertical line connecting hops */}
          <div className="absolute left-11 top-10 bottom-10 w-0.5 bg-border/50 z-0"></div>

          <AnimatePresence>
            {displayRoute.route.map((hop, index) => (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
                key={`${hop.sequence}-${hop.gatewayNodeId}`}
                className="relative z-10 flex gap-6"
              >
                {/* Step indicator */}
                <div className="shrink-0 w-10 h-10 rounded-full border-2 bg-card border-border flex items-center justify-center font-mono text-xs text-muted-foreground font-bold shadow-sm">
                  {hop.sequence}
                </div>

                {/* Hop Card */}
                <div className={`flex-1 rounded-md border p-4 shadow-sm ${hop.integrityVerified ? 'bg-card/80 border-border' : 'bg-critical/5 border-critical/30'}`}>
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4 border-b border-border/50 pb-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                        <span className="text-foreground">{hop.sourceNodeId}</span>
                        <ArrowRight className="w-3 h-3" />
                        <span className="text-foreground">{hop.destinationNodeId}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono">
                        <span className="text-muted-foreground uppercase tracking-widest">Gateway:</span>
                        <span className="text-primary">{hop.gatewayNodeId}</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${hop.decision === 'ACCEPTED' ? 'bg-safe/10 text-safe border-safe/20' : 'bg-warn/10 text-warn border-warn/20'}`}>
                        {hop.decision}
                      </span>
                      <span className="text-[9px] font-mono text-muted-foreground">{new Date(hop.receivedAt).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Hashes & Block */}
                    <div className="space-y-3">
                      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                        <Hash className="w-3 h-3" /> Block Cryptography
                      </div>
                      
                      <div className="space-y-2">
                        <HashDisplay label="HOP" hash={hop.hopHash} />
                        <HashDisplay label="BLOCK" hash={hop.block.blockHash} />
                        <HashDisplay label="PREV" hash={hop.block.previousBlockHash} />
                        <HashDisplay label="PAYLOAD" hash={hop.block.payloadHash} />
                      </div>
                      
                      <div className="mt-2 flex items-center gap-2 text-[9px] font-mono">
                        <span className="px-1.5 py-0.5 bg-secondary/50 rounded text-muted-foreground border border-border/50">KEY_V: {hop.block.keyVersion}</span>
                        <span className={`px-1.5 py-0.5 rounded border ${hop.block.verificationStatus === 'VERIFIED' ? 'bg-safe/10 text-safe border-safe/20' : 'bg-critical/10 text-critical border-critical/20'}`}>
                          SIG: {hop.block.verificationStatus}
                        </span>
                      </div>
                    </div>

                    {/* Integrity Checks */}
                    <div className="space-y-3">
                      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                        <Shield className="w-3 h-3" /> Integrity Verification
                      </div>
                      
                      <div className="space-y-1.5">
                        {Object.entries(hop.checks).map(([key, passed]) => (
                          <div key={key} className="flex items-center gap-2 text-[10px] font-mono">
                            {passed ? (
                              <Check className="w-3 h-3 text-safe shrink-0" />
                            ) : (
                              <X className="w-3 h-3 text-critical shrink-0" />
                            )}
                            <span className="text-foreground/80">{checkLabels[key as keyof NodeExchangeChecks] || key}</span>
                          </div>
                        ))}
                      </div>

                      {hop.errorCode && (
                        <div className="mt-3 p-2 bg-critical/10 border border-critical/30 rounded text-[10px] font-mono text-critical">
                          ERROR: {hop.errorCode}
                        </div>
                      )}
                      {hop.reasonCode && hop.reasonCode !== 'NONE' && (
                        <div className="mt-3 p-2 bg-warn/10 border border-warn/30 rounded text-[10px] font-mono text-warn">
                          REASON: {hop.reasonCode}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </CardContent>
    </Card>
  );
}

function HashDisplay({ label, hash }: { label: string, hash: string }) {
  const [showFull, setShowFull] = useState(false);
  
  // A typical hash might be "sha256:abc123def..."
  const parts = hash.split(':');
  const type = parts.length > 1 ? parts[0] : '';
  const value = parts.length > 1 ? parts[1] : hash;
  
  const shortValue = value.length > 16 ? `${value.substring(0, 8)}...${value.substring(value.length - 8)}` : value;

  return (
    <div className="flex items-center justify-between text-[10px] font-mono gap-4 group">
      <span className="text-muted-foreground shrink-0 w-16">{label}</span>
      <button
        type="button"
        className="flex-1 flex items-center justify-end gap-1 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
        onClick={() => setShowFull(!showFull)}
        title="Click to toggle full hash"
        aria-label={`${showFull ? "Shorten" : "Expand"} ${label} hash`}
      >
        {type && <span className="text-primary/70">{type}:</span>}
        <span className="text-foreground/90 break-all text-right transition-all">
          {showFull ? value : shortValue}
        </span>
      </button>
    </div>
  );
}
