import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  BugOff, ShieldAlert, Database, FileBadge, Eye, Search, AlertTriangle, Lock, ShieldCheck, Activity, Download, Plus, RefreshCw
} from "lucide-react";

import {
  useGetVirusDatabaseStats,
  useListVirusEntries,
  useCreateVirusEntry,
  useLookupVirusIndicator,
  useListVirusSamples,
  useRegisterVirusSample,
  useRequestVirusSampleDownload,
  useListVirusFeeds,
  useListVirusMatches,
  useListVirusDatabaseAudit,
  getGetVirusDatabaseStatsQueryKey,
  getListVirusEntriesQueryKey,
  getListVirusSamplesQueryKey,
  getListVirusMatchesQueryKey,
  getListVirusDatabaseAuditQueryKey
} from "@workspace/api-client-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// --- Schema Definitions ---

const createEntrySchema = z.object({
  canonicalName: z.string().min(1, "Name is required"),
  familyName: z.string().optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  confidence: z.coerce.number().min(0).max(1),
  sha256: z.string().regex(/^[0-9A-Fa-f]{64}$/, "Must be a valid 64-character SHA-256 hash"),
  description: z.string().optional(),
  sourceName: z.string().optional(),
});

const registerSampleSchema = z.object({
  sha256: z.string().regex(/^[0-9A-Fa-f]{64}$/, "Must be a valid 64-character SHA-256 hash"),
  sizeBytes: z.coerce.number().min(1),
  sourceType: z.enum(["MANUAL", "NODE", "VIRTUALBOX", "FEED"]),
  declaredName: z.string().optional(),
  declaredContentType: z.string().optional(),
  sourceReference: z.string().optional(),
});

const lookupSchema = z.object({
  sha256: z.string().regex(/^[0-9A-Fa-f]{64}$/, "Must be a valid 64-character SHA-256 hash"),
});

// --- Components ---

function CreateEntryDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const createMutation = useCreateVirusEntry();

  const form = useForm<z.infer<typeof createEntrySchema>>({
    resolver: zodResolver(createEntrySchema),
    defaultValues: {
      canonicalName: "",
      familyName: "",
      severity: "HIGH",
      confidence: 0.95,
      sha256: "",
      description: "",
      sourceName: "MANUAL_ANALYST",
    }
  });

  const onSubmit = (data: z.infer<typeof createEntrySchema>) => {
    createMutation.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "Entry created", description: "Catalog entry successfully registered." });
          setOpen(false);
          form.reset();
          onSuccess();
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message || "Failed to create entry", variant: "destructive" });
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-xs">
          <Plus className="w-4 h-4" /> NEW_CATALOG_ENTRY
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-mono text-primary flex items-center gap-2">
            <Database className="w-5 h-5" /> CREATE VIRUS CATALOG ENTRY
          </DialogTitle>
          <DialogDescription>
            Register a non-executable threat identity and authoritative exact SHA-256 indicator.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 font-mono text-sm">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="canonicalName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Canonical Name</FormLabel>
                  <FormControl><Input placeholder="e.g. Trojan.Win32.Emotet" {...field} className="bg-background border-border" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="familyName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Family (Optional)</FormLabel>
                  <FormControl><Input placeholder="e.g. Emotet" {...field} className="bg-background border-border" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="sha256" render={({ field }) => (
              <FormItem>
                <FormLabel>SHA-256 Hash</FormLabel>
                <FormControl><Input placeholder="a1b2c3..." {...field} className="bg-background border-border" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="severity" render={({ field }) => (
                <FormItem>
                  <FormLabel>Severity</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-background border-border"><SelectValue placeholder="Select severity" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="LOW">LOW</SelectItem>
                      <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                      <SelectItem value="HIGH">HIGH</SelectItem>
                      <SelectItem value="CRITICAL">CRITICAL</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="confidence" render={({ field }) => (
                <FormItem>
                  <FormLabel>Confidence (0-1)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} className="bg-background border-border" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl><Textarea placeholder="Technical details..." {...field} className="bg-background border-border h-20 resize-none" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={createMutation.isPending} className="font-mono bg-primary text-primary-foreground">
                {createMutation.isPending ? "COMMITTING..." : "COMMIT_ENTRY"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function RegisterSampleDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const registerMutation = useRegisterVirusSample();

  const form = useForm<z.infer<typeof registerSampleSchema>>({
    resolver: zodResolver(registerSampleSchema),
    defaultValues: {
      sha256: "",
      sizeBytes: 1024,
      sourceType: "MANUAL",
      declaredName: "",
      declaredContentType: "application/octet-stream",
      sourceReference: "",
    }
  });

  const onSubmit = (data: z.infer<typeof registerSampleSchema>) => {
    registerMutation.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "Sample Registered", description: "Metadata registered. Waiting for binary upload (disabled in UI)." });
          setOpen(false);
          form.reset();
          onSuccess();
        },
        onError: (err: any) => {
          toast({ title: "Registration Failed", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-secondary-border font-mono text-xs">
          <FileBadge className="w-4 h-4" /> REGISTER_SAMPLE_META
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-mono text-secondary-foreground flex items-center gap-2">
            <FileBadge className="w-5 h-5 text-primary" /> REGISTER QUARANTINED SAMPLE
          </DialogTitle>
          <DialogDescription>
            Record private evidence metadata only. This form never uploads or executes sample bytes.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 font-mono text-sm">
            <FormField control={form.control} name="sha256" render={({ field }) => (
              <FormItem>
                <FormLabel>SHA-256 Hash</FormLabel>
                <FormControl><Input placeholder="a1b2c3..." {...field} className="bg-background border-border" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="sizeBytes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Size (Bytes)</FormLabel>
                  <FormControl><Input type="number" {...field} className="bg-background border-border" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="sourceType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Source Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-background border-border"><SelectValue placeholder="Select source" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="MANUAL">MANUAL</SelectItem>
                      <SelectItem value="NODE">NODE</SelectItem>
                      <SelectItem value="VIRTUALBOX">VIRTUALBOX</SelectItem>
                      <SelectItem value="FEED">FEED</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="declaredName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Declared Name</FormLabel>
                  <FormControl><Input placeholder="malware.exe" {...field} className="bg-background border-border" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="declaredContentType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Content Type</FormLabel>
                  <FormControl><Input placeholder="application/x-dosexec" {...field} className="bg-background border-border" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="bg-warn/10 border border-warn/30 p-3 rounded text-warn text-xs flex items-start gap-2 mt-4">
              <Lock className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <strong className="block mb-1">DATA PLANE RESTRICTION:</strong>
                Registering metadata only. Binary upload must be executed via secure offline channel. The UI does not handle live malware binaries.
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={registerMutation.isPending} className="font-mono bg-primary text-primary-foreground">
                {registerMutation.isPending ? "REGISTERING..." : "REGISTER_METADATA"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function LookupIndicatorDialog() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();
  const lookupMutation = useLookupVirusIndicator();

  const form = useForm<z.infer<typeof lookupSchema>>({
    resolver: zodResolver(lookupSchema),
    defaultValues: { sha256: "" }
  });

  const onSubmit = (data: z.infer<typeof lookupSchema>) => {
    setResult(null);
    lookupMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          setResult(res);
        },
        onError: (err: any) => {
          toast({ title: "Lookup Failed", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 font-mono text-xs border-dashed border-border bg-transparent hover:bg-secondary">
          <Search className="w-4 h-4" /> LOOKUP_HASH
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-mono text-primary flex items-center gap-2">
            <Search className="w-5 h-5" /> EXACT HASH LOOKUP
          </DialogTitle>
          <DialogDescription>
            Compare a SHA-256 value against active catalog indicators without executing content.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 font-mono text-sm">
            <FormField control={form.control} name="sha256" render={({ field }) => (
              <FormItem>
                <FormLabel>SHA-256</FormLabel>
                <div className="flex gap-2">
                  <FormControl>
                    <Input placeholder="Enter 64-character hash..." {...field} className="bg-background border-border flex-1" />
                  </FormControl>
                  <Button type="submit" disabled={lookupMutation.isPending} className="bg-primary text-primary-foreground">
                    {lookupMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : "SEARCH"}
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )} />
          </form>
        </Form>

        {result && (
          <div className="mt-4 border border-border bg-background p-4 rounded-md font-mono text-xs space-y-3">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <span className="text-muted-foreground">MATCH_STATUS:</span>
              {result.matched ? (
                <Badge className="bg-critical/20 text-critical border border-critical hover:bg-critical/30">MATCH_FOUND</Badge>
              ) : (
                <Badge className="bg-safe/20 text-safe border border-safe hover:bg-safe/30">NO_MATCH</Badge>
              )}
            </div>
            {result.matched && result.entry && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground">IDENTITY:</span>
                  <span className="col-span-2 text-foreground font-semibold">{result.entry.canonicalName}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground">SEVERITY:</span>
                  <span className="col-span-2 text-critical">{result.entry.severity}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground">CONFIDENCE:</span>
                  <span className="col-span-2">{(result.entry.confidence * 100).toFixed(0)}%</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground">REC_ACTION:</span>
                  <span className="col-span-2 text-warn">{result.recommendedAction}</span>
                </div>
              </>
            )}
            <div className="grid grid-cols-3 gap-2 border-t border-border pt-2">
              <span className="text-muted-foreground">EXEC_POLICY:</span>
              {result.executionAllowed ? (
                <span className="col-span-2 text-critical flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> ALLOWED (UNSAFE)</span>
              ) : (
                <span className="col-span-2 text-safe flex items-center gap-1"><Lock className="w-3 h-3" /> BLOCKED</span>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Main Page Component ---

export default function VirusDatabase() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: stats } = useGetVirusDatabaseStats({
    query: { refetchInterval: 10000, queryKey: getGetVirusDatabaseStatsQueryKey() }
  });

  const { data: entries } = useListVirusEntries();
  const { data: samples } = useListVirusSamples();
  const { data: feeds } = useListVirusFeeds();
  const { data: matches } = useListVirusMatches();
  const { data: audit } = useListVirusDatabaseAudit();

  const downloadMutation = useRequestVirusSampleDownload();

  const handleDownload = (id: number) => {
    downloadMutation.mutate(
      { id, data: { purpose: "Analysis via SOC Dashboard" } },
      {
        onSuccess: () => {
          // This theoretically shouldn't succeed if policy is strict, but handle if it does
          toast({ title: "Warning", description: "Download permitted by backend policy. Binary transfer starting...", variant: "destructive" });
        },
        onError: (err: any) => {
          toast({ 
            title: "Policy Denied", 
            description: "DATA_PLANE_RESTRICTION: Active binary download is blocked by current environment constraints. " + err.message, 
            variant: "destructive" 
          });
        }
      }
    );
  };

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetVirusDatabaseStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListVirusEntriesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListVirusSamplesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListVirusMatchesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListVirusDatabaseAuditQueryKey() });
  };

  return (
    <div className="flex flex-col h-full w-full max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-widest text-primary font-mono flex items-center gap-3">
            <BugOff className="w-6 h-6" />
            VIRUS_DB <span className="text-muted-foreground font-normal text-lg">/ INTEL & QUARANTINE</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-1">High-trust evidence catalog and exact-match intelligence</p>
        </div>
        
        <div className="flex items-center gap-3">
          <LookupIndicatorDialog />
          <Button variant="outline" size="icon" onClick={refreshAll} className="border-border bg-card">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* Stats Board */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-card border border-border p-4 rounded-md flex flex-col justify-between shadow-sm">
          <span className="text-[10px] text-muted-foreground font-mono uppercase">Catalog Entries</span>
          <span className="text-2xl font-mono text-foreground font-semibold">{stats?.catalogEntries ?? "---"}</span>
        </div>
        <div className="bg-card border border-border p-4 rounded-md flex flex-col justify-between shadow-sm">
          <span className="text-[10px] text-muted-foreground font-mono uppercase">Active Indicators</span>
          <span className="text-2xl font-mono text-primary font-semibold">{stats?.activeIndicators ?? "---"}</span>
        </div>
        <div className="bg-card border border-border p-4 rounded-md flex flex-col justify-between shadow-sm">
          <span className="text-[10px] text-muted-foreground font-mono uppercase">Quarantined Samples</span>
          <span className="text-2xl font-mono text-warn font-semibold">{stats?.quarantinedSamples ?? "---"}</span>
        </div>
        <div className="bg-card border border-border p-4 rounded-md flex flex-col justify-between shadow-sm">
          <span className="text-[10px] text-muted-foreground font-mono uppercase">Exact Matches</span>
          <span className="text-2xl font-mono text-critical font-semibold">{stats?.exactMatches ?? "---"}</span>
        </div>
        <div className="bg-card border border-border p-4 rounded-md flex flex-col justify-between shadow-sm">
          <span className="text-[10px] text-muted-foreground font-mono uppercase">Active Feeds</span>
          <span className="text-2xl font-mono text-foreground font-semibold">{stats?.activeFeeds ?? "---"}</span>
        </div>
        <div className="bg-card border border-border p-4 rounded-md flex flex-col justify-between shadow-sm">
          <span className="text-[10px] text-muted-foreground font-mono uppercase">Binary Storage</span>
          <span className="text-lg font-mono font-semibold flex items-center h-full">
            {stats?.binaryStorageReady ? (
              <span className="text-safe flex items-center gap-1"><ShieldCheck className="w-4 h-4"/> READY</span>
            ) : (
              <span className="text-warn flex items-center gap-1"><AlertTriangle className="w-4 h-4"/> DEGRADED</span>
            )}
          </span>
        </div>
        <div className={`p-4 rounded-md flex flex-col justify-between border shadow-sm ${stats?.executionAllowed ? 'bg-critical/10 border-critical' : 'bg-safe/5 border-safe/30'}`}>
          <span className="text-[10px] text-muted-foreground font-mono uppercase">Exec Policy</span>
          <span className="text-lg font-mono font-semibold flex items-center h-full">
            {stats?.executionAllowed ? (
              <span className="text-critical flex items-center gap-1"><AlertTriangle className="w-4 h-4"/> ALLOWED</span>
            ) : (
              <span className="text-safe flex items-center gap-1"><Lock className="w-4 h-4"/> BLOCKED</span>
            )}
          </span>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="catalog" className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-card border border-border w-full justify-start rounded-md h-auto p-1 font-mono gap-1">
          <TabsTrigger value="catalog" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded text-xs py-2 px-4">
            <Database className="w-4 h-4 mr-2" /> CATALOG
          </TabsTrigger>
          <TabsTrigger value="samples" className="data-[state=active]:bg-warn/20 data-[state=active]:text-warn rounded text-xs py-2 px-4">
            <FileBadge className="w-4 h-4 mr-2" /> QUARANTINE
          </TabsTrigger>
          <TabsTrigger value="matches" className="data-[state=active]:bg-critical/20 data-[state=active]:text-critical rounded text-xs py-2 px-4">
            <ShieldAlert className="w-4 h-4 mr-2" /> MATCHES
          </TabsTrigger>
          <TabsTrigger value="feeds" className="data-[state=active]:bg-secondary/50 data-[state=active]:text-foreground rounded text-xs py-2 px-4">
            <Activity className="w-4 h-4 mr-2" /> FEEDS
          </TabsTrigger>
          <TabsTrigger value="audit" className="data-[state=active]:bg-secondary/50 data-[state=active]:text-foreground rounded text-xs py-2 px-4">
            <Eye className="w-4 h-4 mr-2" /> AUDIT LOG
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 mt-4 relative border border-border bg-card rounded-md overflow-hidden flex flex-col shadow-lg shadow-black/20">
          <TabsContent value="catalog" className="m-0 flex-1 flex flex-col h-full overflow-hidden data-[state=active]:flex">
            <div className="border-b border-border p-3 flex justify-between items-center bg-background/50">
              <span className="font-mono text-sm text-muted-foreground">KNOWN_THREAT_SIGNATURES</span>
              <CreateEntryDialog onSuccess={refreshAll} />
            </div>
            <div className="flex-1 overflow-auto p-0 relative">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead className="bg-secondary/30 sticky top-0 backdrop-blur-md shadow-sm z-10">
                  <tr>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Identity</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Family</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Severity</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Indicators</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries?.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">NO_ENTRIES_FOUND</td>
                    </tr>
                  )}
                  {entries?.map(entry => (
                    <tr key={entry.id} className="hover:bg-secondary/20 transition-colors group">
                      <td className="p-3">
                        <div className="font-semibold text-foreground">{entry.canonicalName}</div>
                        {entry.status === 'ACTIVE' ? (
                          <Badge variant="outline" className="mt-1 text-[9px] px-1 py-0 h-4 border-safe/50 text-safe">ACTIVE</Badge>
                        ) : (
                          <Badge variant="outline" className="mt-1 text-[9px] px-1 py-0 h-4 border-muted-foreground text-muted-foreground">{entry.status}</Badge>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground">{entry.familyName || "-"}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-sm text-[10px] border ${
                          entry.severity === 'CRITICAL' ? 'bg-critical/10 text-critical border-critical/30' :
                          entry.severity === 'HIGH' ? 'bg-warn/10 text-warn border-warn/30' :
                          'bg-primary/10 text-primary border-primary/30'
                        }`}>
                          {entry.severity}
                        </span>
                        <div className="mt-1 text-[10px] text-muted-foreground">CFD: {(entry.confidence * 100).toFixed(0)}%</div>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1 flex-wrap max-w-xs">
                          {entry.indicators.map(ind => (
                            <div key={ind.id} className="text-[10px] bg-background border border-border px-1.5 py-0.5 rounded flex items-center gap-1" title={ind.normalizedValue}>
                              <span className="text-primary">{ind.indicatorType.substring(0,3)}:</span>
                              <span className="truncate max-w-[80px] text-muted-foreground">{ind.normalizedValue}</span>
                            </div>
                          ))}
                          {entry.indicators.length === 0 && <span className="text-muted-foreground">-</span>}
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground text-[10px] whitespace-nowrap">
                        {format(new Date(entry.updatedAt), "yyyy-MM-dd HH:mm:ss")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="samples" className="m-0 flex-1 flex flex-col h-full overflow-hidden data-[state=active]:flex">
            <div className="border-b border-border p-3 flex justify-between items-center bg-background/50">
              <span className="font-mono text-sm text-muted-foreground">ISOLATED_EVIDENCE_VAULT</span>
              <RegisterSampleDialog onSuccess={refreshAll} />
            </div>
            <div className="flex-1 overflow-auto p-0 relative">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead className="bg-secondary/30 sticky top-0 backdrop-blur-md shadow-sm z-10">
                  <tr>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Sample Hash (SHA-256)</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Metadata</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Status</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {samples?.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-muted-foreground">NO_QUARANTINED_SAMPLES</td>
                    </tr>
                  )}
                  {samples?.map(sample => (
                    <tr key={sample.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="p-3">
                        <div className="font-mono text-warn select-all break-all text-[11px] max-w-sm">{sample.sha256}</div>
                        <div className="text-[10px] text-muted-foreground mt-1">ID: {sample.id} | Entry: {sample.catalogEntryId || "UNLINKED"}</div>
                      </td>
                      <td className="p-3">
                        <div className="text-foreground">{sample.declaredName || "<unnamed>"}</div>
                        <div className="text-muted-foreground text-[10px] mt-0.5">{sample.sizeBytes} bytes | {sample.sourceType}</div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={`text-[9px] px-1.5 py-0 rounded-sm border ${
                          sample.status === 'QUARANTINED' ? 'border-warn text-warn bg-warn/10' :
                          sample.status === 'HASH_VERIFIED' ? 'border-safe text-safe bg-safe/10' :
                          'border-muted-foreground text-muted-foreground'
                        }`}>
                          {sample.status}
                        </Badge>
                        <div className="text-[9px] mt-1 text-muted-foreground flex items-center gap-1">
                          {sample.executionAllowed ? (
                            <span className="text-critical flex items-center"><AlertTriangle className="w-3 h-3 mr-0.5"/> EXECUTABLE</span>
                          ) : (
                            <span className="text-safe flex items-center"><Lock className="w-3 h-3 mr-0.5"/> NO_EXEC</span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-7 text-[10px] font-mono border-warn/30 text-warn hover:bg-warn hover:text-warn-foreground"
                          onClick={() => handleDownload(sample.id)}
                          disabled={downloadMutation.isPending && downloadMutation.variables?.id === sample.id}
                        >
                          {downloadMutation.isPending && downloadMutation.variables?.id === sample.id ? (
                            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3 mr-1" />
                          )}
                          FETCH_BIN
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="matches" className="m-0 flex-1 flex flex-col h-full overflow-hidden data-[state=active]:flex">
            <div className="border-b border-border p-3 flex justify-between items-center bg-background/50">
              <span className="font-mono text-sm text-critical">CONFIRMED_ENVIRONMENT_HITS</span>
            </div>
            <div className="flex-1 overflow-auto p-0 relative">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead className="bg-secondary/30 sticky top-0 backdrop-blur-md shadow-sm z-10">
                  <tr>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Timestamp</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Match Type</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Indicator Value</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Node/Host</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Severity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {matches?.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">NO_MATCHES_RECORDED</td>
                    </tr>
                  )}
                  {matches?.map(match => (
                    <tr key={match.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="p-3 text-muted-foreground">{format(new Date(match.createdAt), "MM-dd HH:mm:ss")}</td>
                      <td className="p-3">
                        <span className="bg-secondary/50 text-secondary-foreground px-2 py-0.5 rounded text-[10px]">
                          {match.matchType}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-critical break-all text-[11px] max-w-xs">{match.matchedValue}</td>
                      <td className="p-3 text-muted-foreground">
                        <div>{match.nodeId || match.hostId || "UNKNOWN_HOST"}</div>
                        {match.evidenceReference && <div className="text-[10px] mt-0.5 truncate max-w-[150px]" title={match.evidenceReference}>{match.evidenceReference}</div>}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-sm text-[10px] border ${
                          match.severity === 'CRITICAL' ? 'bg-critical/20 text-critical border-critical' :
                          match.severity === 'HIGH' ? 'bg-warn/20 text-warn border-warn' :
                          'bg-primary/20 text-primary border-primary'
                        }`}>
                          {match.severity}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="feeds" className="m-0 flex-1 flex flex-col h-full overflow-hidden data-[state=active]:flex">
             <div className="border-b border-border p-3 flex justify-between items-center bg-background/50">
              <span className="font-mono text-sm text-muted-foreground">EXTERNAL_INTEL_SOURCES</span>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {feeds?.length === 0 && (
                  <div className="col-span-full p-8 text-center text-muted-foreground font-mono text-sm border border-dashed border-border rounded">
                    NO_ACTIVE_FEEDS
                  </div>
                )}
                {feeds?.map(feed => (
                  <div key={feed.id} className="border border-border bg-background p-4 rounded-md font-mono flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold text-primary flex items-center gap-2">
                          <Activity className="w-4 h-4" /> {feed.name}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">ID: {feed.id} | KIND: {feed.adapterKind}</div>
                      </div>
                      <Badge variant="outline" className={`text-[10px] rounded-sm border ${
                          feed.status === 'ACTIVE' ? 'border-safe text-safe bg-safe/10' :
                          feed.status === 'PAUSED' ? 'border-warn text-warn bg-warn/10' :
                          'border-muted-foreground text-muted-foreground'
                        }`}>
                          {feed.status}
                      </Badge>
                    </div>
                    {feed.description && <div className="text-xs text-muted-foreground border-l-2 border-border pl-2">{feed.description}</div>}
                    <div className="text-[10px] text-muted-foreground mt-auto pt-2 border-t border-border">
                      Last Updated: {format(new Date(feed.updatedAt), "yyyy-MM-dd HH:mm")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="audit" className="m-0 flex-1 flex flex-col h-full overflow-hidden data-[state=active]:flex">
            <div className="border-b border-border p-3 flex justify-between items-center bg-background/50">
              <span className="font-mono text-sm text-muted-foreground">IMMUTABLE_ACTION_LOG</span>
            </div>
            <div className="flex-1 overflow-auto p-0 relative">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead className="bg-secondary/30 sticky top-0 backdrop-blur-md shadow-sm z-10">
                  <tr>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Time</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Principal</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Action</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Entity</th>
                    <th className="p-3 border-b border-border font-medium text-muted-foreground uppercase">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {audit?.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">NO_AUDIT_LOGS</td>
                    </tr>
                  )}
                  {audit?.map(log => (
                    <tr key={log.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{format(new Date(log.createdAt), "MM-dd HH:mm:ss")}</td>
                      <td className="p-3 text-primary">{log.principalRef}</td>
                      <td className="p-3 font-semibold">{log.action}</td>
                      <td className="p-3 text-muted-foreground">
                        {log.entityType} {log.entityId ? `[${log.entityId}]` : ""}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className={`text-[9px] px-1 py-0 h-4 border ${
                          log.outcome === 'ALLOWED' || log.outcome === 'COMPLETED' ? 'border-safe/50 text-safe' :
                          log.outcome === 'DENIED' || log.outcome === 'FAILED' ? 'border-critical/50 text-critical' :
                          'border-muted-foreground text-muted-foreground'
                        }`}>
                          {log.outcome}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
