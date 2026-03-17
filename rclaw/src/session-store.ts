import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const DEFAULT_STORE_PATH = join(homedir(), ".rclaw", "sessions.json");

let storePath = DEFAULT_STORE_PATH;

/** Override the store path (for testing). */
export function setStorePath(path: string): void {
  storePath = path;
}

/** Reset to default store path. */
export function resetStorePath(): void {
  storePath = DEFAULT_STORE_PATH;
}

export function loadSessions(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(storePath, "utf-8"));
  } catch {
    return {};
  }
}

export function saveSession(key: string, sessionId: string): void {
  const sessions = loadSessions();
  sessions[key] = sessionId;
  atomicWrite(storePath, JSON.stringify(sessions, null, 2));
}

export function removeSession(key: string): void {
  const sessions = loadSessions();
  delete sessions[key];
  atomicWrite(storePath, JSON.stringify(sessions, null, 2));
}

function atomicWrite(path: string, data: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
