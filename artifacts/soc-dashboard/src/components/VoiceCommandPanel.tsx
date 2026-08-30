import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { FileAudio, FlaskConical, Loader2, Mic, MicOff, Radio, Send, ShieldCheck, Upload, X } from "lucide-react";
import { useVoiceRecorder } from "@workspace/integrations-openai-ai-react";
import {
  useExecuteVoiceCommand,
  usePreviewVoiceCommand,
  type VoiceCommandExecution,
  type VoiceCommandPlan,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

type VoiceCommand =
  | { label: string; kind: "navigate"; path: string }
  | { label: string; kind: "request"; path: "/simulate" | "/self-test" };

class VoiceTranscriptionError extends Error {
  constructor(
    readonly kind: "audio-format" | "transcription",
    message: string,
  ) {
    super(message);
    this.name = "VoiceTranscriptionError";
  }
}

const VOICE_COMMANDS: Array<{ pattern: RegExp; command: VoiceCommand }> = [
  { pattern: /self[\s-]?test|selftest|само?тест|перевір(ка|ити) системи/i, command: { label: "Run self-test", kind: "request", path: "/self-test" } },
  { pattern: /simulation|симуляц|сценар(ій|ію)|запусти атаку/i, command: { label: "Run simulation", kind: "request", path: "/simulate" } },
  { pattern: /dashboard|дашборд|головн(а|ий)/i, command: { label: "Open dashboard", kind: "navigate", path: "/" } },
  { pattern: /audit[\s-]?(trail|log)|аудит|журнал аудиту|історія аудиту/i, command: { label: "Open audit trail", kind: "navigate", path: "/audit-trail" } },
  { pattern: /event|поді(ї|я)|журнал/i, command: { label: "Open event log", kind: "navigate", path: "/events" } },
  { pattern: /alert|сповіщен|тривог/i, command: { label: "Open alerts", kind: "navigate", path: "/alerts" } },
  { pattern: /patch|патч|виправлен/i, command: { label: "Open patches", kind: "navigate", path: "/patches" } },
  { pattern: /threat graph|граф загроз|граф атак/i, command: { label: "Open threat graph", kind: "navigate", path: "/threat-graph" } },
  { pattern: /rule|правил/i, command: { label: "Open rules engine", kind: "navigate", path: "/rules" } },
  { pattern: /correlation|кореляц/i, command: { label: "Open correlations", kind: "navigate", path: "/correlations" } },
  { pattern: /runtime|виконан|мета.?куб/i, command: { label: "Open runtime", kind: "navigate", path: "/runtime" } },
  { pattern: /traffic|network traffic|трафік|мережевий аналіз|аналіз трафіку/i, command: { label: "Open traffic analysis", kind: "navigate", path: "/traffic-analysis" } },
  { pattern: /quarantine|ізоляц|карантин/i, command: { label: "Open quarantine", kind: "navigate", path: "/quarantine" } },
  { pattern: /self[\s-]?healing|відновлен(ня|ня системи)|самовідновлен/i, command: { label: "Open self-healing", kind: "navigate", path: "/self-healing" } },
  { pattern: /virus[\s-]?(database|db)|malware[\s-]?(database|db)|база вірусів|вірусна база|база malware/i, command: { label: "Open virus database", kind: "navigate", path: "/virus-database" } },
  { pattern: /tenant|тенант|організаці|орендар/i, command: { label: "Open tenants", kind: "navigate", path: "/tenants" } },
];

function resolveCommand(transcript: string): VoiceCommand | null {
  return VOICE_COMMANDS.find(({ pattern }) => pattern.test(transcript))?.command ?? null;
}

function isSafeVirusCommand(transcript: string): boolean {
  return /(?:test|протест|перевір|тест|симул|іміту|зіміту|defend|відб|захист).*(?:virus|вірус|malware)|(?:virus|вірус|malware).*(?:test|протест|перевір|тест|симул|іміту|зіміту|defend|відб|захист)/iu.test(transcript);
}

async function transcribeAudio(blob: Blob): Promise<string> {
  if (blob.size > MAX_AUDIO_BYTES) {
    throw new VoiceTranscriptionError("audio-format", "The audio file exceeds the 25 MB upload limit.");
  }

  const response = await fetch("/api/voice/transcribe", {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/webm" },
    body: blob,
  });

  const data = (await response.json().catch(() => ({}))) as { transcript?: string; error?: string };
  if (!response.ok) {
    const message = data.error ?? "Voice transcription failed";
    throw new VoiceTranscriptionError(
      response.status === 400 || response.status === 415 ? "audio-format" : "transcription",
      message,
    );
  }
  return data.transcript?.trim() ?? "";
}

export function VoiceCommandPanel() {
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { state: recordingState, startRecording, stopRecording } = useVoiceRecorder();
  const previewVoiceCommand = usePreviewVoiceCommand();
  const executeVoiceCommand = useExecuteVoiceCommand();
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [typedCommand, setTypedCommand] = useState("");
  const [command, setCommand] = useState<VoiceCommand | null>(null);
  const [plan, setPlan] = useState<VoiceCommandPlan | null>(null);
  const [result, setResult] = useState<VoiceCommandExecution | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [audioError, setAudioError] = useState("");

  const resetResult = () => {
    setTranscript("");
    setTypedCommand("");
    setCommand(null);
    setPlan(null);
    setResult(null);
    setMessage("");
    setError("");
    setAudioError("");
  };

  const interpretTranscript = async (text: string) => {
    const normalized = text.trim();
    setTranscript(normalized);
    setCommand(null);
    setPlan(null);
    setResult(null);
    setMessage("");
    setAudioError("");
    if (!normalized) {
      setMessage("No speech was detected.");
      return;
    }

    if (isSafeVirusCommand(normalized)) {
      try {
        const nextPlan = await previewVoiceCommand.mutateAsync({ data: { transcript: normalized } });
        setPlan(nextPlan);
        return;
      } catch {
        setError("Virus command was not recognized. Try: «протестуй вірус» or «зімітуй власні віруси і відбивай їх».");
        return;
      }
    }

    const localCommand = resolveCommand(normalized);
    setCommand(localCommand);
    if (!localCommand) setError("Command was not recognized.");
  };

  const processAudio = async (audio: Blob) => {
    if (!audio.size) {
      setError("No audio was captured.");
      return;
    }

    setIsTranscribing(true);
    setError("");
    setMessage("");
    setAudioError("");
    try {
      const text = await transcribeAudio(audio);
      await interpretTranscript(text);
    } catch (transcriptionError) {
      if (transcriptionError instanceof VoiceTranscriptionError && transcriptionError.kind === "audio-format") {
        setAudioError(transcriptionError.message);
      } else {
        setError(transcriptionError instanceof Error ? transcriptionError.message : "Voice transcription failed");
      }
    } finally {
      setIsTranscribing(false);
    }
  };

  const toggleRecording = async () => {
    setError("");
    setMessage("");
    setAudioError("");
    if (recordingState === "recording") {
      await processAudio(await stopRecording());
      return;
    }

    resetResult();
    try {
      await startRecording();
    } catch (recordingError) {
      setError(recordingError instanceof Error ? recordingError.message : "Microphone permission was denied");
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    resetResult();
    await processAudio(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const executeCommand = async () => {
    if (!command && !plan) return;
    setIsExecuting(true);
    setError("");
    try {
      if (plan) {
        const execution = await executeVoiceCommand.mutateAsync({
          data: { transcript, confirmed: true },
        });
        setResult(execution);
        setMessage(execution.summary);
        return;
      }

      if (!command) return;
      if (command.kind === "navigate") {
        setLocation(command.path);
        setOpen(false);
        return;
      }

      const response = await fetch(`/api${command.path}`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Command failed");
      setMessage(`${command.label} completed.`);
    } catch (executionError) {
      setError(executionError instanceof Error ? executionError.message : "Command failed");
    } finally {
      setIsExecuting(false);
    }
  };

  const isRecording = recordingState === "recording";

  return (
    <div className="relative">
      <Button
        variant={isRecording ? "destructive" : "outline"}
        size="sm"
        className="font-mono gap-2"
        onClick={() => setOpen((current) => !current)}
        data-testid="button-voice-command"
        aria-expanded={open}
        aria-controls="voice-command-panel"
      >
        {isRecording ? <Radio className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4" />}
        {isRecording ? "LISTENING" : "VOICE"}
      </Button>

      {open && (
        <Card id="voice-command-panel" className="absolute right-0 top-11 z-50 max-h-[calc(100vh-5rem)] w-[min(94vw,480px)] overflow-y-auto border-primary/30 shadow-[0_0_36px_hsl(var(--primary)/0.12)]">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-mono uppercase tracking-widest">
                  <ShieldCheck className="h-4 w-4 text-safe" />
                  Voice Control
                </CardTitle>
                <CardDescription className="mt-2 text-xs">
                  Transcribe a command, review it, then confirm execution.
                </CardDescription>
                <p className="mt-2 text-[10px] leading-4 text-muted-foreground/80">
                  Try: “open audit trail”, “show traffic”, “open quarantine”, “open virus database”, or “run simulation”.
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Close voice control">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={toggleRecording} disabled={isTranscribing || isExecuting} variant={isRecording ? "destructive" : "default"} className="font-mono text-xs">
                {isRecording ? <><MicOff className="h-4 w-4" /> Stop & transcribe</> : <><Mic className="h-4 w-4" /> Record command</>}
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} disabled={isRecording || isTranscribing || isExecuting} variant="outline" className="font-mono text-xs">
                <Upload className="h-4 w-4" /> Upload audio
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.wav,.mp3,.webm,.m4a,.mp4,.ogg,.opus,.aac,.flac"
                className="hidden"
                onChange={(event) => void handleFile(event.target.files?.[0])}
                data-testid="input-voice-file"
              />
            </div>

            <div className="flex gap-2">
              <input
                value={typedCommand}
                onChange={(event) => setTypedCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && typedCommand.trim()) void interpretTranscript(typedCommand);
                }}
                placeholder="Або введіть команду…"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
                disabled={isRecording || isTranscribing || isExecuting}
                aria-label="Type voice command"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void interpretTranscript(typedCommand)}
                disabled={!typedCommand.trim() || isRecording || isTranscribing || isExecuting}
              >
                Analyze
              </Button>
            </div>

            <div className="rounded-md border border-border bg-secondary/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                <FileAudio className="h-3.5 w-3.5" /> Transcript
              </div>
              <p className={`min-h-10 text-sm ${transcript ? "text-foreground" : "text-muted-foreground"}`}>
                {isTranscribing ? "Transcribing audio…" : transcript || "Your transcript will appear here."}
              </p>
            </div>

            {command && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Detected command</div>
                  <div className="mt-1 text-sm font-semibold">{command.label}</div>
                </div>
                <Badge variant="outline" className="border-safe/40 text-safe">READY</Badge>
              </div>
            )}

            {plan && (
              <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Safe execution plan</div>
                    <div className="mt-1 text-sm font-semibold">{plan.label}</div>
                  </div>
                  <Badge variant="outline" className="border-warn/40 text-warn">{plan.mode}</Badge>
                </div>
                {plan.criteria.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {plan.criteria.map((criterion) => (
                      <Badge key={`${criterion.type}-${criterion.value ?? "all"}`} variant="secondary" className="font-mono text-[10px]">
                        {criterion.type}{criterion.value ? `: ${criterion.value}` : ": ALL"}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="space-y-1 border-t border-primary/15 pt-2">
                  {plan.safetyNotes.map((note) => (
                    <p key={note} className="text-[11px] leading-4 text-muted-foreground">• {note}</p>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-safe">
                  <ShieldCheck className="h-3.5 w-3.5" /> Payload execution blocked
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-3 rounded-md border border-safe/30 bg-safe/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-mono font-bold text-safe">
                    <FlaskConical className="h-4 w-4" /> TEST COMPLETED
                  </div>
                  <Badge variant="outline" className={result.recommendedAction === "ISOLATE" ? "border-critical/40 text-critical" : result.recommendedAction === "WARN" ? "border-warn/40 text-warn" : "border-safe/40 text-safe"}>
                    {result.recommendedAction}
                  </Badge>
                </div>
                {result.criteriaResults.map((criterion) => (
                  <div key={`${criterion.type}-${criterion.value ?? "all"}`} className="grid grid-cols-[1fr_auto] gap-3 border-t border-border/70 pt-2 text-xs">
                    <div>
                      <div className="font-mono text-foreground">{criterion.type}{criterion.value ? ` · ${criterion.value}` : ""}</div>
                      <div className="mt-1 text-muted-foreground">{criterion.evidence}</div>
                    </div>
                    <div className="text-right">
                      <div className={criterion.status === "NO_MATCH" ? "text-muted-foreground" : "text-safe"}>{criterion.status}</div>
                      <div className="font-mono text-muted-foreground">{criterion.count}</div>
                    </div>
                  </div>
                ))}
                {result.syntheticDefense.map((scenario) => (
                  <div key={scenario.scenario} className="space-y-1 border-t border-border/70 pt-2 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium">{scenario.scenario}</span>
                      <Badge variant="outline" className="shrink-0 text-[9px]">{scenario.action}</Badge>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {scenario.stages.join(" → ")} · SCORE {scenario.riskScore}
                    </div>
                    <div className="text-safe">{scenario.response}</div>
                  </div>
                ))}
                <div className="border-t border-safe/20 pt-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Audit recorded · execution allowed: no
                </div>
              </div>
            )}

            {(isTranscribing || isExecuting) && (
              <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {isExecuting ? "Executing confirmed command…" : "Sending audio for transcription…"}
              </div>
            )}

            {audioError && (
              <div className="space-y-1 rounded-md border border-warn/30 bg-warn/5 p-3 text-xs" role="alert" data-testid="voice-audio-format-error">
                <p className="font-mono font-bold uppercase tracking-widest text-warn">Audio format problem</p>
                <p className="text-muted-foreground">{audioError}</p>
                <p className="text-muted-foreground/80">Try a complete WAV, MP3, WebM, MP4/M4A, OGG, AAC, or FLAC recording.</p>
              </div>
            )}
            {error && <p className="text-xs text-critical" role="alert">{error}</p>}
            {message && <p className="text-xs text-safe" role="status">{message}</p>}

            <Button onClick={() => void executeCommand()} disabled={(!command && !plan) || isTranscribing || isExecuting} className="w-full font-mono">
              <Send className="h-4 w-4" /> {plan ? "Confirm safe test" : "Confirm command"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}