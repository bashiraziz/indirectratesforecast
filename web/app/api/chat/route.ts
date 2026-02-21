export const runtime = "nodejs";

import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_PROMPT = `You are a GovCon indirect rate analyst assistant. You help users understand indirect cost rates (Fringe, Overhead, G&A) for government contractors.

Key concepts:
- Rate = Pool Costs (numerator) / Allocation Base (denominator)
- Bases: DL (Direct Labor $), TL (Total Labor $ = DL), TCI (DL + Subk + ODC + Travel), DLH (Direct Labor Hours)
- Rates cascade in DCAA-proper accounting: Fringe applied first (on raw directs), OH second (base includes Fringe$), G&A last (base includes all prior indirect$)
- Example: DL=$100K, Subk=$50K, Fringe=25%, OH=10%, G&A=15%
  - Fringe$ = $100K × 25% = $25K
  - OH$ = ($100K + $25K) × 10% = $12.5K
  - G&A$ = ($150K + $25K + $12.5K) × 15% = $28.125K
  - LoadedCost$ = $150K + $25K + $12.5K + $28.125K = $215.625K

Answer questions about rate calculations, pool structures, scenario impacts, and forecast methodology. Keep answers concise and specific to government contracting indirect rates.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Missing GEMINI_API_KEY environment variable" },
      { status: 500 },
    );
  }

  let messages: ChatMessage[];
  try {
    const body = await req.json();
    messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "Request body must include a non-empty messages array" },
        { status: 400 },
      );
    }
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: SYSTEM_PROMPT,
  });

  // Build chat history (all messages except the last user message)
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastMessage = messages[messages.length - 1].content;

  const chat = model.startChat({ history });

  try {
    const result = await chat.sendMessageStream(lastMessage);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Gemini API error";
    return Response.json({ error: message }, { status: 502 });
  }
}
