export const CUSTOMER_RESPONSE_DELAY_MS = 300;
export const ASSISTANT_ECHO_GUARD_MS = 1200;
export const USER_TURN_RESPONSE_TIMEOUT_MS = 2500;
export const AI_RESPONSE_STUCK_TIMEOUT_MS = 15000;
export const MAX_FALLBACK_PROMPT_COUNT = 1;
export const GREETING_START_DELAY_MS = 500;
export const GREETING_STUCK_TIMEOUT_MS = 12000;
export const GREETING_MAX_RETRY = 1;

export type VoiceGuardSnapshot = {
  isGreetingInProgress: boolean;
  isAssistantSpeaking: boolean;
  isAssistantAudioPlaying: boolean;
  isResponseInProgress: boolean;
  assistantEchoGuardUntil: number;
  lastAssistantFinishedAt: number;
  lastProcessedTranscript: string;
  lastAssistantText: string;
};

export function isAssistantTurnActive(snapshot: Pick<VoiceGuardSnapshot, "isGreetingInProgress" | "isAssistantSpeaking" | "isAssistantAudioPlaying" | "isResponseInProgress">) {
  return snapshot.isGreetingInProgress || snapshot.isAssistantSpeaking || snapshot.isAssistantAudioPlaying || snapshot.isResponseInProgress;
}

export function isInsideAssistantEchoGuard(snapshot: Pick<VoiceGuardSnapshot, "assistantEchoGuardUntil" | "lastAssistantFinishedAt">) {
  return Date.now() < snapshot.assistantEchoGuardUntil || Date.now() - snapshot.lastAssistantFinishedAt < ASSISTANT_ECHO_GUARD_MS;
}

export function shouldIgnoreRealtimeInput(snapshot: VoiceGuardSnapshot) {
  return isAssistantTurnActive(snapshot) || isInsideAssistantEchoGuard(snapshot);
}

export function isProbablyForeignNoise(text: string) {
  return /[ぁ-ゟ゠-ヿ]|allora|sie hat|karete|sinha|です|ます|あなた/i.test(text);
}

export function isValidFinalTranscript(
  text: string,
  snapshot: VoiceGuardSnapshot,
  allowShortContextSlot: boolean,
  isNoiseLike: (value: string) => boolean,
  isAssistantEcho: (value: string, lastAssistantText?: string) => boolean
) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (shouldIgnoreRealtimeInput(snapshot)) return false;
  if (allowShortContextSlot) return true;
  if (normalized.length < 3) return false;
  if (normalized === snapshot.lastProcessedTranscript) return false;
  if (isProbablyForeignNoise(normalized) && normalized.length < 24) return false;
  if (isNoiseLike(normalized) || isAssistantEcho(normalized, snapshot.lastAssistantText)) return false;
  return true;
}
