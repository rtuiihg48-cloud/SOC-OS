import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { FileAudio, Loader2, Mic, MicOff, Radio, Send, ShieldCheck, Upload, X } from "lucide-react";
import { useVoiceRecorder } from "@workspace/integrations-openai-ai-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type VoiceCommand =
  | { label: string; kind: "navigate"; path: string }
  | { label: string; kind: "request"; path: "/simulate" | "/self-test" };

const VOICE_COMMANDS: Array<{ pattern: RegExp; command: VoiceCommand }> = [
  { pattern: /self[\s-]?test|selftest|само?тест|перевір(ка|ити) системи/i, command: { label: "Run self-test", kind: "request", path: "/self-test" } },
  { pattern: /simulation|симуляц|сценар(ій|ію)|запусти атаку/i, command: { label: "Run simulation", kind: "request", path: "/simulate" } },
  { pattern: /dashboard|дашборд|головн(а|ий)/i, command: { label: "Open dashboard", kind: "navigate", path: "/" } },
  { pattern: /event|поді(ї|я)|журнал/i, command: { label: "Open event log", kind: "navigate", path: "/events" } },
  { pattern: /alert|сповіщен|тривог/i, command: { label: "Open alerts", kind: "navigate", path: "/alerts" } },
  { pattern: /patch|патч|виправлен/i, command: { label: "Open patches", kind: "navigate", path: "/patches" } },
  { pattern: /threat graph|граф загроз|граф атак/i, command: { label: "Open threat graph", kind: "navigate", path: "/threat-graph" } },
  { pattern: /rule|правил/i, command: { label: "Open rules engine", kind: "navigate", path: "/rules" } },
  { pattern: /correlation|кореляц/i, command: { label: "Open correlations", kind: "navigate", path: "/correlations" } },
  { pattern: /runtime|виконан|мета.?куб/i, command: { label: "Open runtime", kind: "navigate", path: "/runtime" } },
];

function resolveCommand(transcript: string): VoiceCommand | null {
  return VOICE_COMMANDS.find(({ pattern }) => pattern.test(transcript))?.command ?? null;
}

async function transcribeAudio(blob: Blob): Promise<string> {
  const response = await fetch("/api/voice/transcribe", {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/webm" },
    body: blob,
  });

  const data = (await response.json().catch(() => ({}))) as { transcript?: string; error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "Voice transcription failed");
  }
  return data.transcript?.trim() ?? "";
}

export function VoiceCommandPanel() {
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { state: recordingState, startRecording, stopRecording } = useVoiceRecorder();
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [command, setCommand] = useState<VoiceCommand | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const resetResult = () => {
    setTranscript("");
    setCommand(null);
    setMessage("");
    setError("");
  };

  const processAudio = async (audio: Blob) => {
    if (!audio.size) {
      setError("No audio was captured.");
      return;
    }

    setIsTranscribing(true);
    setError("");
    setMessage("");
    try {
      const text = await transcribeAudio(audio);
      setTranscript(text);
      setCommand(resolveCommand(text));
      if (!text) setMessage("No speech was detected.");
    } catch (transcriptionError) {
      setError(transcriptionError instanceof Error ? transcriptionError.message : "Voice transcription failed");
    } finally {
      setIsTranscribing(false);
    }
  };

  const toggleRecording = async () => {
    setError("");
    setMessage("");
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
    if (!command) return;
    setIsExecuting(true);
    setError("");
    try {
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
        <Card id="voice-command-panel" className="absolute right-0 top-11 z-50 w-[min(90vw,380px)] border-primary/30 shadow-xl">
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
                accept="audio/*"
                className="hidden"
                onChange={(event) => void handleFile(event.target.files?.[0])}
                data-testid="input-voice-file"
              />
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

            {(isTranscribing || isExecuting) && (
              <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {isExecuting ? "Executing confirmed command…" : "Sending audio for transcription…"}
              </div>
            )}

            {error && <p className="text-xs text-critical" role="alert">{error}</p>}
            {message && <p className="text-xs text-safe" role="status">{message}</p>}

            <Button onClick={() => void executeCommand()} disabled={!command || isTranscribing || isExecuting} className="w-full font-mono">
              <Send className="h-4 w-4" /> Confirm command
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}