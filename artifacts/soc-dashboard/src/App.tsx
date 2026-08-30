import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { Layout } from "@/components/Layout";
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
import Quarantine from "@/pages/Quarantine";
import SelfHealing from "@/pages/SelfHealing";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/events" component={Events} />
        <Route path="/simulate" component={Simulation} />
        <Route path="/patches" component={Patches} />
        <Route path="/threat-graph" component={ThreatGraph} />
        <Route path="/alerts" component={Alerts} />
        <Route path="/rules" component={RulesEngine} />
        <Route path="/correlations" component={Correlations} />
        <Route path="/tenants" component={Tenants} />
        <Route path="/runtime" component={Runtime} />
        <Route path="/quarantine" component={Quarantine} />
        <Route path="/self-healing" component={SelfHealing} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
