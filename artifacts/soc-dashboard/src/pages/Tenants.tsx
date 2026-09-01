import { useState } from "react";
import {
  useListTenants,
  getListTenantsQueryKey,
  useCreateTenant,
  useDeleteTenant,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Ban, Database, Shield } from "lucide-react";

const PLAN_STYLES: Record<string, string> = {
  enterprise: "bg-primary/10 text-primary border-primary/30",
  pro:        "bg-warn/10 text-warn border-warn/30",
  starter:    "bg-muted text-muted-foreground border-border",
};

function previewApiKey(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 14) : "UNAVAILABLE";
}

export default function Tenants() {
  const qc = useQueryClient();
  const { data: tenants = [], isLoading } = useListTenants();
  const { mutate: createTenant, isPending: isCreating } = useCreateTenant();
  const { mutate: deleteTenant } = useDeleteTenant();
  const safeTenants = Array.isArray(tenants)
    ? tenants.filter((tenant): tenant is NonNullable<typeof tenant> => tenant != null)
    : [];

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", plan: "starter" as "starter" | "pro" | "enterprise" });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListTenantsQueryKey() });

  function handleCreate() {
    if (!form.name.trim()) return;
    createTenant(
      { data: { name: form.name.trim(), plan: form.plan } },
      {
        onSuccess: () => {
          invalidate();
          setShowCreate(false);
          setForm({ name: "", plan: "starter" });
        },
      }
    );
  }

  function handleDelete(id: number, name: string) {
    if (!confirm(`Deactivate tenant "${name}"? Access and service credentials will be disabled while audit evidence is retained.`)) return;
    deleteTenant({ id }, { onSuccess: invalidate });
  }

  const totalEvents = (safeTenants as Array<typeof safeTenants[0] & { eventCount?: number }>)
    .reduce((a, t) => a + (t.eventCount ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "TOTAL TENANTS", value: safeTenants.length, color: "text-primary" },
          { label: "TOTAL EVENTS", value: totalEvents, color: "text-warn" },
          { label: "ENTERPRISE", value: safeTenants.filter((t) => t.plan === "enterprise").length, color: "text-safe" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-card border border-border rounded-lg p-4 font-mono">
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">{kpi.label}</div>
            <div className={`text-3xl font-bold ${kpi.color}`}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold font-mono flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            TENANT MANAGEMENT
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Multi-tenant SaaS isolation — each tenant gets scoped events, rules, alerts, and API key
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md font-mono text-sm hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          NEW TENANT
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-card border border-primary/30 rounded-lg p-6 space-y-4">
          <h3 className="font-mono text-sm font-semibold text-primary">CREATE TENANT</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">TENANT NAME *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Acme Corp"
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:border-primary outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-muted-foreground mb-1">PLAN</label>
              <select
                value={form.plan}
                onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value as typeof form.plan }))}
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:border-primary outline-none"
              >
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={isCreating || !form.name.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded font-mono text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isCreating ? "CREATING..." : "CREATE TENANT"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-secondary text-foreground rounded font-mono text-sm hover:bg-secondary/80 transition-colors"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Tenants list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground font-mono">LOADING TENANTS...</div>
      ) : safeTenants.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground font-mono">NO TENANTS</div>
      ) : (
        <div className="space-y-3">
          {safeTenants.map((tenant) => (
            <div key={tenant.id} className="bg-card border border-border rounded-lg p-5 flex items-center gap-6">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-mono font-semibold">{tenant.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded border font-mono uppercase ${PLAN_STYLES[tenant.plan] ?? ""}`}>
                    {tenant.plan}
                  </span>
                  {tenant.id === 1 && (
                    <span className="text-xs px-2 py-0.5 rounded border border-primary/30 text-primary font-mono">SYSTEM</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Database className="w-3 h-3" />
                    {(tenant as any).eventCount ?? 0} events
                  </span>
                  <span>ID: #{tenant.id}</span>
                  <span>Created: {new Date(tenant.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="text-right">
                  <div className="text-xs font-mono text-muted-foreground mb-1">API KEY</div>
                  <div className="text-xs font-mono text-primary/60 font-semibold">
                    {previewApiKey((tenant as { apiKey?: unknown }).apiKey)}...
                  </div>
                </div>
                {tenant.id !== 1 && (
                  <button
                    onClick={() => handleDelete(tenant.id, tenant.name)}
                    title="Deactivate tenant"
                    aria-label={`Deactivate tenant ${tenant.name}`}
                    className="p-2 rounded text-muted-foreground hover:text-critical hover:bg-critical/10 transition-colors"
                  >
                    <Ban className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Architecture note */}
      <div className="bg-secondary/30 border border-border rounded-lg p-4 text-xs font-mono text-muted-foreground">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-3 h-3 text-primary" />
          <span className="text-primary">MULTI-TENANT ISOLATION (V30 ARCHITECTURE)</span>
        </div>
        Each tenant gets isolated event streams, scoped detection rules, separate alert queues, and individual API keys. The "System" tenant (ID=1) contains global rules that apply across all tenants.
      </div>
    </div>
  );
}
