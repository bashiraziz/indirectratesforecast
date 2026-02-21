"use client";

import { useRef, useState } from "react";
import { Send } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }

  async function handleSubmit() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: "user", content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setStreaming(true);
    scrollToBottom();

    // Add a placeholder assistant message
    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages([...updated, assistantMsg]);

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        setMessages([
          ...updated,
          { role: "assistant", content: `Error: ${err}` },
        ]);
        setStreaming(false);
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        setMessages([
          ...updated,
          { role: "assistant", content: "Error: No response stream" },
        ]);
        setStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages([
          ...updated,
          { role: "assistant", content: accumulated },
        ]);
        scrollToBottom();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages([
        ...updated,
        { role: "assistant", content: `Error: ${msg}` },
      ]);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col h-[620px] border border-border rounded-lg overflow-hidden bg-card">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-muted-foreground text-sm text-center py-8">
            Ask a question about indirect rates, pool structures, or cost
            forecasting.
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-primary/20 text-primary"
                  : "bg-accent text-foreground"
              }`}
            >
              {msg.content || (streaming && i === messages.length - 1 ? (
                <span className="text-muted-foreground italic">Thinking...</span>
              ) : null)}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 flex items-center gap-2">
        <input
          className="flex-1 text-sm px-3 py-2 rounded-md border border-input bg-background"
          placeholder="Ask about rates, pools, cascading..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSubmit()}
          disabled={streaming}
        />
        <button
          onClick={handleSubmit}
          disabled={streaming || !input.trim()}
          className="px-3 py-2 rounded-md flex items-center gap-1 text-sm"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
