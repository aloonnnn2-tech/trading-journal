/**
 * The Ask benchmark: about twenty real trader questions, each scored on
 * whether the answer states the right facts, computed from the journal by
 * the app's own functions (src/lib/ai-keys/bench).
 *
 * DEV PROJECT ONLY. It seeds a throwaway journal there (scripts/seed-fake-data.mjs)
 * unless given one with --email/--password. Never the live project, never the
 * demo account.
 *
 *   npm run ask:bench
 *     No key. Replays a good tool path for every question through the real
 *     executor, at the paid AND the free-tier output budget, and checks each
 *     fact is reachable -- i.e. Ask's tools give the same numbers the pages
 *     show, and still do after a free tier's truncation.
 *
 *   npm run ask:bench -- --live groq [--model openai/gpt-oss-20b] [--only total_pl,mae_mfe] [--pause 20]
 *     Real turns through runTurn with the key in GROQ_API_KEY (or the
 *     provider's variable below), scoring each final answer. Prints a pass
 *     rate for that provider/model. Costs the key's own tokens; free tiers
 *     have per-minute limits, hence the pause between questions.
 *
 *   --email you@dev.test --password ...   reuse a dev account instead of seeding a new one.
 */
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadDevProject } from "../../src/lib/env/dev-project";
import { BENCH, factsFor, type BenchQuestion } from "../../src/lib/ai-keys/bench/questions";
import { loadBenchJournal, type BenchJournal } from "../../src/lib/ai-keys/bench/journal";
import { scoreAnswer, type QuestionScore } from "../../src/lib/ai-keys/bench/score";
import { TradeStore, makeToolExecutor, toolDefsFor } from "../../src/lib/ai-keys/tools";
import { tierPolicyFor } from "../../src/lib/ai-keys/tier";
import { buildToolOverview, buildToolSystemPrompt } from "../../src/lib/ai-keys/context";
import { getProvider } from "../../src/lib/ai-keys/providers";
import { chooseModel } from "../../src/lib/ai-keys/providers/model-check";
import { AI_PROVIDERS, type AIProviderName } from "../../src/lib/ai-keys/types";
import { runTurn } from "../../src/lib/chat/turn";
import { computeExcursions } from "../../src/lib/excursions/queries";
import type { ChatStreamEvent } from "../../src/lib/chat/protocol";

const KEY_ENV: Record<AIProviderName, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  mistral: "MISTRAL_API_KEY",
  sambanova: "SAMBANOVA_API_KEY",
  github: "GITHUB_MODELS_TOKEN",
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// tsx runs this as CommonJS, which has no top-level await.
void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

async function main() {
  const dev = loadDevProject(process.cwd());
  console.log("Dev project:", dev.host);
  const supabase = createClient(dev.url, dev.anonKey, { auth: { persistSession: false } });

  let email = arg("email");
  let password = arg("password");
  if (!email || !password) {
    console.log("Seeding a throwaway dev journal...");
    const out = execFileSync(process.execPath, ["--import", "tsx", "scripts/seed-fake-data.mjs"], { encoding: "utf8" });
    email = /email:\s+(\S+)/.exec(out)?.[1];
    password = /password:\s+(\S+)/.exec(out)?.[1];
    if (!email || !password) throw new Error("Couldn't read the seeded account from seed-fake-data's output.");
    console.log(`  ${email}  (reuse with --email ${email} --password ${password})`);
  }
  const { data: auth, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !auth.user) throw error ?? new Error("sign-in failed");
  const userId = auth.user.id;

  const { data: settings } = await supabase.from("user_settings").select("timezone").maybeSingle();
  const timezone = (settings as { timezone?: string | null } | null)?.timezone ?? null;
  // What the MAE/MFE panel's Compute button does; without it a fresh journal
  // has no excursions and those questions have nothing to check.
  try {
    const ex = await computeExcursions(supabase, userId);
    console.log(`Excursions computed for ${ex.computed} of ${ex.tradesConsidered} closed trades.`);
  } catch (err) {
    console.log(`Excursions not computed (${err instanceof Error ? err.message : err}); MAE/MFE questions will be skipped.`);
  }
  const journal = await loadBenchJournal(supabase, timezone);

  const only = arg("only")?.split(",");
  const questions = only ? BENCH.filter((q) => only.includes(q.id)) : BENCH;

  const live = arg("live");
  if (live) {
    if (!(AI_PROVIDERS as readonly string[]).includes(live)) throw new Error(`Unknown provider "${live}".`);
    await runLive(supabase, userId, timezone, journal, questions, live as AIProviderName);
  } else {
    await runReachability(supabase, timezone, journal, questions);
  }
}

// ---- no key: are the facts reachable through the tools? ----------------------

