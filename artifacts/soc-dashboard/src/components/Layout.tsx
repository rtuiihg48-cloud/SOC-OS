import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, ShieldAlert, GitCommit, Shield, LayoutDashboard, Cpu, Database, Bell, Zap, Link2, Building2, TerminalSquare, Box, BugOff, PanelLeftClose, PanelLeftOpen, Radio, Network, LogOut, CreditCard, Search, ClipboardCheck, Siren, Workflow } from "lucide-react";
import { useGetCurrentPrincipal, getGetCurrentPrincipalQueryKey, useGetDashboard, getGetDashboardQueryKey } from "@workspace/api-client-react";
import { VoiceCommandPanel } from "@/components/VoiceCommandPanel";
import { useClerk } from "@clerk/react";
import { getStoredLanguage, languageOptions, menuCopy, type Language } from "@/lib/i18n";

const navStructure = [
  {
    key: "operations",
    items: [
      { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
      { href: "/incidents", key: "incidents", icon: Siren },
      { href: "/alerts", key: "alerts", icon: Bell },
      { href: "/events", key: "events", icon: Database },
      { href: "/simulate", key: "simulation", icon: Cpu },
    ],
  },
  {
    key: "intelligence",
    items: [
      { href: "/threat-graph", key: "threatGraph", icon: ShieldAlert },
      { href: "/virus-database", key: "virusDb", icon: BugOff },
      { href: "/rules", key: "rules", icon: Zap },
      { href: "/correlations", key: "correlations", icon: Link2 },
    ],
  },
  {
    key: "response",
    items: [
      { href: "/quarantine", key: "quarantine", icon: Box },
      { href: "/self-healing", key: "selfHealing", icon: Shield },
      { href: "/patches", key: "patches", icon: GitCommit },
      { href: "/playbooks", key: "playbooks", icon: Workflow },
    ],
  },
  {
    key: "platform",
    items: [
      { href: "/runtime", key: "runtime", icon: TerminalSquare },
      { href: "/approvals", key: "readinessReview", icon: ClipboardCheck },
      { href: "/node-exchange", key: "nodeExchange", icon: Radio },
      { href: "/traffic-analysis", key: "trafficAnalysis", icon: Network },
      { href: "/audit-trail", key: "auditTrail", icon: Activity },
      { href: "/tenants", key: "tenants", icon: Building2 },
      { href: "/billing", key: "billing", icon: CreditCard },
    ],
  },
] as const;

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches
  );
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [language, setLanguage] = useState<Language>(getStoredLanguage);
  const { data: dashboard } = useGetDashboard({
    query: { refetchInterval: 5000, queryKey: getGetDashboardQueryKey() }
  });
  const { data: principal } = useGetCurrentPrincipal({
    query: { queryKey: getGetCurrentPrincipalQueryKey() }
  });
  const { signOut } = useClerk();

  const canReadAudit = principal?.capabilities?.includes("audit:read");

  useEffect(() => {
    window.localStorage.setItem("soc-os-language", language);
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const compactQuery = window.matchMedia("(max-width: 1024px)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsSidebarCollapsed(event.matches);
    };

    compactQuery.addEventListener("change", handleViewportChange);
    return () => compactQuery.removeEventListener("change", handleViewportChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandOpen(true);
      }
      if (event.key === "Escape") setIsCommandOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const copy = menuCopy[language];
  const navSections = navStructure.map((section) => ({
    label: copy.sections[section.key],
    items: section.items
      .filter((item) => item.key !== "auditTrail" || canReadAudit)
      .map((item) => ({ ...item, label: copy.items[item.key] })),
  }));
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
          <Link href="/dashboard" className={`flex items-center min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${isSidebarCollapsed ? "justify-center" : ""}`} title="SOC_OS home">
            <Shield className="w-6 h-6 flex-shrink-0 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
            {!isSidebarCollapsed && (
              <span className="ml-3 font-bold text-lg tracking-wider text-primary font-mono">SOC_OS</span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            aria-label={isSidebarCollapsed ? copy.ui.expandNavigation : copy.ui.collapseNavigation}
            title={isSidebarCollapsed ? copy.ui.expandNavigation : copy.ui.collapseNavigation}
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

        <div className={`border-t border-border font-mono text-xs text-muted-foreground ${isSidebarCollapsed ? "p-3 flex flex-col items-center gap-2" : "p-4 flex flex-col gap-3"}`}>
          {isSidebarCollapsed ? (
            <>
              <span className="text-[9px] leading-4 text-muted-foreground/70">V50</span>
              <button onClick={() => signOut()} className="w-full flex justify-center text-muted-foreground hover:text-primary transition-colors py-2"><LogOut className="w-4 h-4" /></button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span>v0.3.0-beta</span>
                <span className="text-primary/70">V50 PIPELINE</span>
              </div>
              <button onClick={() => signOut()} className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-xs w-full py-1">
                <LogOut className="w-3.5 h-3.5" /> Sign Out
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Subtle grid background */}
        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>

        <header className="h-16 flex-shrink-0 border-b border-border bg-background/80 backdrop-blur-sm flex items-center px-8 z-30 justify-between">
          <h1 className="text-xl font-semibold tracking-wide capitalize">
            {navItems.find(n => n.href === location)?.label || copy.items.dashboard}
          </h1>
          <div className="flex items-center gap-3 text-sm font-mono">
            <label className="flex max-w-[7rem] items-center gap-1 rounded border border-border px-1.5 py-1.5 text-[10px] text-muted-foreground sm:max-w-[8.5rem] sm:gap-2 sm:px-2" title={copy.ui.language}>
              <span className="sr-only">{copy.ui.language}</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as Language)}
                aria-label={copy.ui.language}
                className="max-w-[8.5rem] cursor-pointer bg-transparent font-mono text-[10px] uppercase outline-none"
              >
                {languageOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-card text-foreground">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setIsCommandOpen(true)}
              className="hidden items-center gap-2 rounded border border-border px-2 py-1.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary md:flex"
              aria-label={copy.ui.search}
            >
              <Search className="h-3.5 w-3.5" /> {copy.ui.search} <span className="text-[9px] opacity-70">{copy.ui.shortcut}</span>
            </button>
            <span className="text-muted-foreground">{copy.ui.threatLevel}</span>
            <span className={`font-bold ${dashboard?.threatLevel && dashboard.threatLevel > 75 ? 'text-critical' : dashboard?.threatLevel && dashboard.threatLevel > 50 ? 'text-warn' : 'text-safe'}`}>
              {dashboard?.threatLevel ?? 0}%
            </span>
            <VoiceCommandPanel />
          </div>
        </header>

        {isCommandOpen && (
          <div className="absolute inset-0 z-50 flex items-start justify-center bg-background/70 p-4 pt-20 backdrop-blur-sm" onMouseDown={() => setIsCommandOpen(false)}>
            <div className="w-full max-w-xl rounded-md border border-primary/30 bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
              <div className="flex items-center gap-2 border-b border-border px-4">
                <Search className="h-4 w-4 text-primary" />
                <input
                  autoFocus
                  value={commandQuery}
                  onChange={(event) => setCommandQuery(event.target.value)}
                  placeholder={copy.ui.searchPlaceholder}
                  className="h-12 flex-1 bg-transparent text-sm font-mono outline-none placeholder:text-muted-foreground"
                />
                <button type="button" onClick={() => setIsCommandOpen(false)} className="text-[10px] font-mono text-muted-foreground">{copy.ui.close}</button>
              </div>
              <div className="max-h-80 overflow-y-auto p-2">
                {navItems.filter((item) => item.label.toLowerCase().includes(commandQuery.toLowerCase())).slice(0, 12).map((item) => (
                  <Link key={item.href} href={item.href} onClick={() => { setIsCommandOpen(false); setCommandQuery(""); }} className="flex items-center gap-3 rounded px-3 py-2.5 text-sm text-muted-foreground hover:bg-primary/10 hover:text-primary">
                    <item.icon className="h-4 w-4" /> <span className="font-mono">{item.label}</span><span className="ml-auto text-[10px] text-muted-foreground/60">{item.href}</span>
                  </Link>
                ))}
                {navItems.filter((item) => item.label.toLowerCase().includes(commandQuery.toLowerCase())).length === 0 && (
                  <div className="p-6 text-center text-xs font-mono text-muted-foreground">{copy.ui.noMatches}</div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-8 z-10 relative">
          {children}
        </div>
      </main>
    </div>
  );
}
