import type { TradeReviewContent } from "./schema";

// The review discussion's shapes and limits, with no server imports, so the
// browser can use them (thread.ts holds the reads, writes and prompt).

/** Messages a thread may hold (both sides). Long enough to argue a trade out. */
export const MAX_THREAD_MESSAGES = 30;
/** One message from the trader. */
export const MAX_MESSAGE_CHARS = 2_000;

export const VERDICTS = ["convinced", "partly", "not_convinced"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface ReviewMessage {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  verdict: Verdict | null;
  version_after: number | null;
  created_at: string;
}

export interface ReviewVersion {
  version: number;
  content: TradeReviewContent;
  provider: string;
  model: string;
  changed_because: string | null;
  created_at: string;
}

export interface ReviewThread {
  /** False until 0071 is applied: the panel then hides the thread. */
  available: boolean;
  messages: ReviewMessage[];
  /** Oldest first. Empty until the review is first revised. */
  versions: ReviewVersion[];
}
