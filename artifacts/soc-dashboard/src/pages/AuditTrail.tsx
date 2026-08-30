import { useState } from "react";
import {
  useListAuditRecords,
  getListAuditRecordsQueryKey,
  useVerifyAuditChain,
  useGetCurrentPrincipal,
  getGetCurrentPrincipalQueryKey,
  AuditRecord
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Activity, ShieldCheck, ShieldAlert, CheckCircle2, ChevronLeft, ChevronRight, Fingerprint, History, Server, FileText, Lock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

export default function AuditTrail() {
  const { toast } = useToast();
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const { data: principal } = useGetCurrentPrincipal({
    query: { queryKey: getGetCurrentPrincipalQueryKey() }
  });

  const { data: page, isLoading, isError, refetch } = useListAuditRecords(
    { cursor },
    {
      query: {
        queryKey: getListAuditRecordsQueryKey({ cursor }),
        enabled: !!principal?.capabilities?.includes("audit:read")
      }
    }
  );

  const verifyChain = useVerifyAuditChain();

  const canVerify = principal?.capabilities?.includes("audit:verify");
  const canRead = principal?.capabilities?.includes("audit:read");

  const handleNextPage = () => {
    if (page?.nextCursor) {
      setCursorHistory(prev => [...prev, cursor || ""]);
      setCursor(page.nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorHistory.length > 0) {
      const newHistory = [...cursorHistory];
      const prevCursor = newHistory.pop();
      setCursorHistory(newHistory);
      setCursor(prevCursor === "" ? undefined : prevCursor);
    }
  };

  const handleVerify = () => {
    verifyChain.mutate({ data: {} }, {
      onSuccess: (res) => {
        setVerifyResult(res);
        setVerifyDialogOpen(true);
        if (res.valid) {
          toast({
            title: "Verification Complete",
            description: `Chain integrity verified across ${res.checked} records.`,
          });
        } else {
          toast({
            variant: "destructive",
            title: "Verification Failed",
            description: `Chain broken at sequence ${res.firstBrokenSequence}.`,
          });
        }
      },
      onError: (err: any) => {
        toast({
          variant: "destructive",
          title: "Verification Error",
          description: err.error || "An error occurred while verifying the audit chain.",
        });
      }
    });
  };

  const records = page?.records || [];

  if (principal && !canRead) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
        <Lock className="w-16 h-16 text-muted-foreground mb-6" />
        <h2 className="text-2xl font-mono uppercase tracking-widest mb-2">Access Denied</h2>
        <p className="text-muted-foreground font-sans">
          You lack the required <span className="font-mono text-primary text-xs bg-primary/10 px-1 py-0.5 rounded">audit:read</span> capability to view the tenant audit trail.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col max-w-7xl mx-auto space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-2">Audit Evidence</h2>
          <p className="text-muted-foreground font-sans">
            Immutable, cryptographically chained records of all tenant administrative and security actions.
          </p>
        </div>
        {canVerify && (
          <Button
            onClick={handleVerify}
            disabled={verifyChain.isPending}
            className="font-mono tracking-widest uppercase gap-2"
            data-testid="btn-verify-chain"
          >
            {verifyChain.isPending ? (
              <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            Verify Chain Integrity
          </Button>
        )}
      </div>

      <div className="border border-border rounded-md bg-card flex-1 overflow-hidden flex flex-col shadow-xl">
        <ScrollArea className="flex-1">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm">
              <TableRow className="border-border">
                <TableHead className="font-mono text-xs font-semibold w-24">SEQ</TableHead>
                <TableHead className="font-mono text-xs font-semibold w-40">TIMESTAMP</TableHead>
                <TableHead className="font-mono text-xs font-semibold">PRINCIPAL</TableHead>
                <TableHead className="font-mono text-xs font-semibold">ACTION</TableHead>
                <TableHead className="font-mono text-xs font-semibold">TARGET</TableHead>
                <TableHead className="font-mono text-xs font-semibold">DECISION</TableHead>
                <TableHead className="font-mono text-xs font-semibold w-64 text-right">HASH</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground space-y-4">
                      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span className="font-mono text-xs uppercase tracking-widest">Loading evidence...</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground space-y-4">
                      <History className="w-12 h-12 opacity-20" />
                      <span className="font-mono text-sm uppercase tracking-widest">No audit records found</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {records.map((record: AuditRecord) => (
                <TableRow key={record.id} className="border-border/50 hover:bg-muted/30 transition-colors">
                  <TableCell className="font-mono text-xs text-muted-foreground">{record.sequence}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {format(new Date(record.occurredAt), "yyyy-MM-dd HH:mm:ss")}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium leading-none">{record.principalId}</span>
                      <span className="text-[10px] font-mono text-muted-foreground uppercase">{record.principalType}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider bg-secondary text-secondary-foreground">
                      {record.action}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm leading-none truncate max-w-[200px]" title={record.targetId}>{record.targetId}</span>
                      <span className="text-[10px] font-mono text-muted-foreground uppercase">{record.targetType}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase tracking-wider ${
                      record.decision === 'ALLOW' ? 'bg-safe/10 text-safe border border-safe/20' :
                      record.decision === 'DENY' ? 'bg-destructive/10 text-destructive border border-destructive/20' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {record.decision}
                    </span>
                    {record.reasonCode && (
                      <div className="text-[10px] text-muted-foreground mt-1 truncate max-w-[150px]" title={record.reasonCode}>
                        {record.reasonCode}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[10px] text-muted-foreground/70 align-top">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1 group relative cursor-help">
                        <span className="truncate max-w-[120px]">{record.hash}</span>
                        <Fingerprint className="w-3 h-3 opacity-50" />
                        <div className="absolute right-0 top-full mt-1 bg-popover border border-border p-2 rounded text-xs z-50 shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all w-[300px] text-left">
                          <div className="text-[9px] uppercase text-muted-foreground mb-1">Current Hash</div>
                          <div className="break-all text-primary mb-2">{record.hash}</div>
                          <div className="text-[9px] uppercase text-muted-foreground mb-1">Previous Hash</div>
                          <div className="break-all">{record.prevHash}</div>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
        <div className="p-2 border-t border-border flex items-center justify-between bg-muted/20 px-4">
          <Button
            variant="ghost"
            size="sm"
            className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground gap-2"
            onClick={handlePrevPage}
            disabled={cursorHistory.length === 0}
            data-testid="btn-prev-page"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </Button>
          <div className="text-xs font-mono text-muted-foreground">
            {records.length} records
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground gap-2"
            onClick={handleNextPage}
            disabled={!page?.nextCursor}
            data-testid="btn-next-page"
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {verifyResult?.valid ? (
                <ShieldCheck className="w-5 h-5 text-safe" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-destructive" />
              )}
              Chain Verification Result
            </DialogTitle>
            <DialogDescription>
              Cryptographic integrity check of the immutable audit log.
            </DialogDescription>
          </DialogHeader>

          {verifyResult && (
            <div className="py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="border border-border p-3 rounded-md bg-muted/30 flex flex-col items-center justify-center text-center">
                  <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">Status</div>
                  {verifyResult.valid ? (
                    <div className="text-lg font-bold text-safe flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" /> INTACT
                    </div>
                  ) : (
                    <div className="text-lg font-bold text-destructive flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4" /> BROKEN
                    </div>
                  )}
                </div>
                <div className="border border-border p-3 rounded-md bg-muted/30 flex flex-col items-center justify-center text-center">
                  <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">Records Checked</div>
                  <div className="text-xl font-mono text-primary font-bold">{verifyResult.checked}</div>
                </div>
              </div>

              {!verifyResult.valid && (
                <div className="border border-destructive/30 bg-destructive/10 p-4 rounded-md space-y-2">
                  <h4 className="text-sm font-semibold text-destructive uppercase tracking-wider font-mono flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Violation Detected
                  </h4>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Broken Sequence:</span>{" "}
                    <span className="font-mono text-foreground font-bold">{verifyResult.firstBrokenSequence}</span>
                  </div>
                  {verifyResult.errorCode && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Error Code:</span>{" "}
                      <span className="font-mono text-foreground">{verifyResult.errorCode}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setVerifyDialogOpen(false)} variant="outline" className="font-mono uppercase tracking-widest text-xs">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}