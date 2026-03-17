import { watch, readFileSync, unlinkSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface OutboxSendPayload {
  type: "send";
  to: string;
  text: string;
  task?: string;
  channel?: string;
}

export interface OutboxReplyPayload {
  type: "reply";
  phone: string;
  text: string;
}

type OutboxPayload = OutboxSendPayload | OutboxReplyPayload;

/**
 * Watch an outbox directory for JSON files. When a file appears,
 * read it, dispatch to the appropriate handler, then delete it.
 * Includes a polling fallback for platforms where fs.watch is unreliable.
 */
export function startOutboxWatcher(
  outboxDir: string,
  onSend: (payload: OutboxSendPayload) => Promise<void>,
  onReply: (payload: OutboxReplyPayload) => Promise<void>,
): () => void {
  mkdirSync(outboxDir, { recursive: true });

  const processFile = async (filename: string) => {
    if (!filename.endsWith(".json")) {
      return;
    }
    const filepath = join(outboxDir, filename);
    try {
      const raw = readFileSync(filepath, "utf-8");
      const payload: OutboxPayload = JSON.parse(raw);
      if (payload.type === "send") {
        await onSend(payload);
      } else if (payload.type === "reply") {
        await onReply(payload);
      }
      unlinkSync(filepath);
    } catch (err) {
      console.error(`[outbox] Failed to process ${filename}:`, err);
      // Move to .failed so we don't retry forever
      try {
        const { renameSync } = await import("node:fs");
        renameSync(filepath, filepath + ".failed");
      } catch {}
    }
  };

  // Process any existing files on startup
  try {
    for (const file of readdirSync(outboxDir)) {
      void processFile(file);
    }
  } catch {}

  // fs.watch for real-time notification
  const watcher = watch(outboxDir, (_, filename) => {
    if (filename) {
      void processFile(filename);
    }
  });

  // Polling fallback (Linux fs.watch can miss events)
  const pollInterval = setInterval(() => {
    try {
      for (const file of readdirSync(outboxDir)) {
        if (file.endsWith(".json")) {
          void processFile(file);
        }
      }
    } catch {}
  }, 5000);

  // Return cleanup function
  return () => {
    watcher.close();
    clearInterval(pollInterval);
  };
}
