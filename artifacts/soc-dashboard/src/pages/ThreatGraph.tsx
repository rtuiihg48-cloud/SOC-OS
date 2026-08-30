import { useGetThreatGraph } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, ResponsiveContainer, Tooltip as RechartsTooltip, Cell, ReferenceLine } from "recharts";
import { Network } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";

function generateNodePositions(nodes: any[]) {
  return nodes.map((node, i) => {
    const x = ((i * 137) % 100);
    const y = ((i * 149 + node.score) % 100);
    // Size based on score (clamped)
    const z = Math.max(100, Math.min(500, node.score * 4));
    return { ...node, x, y, z };
  });
}

export default function ThreatGraph() {
  const { data: graphData, isLoading } = useGetThreatGraph();

  const formattedNodes = useMemo(() => {
    if (!graphData?.nodes) return [];
    return generateNodePositions(graphData.nodes);
  }, [graphData]);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center font-mono text-primary animate-pulse">
        [ MAPPING ATTACK VECTORS... ]
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center font-mono text-muted-foreground border border-dashed border-border rounded-lg p-12">
        NO THREAT DATA TO VISUALIZE
      </div>
    );
  }

  const edges = graphData.edges.map(edge => {
    const sourceNode = formattedNodes.find(n => n.id === edge[0]);
    const targetNode = formattedNodes.find(n => n.id === edge[1]);
    if (sourceNode && targetNode) return { start: sourceNode, end: targetNode };
    return null;
  }).filter(Boolean);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-card border border-border p-3 rounded shadow-lg font-mono text-sm max-w-xs z-50">
          <div className="text-primary font-bold mb-1 truncate" title={data.id}>ID: {data.id.substring(0,8)}...</div>
          <div className="mb-2 text-foreground/80">{data.event}</div>
          {data.tactic && (
            <div className="mb-2">
              <Badge variant="outline" className="text-[10px] bg-secondary">{data.tactic}</Badge>
            </div>
          )}
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-border gap-4">
            <span className="text-muted-foreground">Action: <span style={{
              color: data.action === 'ALLOW' ? 'hsl(var(--safe))' :
                     data.action === 'WARN' ? 'hsl(var(--warn))' :
                     data.action === 'ISOLATE' ? 'hsl(var(--critical))' : 'hsl(var(--primary))'
            }}>{data.action}</span></span>
            <span className="text-muted-foreground">Status: <span className="text-foreground">{data.status}</span></span>
            <span className="text-muted-foreground">Score: <span className={data.score > 75 ? 'text-critical' : data.score > 50 ? 'text-warn' : 'text-safe'}>{data.score}</span></span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="h-full flex flex-col space-y-4">
      <Card className="bg-card/50 backdrop-blur border-border shrink-0">
        <CardHeader className="py-4 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-mono text-primary flex items-center gap-2 uppercase tracking-widest">
              <Network className="w-5 h-5" /> Attack Vector Topology
            </CardTitle>
            <CardDescription className="font-mono text-sm">
              Node relationship visualization. Size indicates risk score.
            </CardDescription>
          </div>
          <div className="flex gap-4 font-mono text-xs">
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-safe"></div> ALLOW</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-warn"></div> WARN</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-critical"></div> ISOLATE</div>
            <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-primary"></div> PATCHED</div>
          </div>
        </CardHeader>
      </Card>

      <Card className="bg-[#050B14] border-primary/20 flex-1 relative overflow-hidden flex items-center justify-center min-h-[500px]">
        <div className="absolute inset-0 opacity-10 bg-[linear-gradient(to_right,#00ffff_1px,transparent_1px),linear-gradient(to_bottom,#00ffff_1px,transparent_1px)] bg-[size:40px_40px]"></div>

        <CardContent className="w-full h-full p-6 relative z-10">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
              <XAxis type="number" dataKey="x" name="X" domain={[0, 100]} hide />
              <YAxis type="number" dataKey="y" name="Y" domain={[0, 100]} hide />
              <ZAxis type="number" dataKey="z" range={[50, 400]} name="Size" />
              <RechartsTooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: 'hsl(var(--muted-foreground))' }} />

              {edges.map((edge: any, i) => (
                <ReferenceLine
                  key={`edge-${i}`}
                  segment={[{ x: edge.start.x, y: edge.start.y }, { x: edge.end.x, y: edge.end.y }]}
                  stroke="hsl(var(--primary))"
                  strokeOpacity={0.3}
                  strokeWidth={1}
                />
              ))}

              <Scatter name="Threat Nodes" data={formattedNodes}>
                {formattedNodes.map((entry, index) => {
                  let fill = "hsl(var(--safe))";
                  if (entry.action === 'ISOLATE') fill = "hsl(var(--critical))";
                  else if (entry.action === 'WARN') fill = "hsl(var(--warn))";
                  else if (entry.action === 'PATCHED') fill = "hsl(var(--primary))";

                  return <Cell key={`cell-${index}`} fill={fill} style={{ filter: `drop-shadow(0px 0px 5px ${fill})` }} />;
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
