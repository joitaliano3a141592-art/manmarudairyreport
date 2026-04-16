const TEAMS_AUTH_PENDING_KEY = "teams-auth-pending";
const TEAMS_SESSION_READY_KEY = "teams-session-ready";
export const TEAMS_SESSION_READY_EVENT = "teams-session-ready";

function canUseLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: string): void {
  if (!canUseLocalStorage()) return;
  window.localStorage.setItem(key, value);
}

function clearFlag(key: string): void {
  if (!canUseLocalStorage()) return;
  window.localStorage.removeItem(key);
}

function readFlag(key: string): string | null {
  if (!canUseLocalStorage()) return null;
  return window.localStorage.getItem(key);
}

export function markTeamsAuthPending(): void {
  writeFlag(TEAMS_AUTH_PENDING_KEY, String(Date.now()));
}

export function clearTeamsAuthPending(): void {
  clearFlag(TEAMS_AUTH_PENDING_KEY);
}

export function hasTeamsAuthPending(): boolean {
  return readFlag(TEAMS_AUTH_PENDING_KEY) !== null;
}

export function markTeamsSessionReady(): void {
  const timestamp = String(Date.now());
  writeFlag(TEAMS_SESSION_READY_KEY, timestamp);
  window.dispatchEvent(new CustomEvent(TEAMS_SESSION_READY_EVENT, { detail: timestamp }));
}

export function clearTeamsSessionReady(): void {
  clearFlag(TEAMS_SESSION_READY_KEY);
}

export function hasTeamsSessionReady(): boolean {
  return readFlag(TEAMS_SESSION_READY_KEY) !== null;
}