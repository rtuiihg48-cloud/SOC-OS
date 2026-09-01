import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";

import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { Layout } from "@/components/Layout";
import { useGetCurrentPrincipal, getGetCurrentPrincipalQueryKey } from "@workspace/api-client-react";
import { ShieldAlert } from "lucide-react";

import Home from "@/pages/Home";
import Dashboard from "@/pages/Dashboard";
import Events from "@/pages/Events";
import Simulation from "@/pages/Simulation";
import Patches from "@/pages/Patches";
import ThreatGraph from "@/pages/ThreatGraph";
import Alerts from "@/pages/Alerts";
import RulesEngine from "@/pages/RulesEngine";
import Correlations from "@/pages/Correlations";
import Tenants from "@/pages/Tenants";
import Runtime from "@/pages/Runtime";
import NodeExchange from "@/pages/NodeExchange";
import Quarantine from "@/pages/Quarantine";
import SelfHealing from "@/pages/SelfHealing";
import VirusDatabase from "@/pages/VirusDatabase";
import TrafficAnalysis from "@/pages/TrafficAnalysis";
import AuditTrail from "@/pages/AuditTrail";
import Billing from "@/pages/Billing";
import NotFound from "@/pages/not-found";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(190, 90%, 50%)",
    colorForeground: "hsl(210, 40%, 98%)",
    colorMutedForeground: "hsl(215, 20.2%, 65.1%)",
    colorDanger: "hsl(0, 84%, 60%)",
    colorBackground: "hsl(222, 47%, 6%)",
    colorInput: "hsl(217, 32%, 17%)",
    colorInputForeground: "hsl(210, 40%, 98%)",
    colorNeutral: "hsl(217, 32%, 17%)",
    fontFamily: "'Rajdhani', sans-serif",
    borderRadius: "0.25rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card border border-border rounded-lg w-[440px] max-w-full overflow-hidden shadow-xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-semibold font-sans tracking-wide text-2xl",
    headerSubtitle: "text-muted-foreground font-sans",
    socialButtonsBlockButtonText: "text-foreground font-sans font-medium",
    formFieldLabel: "text-foreground font-sans",
    footerActionLink: "text-primary hover:text-primary/80 font-sans",
    footerActionText: "text-muted-foreground font-sans",
    dividerText: "text-muted-foreground font-sans",
    identityPreviewEditButton: "text-primary hover:text-primary/80",
    formFieldSuccessText: "text-safe",
    alertText: "text-destructive",
    logoBox: "mb-2",
    logoImage: "h-8 object-contain object-left filter brightness-0 invert sepia hue-rotate-180 saturate-200 hue-rotate-[145deg]",
    socialButtonsBlockButton: "border-border bg-transparent hover:bg-secondary/50",
    formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90 font-mono tracking-widest uppercase rounded-sm h-10",
    formFieldInput: "bg-input border-border text-foreground rounded-sm font-mono h-10 focus:border-primary focus:ring-1 focus:ring-primary/50",
    footerAction: "bg-secondary/20 p-4 border-t border-border",
    dividerLine: "bg-border",
    alert: "bg-destructive/10 border border-destructive/20 rounded-sm text-destructive",
    otpCodeFieldInput: "bg-input border-border text-foreground font-mono",
    formFieldRow: "mb-4",
    main: "p-8",
  },
};

const queryClient = new QueryClient();

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function RequireMembership({ children }: { children: React.ReactNode }) {
  const { data: principal, isLoading, error } = useGetCurrentPrincipal({
    query: {
      queryKey: getGetCurrentPrincipalQueryKey(),
      retry: false
    }
  });
  const { signOut } = useClerk();

  if (isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <div className="flex flex-col items-center gap-4 text-primary animate-pulse">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <span className="font-mono tracking-widest text-sm">AUTHENTICATING...</span>
        </div>
      </div>
    );
  }

  if (error && !principal) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-destructive">
          <ShieldAlert className="w-12 h-12" />
          <span className="font-mono tracking-widest text-sm">AUTHENTICATION ERROR</span>
          <button onClick={() => signOut({ redirectUrl: basePath || "/" })} className="text-xs border border-border px-4 py-2 mt-2 hover:bg-secondary">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (principal && (!principal.tenantIds || principal.tenantIds.length === 0)) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center flex-col bg-background relative px-4">
        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <ShieldAlert className="w-16 h-16 text-warn mb-6 z-10" />
        <h1 className="text-2xl font-mono uppercase tracking-widest mb-2 z-10 text-foreground">Access Pending</h1>
        <p className="text-muted-foreground font-sans max-w-md text-center z-10 mb-8">
          Your principal identity has been cryptographically verified, but no tenant boundary assignment was found. Awaiting platform administrator provisioning.
        </p>
        <button
          onClick={() => signOut({ redirectUrl: basePath || "/" })}
          className="z-10 text-sm font-mono bg-secondary hover:bg-secondary/80 px-8 py-3 rounded-sm text-foreground transition-colors tracking-widest uppercase border border-border"
        >
          Terminate Session
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">
        <RequireMembership>
          <Layout>{children}</Layout>
        </RequireMembership>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <WouterRouter base={basePath}>
            <ClerkProvider
              publishableKey={clerkPubKey || ""}
              proxyUrl={clerkProxyUrl}
              appearance={clerkAppearance}
              signInUrl={`${basePath}/sign-in`}
              signUpUrl={`${basePath}/sign-up`}
            >
              <ClerkQueryClientCacheInvalidator />
              <Switch>
                <Route path="/" component={HomeRedirect} />
                <Route path="/sign-in/*?" component={SignInPage} />
                <Route path="/sign-up/*?" component={SignUpPage} />

                <Route path="/:rest*">
                  <ProtectedLayout>
                    <Switch>
                      <Route path="/dashboard" component={Dashboard} />
                      <Route path="/events" component={Events} />
                      <Route path="/simulate" component={Simulation} />
                      <Route path="/patches" component={Patches} />
                      <Route path="/threat-graph" component={ThreatGraph} />
                      <Route path="/alerts" component={Alerts} />
                      <Route path="/rules" component={RulesEngine} />
                      <Route path="/correlations" component={Correlations} />
                      <Route path="/tenants" component={Tenants} />
                      <Route path="/runtime" component={Runtime} />
                      <Route path="/node-exchange" component={NodeExchange} />
                      <Route path="/quarantine" component={Quarantine} />
                      <Route path="/self-healing" component={SelfHealing} />
                      <Route path="/virus-database" component={VirusDatabase} />
                      <Route path="/traffic-analysis" component={TrafficAnalysis} />
                      <Route path="/audit-trail" component={AuditTrail} />
                       <Route path="/billing" component={Billing} />
                      <Route component={NotFound} />
                    </Switch>
                  </ProtectedLayout>
                </Route>
              </Switch>
            </ClerkProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
