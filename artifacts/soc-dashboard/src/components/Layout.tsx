import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Activity, ShieldAlert, GitCommit, Shield, LayoutDashboard, Cpu, Database, Bell, Zap, Link2, Building2, TerminalSquare, Box } from "lucide-react";
import { useGetDashboard, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { VoiceCommandPanel } from "@/components/VoiceCommandPanel";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { data: dashboard } = useGetDashboard({
    query: { refetchInterval: 5000, queryKey: getGetDashboardQueryKey() }
  });

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/alerts", label: "Alerts", icon: Bell },
    { href: "/events", label: "Event Log", icon: Database },
    { href: "/simulate", label: "Simulation", icon: Cpu },
    { href: "/patches", label: "Patches", icon: GitCommit },
    { href: "/threat-graph", label: "Threat Graph", icon: ShieldAlert },
    { href: "/rules", label: "Rules Engine", icon: Zap },
    { href: "/correlations", label: "Correlations", icon: Link2 },
    { href: "/tenants", label: "Tenants", icon: Building2 },
    { href: "/runtime", label: "Runtime", icon: TerminalSquare },
    { href: "/quarantine", label: "Quarantine", icon: Box },
    { href: "/self-healing", label: "Self-Healing", icon: Shield },
  ];

  const statusColor = 
    dashboard?.systemStatus === 'SECURE' ? 'text-safe bg-safe/10 border-safe/20' :
    dashboard?.systemStatus === 'MONITORING' ? 'text-primary bg-primary/10 border-primary/20' :
    dashboard?.systemStatus === 'ALERT' ? 'text-warn bg-warn/10 border-warn/20' :
    dashboard?.systemStatus === 'CRITICAL' ? 'text-critical bg-critical/10 border-critical/20' :
    'text-muted-foreground bg-muted border-border';

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground font-sans selection:bg-primary/30">
      
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border bg-card flex flex-col z-10">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Shield className="w-6 h-6 text-primary mr-3" />
          <span className="font-bold text-lg tracking-wider text-primary font-mono">SOC_OS</span>
        </div>
        
        <div className="p-4 border-b border-border">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2 font-mono">System Status</div>
          <div className={`px-3 py-2 rounded-md border flex items-center gap-2 font-mono text-sm ${statusColor}`}>
            <Activity className="w-4 h-4" />
            {dashboard?.systemStatus || "INITIALIZING..."}
          </div>
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 group ${
                  isActive 
                    ? "bg-primary/10 text-primary border border-primary/20" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground border border-transparent"
                }`}
              >
                <item.icon className={`w-4 h-4 ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
                <span className="font-medium tracking-wide">{item.label}</span>
                {item.href === '/alerts' && dashboard && dashboard.openAlerts > 0 && (
                  <span className="ml-auto bg-critical text-critical-foreground text-xs px-2 py-0.5 rounded-full font-mono">
                    {dashboard.openAlerts}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        
        <div className="p-4 border-t border-border text-xs font-mono text-muted-foreground">
          v0.3.0-beta / V50 PIPELINE
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Subtle grid background */}
        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        
        <header className="h-16 flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm flex items-center px-8 z-30 justify-between">
          <h1 className="text-xl font-semibold tracking-wide capitalize">
            {navItems.find(n => n.href === location)?.label || "Dashboard"}
          </h1>
          <div className="flex items-center gap-4 text-sm font-mono">
            <span className="text-muted-foreground">THREAT_LEVEL:</span>
            <span className={`font-bold ${dashboard?.threatLevel && dashboard.threatLevel > 75 ? 'text-critical' : dashboard?.threatLevel && dashboard.threatLevel > 50 ? 'text-warn' : 'text-safe'}`}>
              {dashboard?.threatLevel ?? 0}%
            </span>
            <VoiceCommandPanel />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 z-10 relative">
          {children}
        </div>
      </main>
    </div>
  );
}
