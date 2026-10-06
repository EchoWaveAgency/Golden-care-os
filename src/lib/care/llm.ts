import "server-only";
import type { Intent } from "./nlu";
import type { Hint } from "./engine";

// Optional second opinion from a language model when the rules cannot understand a free-text reply.
// Off unless ANTHROPIC_API_KEY is set AND CARE_LLM=on. Only the patient's reply text and the list of
// allowed answers are sent — no name, phone number or record from our side — but the reply itself may contain
// health details or names the patient typed, so turning this on needs the clinic's sign-off and a data processing
// agreement (OPEN_QUESTIONS). The model can only pick one of the allowed answers or flag urgency; it never writes
// what the assistant says and can never lower urgency found by the rules.
export function llmEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.CARE_LLM === "on";
}

const SYSTEM = `You classify one short reply from a patient of an Egyptian outpatient clinic, written in Egyptian Arabic or English.
Return only JSON: {"intent": "<one of the allowed intents or unknown>", "urgent": <true|false>}.
"urgent" is true only when the reply describes possible danger now: breathing difficulty, chest pain, heavy bleeding, fainting,
seizure, face/lip/throat swelling, very high fever, sudden weakness or numbness, severe pain, or any thought of self-harm.
Do not explain. Do not add any other text.`;

export async function classifyWithModel(text: string, allowed: Intent[]): Promise<Hint | null> {
  if (!llmEnabled() || !text.trim()) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.CARE_LLM_MODEL ?? "claude-haiku-4-5-20251001",
        max_tokens: 60,
        system: SYSTEM,
        messages: [{ role: "user", content: `Allowed intents: ${allowed.join(", ")}\nPatient reply: """${text.slice(0, 500)}"""` }],
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const raw = json.content?.find((c) => c.type === "text")?.text ?? "";
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { intent?: string; urgent?: boolean };
    const intent = allowed.includes(parsed.intent as Intent) ? (parsed.intent as Intent) : undefined;
    return { intent, urgent: parsed.urgent === true };
  } catch {
    return null; // the rules alone decide
  }
}
