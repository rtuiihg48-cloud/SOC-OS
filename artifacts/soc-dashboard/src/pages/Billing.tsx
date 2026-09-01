import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, CreditCard, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type BillingPlan = { price: number; currency: string; interval: "month" | "year"; savings?: number };
type BillingStatus = { plans: BillingPlan[]; freeLimit: number; freeUsed: number; freeRemaining: number; paidAccess: boolean; manageUrl: string | null };

async function jsonFetch(path: string, init?: RequestInit) {
  const response = await fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Billing request failed");
  return body;
}

export default function Billing() {
  const [location] = useLocation();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"month" | "year" | "verify" | null>(null);
  const load = async () => {
    try { setStatus(await jsonFetch("/billing/status")); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load billing status"); }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const checkoutCorrelation = new URLSearchParams(window.location.search).get("checkout_correlation");
    if (!checkoutCorrelation) return;
    setBusy("verify");
    void jsonFetch("/billing/verify", { method: "POST", body: JSON.stringify({ checkoutCorrelation }) })
      .then((result) => setMessage(result.paidAccess ? "Payment verified securely with Whop." : "Payment is not confirmed yet. Please refresh shortly."))
      .catch((error) => setMessage(error instanceof Error ? error.message : "Payment verification failed"))
      .finally(() => { setBusy(null); void load(); });
  }, [location]);

  const subscribe = async (interval: "month" | "year") => {
    setBusy(interval); setMessage("");
    try {
      const checkout = await jsonFetch("/billing/checkout", { method: "POST", body: JSON.stringify({ interval }) }) as { purchase_url: string };
      window.location.assign(checkout.purchase_url);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Checkout could not be started"); setBusy(null); }
  };

  return <div className="mx-auto max-w-4xl space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="font-mono text-xs tracking-[.2em] text-primary">ACCESS CONTROL / BILLING</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Security Test Access</h1></div>
      <Badge className={status?.paidAccess ? "bg-safe text-safe-foreground" : "bg-secondary text-muted-foreground"}>{status?.paidAccess ? "PAID ACCESS ACTIVE" : "FREE QUOTA"}</Badge>
    </div>
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="border-border bg-card/60 md:order-3"><CardHeader><CardTitle className="font-mono">FREE SECURITY TESTS</CardTitle><CardDescription>Per authenticated user and operator-managed tenant</CardDescription></CardHeader>
        <CardContent><div className="mb-3 flex items-end justify-between"><span className="font-mono text-4xl text-primary">{status?.freeRemaining ?? "—"}</span><span className="pb-1 font-mono text-xs text-muted-foreground">REMAINING / {status?.freeLimit ?? 3}</span></div>
          <div className="h-2 overflow-hidden rounded bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${status ? (status.freeUsed / status.freeLimit) * 100 : 0}%` }} /></div><p className="mt-3 text-xs text-muted-foreground">{status ? `${status.freeUsed} accepted free test${status.freeUsed === 1 ? "" : "s"} used.` : "Loading quota…"}</p>
        </CardContent></Card>
      {(["month", "year"] as const).map((interval) => {
        const plan = status?.plans.find((candidate) => candidate.interval === interval);
        const annual = interval === "year";
        return <Card key={interval} className={annual ? "border-primary bg-primary/5" : "border-primary/30 bg-card/60"}>
          <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 font-mono text-primary"><CreditCard className="h-5 w-5" /> {annual ? "ANNUAL" : "MONTHLY"}</CardTitle>{annual && <Badge className="bg-safe text-safe-foreground">SAVE $58</Badge>}</div><CardDescription>{plan ? `$${plan.price}/${annual ? "year" : "month"}` : annual ? "$290/year" : "$29/month"} • Whop checkout</CardDescription></CardHeader>
          <CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{annual ? "Best value: two months free compared with monthly billing." : "Flexible month-to-month access after the free quota."}</p>
            {status?.paidAccess ? <Button asChild className="w-full font-mono"><a href={status.manageUrl ?? "https://whop.com"} target="_blank" rel="noreferrer">MANAGE SUBSCRIPTION <ExternalLink className="ml-2 h-4 w-4" /></a></Button> : <Button onClick={() => void subscribe(interval)} disabled={busy !== null} className="w-full font-mono">{busy === interval ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />} {annual ? "SUBSCRIBE — $290/YEAR" : "SUBSCRIBE — $29/MONTH"}</Button>}
          </CardContent>
        </Card>;
      })}
    </div>
    {message && <div className="flex items-center gap-2 border border-primary/30 bg-primary/5 p-3 text-sm"><CheckCircle2 className="h-4 w-4 text-primary" />{message}</div>}
  </div>;
}