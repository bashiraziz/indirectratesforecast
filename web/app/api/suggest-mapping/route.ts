export const runtime = "nodejs";

import { GoogleGenerativeAI } from "@google/generative-ai";

interface AccountInput {
  account: string;
  name: string;
  category: string;
}

interface PoolInput {
  id: number;
  name: string;
  base: string;
  cascade_order: number;
}

export interface MappingSuggestion {
  account: string;
  suggested_pool_id: number;    // -1 if no confident match
  suggested_pool_name: string;
  is_unallowable: boolean;
  reason: string;
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Missing GEMINI_API_KEY environment variable" },
      { status: 500 },
    );
  }

  let accounts: AccountInput[];
  let pools: PoolInput[];
  try {
    const body = await req.json();
    accounts = body.accounts;
    pools = body.pools;
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return Response.json({ error: "accounts must be a non-empty array" }, { status: 400 });
    }
    if (!Array.isArray(pools) || pools.length === 0) {
      return Response.json({ error: "pools must be a non-empty array" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = `You are a DCAA GovCon cost accountant classifying GL accounts into indirect cost pools.

Available cost pools (use exact pool IDs in your response):
${JSON.stringify(pools, null, 2)}

GL accounts to classify:
${JSON.stringify(accounts, null, 2)}

Rules:
- Assign each account to exactly ONE pool from the list above using its "id" field.
- If the account clearly does not fit any pool (e.g., revenue, capital assets), set suggested_pool_id to -1.
- If an account is unallowable under FAR 31.205 (e.g., entertainment, alcohol, lobbying, fines, advertising not allowed under FAR), set is_unallowable to true. Unallowable accounts should still be assigned to their most appropriate pool (or -1 if none fits) so they can be tracked.
- Keep reason brief (5-10 words).

Respond with a JSON array only, no markdown, no extra text:
[
  {
    "account": "<account number>",
    "suggested_pool_id": <number or -1>,
    "suggested_pool_name": "<pool name or 'None'>",
    "is_unallowable": <true|false>,
    "reason": "<brief reason>"
  },
  ...
]`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    let suggestions: MappingSuggestion[];
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Expected array");
      // Validate and normalize each entry
      suggestions = parsed.map((item: Record<string, unknown>) => ({
        account: String(item.account ?? ""),
        suggested_pool_id: typeof item.suggested_pool_id === "number" ? item.suggested_pool_id : -1,
        suggested_pool_name: String(item.suggested_pool_name ?? "None"),
        is_unallowable: Boolean(item.is_unallowable),
        reason: String(item.reason ?? ""),
      }));
    } catch {
      // Fallback: return all as no-match
      suggestions = accounts.map((a) => ({
        account: a.account,
        suggested_pool_id: -1,
        suggested_pool_name: "None",
        is_unallowable: false,
        reason: "Parse error",
      }));
    }

    return Response.json(suggestions);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gemini API error";
    return Response.json({ error: message }, { status: 502 });
  }
}
