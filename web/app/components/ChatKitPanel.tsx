"use client";

import { ChatKit, useChatKit } from "@openai/chatkit-react";
import { useMemo } from "react";

export function ChatKitPanel() {
  const getClientSecret = useMemo(() => {
    return async (existing: string | null) => {
      if (existing) return existing;
      const res = await fetch("/api/chatkit/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await res.json().catch(() => ({}))) as { client_secret?: string; error?: string };
      if (!res.ok) throw new Error(payload.error || `Session error: HTTP ${res.status}`);
      if (!payload.client_secret) throw new Error("Missing client_secret");
      return payload.client_secret;
    };
  }, []);

  const chatkit = useChatKit({
    api: { getClientSecret },
    header: { title: { text: "GovCon Rate Analyst" } },
  });

  return <ChatKit control={chatkit.control} className="h-[620px] w-full" />;
}
