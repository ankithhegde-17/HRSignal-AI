import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, MessageSquareText, Mic, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { EvidenceQualityBadge, ToneBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/db";
import { useDepartmentOptions, useEmployeeDirectory } from "@/hooks/use-lookups";
import { useEmployee360 } from "@/providers/employee-360-provider";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationMessage } from "@/lib/types";

const SUGGESTED_QUESTIONS = [
  "Why is this employee high risk?",
  "Which department has the lowest attendance?",
  "Which employees require a performance review?",
  "How many candidates are in Interview?",
  "Which actions require CEO approval?",
  "What is the current attrition position?",
];

interface AssistantResponse {
  ok: boolean;
  conversation_id: string;
  answer: string;
  answer_type: "fact" | "recommendation" | "insufficient_data";
  recommendation: string | null;
  evidence: Array<{ label: string; type: string; id: string }>;
  message?: string;
}

export default function AskHrSignalPage() {
  const queryClient = useQueryClient();
  const { openEmployee360 } = useEmployee360();
  const { options: departmentOptions } = useDepartmentOptions();
  const { data: employees = [] } = useEmployeeDirectory();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [contextType, setContextType] = useState<"organization" | "department" | "employee">("organization");
  const [contextEntityId, setContextEntityId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [voiceAnnounce, setVoiceAnnounce] = useState("");
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  // Separate channels per recognition session: typed text is preserved, interim
  // text is shown live (never committed), and the FINAL transcript is the
  // source of truth committed into the input on stop.
  const typedBaseRef = useRef("");
  const interimRef = useRef("");
  const finalizedRef = useRef("");
  const sessionIdRef = useRef(0); // monotonically increasing; guards stale events
  const lastProcessedRef = useRef(-1); // last result index processed (dedupe)
  const speechSupported =
    typeof window !== "undefined" &&
    Boolean((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

  // Stop any in-flight recognition when the page unmounts / navigates away.
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // noop on teardown
      }
    };
  }, []);

  /** Appends a transcript to the existing typed input (with a space), never replacing it. */
  const mergeTranscript = (base: string, transcript: string) => {
    const clean = transcript.trim().replace(/\s+/g, " ");
    if (!clean) return base;
    return base.trim() ? `${base.trim()} ${clean}` : clean;
  };
  const scrollRef = useRef<HTMLDivElement>(null);

  useRealtimeRefresh(["hr_ai_conversations"], [["conversations"]]);

  const conversations = useQuery<Conversation[]>({
    queryKey: ["conversations"],
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("hr_ai_conversations")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(30);
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as Conversation[];
    },
  });

  const messages = useQuery<ConversationMessage[]>({
    queryKey: ["conversation-messages", conversationId],
    enabled: Boolean(conversationId),
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("hr_ai_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at");
      if (queryError) throw new Error(queryError.message);
      return (data ?? []) as ConversationMessage[];
    },
  });

  const ask = useMutation({
    mutationFn: async (text: string) => {
      const contextLabel =
        contextType === "organization"
          ? undefined
          : contextType === "department"
            ? departmentOptions.find((option) => option.value === contextEntityId)?.label
            : employees.find((employee) => employee.id === contextEntityId)?.full_name;

      const { data, error: invokeError } = await supabase.functions.invoke<AssistantResponse>("ask-hr-signal", {
        body: {
          conversation_id: conversationId,
          question: contextLabel ? `${text} (about ${contextLabel})` : text,
          context_type: contextType,
          context_entity_id: contextEntityId || null,
        },
        headers: { "Content-Type": "application/json" },
      });
      if (invokeError) throw new Error(invokeError.message);
      if (!data?.ok) throw new Error(data?.message ?? "The assistant could not answer that question.");
      return data;
    },
    onSuccess: (result) => {
      setError(null);
      setConversationId(result.conversation_id);
      setQuestion("");
      void queryClient.invalidateQueries({ queryKey: ["conversation-messages", result.conversation_id] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const clearHistory = useMutation({
    mutationFn: async () => {
      const { error: deleteError } = await supabase.from("hr_ai_conversations").delete().not("id", "is", null);
      if (deleteError) throw new Error(deleteError.message);
    },
    onSuccess: () => {
      setClearOpen(false);
      setConversationId(null);
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["conversation-messages"] });
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.data?.length]);

  const lastAssistant = useMemo(
    () => (messages.data ?? []).filter((message) => message.sender_type === "assistant").at(-1) ?? null,
    [messages.data],
  );

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || ask.isPending) return;
    setError(null);
    ask.mutate(trimmed);
  };

  // Browser speech-to-text (optimized for Microsoft Edge / Chromium): the mic
  // prompts for permission, live interim text is shown appended to any typed
  // text, and the FINAL transcript is committed exactly once into the existing
  // input on stop (onend). Nothing is cleared in stop/end/error handlers.
  const toggleMic = () => {
    if (listening || requesting) {
      // Stop recording; onend owns the idle state + commit. Never clear here.
      try {
        recognitionRef.current?.stop();
      } catch {
        // noop
      }
      return;
    }
    if (!speechSupported) {
      toast.error("Voice input is not supported in this browser. You can type your question instead.");
      return;
    }
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition() as {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      maxAlternatives: number;
      start: () => void;
      stop: () => void;
      onstart: (() => void) | null;
      onresult:
        | ((event: {
            resultIndex: number;
            results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
          }) => void)
        | null;
      onerror: ((event: { error?: string }) => void) | null;
      onend: (() => void) | null;
    };

    recognitionRef.current = recognition;
    // Reliable dictation defaults (Edge supports these).
    recognition.lang = "en-IN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    const sessionId = sessionIdRef.current + 1;
    sessionIdRef.current = sessionId;
    typedBaseRef.current = question;
    interimRef.current = "";
    finalizedRef.current = "";
    lastProcessedRef.current = -1;

    // Ignore events from superseded sessions (start/stop/start races).
    const isCurrentSession = () => sessionIdRef.current === sessionId;

    recognition.onstart = () => {
      if (!isCurrentSession()) return;
      setRequesting(false);
      setListening(true);
      setVoiceAnnounce("Listening");
    };

    recognition.onresult = (event) => {
      if (!isCurrentSession()) return;
      let interim = "";
      // Process each result index exactly once; skip repeats.
      for (let i = Math.max(event.resultIndex, lastProcessedRef.current + 1); i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalizedRef.current = `${finalizedRef.current} ${text}`.trim().replace(/\s+/g, " ");
          lastProcessedRef.current = i;
        } else {
          interim = `${interim} ${text}`.trim();
        }
      }
      interimRef.current = interim;
      // Show live text while speaking; finalized text is what stays on stop.
      const shown = mergeTranscript(typedBaseRef.current, `${finalizedRef.current}${interim ? ` ${interim}` : ""}`);
      setQuestion(shown);
    };

    recognition.onerror = (event) => {
      if (!isCurrentSession()) return;
      setRequesting(false);
      setListening(false);
      setVoiceAnnounce("Voice input stopped");
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error("Microphone access was denied. Enable microphone permission or type your question.");
      } else if (event.error === "no-speech") {
        toast.error("No speech detected. Try speaking again.");
      } else if (event.error === "network") {
        toast.error("Voice recognition network error. Try again or type your question.");
      } else if (event.error === "audio-capture") {
        toast.error("No microphone was found. Connect one or type your question.");
      } else if (event.error === "aborted") {
        // User cancelled — keep the typed input untouched.
      } else {
        toast.error("Voice input failed. Please try again.");
      }
    };

    recognition.onend = () => {
      if (!isCurrentSession()) return;
      setRequesting(false);
      setListening(false);
      setVoiceAnnounce("Voice input stopped");
      // Commit the FINAL transcript exactly once. A final onresult can land just
      // after stop(), so defer a tick; a late onresult re-commits idempotently.
      setTimeout(() => {
        setQuestion(mergeTranscript(typedBaseRef.current, finalizedRef.current));
      }, 0);
    };

    setRequesting(true);
    setVoiceAnnounce("Listening");
    try {
      recognition.start();
    } catch {
      setRequesting(false);
      setListening(false);
      setVoiceAnnounce("");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ask HR Signal"
        description="Answers come from verified records stored in your workforce database. When evidence is missing, the assistant says so instead of estimating."
        breadcrumbs={[{ label: "AI Insights", to: "/insights/organization" }, { label: "Ask HR Signal" }]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setConversationId(null)}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              New conversation
            </Button>
            <Button variant="outline" size="sm" onClick={() => setClearOpen(true)} disabled={(conversations.data ?? []).length === 0}>
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Clear history
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversations</h2>
          {conversations.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : conversations.isError ? (
            <ErrorState onRetry={() => void conversations.refetch()} />
          ) : (conversations.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No conversations yet. Ask a question to start.
            </p>
          ) : (
            <ul className="hr-scroll-area max-h-[28rem] space-y-1 overflow-y-auto pr-1">
              {(conversations.data ?? []).map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setConversationId(conversation.id);
                      setError(null);
                    }}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      conversationId === conversation.id
                        ? "border-primary/30 bg-primary-soft text-foreground"
                        : "border-border bg-card hover:border-primary/30",
                    )}
                  >
                    <p className="truncate font-medium">{conversation.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatRelative(conversation.updated_at)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="glass flex min-h-[32rem] flex-col rounded-lg border border-border shadow-card">
          <div className="border-b border-border px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex w-full flex-col gap-1.5 sm:w-48">
                <Label className="text-xs font-medium text-muted-foreground">Context</Label>
                <Select
                  value={contextType}
                  onValueChange={(value) => {
                    setContextType(value as typeof contextType);
                    setContextEntityId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="organization">Organisation-wide</SelectItem>
                    <SelectItem value="department">A department</SelectItem>
                    <SelectItem value="employee">An employee</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {contextType !== "organization" ? (
                <div className="flex w-full flex-col gap-1.5 sm:w-64">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {contextType === "department" ? "Department" : "Employee"}
                  </Label>
                  <Select value={contextEntityId} onValueChange={setContextEntityId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select context" />
                    </SelectTrigger>
                    <SelectContent>
                      {(contextType === "department" ? departmentOptions : employees.slice(0, 300).map((employee) => ({
                        value: employee.id,
                        label: employee.full_name,
                      }))).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setQuestion(suggestion)}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <div ref={scrollRef} className="hr-scroll-area flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {!conversationId && (messages.data ?? []).length === 0 ? (
              <EmptyState
                title="Ask a question about your workforce"
                description="Responses are built from stored attendance, performance, recruitment, risk and action records. Facts and recommendations are labelled separately."
                icon={<MessageSquareText className="h-5 w-5" aria-hidden="true" />}
              />
            ) : messages.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading conversation…
              </p>
            ) : (
              (messages.data ?? []).map((message) => (
                <div
                  key={message.id}
                  className={cn("flex", message.sender_type === "user" ? "justify-end" : "justify-start")}
                >
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg border px-4 py-3 text-sm",
                    message.sender_type === "user"
                      ? "border-primary/25 bg-primary-soft text-foreground"
                      : "border-insight/20 bg-insight-soft/70 text-foreground",
                  )}
                >
                  {message.sender_type === "assistant" ? (
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-insight">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        HR Signal AI
                      </p>
                      <ToneBadge tone="insight">Qwen interpretation</ToneBadge>
                      {/^insufficient data/i.test(message.message) ? (
                        <ToneBadge tone="neutral">Insufficient data</ToneBadge>
                      ) : null}
                      {message.message.includes("Suggested next step") ? (
                        <ToneBadge tone="workflow">Recommendation</ToneBadge>
                      ) : null}
                    </div>
                  ) : null}
                    <p className="whitespace-pre-wrap leading-relaxed">{message.message}</p>

                    {(message.evidence_refs ?? []).length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(message.evidence_refs ?? []).map((ref, index) => (
                          <button
                            key={`${ref.id}-${index}`}
                            type="button"
                            onClick={() => ref.type === "employee" && openEmployee360(ref.id)}
                            className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                          >
                            {ref.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            )}

            {ask.isPending ? (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Querying verified records…
                </div>
              </div>
            ) : null}
          </div>

          {lastAssistant ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-2.5">
              <EvidenceQualityBadge quality="moderate" />
              <span className="text-xs text-muted-foreground">
                Facts are read from stored records; suggestions are labelled as recommendations.
              </span>
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="mx-5 mb-3 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive-soft px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit(question);
            }}
            className="border-t border-border p-4"
          >
            <Label htmlFor="ask-input" className="sr-only">
              Your question
            </Label>
            <div className="flex items-end gap-2">
              <Textarea
                id="ask-input"
                rows={2}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit(question);
                  }
                }}
                placeholder="Ask about attendance, performance, recruitment, risk or approvals…"
                disabled={ask.isPending}
                className="min-h-[3rem] flex-1 resize-none"
              />
              <Button
                type="button"
                size="icon"
                variant={listening ? "default" : "outline"}
                aria-label={listening ? "Stop voice input" : requesting ? "Requesting microphone access" : "Start voice input"}
                aria-pressed={listening}
                title={
                  listening
                    ? "Stop voice input"
                    : requesting
                      ? "Waiting for microphone access…"
                      : speechSupported
                        ? "Start voice input"
                        : "Voice input not supported in this browser"
                }
                disabled={requesting || !speechSupported || ask.isPending}
                onClick={toggleMic}
                className={listening ? "animate-pulse" : undefined}
              >
                <Mic className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button type="submit" size="icon" disabled={ask.isPending || !question.trim()} aria-label="Send question">
                {ask.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Answers respect your role permissions and never invent values. Unsupported questions return an
              insufficient-data response.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Voice is converted to text for this question. Audio is not stored.
            </p>
            <p className="sr-only" role="status" aria-live="polite">
              {voiceAnnounce}
            </p>
          </form>
        </section>
      </div>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear all conversation history?"
        description="Every conversation and message you created with Ask HR Signal will be permanently removed. This cannot be undone."
        confirmLabel="Clear history"
        destructive
        busy={clearHistory.isPending}
        onConfirm={() => clearHistory.mutate()}
      />

      <p className="text-xs text-muted-foreground">
        <ToneBadge tone="neutral">Grounded with Qwen</ToneBadge> Answers are built from verified records in your own
        database; Qwen explains only from that evidence and never invents values. Unsupported questions return an
        insufficient-data response.
      </p>
    </div>
  );
}
