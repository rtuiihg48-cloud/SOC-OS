import { useState } from "react";
import { useListEvents, useProcessEvent, getListEventsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion } from "framer-motion";
import { Link2, ShieldAlert, Cpu, HardDrive, PlusSquare, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  event: z.string().min(1, "Event description is required"),
  cpuUsage: z.coerce.number().optional(),
  memUsage: z.coerce.number().optional(),
});

export default function Events() {
  const { data: events, isLoading } = useListEvents();
  const processEvent = useProcessEvent();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      event: "",
      cpuUsage: undefined,
      memUsage: undefined,
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);
    processEvent.mutate(
      { data: values },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEventsQueryKey() });
          toast({
            title: "EVENT INGESTED",
            description: "Event has been successfully processed by the detection engine.",
          });
          form.reset();
        },
        onError: () => {
          toast({
            title: "INGESTION FAILED",
            description: "Failed to process the security event.",
            variant: "destructive",
          });
        },
        onSettled: () => {
          setIsSubmitting(false);
        }
      }
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-card/50 backdrop-blur border-primary/20">
        <CardHeader>
          <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
            <PlusSquare className="w-4 h-4 text-primary" />
            Manual Event Ingestion
          </CardTitle>
          <CardDescription className="font-mono text-xs">Submit payload to the detection engine for analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="event"
                  render={({ field }) => (
                    <FormItem className="col-span-1 md:col-span-3">
                      <FormLabel className="font-mono text-xs text-muted-foreground uppercase tracking-widest">Payload Description</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Unauthorized access attempt on port 22" className="font-mono bg-background/50 border-border" {...field} />
                      </FormControl>
                      <FormMessage className="font-mono text-xs" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cpuUsage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-1"><Cpu className="w-3 h-3"/> CPU Usage (%)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Optional" className="font-mono bg-background/50 border-border" {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage className="font-mono text-xs" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="memUsage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-1"><HardDrive className="w-3 h-3"/> Mem Usage (MB)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Optional" className="font-mono bg-background/50 border-border" {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage className="font-mono text-xs" />
                    </FormItem>
                  )}
                />
              </div>
              <Button type="submit" disabled={isSubmitting} className="w-full font-mono uppercase tracking-widest bg-primary hover:bg-primary/90 text-primary-foreground">
                {isSubmitting ? "[ PROCESSING... ]" : "SUBMIT PAYLOAD"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur border-border">
        <CardHeader>
          <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-primary" />
            Event Memory Chain
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center font-mono text-muted-foreground animate-pulse">
              [ LOADING MEMORY CHAIN... ]
            </div>
          ) : !events || events.length === 0 ? (
            <div className="py-8 text-center font-mono text-muted-foreground border border-dashed border-border rounded-lg">
              NO EVENTS IN MEMORY
            </div>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader className="bg-secondary/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[120px]">Timestamp</TableHead>
                    <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest">Chain Hash</TableHead>
                    <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest">Event</TableHead>
                    <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[100px] text-right">Score</TableHead>
                    <TableHead className="font-mono text-xs text-muted-foreground uppercase tracking-widest w-[120px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((ev, i) => (
                    <motion.tr 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      key={ev.id}
                      className="border-b border-border hover:bg-secondary/20 font-mono text-sm"
                    >
                      <TableCell className="text-muted-foreground">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 text-[10px]">
                          <div className="flex items-center gap-1 text-muted-foreground/60" title="Previous Hash">
                            <span className="truncate w-24 inline-block">{ev.prevHash}</span>
                            <ArrowRight className="w-3 h-3" />
                          </div>
                          <div className="flex items-center gap-1 text-primary" title="Current Hash">
                            <Link2 className="w-3 h-3" />
                            <span className="truncate w-32 inline-block">{ev.hash}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="truncate max-w-[200px]">{ev.event}</TableCell>
                      <TableCell className="text-right">
                        <span className={`px-2 py-1 rounded-sm bg-secondary ${
                          ev.score > 75 ? 'text-critical border border-critical/30' : 
                          ev.score > 50 ? 'text-warn border border-warn/30' : 'text-safe border border-safe/30'
                        }`}>
                          {ev.score}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-bold tracking-wider" style={{
                          color: ev.action === 'ALLOW' ? 'hsl(var(--safe))' : 
                                ev.action === 'WARN' ? 'hsl(var(--warn))' : 
                                ev.action === 'ISOLATE' ? 'hsl(var(--critical))' : 'hsl(var(--primary))'
                        }}>
                          {ev.action}
                        </span>
                      </TableCell>
                    </motion.tr>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
