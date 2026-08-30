import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, ShieldAlert, GitCommit, Shield, LayoutDashboard, Cpu, Database, Bell, Zap, Link2, Building2, TerminalSquare, Box, BugOff, PanelLeftClose, PanelLeftOpen, Radio, Network } from "lucide-react";
import { useGetDashboard, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { VoiceCommandPanel } from "@/components/VoiceCommandPanel";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches
  );
  const { data: dashboard } = useGetDashboard({
    query: { refetchInterval: 5000, queryKey: getGetDashboardQueryKey() }
  });

  useEffect(() => {
    const compactQuery = window.matchMedia("(max-width: 1024px)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsSidebarCollapsed(event.matches);
    };

    compactQuery.addEventListener("change", handleViewportChange);
    return () => compactQuery.removeEventListener("change", handleViewportChange);
  }, []);

  const navSections = [
    {
      label: "Operations",
      items: [
        { href: "/", label: "Dashboard", icon: LayoutDashboard },
        { href: "/alerts", label: "Alerts", icon: Bell },
        { href: "/events", label: "Event Log", icon: Database },
        { href: "/simulate", label: "Simulation", icon: Cpu },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { href: "/threat-graph", label: "Threat Graph", icon: ShieldAlert },
        { href: "/virus-database", label: "Virus DB", icon: BugOff },
        { href: "/rules", label: "Rules Engine", icon: Zap },
        { href: "/correlations", label: "Correlations", icon: Link2 },
      ],
    },
    {
      label: "Response",
      items: [
        { href: "/quarantine", label: "Quarantine", icon: Box },
        { href: "/self-healing", label: "Self-Healing", icon: Shield },
        { href: "/patches", label: "Patches", icon: GitCommit },
      ],
    },
    {
      label: "Platform",
      items: [
        { href: "/runtime", label: "Runtime", icon: TerminalSquare },
        { href: "/traffic-analysis", label: "Traffic Analysis", icon: Network },
        { href: "/tenants", label: "Tenants", icon: Building2 },
      ],
    },
  ];
  const navItems = navSections.flatMap((section) => section.items);

  const statusColor = 
    dashboard?.systemStatus === 'SECURE' ? 'text-safe bg-safe/10 border-safe/20' :
    dashboard?.systemStatus === 'MONITORING' ? 'text-primary bg-primary/10 border-primary/20' :
    dashboard?.systemStatus === 'ALERT' ? 'text-warn bg-warn/10 border-warn/20' :
    dashboard?.systemStatus === 'CRITICAL' ? 'text-critical bg-critical/10 border-critical/20' :
    'text-muted-foreground bg-muted border-border';

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground font-sans selection:bg-primary/30">
      
      {/* Sidebar */}
      <aside
        className={`flex-shrink-0 border-r border-border bg-card flex flex-col z-10 transition-[width] duration-300 ease-out ${
          isSidebarCollapsed ? "w-[4.75rem]" : "w-64"
        }`}
      >
        <div className={`h-16 flex items-center border-b border-border ${isSidebarCollapsed ? "justify-between px-2" : "justify-between px-5"}`}>
          <Link href="/" className={`flex items-center min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${isSidebarCollapsed ? "justify-center" : ""}`} title="SOC_OS home">
            <Shield className="w-6 h-6 flex-shrink-0 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
            {!isSidebarCollapsed && (
              <span className="ml-3 font-bold text-lg tracking-wider text-primary font-mono">SOC_OS</span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            aria-label={isSidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            title={isSidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
        
        <div className={`border-b border-border ${isSidebarCollapsed ? "p-3" : "p-4"}`}>
          {!isSidebarCollapsed && (
            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-mono">
              <span>System Status</span>
              <span className="flex items-center gap-1 text-safe"><Radio className="h-3 w-3" /> live</span>
            </div>
          )}
          <div className={`rounded-md border flex items-center font-mono text-sm ${isSidebarCollapsed ? "justify-center px-2 py-2" : "gap-2 px-3 py-2"} ${statusColor}`} title={dashboard?.systemStatus || "INITIALIZING..."}>
            <Activity className="w-4 h-4 flex-shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">{dashboard?.systemStatus || "INITIALIZING..."}</span>}
          </div>
        </div>

        <nav className={`flex-1 overflow-y-auto ${isSidebarCollapsed ? "px-2 py-4" : "px-3 py-5"}`} aria-label="Primary navigation">
          <div className={isSidebarCollapsed ? "space-y-3" : "space-y-5"}>
            {navSections.map((section) => (
              <div key={section.label}>
                {!isSidebarCollapsed && (
                  <div className="mb-2 px-3 text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground/70">
                    {section.label}
                  </div>
                )}
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = location === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={`group relative flex items-center rounded-md border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${
                          isSidebarCollapsed ? "justify-center px-3 py-2.5" : "gap-3 px-3 py-2"
                        } ${
                          isActive
                            ? "border-primary/30 bg-primary/10 text-primary shadow-[inset_3px_0_0_hsl(var(--primary)),0_0_16px_hsl(var(--primary)/0.08)]"
                            : "border-transparent text-muted-foreground hover:border-border hover:bg-secondary/70 hover:text-foreground"
                        }`}
                        title={isSidebarCollapsed ? item.label : undefined}
                      >
                        <item.icon className={`h-4 w-4 flex-shrink-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} />
                        {!isSidebarCollapsed && <span className="truncate font-medium tracking-wide">{item.label}</span>}
                        {item.href === '/alerts' && dashboard && dashboard.openAlerts > 0 && (
                          <span className={`${isSidebarCollapsed ? "absolute -right-1 -top-1 min-w-4 px-1 text-[9px]" : "ml-auto px-2 text-xs"} rounded-full bg-critical py-0.5 text-center font-mono text-critical-foreground shadow-[0_0_10px_hsl(var(--critical)/0.35)]`}>
                            {dashboard.openAlerts}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>
        
        <div className={`border-t border-border font-mono text-xs text-muted-foreground ${isSidebarCollapsed ? "p-3 text-center" : "p-4"}`}>
          {isSidebarCollapsed ? (
            <span className="text-[9px] leading-4 text-muted-foreground/70">V50</span>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span>v0.3.0-beta</span>
              <span className="text-primary/70">V50 PIPELINE</span>
            </div>
          )}
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