async function runReachability(
  supabase: SupabaseClient,
  timezone: string | null,
  journal: BenchJournal,
  questions: BenchQuestion[],
) {
  let failed = false;
  for (const [tier, budget] of [
    ["paid", tierPolicyFor("openai").maxToolOutputChars],
    ["free", tierPolicyFor("groq").maxToolOutputChars],
  ] as const) {
    console.log(`\n== Facts reachable through the tools (${tier} output budget, ${budget} chars)`);
    let passed = 0;
    for (const q of questions) {
      const execute = makeToolExecutor(supabase, timezone, new TradeStore(supabase, timezone), budget);
      const outputs = await Promise.all(q.calls.map((c) => execute(c)));
      const facts = factsFor(q, journal);
      const score = scoreAnswer(facts, outputs.join("\n"), [], null);
      const errors = outputs.filter((o) => o.startsWith('{"error"'));
      const ok = score.pass && errors.length === 0;
      if (ok) passed++;
      else if (!q.needsNetwork) failed = true;
      print(q, ok, score, facts.length, errors.length ? `tool error: ${errors.join(" ").slice(0, 160)}` : "");
    }
    console.log(`${passed}/${questions.length} reachable`);
  }
  if (failed) process.exit(1);
}

// ---- with a key: does the model actually answer right? -----------------------

async function runLive(
  supabase: SupabaseClient,
  userId: string,
  timezone: string | null,
  journal: BenchJournal,
  questions: BenchQuestion[],
  providerName: AIProviderName,
) {
  const key = process.env[KEY_ENV[providerName]];
  if (!key) throw new Error(`Set ${KEY_ENV[providerName]} to run the live benchmark for ${providerName}.`);
  const provider = getProvider(providerName);
  const check = await provider.validateKey(key);
  if (!check.valid) throw new Error(`${KEY_ENV[providerName]} was rejected by ${providerName}.`);
  const model = arg("model") ?? chooseModel(providerName, check.models);
  if (!model) throw new Error(`None of this app's ${providerName} models is on the key's list.`);

  const policy = tierPolicyFor(providerName);
  const pauseMs = Number(arg("pause") ?? (policy.autoRounds <= 3 ? 20 : 2)) * 1000;
  const system = buildToolSystemPrompt(await buildToolOverview(supabase, timezone));
  console.log(`\n== Live: ${providerName} / ${model} (${policy.autoRounds} lookups per question)`);

  let passed = 0;
  for (const q of questions) {
    const { data: conv, error } = await supabase
      .from("ai_conversations")
      .insert({ user_id: userId, provider: providerName, model, key_id: null })
      .select("id")
      .single();
    if (error) throw error;
    const conversationId = (conv as { id: string }).id;

    const used: string[] = [];
    let answer = "";
    let failure = "";
    const execute = makeToolExecutor(supabase, timezone, new TradeStore(supabase, timezone), policy.maxToolOutputChars);
    for (let request = 0; request < 15; request++) {
      let next: "idle" | "continue" | null = null;
      let text = "";
      const emit = (e: ChatStreamEvent) => {
        if (e.type === "tool_call") used.push(e.call.name);
        if (e.type === "message_start") text = "";
        if (e.type === "text_delta") text += e.text;
        if (e.type === "message_end" && e.stopReason === "text") answer = text;
        if (e.type === "done") next = e.next;
        if (e.type === "error") failure = `${e.code}: ${e.message}`;
      };
      await runTurn(
        {
          supabase,
          userId,
          conversationId,
          provider,
          apiKey: key,
          model,
          policy,
          system,
          tools: toolDefsFor(policy),
          execute,
          maxTokens: policy.maxAnswerTokens,
          deadline: Date.now() + 55_000,
          newMessage: request === 0 ? q.question : undefined,
        },
        emit,
      );
      if (failure || next !== "continue") break;
    }
    await supabase.from("ai_conversations").delete().eq("id", conversationId);

    const facts = factsFor(q, journal);
    const score = scoreAnswer(facts, answer, q.tools, used);
    if (score.pass && !failure) passed++;
    print(q, score.pass && !failure, score, facts.length, failure || `tools: ${used.join(", ") || "none"}`);
    if (process.argv.includes("--verbose")) console.log(`     answer: ${answer.replace(/\s+/g, " ").slice(0, 600)}`);
    await new Promise((r) => setTimeout(r, pauseMs));
  }
  console.log(`\n${passed}/${questions.length} answered right (${Math.round((100 * passed) / questions.length)}%) on ${providerName} / ${model}`);
}

function print(q: BenchQuestion, ok: boolean, score: QuestionScore, factCount: number, note: string) {
  const mark = ok ? "ok  " : q.needsNetwork ? "net?" : "FAIL";
  const facts = factCount === 0 ? "no facts in this journal" : score.missing.length ? `missing ${score.missing.join("; ")}` : `${factCount} facts`;
  console.log(`${mark} ${q.id.padEnd(15)} ${facts}${note ? `  | ${note}` : ""}`);
}
