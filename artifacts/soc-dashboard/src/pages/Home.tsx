import { Link } from "wouter";
import { Shield, Lock, Zap, Network, ChevronRight, Activity, Globe, Database, TerminalSquare } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col font-sans selection:bg-primary/30 relative">
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] z-0"></div>

      {/* Navigation */}
      <header className="h-20 border-b border-border bg-background/80 backdrop-blur-md flex items-center px-6 md:px-12 z-30 justify-between sticky top-0">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-primary drop-shadow-[0_0_8px_hsl(var(--primary)/0.6)]" />
          <span className="font-bold text-2xl tracking-[0.2em] text-primary font-mono uppercase">SOC_OS</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/sign-in" className="text-sm font-mono tracking-widest text-muted-foreground hover:text-foreground transition-colors uppercase hidden sm:block">
            Sign In
          </Link>
          <Link href="/sign-up" className="text-sm font-mono tracking-widest bg-primary text-primary-foreground px-6 py-2.5 hover:bg-primary/90 transition-colors uppercase rounded-sm shadow-[0_0_15px_hsl(var(--primary)/0.3)]">
            Initialize
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center relative z-10 px-6 py-20 text-center">
        {/* Hero Section */}
        <div className="max-w-4xl mx-auto flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary mb-8 font-mono text-xs uppercase tracking-widest">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            V50 Pipeline Active
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-[1.1] font-sans">
            Security operations, <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">
              cryptographically enforced.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-12 font-sans font-medium leading-relaxed">
            SOC_OS is the next-generation autonomous defense boundary. Analyze, isolate, and remediate threats in milliseconds with an immutable audit trail.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
            <Link href="/sign-up" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-mono tracking-widest uppercase hover:bg-primary/90 transition-all rounded-sm text-sm group">
              Start Operations
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link href="/sign-in" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-secondary text-foreground px-8 py-4 font-mono tracking-widest uppercase hover:bg-secondary/80 transition-all rounded-sm text-sm border border-border">
              Access Dashboard
            </Link>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-32 max-w-6xl mx-auto w-full text-left">
          <div className="p-8 border border-border bg-card/50 backdrop-blur-sm rounded-sm hover:border-primary/50 transition-colors group">
            <Activity className="w-10 h-10 text-primary mb-6 group-hover:scale-110 transition-transform duration-500" />
            <h3 className="text-xl font-bold mb-3 font-sans">Meta-Cube Engine</h3>
            <p className="text-muted-foreground font-sans text-sm leading-relaxed">
              Proprietary behavioral analysis execution plane that automatically synthesizes zero-day mitigation strategies and sandboxes hostile processes.
            </p>
          </div>

          <div className="p-8 border border-border bg-card/50 backdrop-blur-sm rounded-sm hover:border-primary/50 transition-colors group">
            <Lock className="w-10 h-10 text-primary mb-6 group-hover:scale-110 transition-transform duration-500" />
            <h3 className="text-xl font-bold mb-3 font-sans">Immutable Audit</h3>
            <p className="text-muted-foreground font-sans text-sm leading-relaxed">
              Every action, rule modification, and quarantine event is cryptographically hashed and logged to an unalterable tenant-scoped chain.
            </p>
          </div>

          <div className="p-8 border border-border bg-card/50 backdrop-blur-sm rounded-sm hover:border-primary/50 transition-colors group">
            <Zap className="w-10 h-10 text-primary mb-6 group-hover:scale-110 transition-transform duration-500" />
            <h3 className="text-xl font-bold mb-3 font-sans">Self-Healing Assets</h3>
            <p className="text-muted-foreground font-sans text-sm leading-relaxed">
              Define auto-restoration boundaries around critical infrastructure. SOC_OS rolls back compromised managed resources in under 400ms.
            </p>
          </div>
        </div>

        {/* Global Network Map Visualization placeholder */}
        <div className="mt-32 max-w-6xl mx-auto w-full border border-border bg-card p-12 rounded-sm relative overflow-hidden flex flex-col items-center justify-center min-h-[400px]">
          <div className="absolute inset-0 opacity-[0.03]">
             <Globe className="w-[800px] h-[800px] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <Network className="w-16 h-16 text-muted-foreground mb-6 opacity-50 relative z-10" />
          <h2 className="text-3xl font-bold font-sans mb-4 relative z-10">Global Traffic Analysis</h2>
          <p className="text-muted-foreground max-w-xl mx-auto font-sans relative z-10">
            Ingest and classify millions of network flows across distributed gateways with sub-millisecond heartbeat latency and continuous threat scoring.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6 md:px-12 bg-background relative z-10">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TerminalSquare className="w-4 h-4" />
            <span className="font-mono text-xs tracking-widest uppercase">© 2024 SOC_OS. All systems operational.</span>
          </div>
          <div className="flex gap-6 font-mono text-xs text-muted-foreground uppercase tracking-wider">
            <span className="hover:text-primary cursor-pointer transition-colors">Documentation</span>
            <span className="hover:text-primary cursor-pointer transition-colors">API Reference</span>
            <span className="hover:text-primary cursor-pointer transition-colors">Privacy Policy</span>
          </div>
        </div>
      </footer>
    </div>
  );
}