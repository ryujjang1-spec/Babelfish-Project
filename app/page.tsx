"use client";

import {
  analyzeRequest,
  isAssistantEcho,
  isNoiseLikeTranscript,
  normalizePlaceCandidate,
  type ConciergeAnalysis,
  type OrderStatus,
  type ServiceSlots
} from "../shared";
import { DEMO_SUCCESS_DELAY_MS, standbyMessage } from "../serviceStateMachine";
import {
  AI_RESPONSE_STUCK_TIMEOUT_MS,
  ASSISTANT_ECHO_GUARD_MS,
  GREETING_MAX_RETRY,
  GREETING_START_DELAY_MS,
  GREETING_STUCK_TIMEOUT_MS,
  MAX_FALLBACK_PROMPT_COUNT,
  USER_TURN_RESPONSE_TIMEOUT_MS,
  isAssistantTurnActive as guardIsAssistantTurnActive,
  isInsideAssistantEchoGuard as guardIsInsideAssistantEchoGuard,
  isProbablyForeignNoise,
  isValidFinalTranscript
} from "../voiceGuard";
import { CircleStop, Mic, Phone, Send } from "lucide-react";
import { useMemo, useRef, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const SERVICE_NAME = "Babelfish_온디멘드 컨시어지";
const DISPLAY_BRAND_NAME = "Babelfish";
const SPOKEN_BRAND_NAME = "바벨피시";
const AI_NAME = DISPLAY_BRAND_NAME;
const FOLLOWUP_PROMPT = "이어서 처리할 다른 요청이 있으시면 바로 말씀해 주세요. 없으시면 종료하겠다고 말씀해 주세요.";
const SCRIPT_TEMPLATES = {
  confirmRetry: "다시 확인하겠습니다. 변경하실 내용을 말씀해 주세요.",
  confirmPrompt: "확인해 주시면 진행하겠습니다.",
  followupGuide: "이어서 처리할 요청을 말씀해 주세요. 없으시면 종료하겠다고 말씀해 주세요.",
  followupIdleReminder: "추가 요청이 없으시면 통화를 종료하겠습니다. 필요하신 내용이 있으면 지금 말씀해 주세요.",
  noSpeechFirst: "말씀이 확인되지 않았습니다. 다시 말씀해 주세요.",
  noSpeechRepeat: "말씀이 잘 들리지 않았습니다. 원하시는 서비스명만 다시 말씀해 주세요.",
  noSpeechVoice: "죄송합니다. 말씀이 잘 들리지 않았습니다. 다시 한 번 말씀해 주세요.",
  unclearFirst: "말씀하신 내용 파악이 어려웠습니다. 다시 말씀해 주세요.",
  unclearRepeat: "말씀하신 내용을 다시 확인하겠습니다. 원하시는 서비스와 장소를 한 번만 더 말씀해 주세요.",
  unsupportedLanguage: "죄송합니다. 말씀을 정확히 파악하지 못했습니다. 한국어, 영어 또는 일본어로 다시 말씀해 주세요.",
  noiseRetry: "죄송합니다. 말씀이 정확히 들리지 않았습니다. 다시 한 번 말씀해 주세요.",
  completedLocked: "통화를 종료하는 중입니다.",
  recall: "다시 호출해 주셔서 감사합니다. 추가로 필요한 서비스를 말씀해 주세요.",
  operatorTransferHint: "수기 접수 대기 상태입니다. 접수 맥락을 함께 전달했습니다.",
  waitingForCustomer: "고객 말씀을 다시 기다리고 있습니다.",
  initialGreetingHint: "AI 첫 인사 후 자동으로 고객 말씀 대기 상태가 됩니다.",
  standbyHint: "서비스 대기 중입니다.",
  autoListenHint: "고객 말씀을 기다리고 있습니다.",
  manualListenHint: "말씀하신 뒤 다시 확인을 시작하세요.",
  autoWaitingHint: "고객 말씀을 기다리고 있습니다.",
  manualAnalyzingHint: "고객 말씀을 확인하고 있습니다.",
  assistantTurnPausedHint: "AI 응답 중에는 고객 말씀 분석을 잠시 중지합니다.",
  manualModeHint: "수동 말하기 모드입니다. 필요할 때 화면의 말하기 컨트롤로 다시 말씀해 주세요.",
  autoModeHint: "자연 대화 모드입니다. 버튼을 누르지 않아도 말씀하실 수 있습니다.",
  unsupportedLanguageHint: "한국어, 영어 또는 일본어로 다시 말씀해 주세요.",
  noiseHint: "다시 한 번 또렷하게 말씀해 주세요.",
  operatorHandoffHint: "상담원에게 이관합니다. 인식 실패 맥락을 함께 전달했습니다."
} as const;
const DEMO_SCRIPTS = {
  greeting: "안녕하세요, 바벨피시입니다. 제휴 서비스와 연결해 실행까지 도와드리겠습니다. 원하시는 내용을 말씀해 주세요.",
  start: {
    taxi: "아이나비 M 택시를 호출하겠습니다. 출발지와 도착지를 말씀해 주세요.",
    hospital_reservation: "바벨피시 제휴 병원으로 확인 해드릴께요. 진료과와 지역, 희망 일시를 말씀해 주세요.",
    car_maintenance: "바벨피시 제휴 자동차 서비스 업체로 연결해드리겠습니다. 차량 증상과 지역을 말씀해 주세요.",
    car_inspection: "바벨피시 제휴 검사소로 연결해드리겠습니다. 차량 정보와 검사 지역, 희망 일시를 말씀해 주세요.",
    blackbox_installation: "아이나비 블랙박스 장착 서비스를 연결해드리겠습니다. 차량 종류와 장착 지역을 말씀해 주세요.",
    tinting_installation: "프리미엄 칼트윈 틴팅 시공 서비스를 연결해드리겠습니다. 차량 종류와 시공 지역을 말씀해 주세요.",
    product_purchase: "바벨피시 제휴 업체를 통해 구매를 도와드리겠습니다. 상품명과 수량을 말씀해 주세요.",
    unknown: "원하시는 서비스를 말씀해 주세요."
  },
  checking: {
    taxi: "아이나비 M 택시 배차 가능 여부를 확인 중입니다. 바로 결과를 안내드리겠습니다.",
    hospital_reservation: "바벨피시 제휴 병원 예약 가능 여부를 확인 중입니다. 바로 결과를 안내드리겠습니다.",
    car_maintenance: "바벨피시 제휴 자동차 서비스 업체 예약 가능 여부를 확인 중입니다. 바로 결과를 안내드리겠습니다.",
    car_inspection: "바벨피시 제휴 검사소 예약 가능 여부를 확인 중입니다. 바로 결과를 안내드리겠습니다.",
    blackbox_installation: "아이나비 블랙박스 장착 가능 여부를 확인 중입니다. 바로 결과를 안내드리겠습니다.",
    tinting_installation: "칼트윈 틴팅 시공 가능 여부를 확인 중입니다. 바로 결과를 안내드리겠습니다.",
    product_purchase: "바벨피시 제휴 협력사 구매 가능 여부를 확인 중입니다. 바로 결과를 안내드리겠습니다.",
    unknown: "바벨피시 제휴 서비스 연결 가능 여부를 확인 중입니다. 바로 결과를 안내드리겠습니다."
  },
  success: {
    taxi: `아이나비 M 택시 배차 요청이 성공적으로 접수되었습니다. ${FOLLOWUP_PROMPT}`,
    hospital_reservation: `바벨피시 제휴 병원 예약 요청이 성공적으로 접수되었습니다. ${FOLLOWUP_PROMPT}`,
    car_maintenance: `바벨피시 제휴 자동차 서비스 업체 예약 요청이 성공적으로 접수되었습니다. ${FOLLOWUP_PROMPT}`,
    car_inspection: `바벨피시 제휴 검사소 예약 요청이 성공적으로 접수되었습니다. ${FOLLOWUP_PROMPT}`,
    blackbox_installation: `아이나비 블랙박스 장착 요청이 성공적으로 접수되었습니다. ${FOLLOWUP_PROMPT}`,
    tinting_installation: `칼트윈 틴팅 시공 요청이 성공적으로 접수되었습니다. ${FOLLOWUP_PROMPT}`,
    product_purchase: `바벨피시 제휴 협력사 구매 요청이 성공적으로 접수되었습니다. ${FOLLOWUP_PROMPT}`,
    unknown: `바벨피시 제휴 서비스 요청이 성공적으로 접수되었습니다. ${FOLLOWUP_PROMPT}`
  },
  end: "종료하겠습니다. 언제든지 필요하실 때 불러주세요. 이용해 주셔서 감사합니다."
} as const;
const FIRST_MESSAGE = DEMO_SCRIPTS.greeting;
const API_REQUEST_TIMEOUT_MS = 10000;
const STT_TURN_MERGE_WAIT_MS = 650;
const STT_SLOT_READY_WAIT_MS = 250;
const FOLLOWUP_IDLE_TIMEOUT_MS = 8000;
const FOLLOWUP_FINAL_TIMEOUT_MS = 15000;

type AppStatus =
  | "AI READY"
  | "CONNECTING"
  | "GREETING"
  | "AI SPEAKING"
  | "LISTENING"
  | "ANALYZING"
  | "BUILDING PLAN"
  | "UNSUPPORTED LANGUAGE"
  | "NO SPEECH"
  | "UNCLEAR SPEECH"
  | "ECHO GUARD"
  | "SERVER ERROR";

type VoiceState =
  | "대기 중"
  | "고객 말씀 대기 중"
  | "듣는 중"
  | "고객 말씀 확인 중"
  | "말씀 미확인"
  | "소음 무시"
  | "AI 응답 중"
  | "에코 차단 중"
  | "다시 말씀 필요"
  | "완료";

type LogEntry = {
  id: string;
  role: "system" | "user" | "assistant" | "event";
  text: string;
};

type ServiceStatus =
  | "idle"
  | "listening"
  | "analyzing"
  | "waiting_confirmation"
  | "waiting_detail"
  | "ready_for_approval"
  | "checking"
  | "submitted"
  | "completed"
  | "followup_listening"
  | "standby"
  | "feedback_pending"
  | "operator_transfer";

type DemoPhase =
  | "idle"
  | "greeting"
  | "collecting"
  | "confirming"
  | "checking"
  | "completed"
  | "followup_listening"
  | "ending";

type DemoConfirmationStep = "content" | "proceed";

type DemoServiceType =
  | "taxi"
  | "hospital_reservation"
  | "car_maintenance"
  | "car_inspection"
  | "blackbox_installation"
  | "tinting_installation"
  | "product_purchase"
  | "family_mobility"
  | "unknown";

type DemoScriptServiceType = keyof typeof DEMO_SCRIPTS.start;

type DemoSlots = {
  origin?: string;
  destination?: string;
  departmentOrSymptom?: string;
  location?: string;
  providerName?: string;
  appointmentDateTime?: string;
  vehicleInfo?: string;
  vehicleSymptom?: string;
  productName?: string;
  quantity?: string;
  deliveryAddress?: string;
  callTiming?: string;
  packageRequested?: boolean;
};

type DemoService = {
  id: string;
  serviceType: DemoServiceType;
  rawText: string;
  slots: DemoSlots;
};

type CustomerNextEvent =
  | "start_service"
  | "update_slots"
  | "confirm_service"
  | "restart_service"
  | "end_service"
  | "ignore";

type CustomerUtteranceAnalysis = {
  transcript: string;
  intent: DemoServiceType | "confirm" | "restart" | "end" | "unknown";
  slots: Partial<DemoSlots>;
  missing_slots: string[];
  confidence: number;
  next_event: CustomerNextEvent;
};

function sanitizeDemoSlotValue(value?: string) {
  return String(value ?? "")
    .trim()
    .replace(/[.。!?？！,，]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/(에서|부터|까지|으로|로|입니다|이에요|예요|이요|요)$/g, "")
    .trim();
}

function sanitizeDemoSlots(slots: DemoSlots): DemoSlots {
  return {
    ...slots,
    origin: sanitizeDemoSlotValue(slots.origin),
    destination: sanitizeDemoSlotValue(slots.destination),
    location: sanitizeDemoSlotValue(slots.location),
    departmentOrSymptom: sanitizeDemoSlotValue(slots.departmentOrSymptom),
    appointmentDateTime: sanitizeDemoSlotValue(slots.appointmentDateTime),
    vehicleInfo: sanitizeDemoSlotValue(slots.vehicleInfo),
    vehicleSymptom: sanitizeDemoSlotValue(slots.vehicleSymptom),
    productName: sanitizeDemoSlotValue(slots.productName),
    quantity: sanitizeDemoSlotValue(slots.quantity),
    deliveryAddress: sanitizeDemoSlotValue(slots.deliveryAddress),
    providerName: sanitizeDemoSlotValue(slots.providerName)
  };
}

type CompletedService = {
  id: string;
  serviceType: string;
  summary: string;
  orderId: string;
  completedAt?: string;
};

type OperatorTransferUrgency = "P1" | "P2" | "P3";

type OperatorTransferContext = {
  reason: string;
  failureReason: string;
  urgency: OperatorTransferUrgency;
  rawTranscript: string;
  activeService: DemoService | null;
  analysis: ConciergeAnalysis;
  slots: ServiceSlots;
  serviceStatus: ServiceStatus;
  demoPhase: DemoPhase;
  timestamp: string;
  errorMessage?: string;
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const appStatusLabels: Record<AppStatus, string> = {
  "AI READY": "AI 준비 완료",
  CONNECTING: "연결 중",
  GREETING: "첫 인사 중",
  "AI SPEAKING": "AI 응답 중",
  LISTENING: "듣는 중",
  ANALYZING: "분석 중",
  "BUILDING PLAN": "실행안 생성 중",
  "UNSUPPORTED LANGUAGE": "언어 확인 필요",
  "NO SPEECH": "말씀 미확인",
  "UNCLEAR SPEECH": "말씀 확인 필요",
  "ECHO GUARD": "에코 차단 중",
  "SERVER ERROR": "서버 오류"
};

const roleLabels: Record<LogEntry["role"], string> = {
  user: "고객",
  assistant: "Babelfish",
  system: "Babelfish",
  event: "이벤트"
};

const regionKeywords = ["수원", "성남", "분당", "판교", "강남", "서울", "송파", "잠실", "용인", "광교", "일산", "부천", "안양", "과천", "하남", "위례"];
const dateKeywords = ["오늘", "내일", "모레", "오전", "오후", "저녁", "점심", "아침", "다음 주", "이번 주"];

export default function Home() {
  const [phase, setPhase] = useState<"start" | "call" | "summary">("start");
  const [status, setStatus] = useState<OrderStatus>("idle");
  const [connection, setConnection] = useState("대기 중");
  const [appStatus, setAppStatus] = useState<AppStatus>("AI READY");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [transcript, setTranscript] = useState("");
  const transcriptRef = useRef("");
  const [assistantDraft, setAssistantDraft] = useState("");
  const assistantDraftRef = useRef("");
  const [analysis, setAnalysis] = useState<ConciergeAnalysis>(() => analyzeRequest(""));
  const [mockOrderId, setMockOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("대기 중");
  const [isPushToTalkActive, setIsPushToTalkActive] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);
  const [assistHint, setAssistHint] = useState("기본은 자동으로 듣습니다. 인식이 안 될 때만 화면의 말하기 컨트롤을 사용해 주세요.");
  const [understoodText, setUnderstoodText] = useState("");
  const [finalSummary, setFinalSummary] = useState("");
  const [serviceStatus, setServiceStatusState] = useState<ServiceStatus>("idle");
  const [demoPhase, setDemoPhaseState] = useState<DemoPhase>("idle");
  const [confirmedSlots, setConfirmedSlots] = useState<ServiceSlots>({});
  const [lastCompletedService, setLastCompletedService] = useState<CompletedService | null>(null);
  const [satisfactionState, setSatisfactionState] = useState("확인 전");
  const [demoCompletionHint, setDemoCompletionHint] = useState("");
  const [isWaitingDemoCompletion, setIsWaitingDemoCompletion] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const greetingSentRef = useRef(false);
  const hasSentGreetingRef = useRef(false);
  const isGreetingInProgressRef = useRef(false);
  const isInitialAudioReadyRef = useRef(false);
  const isDataChannelReadyRef = useRef(false);
  const isRemoteAudioReadyRef = useRef(false);
  const greetingTimeoutRef = useRef<number | null>(null);
  const greetingRetryCountRef = useRef(0);
  const lastGreetingStartedAtRef = useRef(0);
  const lastGreetingCompletedAtRef = useRef(0);
  const responseTimerRef = useRef<number | null>(null);
  const pendingResponseTimerRef = useRef<number | null>(null);
  const completionTimerRef = useRef<number | null>(null);
  const assistantEchoReleaseTimerRef = useRef<number | null>(null);
  const followupIdleTimerRef = useRef<number | null>(null);
  const completionTimerServiceIdRef = useRef<string | null>(null);
  const checkingServiceIdRef = useRef<string | null>(null);
  const completedServiceIdsRef = useRef<Set<string>>(new Set());
  const emittedAssistantMessageKeysRef = useRef<Set<string>>(new Set());
  const checkingReminderSentRef = useRef(false);
  const operatorTransferTriggeredRef = useRef(false);
  const waitingForAdditionalRequestRef = useRef(false);
  const pendingAnalysisRef = useRef<ConciergeAnalysis | null>(null);
  const lastAssistantTextRef = useRef("");
  const lastAssistantResponseMessageRef = useRef("");
  const assistantRetryCountRef = useRef(0);
  const lastAssistantStartedAtRef = useRef(0);
  const lastAssistantSpokeAtRef = useRef(0);
  const lastAssistantFinishedAtRef = useRef(0);
  const assistantEchoGuardUntilRef = useRef(0);
  const lastUserSpeechStoppedAtRef = useRef(0);
  const lastUserTranscriptAtRef = useRef(0);
  const lastAssistantMessageAtRef = useRef(0);
  const lastStateChangedAtRef = useRef(0);
  const lastValidUserTurnRef = useRef("");
  const currentAppStatusRef = useRef<AppStatus>("AI READY");
  const fallbackPromptCountRef = useRef(0);
  const watchdogTimerRef = useRef<number | null>(null);
  const lastPushToTalkAtRef = useRef(0);
  const isAssistantSpeakingRef = useRef(false);
  const isAssistantAudioPlayingRef = useRef(false);
  const isResponseInProgressRef = useRef(false);
  const userSpeakingRef = useRef(false);
  const isListeningEnabledRef = useRef(false);
  const isManualModeRef = useRef(false);
  const confirmedAnalysisRef = useRef<ConciergeAnalysis | null>(null);
  const detailNotesRef = useRef<string[]>([]);
  const remainingFieldsRef = useRef<string[]>([]);
  const noSpeechCountRef = useRef(0);
  const unclearCountRef = useRef(0);
  const noiseCountRef = useRef(0);
  const lastIgnoredTranscriptRef = useRef("");
  const lastAcceptedTranscriptRef = useRef("");
  const lastAcceptedAtRef = useRef(0);
  const latestFinalTranscriptRef = useRef("");
  const sttTurnBufferRef = useRef<string[]>([]);
  const sttLastBufferedAtRef = useRef(0);
  const sttListenerEnabledRef = useRef(false);
  const lastProcessedTranscriptRef = useRef("");
  const ignoredEchoCountRef = useRef(0);
  const expectedAssistantMessageRef = useRef("");
  const serviceStatusRef = useRef<ServiceStatus>("idle");
  const demoPhaseRef = useRef<DemoPhase>("idle");
  const activeDemoServiceRef = useRef<DemoService | null>(null);
  const demoConfirmationStepRef = useRef<DemoConfirmationStep>("content");
  const confirmedSlotsRef = useRef<ServiceSlots>({});
  const lastCompletedServiceRef = useRef<CompletedService | null>(null);
  const demoCompletedLockedRef = useRef(false);
  const completedAtRef = useRef<number | null>(null);
  const ignoreUserInputUntilRef = useRef<number>(0);
  const lastAssistantExactTextRef = useRef("");

  const sortedLogs = useMemo(() => logs.slice(-14), [logs]);

  function appendLog(role: LogEntry["role"], text: string) {
    if (!text.trim()) return;
    setLogs((current) => [...current, { id: makeId(), role, text }]);
  }

  function updateAppStatus(next: AppStatus) {
    currentAppStatusRef.current = next;
    lastStateChangedAtRef.current = Date.now();
    setAppStatus(next);
  }

  function setServiceStatus(next: ServiceStatus) {
    serviceStatusRef.current = next;
    setServiceStatusState(next);
  }

  function setDemoPhase(next: DemoPhase) {
    demoPhaseRef.current = next;
    setDemoPhaseState(next);
  }

  function normalizeDemoText(text: string) {
    return text.trim().toLowerCase().replace(/[.,!?。？！~～]/g, "").replace(/\s+/g, " ");
  }

  function toSpokenBrandName(message: string) {
    return message.replaceAll(DISPLAY_BRAND_NAME, SPOKEN_BRAND_NAME);
  }

  function getDemoScriptKey(serviceType: DemoServiceType): DemoScriptServiceType {
    return serviceType in DEMO_SCRIPTS.start ? serviceType as DemoScriptServiceType : "unknown";
  }

  function isCompletedHardLocked() {
    return demoCompletedLockedRef.current || demoPhaseRef.current === "ending";
  }

  function clearAssistantEchoReleaseTimer() {
    if (assistantEchoReleaseTimerRef.current) {
      window.clearTimeout(assistantEchoReleaseTimerRef.current);
      assistantEchoReleaseTimerRef.current = null;
    }
  }

  function clearFollowupIdleTimer() {
    if (followupIdleTimerRef.current) {
      window.clearTimeout(followupIdleTimerRef.current);
      followupIdleTimerRef.current = null;
    }
  }

  function clearSttTurn() {
    sttTurnBufferRef.current = [];
    sttLastBufferedAtRef.current = 0;
    latestFinalTranscriptRef.current = "";
  }

  function startFollowupIdleTimer() {
    clearFollowupIdleTimer();
    followupIdleTimerRef.current = window.setTimeout(() => {
      followupIdleTimerRef.current = null;
      if (demoPhaseRef.current !== "followup_listening") return;
      emitDemoAssistantExact(SCRIPT_TEMPLATES.followupIdleReminder, "followup-idle-reminder");
      followupIdleTimerRef.current = window.setTimeout(() => {
        followupIdleTimerRef.current = null;
        if (demoPhaseRef.current !== "followup_listening") return;
        enterEnding();
      }, FOLLOWUP_FINAL_TIMEOUT_MS);
    }, FOLLOWUP_IDLE_TIMEOUT_MS);
  }

  function clearPendingCustomerTurn() {
    clearPendingResponseTimer();
    clearSttTurn();
    lastValidUserTurnRef.current = "";
    pendingAnalysisRef.current = null;
    fallbackPromptCountRef.current = 0;
    userSpeakingRef.current = false;
  }

  function appendFinalTranscriptSegment(text: string) {
    const clean = normalizeSttSegment(text);
    if (!clean) return;
    sttTurnBufferRef.current.push(clean);
    sttLastBufferedAtRef.current = Date.now();
    latestFinalTranscriptRef.current = peekBufferedCustomerTurn();
  }

  function enforceCompletedHardLock(source: string) {
    sttListenerEnabledRef.current = false;
    clearDemoPendingTimers();
    clearPendingCustomerTurn();
    stopWatchdog();
    setMicrophoneEnabled(false, "completed");
    updateAppStatus("AI READY");
    setVoiceState("완료");
    console.log("[DEMO_FLOW] completed_hard_lock_enforced", { source });
  }

  function isBlockedAfterCompleted(source: string) {
    if (isCompletedHardLocked()) {
      enforceCompletedHardLock(source);
      console.log("[DEMO_FLOW] blocked_after_completed", { source });
      return true;
    }
    return false;
  }

  function cancelRealtimeModelOutput(source: string) {
    const dc = dcRef.current;
    if (source === "response.created" && dc?.readyState === "open") {
      dc.send(JSON.stringify({ type: "response.cancel" }));
    }
    isResponseInProgressRef.current = false;
    assistantDraftRef.current = "";
    setAssistantDraft("");
    console.warn("[REALTIME_SENSOR_ONLY] ignored_model_output", { source });
  }

  function isDemoPositiveIntent(text: string) {
    const normalized = normalizeDemoText(text);
    if (!normalized) return false;
    if (isDemoRestartIntent(normalized)) return false;

    return /^(네|예|응|어|그래|좋아|좋습니다|맞아|맞아요|확인|확인해줘|진행|진행해|진행해줘|해주세요|해줘|오케이|ok|ㅇㅇ)$/.test(normalized);
  }

  function isDemoRestartIntent(text: string) {
    const normalized = normalizeDemoText(text);
    return /^(아니|아니요|노|no|싫어|싫습니다|다시|다시 해줘|틀렸어|틀렸습니다|변경|바꿔줘|취소)$/.test(normalized);
  }

  function isDemoEndIntent(text: string) {
    const normalized = normalizeDemoText(text);
    return /^(종료|서비스 종료|끝|그만)$/.test(normalized);
  }

  function isDemoCompletedCloseIntent(text: string) {
    return isDemoEndIntent(text);
  }

  function isFollowUpEndIntent(text: string) {
    const normalized = normalizeDemoText(text);
    return /^(없어|없어요|됐어|됐어요|괜찮아|괜찮아요|끝|종료|그만|마무리|통화 종료|없습니다|됐습니다|괜찮습니다|이제 없어|더 없어)$/.test(normalized);
  }

  function isFollowUpNewServiceIntent(text: string) {
    const normalized = normalizeDemoText(text);
    if (detectDemoServiceType(normalized) !== "unknown") return true;
    return /(그리고|추가로|또|하나 더|아 맞다|이번엔|이번에는|그럼|그러면|이어서|다음으로)/.test(normalized);
  }

  function normalizeForEchoGuard(value: string) {
    return value
      .replace(/\s+/g, "")
      .replace(/[.,!?~]/g, "")
      .trim();
  }

  function isAssistantEchoTranscript(text: string) {
    const clean = normalizeForEchoGuard(text);
    const last = normalizeForEchoGuard(lastAssistantExactTextRef.current);

    if (!clean || !last) return false;

    if (Date.now() < ignoreUserInputUntilRef.current) return true;

    if (last.includes(clean) && clean.length >= 6) return true;
    if (clean.includes(last.slice(0, Math.min(last.length, 20))) && clean.length >= 6) return true;

    return false;
  }

  function isDemoForbiddenSlotUtterance(text: string) {
    const normalized = normalizeDemoText(text);
    return /^(다시|다시 해줘|아니 다시|아니 다시 해줘|처음부터|취소|재시작|변경|수정|택시 불러줘|병원 예약해줘|해줘|불러줘|진행|진행해|진행해줘|진행해 주세요|예약해줘|호출해줘|접수해줘|맞아|맞아요|맞습니다|네|예|응|어|어어|ㅇㅇ|그래|그래요|그럼|좋아|좋아요|좋습니다|오케이|ok|아니|아니요|아냐|노|no|nope|싫어|싫다|그건 아니야)$/.test(normalized);
  }

  function isDemoPartnerRefusal(text: string) {
    return /싫어|싫다|제휴 말고|다른 곳|내가 원하는 곳|내가 아는 곳|직접 정할게|거기 말고/.test(text);
  }

  function hasDemoBlackboxIntent(text: string) {
    return /블랙박스|블박|아이나비\s*블랙박스/.test(text);
  }

  function hasDemoTintingIntent(text: string) {
    return /틴팅|썬팅|선팅|칼트윈/.test(text);
  }

  function hasDemoTaxiIntent(text: string) {
    const normalized = normalizeDemoText(text);
    const compact = normalized.replace(/\s+/g, "");
    if (/택시|텍시|택씨|텍씨|첵시|첵씨|쵝시|췍시|아이나비m/.test(compact)) return true;
    if (/(섹시|쎅시)/.test(compact) && /(불러|호출|잡아|불러줘|호출해줘)/.test(compact)) return true;
    return false;
  }

  function detectDemoServiceType(text: string): DemoServiceType {
    const normalized = normalizeDemoText(text);
    if (hasDemoTaxiIntent(normalized)) return "taxi";
    if (/병원|의원|진료|피부과|정형외과|내과|소아과/.test(normalized)) return "hospital_reservation";
    if (/검사소|자동차 검사|차 검사|검사 예약/.test(normalized)) return "car_inspection";
    if (/수리|정비|차량 as|자동차 as|엔진|타이어|오일|고장/.test(normalized)) return "car_maintenance";
    if (hasDemoBlackboxIntent(normalized)) return "blackbox_installation";
    if (hasDemoTintingIntent(normalized)) return "tinting_installation";
    if (/사줘|구매|주문|물품|상품|생수|배송/.test(normalized)) return "product_purchase";
    if (/가족|부모님|아이.*이동|모셔다|에스코트|이동 서비스/.test(normalized)) return "family_mobility";
    return "unknown";
  }

  function isSameDemoServiceRequest(text: string, service: DemoService) {
    const detected = detectDemoServiceType(text);
    if (detected === "unknown") return false;
    if (service.serviceType === detected) return true;
    return service.serviceType === "blackbox_installation" && detected === "tinting_installation" && Boolean(service.slots.packageRequested);
  }

  function makeDemoService(text: string): DemoService {
    const serviceType = detectDemoServiceType(text);
    return {
      id: `${serviceType}-${Date.now()}`,
      serviceType,
      rawText: text,
      slots: {
        callTiming: serviceType === "taxi" ? "즉시 호출" : undefined,
        packageRequested: hasDemoBlackboxIntent(text) && hasDemoTintingIntent(text)
      }
    };
  }

  function stripDemoRequestWords(text: string) {
    return text
      .replace(/(택시|텍시|택씨|텍씨|첵시|첵씨|쵝시|췍시|아이나비\s*m\s*택시|불러줘|호출해줘|호출|병원\s*예약해줘|예약해줘|예약|블랙박스|블박|틴팅|썬팅|선팅|하고 싶어|달고 싶어|장착|시공|수리|정비|검사|사줘|구매해줘|구매|주문해줘|주문|해주세요|해줘|진행해줘)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractDemoDateTime(text: string) {
    const dateMatch = text.match(/(?:(오늘|내일|모레|이번 주|다음 주|다음주|[월화수목금토일]요일|\d{1,2}월\s*\d{1,2}일|\d{1,2}일)\s*)?(?:(오전|오후|저녁|점심|아침)\s*)?\d{1,2}시(?:\s*\d{1,2}분)?|(오늘|내일|모레|이번 주|다음 주|다음주|오전|오후|저녁|점심|아침|[월화수목금토일]요일|\d{1,2}월\s*\d{1,2}일|\d{1,2}일)/);
    return dateMatch?.[0]?.trim();
  }

  function extractDemoLocation(text: string) {
    const station = text.match(/[가-힣A-Za-z0-9]+역/);
    if (station) return station[0];
    const region = regionKeywords.find((item) => text.includes(item));
    if (region) return region;
    const area = text.match(/[가-힣A-Za-z0-9]+(?:시|구|동|군|읍|면)/);
    return area?.[0];
  }

  function isDemoValidTaxiPlace(text: string) {
    const normalized = normalizeDemoText(text);
    if (!normalized || isDemoForbiddenSlotUtterance(normalized)) return false;
    if (/(택시|불러줘|해줘|다시|취소|재시작|처음부터|진행)/.test(normalized)) return false;
    return /에서.+(까지|으로|로)?$/.test(normalized) ||
      /(우리집|집|회사|사무실|역|터미널|공항|병원|학교|아파트|동|구|시|군|로|길|강남|판교|수원|서울|성남|분당|잠실|송파|광교|용인|일산|부천|안양|과천|하남|위례)/.test(normalized);
  }

  function extractDemoSlots(text: string, service: DemoService): Partial<DemoSlots> {
    if (isDemoForbiddenSlotUtterance(text)) return {};
    const slots: Partial<DemoSlots> = {};
    const clean = stripDemoRequestWords(text);
    const source = clean || text.trim();
    if (!source || isDemoForbiddenSlotUtterance(source)) return {};
    const dateTime = extractDemoDateTime(source);
    const location = extractDemoLocation(source);

    if (service.serviceType === "taxi" || service.serviceType === "family_mobility") {
      const routeMatch = source.match(/(.+?)에서\s*(.+?)(?:까지|으로|로)?$/);
      if (routeMatch) {
        slots.origin = normalizePlaceCandidate(routeMatch[1].trim());
        slots.destination = normalizePlaceCandidate(routeMatch[2].replace(/(까지|으로|로)$/g, "").trim());
      } else if (isDemoValidTaxiPlace(source)) {
        if (!service.slots.origin) slots.origin = normalizePlaceCandidate(source);
        else if (!service.slots.destination) slots.destination = normalizePlaceCandidate(source);
      }
      if (service.serviceType === "taxi") slots.callTiming = "즉시 호출";
      return slots;
    }

    if (dateTime) slots.appointmentDateTime = dateTime;
    if (location) slots.location = location;

    if (service.serviceType === "hospital_reservation") {
      const department = source.match(/피부과|정형외과|내과|소아과|치과|안과|이비인후과|진료|검진|두통|감기|복통|통증/)?.[0];
      if (department) slots.departmentOrSymptom = department;
      if (/병원|의원|클리닉|센터/.test(source)) slots.providerName = source;
    }

    if (service.serviceType === "car_maintenance") {
      const symptom = source.replace(dateTime ?? "", "").replace(location ?? "", "").trim();
      if (symptom && !isDemoForbiddenSlotUtterance(symptom)) slots.vehicleSymptom = symptom;
    }

    if (service.serviceType === "car_inspection" || service.serviceType === "blackbox_installation" || service.serviceType === "tinting_installation") {
      const vehicle = source.match(/소나타|아반떼|그랜저|카니발|쏘렌토|스포티지|테슬라|벤츠|bmw|ev\d*|전기차|SUV|승용차|차량|내 차|우리 차/i)?.[0];
      if (vehicle) slots.vehicleInfo = vehicle;
      if (hasDemoBlackboxIntent(text) && hasDemoTintingIntent(text)) slots.packageRequested = true;
    }

    if (service.serviceType === "product_purchase") {
      const quantity = source.match(/\d+\s*(개|병|박스|팩|세트|개입)|한\s*(개|병|박스|팩)|두\s*(개|병|박스|팩)/)?.[0];
      if (quantity) slots.quantity = quantity;
      if (/배송|주소|집으로|회사로/.test(source)) slots.deliveryAddress = source;
      const product = source.replace(quantity ?? "", "").replace(/배송|주소|집으로|회사로/g, "").trim();
      if (product && !isDemoForbiddenSlotUtterance(product)) slots.productName = product;
    }

    return slots;
  }

  function syncDemoSlotsToLegacyState(service: DemoService) {
    const slots = sanitizeDemoSlots(service.slots);
    const next: ServiceSlots = {
      origin: slots.origin,
      destination: slots.destination,
      serviceLocation: slots.location,
      providerName: slots.providerName,
      appointmentDateTime: slots.appointmentDateTime,
      vehicleInfo: slots.vehicleInfo,
      vehicleSymptom: slots.vehicleSymptom || slots.departmentOrSymptom,
      productName: slots.productName,
      quantity: slots.quantity,
      deliveryAddress: slots.deliveryAddress,
      callTiming: slots.callTiming
    };
    confirmedSlotsRef.current = Object.fromEntries(Object.entries(next).filter(([, value]) => Boolean(value))) as ServiceSlots;
    setConfirmedSlots(confirmedSlotsRef.current);
  }

  function mergeDemoSlots(service: DemoService, slots: Partial<DemoSlots>) {
    service.slots = sanitizeDemoSlots({ ...service.slots, ...slots });
    if (service.serviceType === "taxi" && !service.slots.callTiming) service.slots.callTiming = "즉시 호출";
    activeDemoServiceRef.current = service;
    syncDemoSlotsToLegacyState(service);
  }

  function applyDemoDefaultsBeforeChecking(service: DemoService) {
    if (service.serviceType === "hospital_reservation") {
      mergeDemoSlots(service, {
        departmentOrSymptom: service.slots.departmentOrSymptom || "일반 진료",
        location: service.slots.location || (service.slots.providerName ? undefined : "고객 위치 인근"),
        appointmentDateTime: service.slots.appointmentDateTime || "가장 빠른 가능 시간"
      });
      return;
    }
    if (service.serviceType === "car_maintenance") {
      mergeDemoSlots(service, {
        vehicleSymptom: service.slots.vehicleSymptom || "일반 점검",
        location: service.slots.location || (service.slots.providerName ? undefined : "고객 위치 인근"),
        appointmentDateTime: service.slots.appointmentDateTime || "가장 빠른 가능 시간"
      });
      return;
    }
    if (service.serviceType === "car_inspection") {
      mergeDemoSlots(service, {
        vehicleInfo: service.slots.vehicleInfo || "고객 차량",
        location: service.slots.location || (service.slots.providerName ? undefined : "고객 위치 인근"),
        appointmentDateTime: service.slots.appointmentDateTime || "가장 빠른 가능 시간"
      });
      return;
    }
    if (service.serviceType === "blackbox_installation" || service.serviceType === "tinting_installation") {
      mergeDemoSlots(service, {
        vehicleInfo: service.slots.vehicleInfo || "고객 차량",
        location: service.slots.location || "고객 위치 인근",
        appointmentDateTime: service.slots.appointmentDateTime || "가장 빠른 가능 시간"
      });
      return;
    }
    if (service.serviceType === "product_purchase") {
      mergeDemoSlots(service, {
        productName: service.slots.productName || "요청 상품",
        quantity: service.slots.quantity || "1개"
      });
      return;
    }
    if (service.serviceType === "family_mobility") {
      mergeDemoSlots(service, {
        origin: service.slots.origin || "현재 위치",
        destination: service.slots.destination || "요청 목적지"
      });
    }
  }

  function getDemoMissingFields(service: DemoService) {
    const slots = service.slots;
    if (service.serviceType === "taxi") {
      return [
        !slots.origin ? "출발지" : "",
        !slots.destination ? "도착지" : ""
      ].filter(Boolean);
    }
    if (service.serviceType === "hospital_reservation") {
      return [
        !slots.departmentOrSymptom ? "진료과 또는 증상" : "",
        !slots.location && !slots.providerName ? "진료 지역" : "",
        !slots.appointmentDateTime ? "희망 일시" : ""
      ].filter(Boolean);
    }
    if (service.serviceType === "car_maintenance") {
      return [
        !slots.vehicleSymptom ? "차량 증상" : "",
        !slots.location && !slots.providerName ? "지역 또는 업체" : "",
        !slots.appointmentDateTime ? "희망 일시" : ""
      ].filter(Boolean);
    }
    if (service.serviceType === "car_inspection") {
      return [
        !slots.vehicleInfo ? "차량 정보" : "",
        !slots.location && !slots.providerName ? "검사 지역 또는 업체" : "",
        !slots.appointmentDateTime ? "희망 일시" : ""
      ].filter(Boolean);
    }
    if (service.serviceType === "blackbox_installation" || service.serviceType === "tinting_installation") {
      return [
        !slots.vehicleInfo ? "차량 종류" : "",
        !slots.location ? "시공 지역" : "",
        !slots.appointmentDateTime ? "희망 일시" : ""
      ].filter(Boolean);
    }
    if (service.serviceType === "product_purchase") {
      return [
        !slots.productName ? "상품명" : "",
        !slots.quantity && !slots.deliveryAddress ? "수량 또는 배송지" : ""
      ].filter(Boolean);
    }
    if (service.serviceType === "family_mobility") {
      return [
        !slots.origin ? "출발지" : "",
        !slots.destination ? "도착지" : ""
      ].filter(Boolean);
    }
    return ["요청 내용"];
  }

  function getDemoServiceLabel(service: DemoService) {
    if (service.serviceType === "taxi") return "아이나비 M 택시";
    if (service.serviceType === "hospital_reservation") return "Babelfish 제휴 병원";
    if (service.serviceType === "car_maintenance") return "Babelfish 제휴 자동차 서비스 업체";
    if (service.serviceType === "car_inspection") return "Babelfish 제휴 검사소";
    if (service.serviceType === "blackbox_installation") return service.slots.packageRequested ? "아이나비 블랙박스와 칼트윈 틴팅 필름 패키지" : "아이나비 블랙박스";
    if (service.serviceType === "tinting_installation") return "칼트윈 틴팅 필름";
    if (service.serviceType === "product_purchase") return "Babelfish 제휴 협력사";
    if (service.serviceType === "family_mobility") return "Babelfish 제휴 이동 서비스";
    return "Babelfish 제휴 서비스";
  }

  function buildDemoProviderFirstMessage(service: DemoService) {
    return DEMO_SCRIPTS.start[getDemoScriptKey(service.serviceType)] ?? DEMO_SCRIPTS.start.unknown;
  }

  function buildDemoRetryQuestion(service: DemoService) {
    return buildDemoProviderFirstMessage(service);
  }

  function buildDemoMissingQuestion(service: DemoService) {
    const missing = getDemoMissingFields(service);
    if (missing.length === 0) return buildDemoConfirmationMessage(service);
    return buildDemoProviderFirstMessage(service);
  }

  function buildDemoConfirmationMessage(service: DemoService) {
    const slots = sanitizeDemoSlots(service.slots);
    const area = slots.location || slots.providerName || "-";
    if (service.serviceType === "taxi") return `출발지는 ${slots.origin || "-"}, 도착지는 ${slots.destination || "-"} 입니다. 확인해 주시면 아이나비 M 택시를 호출 하겠습니다.`;
    if (service.serviceType === "hospital_reservation") return `${area} 지역 ${slots.departmentOrSymptom || "-"} 진료 예약으로 확인했습니다. 제휴 병원 예약 가능 여부를 확인할까요?`;
    if (service.serviceType === "car_maintenance") return `${area} 지역에서 ${slots.vehicleSymptom || "-"} 정비로 확인했습니다. 제휴 자동차 서비스 업체 예약 가능 여부를 확인할까요?`;
    if (service.serviceType === "car_inspection") return `${area} 지역 차량 검사로 확인했습니다. 바벨피시 제휴 검사소 예약 가능 여부를 확인할까요?`;
    if (service.serviceType === "blackbox_installation") return `${area} 지역 아이나비 블랙박스 장착으로 확인했습니다. 장착 가능 여부를 확인할까요?`;
    if (service.serviceType === "tinting_installation") return `${area} 지역 칼트윈 틴팅 시공으로 확인했습니다. 시공 가능 여부를 확인할까요?`;
    if (service.serviceType === "product_purchase") return `${slots.productName || "-"} 구매 요청으로 확인했습니다. 구매 가능 여부를 확인할까요?`;
    return "요청하신 내용을 확인했습니다. 진행할까요?";
  }

  function buildDemoCheckingMessage(service: DemoService) {
    return DEMO_SCRIPTS.checking[getDemoScriptKey(service.serviceType)] ?? DEMO_SCRIPTS.checking.unknown;
  }

  // Demo fulfillment details are fixed mock values.
  // Replace these values with real dispatch/reservation API results in production.
  function buildDemoFulfillmentDetailMessage(service: DemoService) {
    const slots = sanitizeDemoSlots(service.slots);

    if (service.serviceType === "taxi") {
      return [
        "배차 정보입니다.",
        "차량은 아이나비 M 택시, 차량번호는 12가 3456입니다.",
        "기사님은 김현수 기사님이며, 예상 도착 시간은 약 5분 후입니다.",
        "탑승 위치에서 대기해 주세요."
      ].join(" ");
    }

    if (service.serviceType === "hospital_reservation") {
      return [
        "예약 정보입니다.",
        `${slots.location || "요청 지역"} 제휴 병원으로 접수되었습니다.`,
        "예약 병원은 바벨피시 제휴 메디컬센터입니다.",
        "진료 항목은 요청하신 진료 내용 기준으로 접수되었고, 예약 확인 알림을 안내드릴 예정입니다."
      ].join(" ");
    }

    if (service.serviceType === "car_maintenance") {
      return [
        "예약 정보입니다.",
        `${slots.location || "요청 지역"} 제휴 자동차 서비스 업체로 접수되었습니다.`,
        "방문 업체는 바벨피시 제휴 오토케어센터입니다.",
        "접수된 증상 기준으로 차량 점검 후 정비 가능 여부를 안내드릴 예정입니다."
      ].join(" ");
    }

    if (service.serviceType === "car_inspection") {
      return [
        "예약 정보입니다.",
        `${slots.location || "요청 지역"} 제휴 검사소로 접수되었습니다.`,
        "방문 검사소는 바벨피시 제휴 자동차 검사센터입니다.",
        "차량 정보 확인 후 검사 가능 시간을 안내드릴 예정입니다."
      ].join(" ");
    }

    if (service.serviceType === "blackbox_installation") {
      return [
        "예약 정보입니다.",
        `${slots.location || "요청 지역"} 아이나비 블랙박스 장착점으로 접수되었습니다.`,
        "방문 업체는 아이나비 제휴 장착센터입니다.",
        "차량 종류 확인 후 장착 가능 시간을 안내드릴 예정입니다."
      ].join(" ");
    }

    if (service.serviceType === "tinting_installation") {
      return [
        "예약 정보입니다.",
        `${slots.location || "요청 지역"} 칼트윈 틴팅 시공점으로 접수되었습니다.`,
        "방문 업체는 프리미엄 칼트윈 제휴 시공센터입니다.",
        "차량 종류와 희망 시공 범위 확인 후 예약 가능 시간을 안내드릴 예정입니다."
      ].join(" ");
    }

    if (service.serviceType === "product_purchase") {
      return [
        "구매 접수 정보입니다.",
        `${slots.productName || "요청 상품"} 구매 요청이 제휴 협력사로 접수되었습니다.`,
        "재고와 배송 가능 여부를 확인한 뒤 안내드릴 예정입니다."
      ].join(" ");
    }

    return "접수 정보는 바벨피시 제휴 네트워크를 통해 확인 후 안내드릴 예정입니다.";
  }

  function buildDemoSuccessMessage(service: DemoService) {
    const detail = buildDemoFulfillmentDetailMessage(service);

    if (service.serviceType === "taxi") {
      return [
        "아이나비 M 택시 배차 요청이 성공적으로 접수되었습니다.",
        detail,
        FOLLOWUP_PROMPT
      ].join(" ");
    }

    if (service.serviceType === "hospital_reservation") {
      return [
        "바벨피시 제휴 병원 예약 요청이 성공적으로 접수되었습니다.",
        detail,
        FOLLOWUP_PROMPT
      ].join(" ");
    }

    if (service.serviceType === "car_maintenance") {
      return [
        "바벨피시 제휴 자동차 서비스 업체 예약 요청이 성공적으로 접수되었습니다.",
        detail,
        FOLLOWUP_PROMPT
      ].join(" ");
    }

    if (service.serviceType === "car_inspection") {
      return [
        "바벨피시 제휴 검사소 예약 요청이 성공적으로 접수되었습니다.",
        detail,
        FOLLOWUP_PROMPT
      ].join(" ");
    }

    if (service.serviceType === "blackbox_installation") {
      return [
        "아이나비 블랙박스 장착 요청이 성공적으로 접수되었습니다.",
        detail,
        FOLLOWUP_PROMPT
      ].join(" ");
    }

    if (service.serviceType === "tinting_installation") {
      return [
        "칼트윈 틴팅 시공 요청이 성공적으로 접수되었습니다.",
        detail,
        FOLLOWUP_PROMPT
      ].join(" ");
    }

    if (service.serviceType === "product_purchase") {
      return [
        "바벨피시 제휴 협력사 구매 요청이 성공적으로 접수되었습니다.",
        detail,
        FOLLOWUP_PROMPT
      ].join(" ");
    }

    return [
      "바벨피시 제휴 서비스 요청이 성공적으로 접수되었습니다.",
      detail,
      FOLLOWUP_PROMPT
    ].join(" ");
  }

  function buildDemoPartnerRefusalReply(service: DemoService) {
    return DEMO_SCRIPTS.start[getDemoScriptKey(service.serviceType)] ?? DEMO_SCRIPTS.start.unknown;
  }

  function buildDemoUiSummary(service: DemoService) {
    const slots = sanitizeDemoSlots(service.slots);
    if (service.serviceType === "taxi") return `아이나비 M 택시 요청: ${slots.origin ?? "출발지 미확인"}에서 ${slots.destination ?? "도착지 미확인"}까지`;
    if (service.serviceType === "hospital_reservation") return `Babelfish 제휴 병원 예약: ${slots.location ?? slots.providerName ?? "지역 미확인"} / ${slots.departmentOrSymptom ?? "진료과 미확인"} / ${slots.appointmentDateTime ?? "일시 미확인"}`;
    if (service.serviceType === "car_maintenance") return `Babelfish 제휴 자동차 서비스 업체 예약: ${slots.vehicleSymptom ?? "차량 증상 미확인"} / ${slots.location ?? slots.providerName ?? "지역 미확인"} / ${slots.appointmentDateTime ?? "일시 미확인"}`;
    if (service.serviceType === "car_inspection") return `Babelfish 제휴 검사소 예약: ${slots.vehicleInfo ?? "차량 정보 미확인"} / ${slots.location ?? slots.providerName ?? "검사 지역 미확인"} / ${slots.appointmentDateTime ?? "일시 미확인"}`;
    if (service.serviceType === "blackbox_installation") return `${getDemoServiceLabel(service)} 시공: ${slots.vehicleInfo ?? "차량 종류 미확인"} / ${slots.location ?? "시공 지역 미확인"} / ${slots.appointmentDateTime ?? "일시 미확인"}`;
    if (service.serviceType === "tinting_installation") return `칼트윈 틴팅 필름 시공: ${slots.vehicleInfo ?? "차량 종류 미확인"} / ${slots.location ?? "시공 지역 미확인"} / ${slots.appointmentDateTime ?? "일시 미확인"}`;
    if (service.serviceType === "product_purchase") return `Babelfish 제휴 협력사 구매: ${slots.productName ?? "상품명 미확인"} / ${slots.quantity ?? slots.deliveryAddress ?? "수량 또는 배송지 미확인"}`;
    if (service.serviceType === "family_mobility") return `Babelfish 가족 이동 서비스: ${slots.origin ?? "출발지 미확인"}에서 ${slots.destination ?? "도착지 미확인"}까지`;
    return service.rawText || "Babelfish 제휴 서비스 요청";
  }

  function buildDemoExecutionPlan(service: DemoService) {
    if (service.serviceType === "taxi") return ["출발지/도착지 확인", "아이나비 M 택시 배차 확인", "배차 접수 완료 안내"];
    if (service.serviceType === "hospital_reservation") return ["진료과/증상 확인", "지역 또는 병원 확인", "희망 일시 확인", "바벨피시 제휴 병원 예약 가능 여부 확인", "예약 접수 완료 안내"];
    if (service.serviceType === "car_maintenance") return ["차량 증상 확인", "지역 또는 업체 확인", "희망 일시 확인", "예약 접수 완료 안내"];
    if (service.serviceType === "car_inspection") return ["차량 정보 확인", "검사 지역 확인", "희망 일시 확인", "검사 예약 접수 완료 안내"];
    if (service.serviceType === "blackbox_installation") return ["차량 종류 확인", "시공 지역 확인", "희망 일시 확인", "장착 접수 완료 안내"];
    if (service.serviceType === "tinting_installation") return ["차량 종류 확인", "시공 지역 확인", "희망 일시 확인", "시공 접수 완료 안내"];
    if (service.serviceType === "product_purchase") return ["상품명 확인", "수량 또는 배송지 확인", "구매 요청 접수 완료 안내"];
    if (service.serviceType === "family_mobility") return ["출발지/도착지 확인", "바벨피시 가족 이동 서비스 연결 확인", "연결 요청 접수 완료 안내"];
    return ["고객 요청 확인", "바벨피시 제휴 서비스 연결 확인", "연결 요청 접수 완료 안내"];
  }

  function buildDemoFulfillmentSummaryItems(service: DemoService) {
    const slots = sanitizeDemoSlots(service.slots);
    if (service.serviceType === "taxi") return ["배차 접수 완료", "차량번호: 12가 3456", "기사: 김현수", "예상 도착: 약 5분 후"];
    if (service.serviceType === "hospital_reservation") return ["병원 예약 접수 완료", "병원: 바벨피시 제휴 메디컬센터", `지역: ${slots.location || "요청 지역"}`, "확인 알림 예정"];
    if (service.serviceType === "car_maintenance") return ["정비 예약 접수 완료", "업체: 바벨피시 제휴 오토케어센터", `지역: ${slots.location || "요청 지역"}`, `증상: ${slots.vehicleSymptom || "요청 증상"}`];
    if (service.serviceType === "car_inspection") return ["검사 예약 접수 완료", "검사소: 바벨피시 제휴 자동차 검사센터", `지역: ${slots.location || "요청 지역"}`, "검사 가능 시간 안내 예정"];
    if (service.serviceType === "blackbox_installation") return ["장착 예약 접수 완료", "업체: 아이나비 제휴 장착센터", `지역: ${slots.location || "요청 지역"}`, "장착 가능 시간 안내 예정"];
    if (service.serviceType === "tinting_installation") return ["시공 예약 접수 완료", "업체: 프리미엄 칼트윈 제휴 시공센터", `지역: ${slots.location || "요청 지역"}`, "시공 가능 시간 안내 예정"];
    if (service.serviceType === "product_purchase") return ["구매 요청 접수 완료", `상품: ${slots.productName || "요청 상품"}`, "재고 확인 예정", "배송 가능 여부 안내 예정"];
    return ["제휴 서비스 접수 완료", "바벨피시 제휴 네트워크 확인 예정", "추가 안내 예정"];
  }

  function buildDemoNextUiMessage(service: DemoService) {
    if (demoPhaseRef.current === "confirming") return buildDemoConfirmationMessage(service);
    if (demoPhaseRef.current === "checking") return buildDemoCheckingMessage(service);
    if (demoPhaseRef.current === "completed") {
      const active = activeDemoServiceRef.current;
      if (active) return buildDemoSuccessMessage(active);
      return "";
    }
    return buildDemoMissingQuestion(service);
  }

  function clearDemoPendingTimers() {
    clearAssistantEchoReleaseTimer();
    clearFollowupIdleTimer();
    if (completionTimerRef.current) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
    if (pendingResponseTimerRef.current) {
      window.clearTimeout(pendingResponseTimerRef.current);
      pendingResponseTimerRef.current = null;
    }
    if (responseTimerRef.current) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
    if (greetingTimeoutRef.current) {
      window.clearTimeout(greetingTimeoutRef.current);
      greetingTimeoutRef.current = null;
    }
    completionTimerServiceIdRef.current = null;
    expectedAssistantMessageRef.current = "";
    assistantDraftRef.current = "";
    setAssistantDraft("");
    lastValidUserTurnRef.current = "";
    fallbackPromptCountRef.current = 0;
    isResponseInProgressRef.current = false;
  }

  function releaseDemoCompletedLockByStartButton() {
    demoCompletedLockedRef.current = false;
    waitingForAdditionalRequestRef.current = false;
    completedAtRef.current = null;
    ignoreUserInputUntilRef.current = 0;
    lastAssistantExactTextRef.current = "";
    clearDemoPendingTimers();
    clearPendingCustomerTurn();
    assistantEchoGuardUntilRef.current = 0;
    lastProcessedTranscriptRef.current = "";
    emittedAssistantMessageKeysRef.current = new Set();
    console.log("[DEMO_FLOW] completed_lock_released_by_start_button");
  }

  function lockUserInputForAssistantTurn() {
    ignoreUserInputUntilRef.current = Date.now() + 2000;
  }

  function speakExactText(message: string, allowAfterCompleted = false, onDone?: () => void) {
    if (isCompletedHardLocked() && !allowAfterCompleted) {
      console.log("[DEMO_FLOW] blocked_exact_speech_after_completed", { message });
      return;
    }

    const fixed = toSpokenBrandName(message).trim();
    if (!fixed) return;

    lastAssistantTextRef.current = fixed;
    lastAssistantResponseMessageRef.current = fixed;
    lastAssistantExactTextRef.current = fixed;
    lastAssistantSpokeAtRef.current = Date.now();
    lockUserInputForAssistantTurn();

    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      onDone?.();
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(fixed);
    utterance.lang = "ko-KR";
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onstart = () => {
      if (isCompletedHardLocked() && !allowAfterCompleted) {
        window.speechSynthesis.cancel();
        return;
      }
      lastAssistantStartedAtRef.current = Date.now();
      lastAssistantMessageAtRef.current = Date.now();
      lastAssistantExactTextRef.current = fixed;
      lockUserInputForAssistantTurn();
      isAssistantSpeakingRef.current = true;
      isAssistantAudioPlayingRef.current = true;
      isResponseInProgressRef.current = false;
      clearPendingResponseTimer();
      setMicrophoneEnabled(false, "auto");
      updateAppStatus("AI SPEAKING");
      setVoiceState("AI 응답 중");
    };

    const finish = () => {
      lockUserInputForAssistantTurn();
      isGreetingInProgressRef.current = false;
      isAssistantSpeakingRef.current = false;
      isAssistantAudioPlayingRef.current = false;
      isResponseInProgressRef.current = false;
      markAssistantSpeakingEnd();
      onDone?.();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    window.speechSynthesis.speak(utterance);
  }

  function emitDemoAssistantExact(message: string, key?: string, allowAfterCompleted = false, onDone?: () => void) {
    if (isCompletedHardLocked() && !allowAfterCompleted) {
      console.log("[DEMO_FLOW] blocked_exact_message_after_completed", { key, message });
      return;
    }

    const fixed = toSpokenBrandName(message).trim();
    if (!fixed) return;
    const dedupeKey = key ?? fixed;
    if (emittedAssistantMessageKeysRef.current.has(dedupeKey)) {
      onDone?.();
      return;
    }
    emittedAssistantMessageKeysRef.current.add(dedupeKey);
    setAssistHint(fixed);
    lastAssistantResponseMessageRef.current = fixed;
    expectedAssistantMessageRef.current = fixed;
    appendLog("assistant", fixed);
    console.log("[DEMO] emitExact", fixed);
    speakExactText(fixed, allowAfterCompleted, onDone);
  }

  function enterDemoCollecting(service: DemoService, message: string) {
    activeDemoServiceRef.current = service;
    setDemoPhase("collecting");
    setServiceStatus("listening");
    setStatus("draft");
    updateAppStatus("LISTENING");
    lastValidUserTurnRef.current = "";
    fallbackPromptCountRef.current = 0;
    remainingFieldsRef.current = getDemoMissingFields(service);
    setUnderstoodText(`${getDemoServiceLabel(service)} 요청`);
    setFinalSummary("");
    emitDemoAssistantExact(message);
  }

  function enterDemoConfirming(service: DemoService, step: DemoConfirmationStep = "content") {
    activeDemoServiceRef.current = service;
    setDemoPhase("confirming");
    setServiceStatus("listening");
    setStatus("draft");
    updateAppStatus("LISTENING");
    lastValidUserTurnRef.current = "";
    fallbackPromptCountRef.current = 0;
    remainingFieldsRef.current = [];
    demoConfirmationStepRef.current = step;
    const message = buildDemoConfirmationMessage(service);
    setUnderstoodText(message);
    emitDemoAssistantExact(message);
  }

  function enterDemoChecking(service: DemoService) {
    if (demoPhaseRef.current === "checking" && checkingServiceIdRef.current === service.id) {
      return;
    }
    applyDemoDefaultsBeforeChecking(service);
    activeDemoServiceRef.current = service;
    checkingServiceIdRef.current = service.id;
    demoConfirmationStepRef.current = "content";
    setDemoPhase("checking");
    setServiceStatus("checking");
    setStatus("submitted");
    updateAppStatus("BUILDING PLAN");
    setMockOrderId(service.id);
    setSatisfactionState("제휴사 확인 중");
    lastValidUserTurnRef.current = "";
    fallbackPromptCountRef.current = 0;
    const checkingMessage = buildDemoCheckingMessage(service);
    setDemoCompletionHint(checkingMessage);
    setIsWaitingDemoCompletion(true);
    checkingReminderSentRef.current = false;
    console.log("[DEMO] enterDemoChecking", service.id, service.serviceType);
    emitDemoAssistantExact(checkingMessage, `checking:${service.id}`);
    startSuccessTimer(service);
  }

  function startSuccessTimer(service: DemoService) {
    if (!service.id) return;
    if (isCompletedHardLocked()) {
      enforceCompletedHardLock("startSuccessTimer");
      return;
    }
    if (completionTimerRef.current) {
      window.clearTimeout(completionTimerRef.current);
    }
    completionTimerRef.current = null;
    completionTimerServiceIdRef.current = service.id;
    console.log("[DEMO] startSuccessTimer", service.id, service.serviceType);
    completionTimerRef.current = window.setTimeout(() => {
      completionTimerRef.current = null;
      completionTimerServiceIdRef.current = null;
      if (isCompletedHardLocked()) {
        enforceCompletedHardLock("startSuccessTimer:callback");
        return;
      }
      completeService(service);
    }, DEMO_SUCCESS_DELAY_MS);
  }

  function triggerOperatorTransfer(reason: string, context: Partial<OperatorTransferContext> = {}) {
    const activeService = context.activeService ?? activeDemoServiceRef.current;
    const payload: OperatorTransferContext = {
      reason,
      failureReason: context.failureReason ?? reason,
      urgency: context.urgency ?? "P1",
      rawTranscript: context.rawTranscript ?? transcriptRef.current,
      activeService,
      analysis: context.analysis ?? analysis,
      slots: context.slots ?? confirmedSlotsRef.current,
      serviceStatus: context.serviceStatus ?? serviceStatusRef.current,
      demoPhase: context.demoPhase ?? demoPhaseRef.current,
      timestamp: context.timestamp ?? new Date().toISOString(),
      errorMessage: context.errorMessage
    };

    // 상담원이 같은 내용을 다시 묻지 않도록 이관 시점의 전체 맥락을 고정한다.
    operatorTransferTriggeredRef.current = true;
    setServiceStatus("operator_transfer");
    setStatus("operator_transfer");
    updateAppStatus("SERVER ERROR");
    setSatisfactionState("시스템 장애 - 상담원 최우선 수기 접수 대기(Priority 1)");
    setAssistHint(SCRIPT_TEMPLATES.operatorTransferHint);
    appendLog("event", `상담원 이관: ${payload.failureReason} / 긴급도 ${payload.urgency}`);
    console.warn("[HANDOVER] operator transfer", payload);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("babelfish:operator-transfer", { detail: payload }));
    }
    return payload;
  }

  function completeService(service: DemoService) {
    if (completedServiceIdsRef.current.has(service.id)) return;
    completedServiceIdsRef.current.add(service.id);
    console.log("[DEMO] completeService", service.id, service.serviceType);
    clearDemoPendingTimers();
    clearPendingCustomerTurn();
    checkingServiceIdRef.current = null;
    const message = buildDemoSuccessMessage(service);
    activeDemoServiceRef.current = null;
    setDemoPhase("followup_listening");
    setServiceStatus("listening");
    setStatus("completed");
    setIsWaitingDemoCompletion(false);
    setDemoCompletionHint(message);
    setFinalSummary(message);
    const completed: CompletedService = {
      id: service.id,
      orderId: service.id,
      serviceType: service.serviceType,
      summary: message,
      completedAt: new Date().toISOString()
    };
    lastCompletedServiceRef.current = completed;
    setLastCompletedService(completed);
    setSatisfactionState("후속 요청 대기 중");
    demoCompletedLockedRef.current = false;
    waitingForAdditionalRequestRef.current = true;
    completedAtRef.current = Date.now();
    ignoreUserInputUntilRef.current = Date.now() + ASSISTANT_ECHO_GUARD_MS;
    sttListenerEnabledRef.current = true;
    setMicrophoneEnabled(false, "auto");
    updateAppStatus("AI SPEAKING");
    setVoiceState("AI 응답 중");
    console.log("[DEMO_FLOW] completed_followup_listening", {
      serviceId: service.id,
      serviceType: service.serviceType
    });
    emitDemoAssistantExact(message, `success:${service.id}`, true);
  }

  function beginDemoService(text: string) {
    console.log("[DEMO_FLOW] beginDemoService", {
      text,
      phase: demoPhaseRef.current,
      locked: demoCompletedLockedRef.current
    });
    if (isCompletedHardLocked()) {
      enforceCompletedHardLock("beginDemoService");
      console.log("[DEMO_FLOW] blocked_begin_after_completed", { text });
      return;
    }
    waitingForAdditionalRequestRef.current = false;
    clearFollowupIdleTimer();
    const service = makeDemoService(text);
    if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    completionTimerRef.current = null;
    completionTimerServiceIdRef.current = null;
    checkingServiceIdRef.current = null;
    emittedAssistantMessageKeysRef.current = new Set();
    checkingReminderSentRef.current = false;
    operatorTransferTriggeredRef.current = false;
    confirmedSlotsRef.current = {};
    setConfirmedSlots({});
    setFinalSummary("");
    setDemoCompletionHint("");
    setIsWaitingDemoCompletion(false);
    setMockOrderId(null);
    demoConfirmationStepRef.current = "content";
    if (service.serviceType === "unknown") {
      activeDemoServiceRef.current = service;
      setAnalysis(analyzeRequest(text));
      setDemoPhase("collecting");
      setServiceStatus("listening");
      remainingFieldsRef.current = getDemoMissingFields(service);
      emitDemoAssistantExact(DEMO_SCRIPTS.start.unknown);
      return;
    }
    const analyzed = analyzeRequest(text);
    setAnalysis(analyzed);
    pendingAnalysisRef.current = null;
    confirmedAnalysisRef.current = null;
    detailNotesRef.current = [];
    mergeDemoSlots(service, extractDemoSlots(text, service));
    const missing = getDemoMissingFields(service);
    remainingFieldsRef.current = missing;
    if (missing.length === 0) {
      enterDemoConfirming(service, "content");
      return;
    }
    enterDemoCollecting(service, buildDemoProviderFirstMessage(service));
  }

  function handleDemoCollecting(text: string, service: DemoService) {
    if (isDemoPartnerRefusal(text)) {
      emitDemoAssistantExact(buildDemoPartnerRefusalReply(service));
      return;
    }
    if (isDemoRestartIntent(text)) {
      service.slots = { callTiming: service.serviceType === "taxi" ? "즉시 호출" : undefined, packageRequested: service.slots.packageRequested };
      mergeDemoSlots(service, {});
      enterDemoCollecting(service, buildDemoRetryQuestion(service));
      return;
    }
    if (isDemoForbiddenSlotUtterance(text)) {
      emitDemoAssistantExact(buildDemoMissingQuestion(service));
      return;
    }
    const slots = extractDemoSlots(text, service);
    if (Object.keys(slots).length === 0) {
      if (service.serviceType !== "taxi" && isDemoPositiveIntent(text)) {
        applyDemoDefaultsBeforeChecking(service);
        enterDemoConfirming(service, "content");
        return;
      }
      if (service.serviceType === "taxi" && isSameDemoServiceRequest(text, service)) {
        service.slots = { callTiming: service.serviceType === "taxi" ? "즉시 호출" : undefined, packageRequested: service.slots.packageRequested };
        mergeDemoSlots(service, {});
        enterDemoCollecting(service, buildDemoRetryQuestion(service));
        return;
      }
      emitDemoAssistantExact(buildDemoMissingQuestion(service));
      return;
    }
    service.rawText = text;
    mergeDemoSlots(service, slots);
    if (service.serviceType === "taxi" && service.slots.origin && service.slots.destination) {
      enterDemoConfirming(service, "content");
      return;
    }
    if (service.serviceType === "hospital_reservation") {
      applyDemoDefaultsBeforeChecking(service);
      enterDemoConfirming(service, "content");
      return;
    }
    const missing = getDemoMissingFields(service);
    remainingFieldsRef.current = missing;
    if (missing.length === 0) {
      if (service.serviceType !== "taxi") {
        enterDemoConfirming(service, "content");
        return;
      }
      enterDemoConfirming(service);
      return;
    }
    emitDemoAssistantExact(buildDemoMissingQuestion(service));
  }

  function enterEnding() {
    activeDemoServiceRef.current = null;
    waitingForAdditionalRequestRef.current = false;
    demoCompletedLockedRef.current = true;
    sttListenerEnabledRef.current = false;
    clearDemoPendingTimers();
    clearPendingCustomerTurn();
    stopWatchdog();
    setDemoPhase("ending");
    setServiceStatus("standby");
    setStatus("standby");
    updateAppStatus("AI SPEAKING");
    setVoiceState("AI 응답 중");
    setMicrophoneEnabled(false, "auto");
    emitDemoAssistantExact(DEMO_SCRIPTS.end, "end", true, () => stopCall(true));
  }

  function finishDemoConversation() {
    enterEnding();
  }

  function handleDemoConversation(customerAnalysis: CustomerUtteranceAnalysis) {
    const text = customerAnalysis.transcript;
    const cleanText = text.trim();
    if (!cleanText) return;

    if (demoPhaseRef.current === "followup_listening") {
      clearFollowupIdleTimer();
      if (isAssistantEchoTranscript(cleanText)) {
        startFollowupIdleTimer();
        return;
      }
      if (Date.now() < ignoreUserInputUntilRef.current) {
        startFollowupIdleTimer();
        return;
      }

      if (isFollowUpEndIntent(cleanText)) {
        enterEnding();
        return;
      }

      if (isFollowUpNewServiceIntent(cleanText)) {
        waitingForAdditionalRequestRef.current = false;
        beginDemoService(cleanText);
        return;
      }

      emitDemoAssistantExact(SCRIPT_TEMPLATES.followupGuide, "followup-guide");
      startFollowupIdleTimer();
      return;
    }

    if (isCompletedHardLocked()) {
      console.log("[DEMO_FLOW] completed_guard", {
        text: cleanText,
        phase: demoPhaseRef.current,
        locked: demoCompletedLockedRef.current
      });
      enforceCompletedHardLock("handleDemoConversation");
      return;
    }

    if (isAssistantEchoTranscript(cleanText)) {
      console.log("[DEMO_FLOW] ignored_assistant_echo", {
        text: cleanText,
        lastAssistant: lastAssistantExactTextRef.current,
        phase: demoPhaseRef.current
      });
      return;
    }

    if (Date.now() < ignoreUserInputUntilRef.current) {
      console.log("[DEMO_FLOW] ignored_input_cooldown", {
        text: cleanText,
        phase: demoPhaseRef.current
      });
      return;
    }

    if (demoPhaseRef.current === "checking") {
      if (isDemoEndIntent(text)) {
        if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
        completionTimerServiceIdRef.current = null;
        checkingServiceIdRef.current = null;
        setIsWaitingDemoCompletion(false);
        finishDemoConversation();
        return;
      }
      if (isDemoRestartIntent(text)) {
        if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
        completionTimerServiceIdRef.current = null;
        checkingServiceIdRef.current = null;
        setIsWaitingDemoCompletion(false);
        const active = activeDemoServiceRef.current;
        if (active) enterDemoCollecting(active, buildDemoRetryQuestion(active));
        return;
      }
      return;
    }

    const active = activeDemoServiceRef.current;
    if (active && demoPhaseRef.current === "confirming") {
      if (isDemoPositiveIntent(text)) {
        enterDemoChecking(active);
        return;
      }
      if (isDemoRestartIntent(text)) {
        setDemoPhase("collecting");
        setServiceStatus("listening");
        setStatus("draft");
        updateAppStatus("LISTENING");
        emitDemoAssistantExact(SCRIPT_TEMPLATES.confirmRetry, `confirm-retry:${active.id}`);
        return;
      }
      emitDemoAssistantExact(SCRIPT_TEMPLATES.confirmPrompt, `confirm-prompt:${active.id}`);
      return;
    }

    if (active && demoPhaseRef.current === "collecting" && active.serviceType !== "taxi" && isDemoPositiveIntent(text)) {
      applyDemoDefaultsBeforeChecking(active);
      enterDemoChecking(active);
      return;
    }
    const detected = customerAnalysis.intent === "confirm" || customerAnalysis.intent === "restart" || customerAnalysis.intent === "end"
      ? "unknown"
      : customerAnalysis.intent;
    if (!active || (detected !== "unknown" && !isSameDemoServiceRequest(text, active))) {
      beginDemoService(text);
      return;
    }

    if (demoPhaseRef.current === "collecting" && active.serviceType !== "taxi" && isDemoPositiveIntent(text)) {
      applyDemoDefaultsBeforeChecking(active);
      enterDemoChecking(active);
      return;
    }

    handleDemoCollecting(text, active);
  }

  function getOpeningGreetingMessage() {
    return FIRST_MESSAGE;
  }

  function scheduleGreetingWhenReady() {
    if (isCompletedHardLocked()) {
      enforceCompletedHardLock("scheduleGreetingWhenReady");
      return;
    }
    if (hasSentGreetingRef.current || isGreetingInProgressRef.current) return;
    if (!isDataChannelReadyRef.current || !sttListenerEnabledRef.current) return;
    if (!dcRef.current || dcRef.current.readyState !== "open") return;
    if (!pcRef.current || ["failed", "closed"].includes(pcRef.current.connectionState)) return;
    if (isResponseInProgressRef.current) return;
    if (greetingTimeoutRef.current) window.clearTimeout(greetingTimeoutRef.current);
    greetingTimeoutRef.current = window.setTimeout(() => {
      greetingTimeoutRef.current = null;
      if (isCompletedHardLocked()) {
        enforceCompletedHardLock("scheduleGreetingWhenReady:callback");
        return;
      }
      sendInitialGreetingOnce();
    }, GREETING_START_DELAY_MS);
  }

  function sendInitialGreetingOnce(retryMessage?: string) {
    if (isCompletedHardLocked()) {
      enforceCompletedHardLock("sendInitialGreetingOnce");
      return;
    }
    if (hasSentGreetingRef.current && !retryMessage) return;
    if (isGreetingInProgressRef.current || isResponseInProgressRef.current) return;
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    hasSentGreetingRef.current = true;
    greetingSentRef.current = true;
    isGreetingInProgressRef.current = true;
    lastGreetingStartedAtRef.current = Date.now();
    lastAssistantStartedAtRef.current = Date.now();
    clearPendingResponseTimer();
    setMicrophoneEnabled(false, "auto");
    updateAppStatus("GREETING");
    setVoiceState("AI 응답 중");
    const greetingMessage = retryMessage ?? getOpeningGreetingMessage();
    emitDemoAssistantExact(greetingMessage, "greeting");
    isAssistantAudioPlayingRef.current = true;
    startGreetingWatchdog();
  }

  function startGreetingWatchdog() {
    if (greetingTimeoutRef.current) window.clearTimeout(greetingTimeoutRef.current);
    greetingTimeoutRef.current = window.setTimeout(() => {
      greetingTimeoutRef.current = null;
      if (isCompletedHardLocked()) {
        enforceCompletedHardLock("startGreetingWatchdog:callback");
        return;
      }
      if (!isGreetingInProgressRef.current) return;
      console.warn("Initial greeting stuck. Recovering.");
      isGreetingInProgressRef.current = false;
      isResponseInProgressRef.current = false;
      isAssistantSpeakingRef.current = false;
      isAssistantAudioPlayingRef.current = false;
      setMicrophoneEnabled(false, "auto");
      if (greetingRetryCountRef.current < GREETING_MAX_RETRY) {
        greetingRetryCountRef.current += 1;
        sendInitialGreetingOnce(FIRST_MESSAGE);
        return;
      }
      markAssistantSpeakingEnd();
    }, GREETING_STUCK_TIMEOUT_MS);
  }

  function completeGreetingTurn() {
    if (greetingTimeoutRef.current) window.clearTimeout(greetingTimeoutRef.current);
    greetingTimeoutRef.current = null;
    isGreetingInProgressRef.current = false;
    lastGreetingCompletedAtRef.current = Date.now();
    if (demoPhaseRef.current === "greeting") setDemoPhase("collecting");
    isResponseInProgressRef.current = false;
    isAssistantSpeakingRef.current = false;
    isAssistantAudioPlayingRef.current = false;
    markAssistantSpeakingEnd();
  }

  function startWatchdog() {
    if (watchdogTimerRef.current) window.clearInterval(watchdogTimerRef.current);
    watchdogTimerRef.current = window.setInterval(checkStuckState, 1000);
  }

  function stopWatchdog() {
    if (watchdogTimerRef.current) window.clearInterval(watchdogTimerRef.current);
    watchdogTimerRef.current = null;
  }

  function checkStuckState() {
    if (isBlockedAfterCompleted("checkStuckState")) return;
    const now = Date.now();
    if (demoPhaseRef.current === "checking") {
      // 제휴사 확인 중에는 내부 완료 타이머만 신뢰한다.
      // 2.5초 침묵 watchdog/fallback이 끼어들면 완료 멘트가 밀리므로 여기서 즉시 빠져나간다.
      if (activeDemoServiceRef.current && !completionTimerRef.current) {
        startSuccessTimer(activeDemoServiceRef.current);
      }
      return;
    }
    if (isAssistantTurnActive() && lastAssistantStartedAtRef.current && now - lastAssistantStartedAtRef.current > AI_RESPONSE_STUCK_TIMEOUT_MS) {
      forceRecoverToListening("AI response stuck");
      return;
    }
    if (currentAppStatusRef.current === "ECHO GUARD" && now > assistantEchoGuardUntilRef.current + 500) {
      forceRecoverToListening("Echo guard stuck");
      return;
    }
    if (demoPhaseRef.current === "greeting" || demoPhaseRef.current === "collecting" || demoPhaseRef.current === "confirming" || demoPhaseRef.current === "completed" || demoPhaseRef.current === "followup_listening" || demoPhaseRef.current === "ending") {
      // 데모 대화 중에는 과거 analysis 기반 fallback을 쓰지 않는다.
      // 이전 택시 analysis가 병원/틴팅 흐름에 섞여 나오는 문제를 막는다.
      return;
    }
    if (lastValidUserTurnRef.current && fallbackPromptCountRef.current < MAX_FALLBACK_PROMPT_COUNT && !isAssistantTurnActive()) {
      const userWait = now - lastUserTranscriptAtRef.current;
      const assistantWait = now - lastAssistantMessageAtRef.current;
      if (userWait > USER_TURN_RESPONSE_TIMEOUT_MS && assistantWait > USER_TURN_RESPONSE_TIMEOUT_MS) {
        fallbackPromptCountRef.current += 1;
        lastValidUserTurnRef.current = "";
        setAssistHint(SCRIPT_TEMPLATES.waitingForCustomer);
        console.debug("[STATE_MACHINE_ONLY] skipped_context_fallback");
      }
    }
  }

  function forceRecoverToListening(reason: string) {
    if (isBlockedAfterCompleted("forceRecoverToListening")) return;
    console.warn(reason);
    isResponseInProgressRef.current = false;
    isAssistantSpeakingRef.current = false;
    isAssistantAudioPlayingRef.current = false;
    clearPendingResponseTimer();
    if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
    responseTimerRef.current = null;
    assistantEchoGuardUntilRef.current = 0;
    if (demoPhaseRef.current === "idle") {
      setMicrophoneEnabled(false, "auto");
      updateAppStatus("AI READY");
      setVoiceState("대기 중");
      return;
    }
    setMicrophoneEnabled(!isManualModeRef.current, "auto");
    updateAppStatus("LISTENING");
    setVoiceState("고객 말씀 대기 중");
    if (reason === "AI response stuck" && lastAssistantResponseMessageRef.current && assistantRetryCountRef.current < 1) {
      assistantRetryCountRef.current += 1;
      console.debug("[STATE_MACHINE_ONLY] skipped_ai_retry_response");
    }
  }

  async function startCall() {
    releaseDemoCompletedLockByStartButton();
    setError(null);
    setConnection("마이크 권한 요청 중");
    updateAppStatus("CONNECTING");
    setPhase("call");
    setMockOrderId(null);
    setLogs([]);
    setTranscript("");
    transcriptRef.current = "";
    pendingAnalysisRef.current = null;
    confirmedAnalysisRef.current = null;
    detailNotesRef.current = [];
    remainingFieldsRef.current = [];
    confirmedSlotsRef.current = {};
    activeDemoServiceRef.current = null;
    emittedAssistantMessageKeysRef.current = new Set();
    completedServiceIdsRef.current = new Set();
    setDemoPhase("greeting");
    lastAssistantTextRef.current = "";
    lastAssistantResponseMessageRef.current = "";
    assistantRetryCountRef.current = 0;
    lastAssistantStartedAtRef.current = 0;
    lastAssistantSpokeAtRef.current = 0;
    lastAssistantFinishedAtRef.current = 0;
    assistantEchoGuardUntilRef.current = 0;
    lastUserSpeechStoppedAtRef.current = 0;
    lastUserTranscriptAtRef.current = 0;
    lastAssistantMessageAtRef.current = 0;
    lastStateChangedAtRef.current = Date.now();
    lastValidUserTurnRef.current = "";
    currentAppStatusRef.current = "CONNECTING";
    fallbackPromptCountRef.current = 0;
    operatorTransferTriggeredRef.current = false;
    waitingForAdditionalRequestRef.current = false;
    isAssistantSpeakingRef.current = false;
    isAssistantAudioPlayingRef.current = false;
    isResponseInProgressRef.current = false;
    assistantEchoGuardUntilRef.current = 0;
    lastValidUserTurnRef.current = "";
    fallbackPromptCountRef.current = 0;
    userSpeakingRef.current = false;
    isListeningEnabledRef.current = false;
    noSpeechCountRef.current = 0;
    unclearCountRef.current = 0;
    noiseCountRef.current = 0;
    lastIgnoredTranscriptRef.current = "";
    lastAcceptedTranscriptRef.current = "";
    lastAcceptedAtRef.current = 0;
    latestFinalTranscriptRef.current = "";
    sttTurnBufferRef.current = [];
    sttLastBufferedAtRef.current = 0;
    sttListenerEnabledRef.current = false;
    lastProcessedTranscriptRef.current = "";
    ignoredEchoCountRef.current = 0;
    expectedAssistantMessageRef.current = "";
    setIsPushToTalkActive(false);
    setIsManualMode(false);
    isManualModeRef.current = false;
    setVoiceState("대기 중");
    setAssistHint(SCRIPT_TEMPLATES.initialGreetingHint);
    setUnderstoodText("");
    setFinalSummary("");
    setServiceStatus("listening");
    setConfirmedSlots({});
    setDemoCompletionHint("");
    setIsWaitingDemoCompletion(false);
    if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    completionTimerRef.current = null;
    completionTimerServiceIdRef.current = null;
    checkingServiceIdRef.current = null;
    setSatisfactionState("확인 전");
    greetingSentRef.current = false;
    hasSentGreetingRef.current = false;
    isGreetingInProgressRef.current = false;
    isInitialAudioReadyRef.current = false;
    isDataChannelReadyRef.current = false;
    isRemoteAudioReadyRef.current = false;
    greetingRetryCountRef.current = 0;
    lastGreetingStartedAtRef.current = 0;
    lastGreetingCompletedAtRef.current = 0;
    if (greetingTimeoutRef.current) window.clearTimeout(greetingTimeoutRef.current);
    greetingTimeoutRef.current = null;
    if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
    responseTimerRef.current = null;
    clearPendingResponseTimer();
    startWatchdog();
    appendLog("system", "통화를 시작합니다.");

    try {
      const healthResponse = await fetchWithTimeout(`${API_BASE}/health`);
      if (!healthResponse.ok) throw new Error("서버 연결 실패: Express 서버 /health 확인에 실패했습니다.");

      const tokenResponse = await fetchWithTimeout(`${API_BASE}/realtime/session`, { method: "POST" });
      if (!tokenResponse.ok) throw new Error(await formatApiError(tokenResponse));
      const tokenPayload = await tokenResponse.json();
      const ephemeralKey = tokenPayload.value ?? tokenPayload.client_secret?.value;
      if (!ephemeralKey) throw new Error("Realtime ephemeral key 응답을 찾지 못했습니다.");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.onconnectionstatechange = () => setConnection(pc.connectionState);

      const audio = new Audio();
      audio.autoplay = false;
      audio.muted = true;
      audioRef.current = audio;
      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];
        isRemoteAudioReadyRef.current = true;
        isInitialAudioReadyRef.current = true;
        scheduleGreetingWhenReady();
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = mediaStream;
      mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      mediaStream.getAudioTracks().forEach((track) => pc.addTrack(track, mediaStream));
      sttListenerEnabledRef.current = true;

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("open", () => {
        appendLog("event", "Realtime 데이터 채널이 열렸습니다.");
        isDataChannelReadyRef.current = true;
        scheduleGreetingWhenReady();
      });
      dc.addEventListener("message", (event) => handleRealtimeEvent(event.data));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetchWithTimeout("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp"
        }
      });
      if (!sdpResponse.ok) throw new Error(await sdpResponse.text());
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
      setConnection("connected");
      scheduleGreetingWhenReady();
      setVoiceState("대기 중");
    } catch (err) {
      const message = formatClientError(err);
      const transferContext: Partial<OperatorTransferContext> = {
        failureReason: "API 요청 실패 또는 타임아웃",
        urgency: "P1",
        rawTranscript: transcriptRef.current,
        activeService: activeDemoServiceRef.current,
        analysis,
        slots: confirmedSlotsRef.current,
        serviceStatus: serviceStatusRef.current,
        demoPhase: demoPhaseRef.current,
        errorMessage: message
      };
      updateAppStatus("SERVER ERROR");
      setError(message);
      appendLog("system", message);
      stopCall(false);
      triggerOperatorTransfer("API 요청 실패 또는 타임아웃", transferContext);
    }
  }

  function handleRealtimeEvent(raw: string) {
    const event = JSON.parse(raw);
    if (isCompletedHardLocked()) {
      enforceCompletedHardLock(`realtime:${event.type ?? "unknown"}`);
      return;
    }

    if (String(event.type ?? "").startsWith("response.")) {
      cancelRealtimeModelOutput(String(event.type ?? "response"));
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      if (!sttListenerEnabledRef.current) return;
      if (isGreetingInProgressRef.current || isAssistantTurnActive() || isInsideAssistantEchoGuard()) {
        ignoredEchoCountRef.current += 1;
        setVoiceState("에코 차단 중");
        return;
      }
      userSpeakingRef.current = true;
      sttTurnBufferRef.current = [];
      latestFinalTranscriptRef.current = "";
      clearPendingResponseTimer();
      setVoiceState("고객 말씀 대기 중");
      updateAppStatus("LISTENING");
      return;
    }
    if (event.type === "input_audio_buffer.speech_stopped") {
      if (!sttListenerEnabledRef.current) return;
      userSpeakingRef.current = false;
      lastUserSpeechStoppedAtRef.current = Date.now();
      if (isGreetingInProgressRef.current || isAssistantTurnActive() || isInsideAssistantEchoGuard()) return;
      scheduleUserTurnProcessing();
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      enqueueFinalTranscript(String(event.transcript ?? ""));
    }
    if (event.type === "error") {
      const errorMessage = event.error?.message ?? "Realtime error";
      console.warn(errorMessage);
      if (!operatorTransferTriggeredRef.current) {
        triggerOperatorTransfer("Realtime 응답 오류", {
          failureReason: "Realtime 응답 오류",
          urgency: "P1",
          errorMessage
        });
      }
    }
  }

  function processCustomerTranscript(text: string) {
    const trimmed = text.trim();

    if (isCompletedHardLocked()) {
      enforceCompletedHardLock("processCustomerTranscript");
      return;
    }

    if (!trimmed) {
      handleNoSpeech();
      return;
    }

    if (isAssistantEchoTranscript(trimmed)) {
      console.log("[DEMO_FLOW] ignored_assistant_echo", {
        text: trimmed,
        lastAssistant: lastAssistantExactTextRef.current,
        phase: demoPhaseRef.current
      });
      return;
    }

    if (Date.now() < ignoreUserInputUntilRef.current) {
      console.log("[DEMO_FLOW] ignored_input_cooldown", {
        text: trimmed,
        phase: demoPhaseRef.current
      });
      return;
    }

    const withinSpeechWindow = !isManualModeRef.current || isListeningEnabledRef.current || Date.now() - lastPushToTalkAtRef.current < 5000;

    if (!withinSpeechWindow) {
      if (trimmed) {
        console.debug("Ignored transcript while listening is disabled", trimmed);
        setVoiceState("소음 무시");
      }
      return;
    }

    const isDemoControlCommand = isDemoControlTranscript(trimmed);

    if (isAssistantTurnActive() && !isDemoControlCommand) {
      console.debug("Ignored transcript while assistant is speaking", trimmed);
      setVoiceState("AI 응답 중");
      return;
    }

    if (!isDemoControlCommand && (isInsideAssistantEchoGuard() || (Date.now() - lastAssistantSpokeAtRef.current < ASSISTANT_ECHO_GUARD_MS && isAssistantEcho(trimmed, lastAssistantTextRef.current)))) {
      console.debug("Ignored possible assistant echo", trimmed);
      setVoiceState("에코 차단 중");
      return;
    }

    const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (!isDemoControlCommand && lastAcceptedTranscriptRef.current === normalized && Date.now() - lastAcceptedAtRef.current < 3500) {
      console.debug("Ignored duplicated transcript", trimmed);
      setVoiceState("대기 중");
      return;
    }
    if (!isDemoControlCommand && lastProcessedTranscriptRef.current === normalized) {
      console.debug("Ignored already processed transcript", trimmed);
      return;
    }
    if (!isValidCustomerTranscript(trimmed)) {
      handleRejectedTranscript(trimmed);
      return;
    }

    const customerAnalysis = buildCustomerUtteranceAnalysis(trimmed);
    console.debug("[CUSTOMER_ANALYSIS_JSON]", customerAnalysis);

    lastValidUserTurnRef.current = trimmed;
    lastUserTranscriptAtRef.current = Date.now();
    fallbackPromptCountRef.current = 0;
    appendLog("user", trimmed);
    setVoiceState("고객 말씀 확인 중");

    lastAcceptedTranscriptRef.current = normalized;
    lastAcceptedAtRef.current = Date.now();
    lastProcessedTranscriptRef.current = normalized;
    const acceptedTranscript = `${transcriptRef.current}\n${trimmed}`.trim();
    transcriptRef.current = acceptedTranscript;
    setTranscript(acceptedTranscript);
    noSpeechCountRef.current = 0;
    unclearCountRef.current = 0;
    noiseCountRef.current = 0;
    handleDemoConversation(customerAnalysis);
  }

  function handleNoSpeech() {
    if (isBlockedAfterCompleted("handleNoSpeech")) return;
    noSpeechCountRef.current += 1;
    updateAppStatus("NO SPEECH");
    setVoiceState("말씀 미확인");
    const message = noSpeechCountRef.current >= 2
      ? SCRIPT_TEMPLATES.noSpeechRepeat
      : SCRIPT_TEMPLATES.noSpeechFirst;
    appendLog("system", message);
    setAssistHint(message);
    if (noSpeechCountRef.current <= 1) emitDemoAssistantExact(SCRIPT_TEMPLATES.noSpeechVoice, "no-speech:first");
    if (noSpeechCountRef.current >= 3) {
      updateAppStatus("LISTENING");
      setAssistHint(SCRIPT_TEMPLATES.waitingForCustomer);
    }
  }

  function handleUnclearSpeech() {
    if (isBlockedAfterCompleted("handleUnclearSpeech")) return;
    unclearCountRef.current += 1;
    updateAppStatus("UNCLEAR SPEECH");
    setVoiceState("다시 말씀 필요");
    const message = unclearCountRef.current >= 2
      ? SCRIPT_TEMPLATES.unclearRepeat
      : SCRIPT_TEMPLATES.unclearFirst;
    appendLog("system", message);
    setAssistHint(message);
    if (unclearCountRef.current < 3) emitDemoAssistantExact(message, `unclear:${unclearCountRef.current}`);
    if (unclearCountRef.current >= 3) {
      setAssistHint(SCRIPT_TEMPLATES.operatorHandoffHint);
      if (!operatorTransferTriggeredRef.current) {
        triggerOperatorTransfer("STT 인식 실패", {
          failureReason: "STT 인식 실패",
          urgency: "P2"
        });
      }
    }
  }

  function handleUnsupportedLanguage() {
    if (isBlockedAfterCompleted("handleUnsupportedLanguage")) return;
    unclearCountRef.current += 1;
    updateAppStatus("UNSUPPORTED LANGUAGE");
    setVoiceState("다시 말씀 필요");
    appendLog("system", "지원하지 않는 언어이거나 말씀을 정확히 파악하지 못했습니다.");
    setAssistHint(SCRIPT_TEMPLATES.unsupportedLanguageHint);
    emitDemoAssistantExact(SCRIPT_TEMPLATES.unsupportedLanguage, "unsupported-language");
  }

  function handleNoiseLikeTranscript(text: string) {
    if (isBlockedAfterCompleted("handleNoiseLikeTranscript")) return;
    noiseCountRef.current += 1;
    updateAppStatus("NO SPEECH");
    setVoiceState("소음 무시");
    const normalized = text.trim().toLowerCase();
    const repeated = lastIgnoredTranscriptRef.current === normalized;
    lastIgnoredTranscriptRef.current = normalized;
    appendLog("system", repeated ? "주변 소음으로 판단해 분석하지 않았습니다." : "고객 말씀이 확인되지 않았습니다.");
    setAssistHint(SCRIPT_TEMPLATES.noiseHint);
    if (!repeated && noiseCountRef.current <= 1) {
      emitDemoAssistantExact(SCRIPT_TEMPLATES.noiseRetry, "noise:first");
    }
    if (noiseCountRef.current >= 3) {
      setAssistHint(SCRIPT_TEMPLATES.waitingForCustomer);
    }
  }

  function markAssistantSpeakingStart(audioPlaying = false) {
    if (isCompletedHardLocked()) {
      enforceCompletedHardLock("markAssistantSpeakingStart");
      return;
    }
    if (!lastAssistantStartedAtRef.current || !isResponseInProgressRef.current) {
      lastAssistantStartedAtRef.current = Date.now();
    }
    isAssistantSpeakingRef.current = true;
    if (audioPlaying) isAssistantAudioPlayingRef.current = true;
    clearPendingResponseTimer();
    setMicrophoneEnabled(false, "auto");
    updateAppStatus("AI SPEAKING");
    setVoiceState("AI 응답 중");
  }

  function markAssistantSpeakingEnd() {
    lastAssistantFinishedAtRef.current = Date.now();
    lastAssistantSpokeAtRef.current = Date.now();
    clearAssistantEchoReleaseTimer();
    if (isCompletedHardLocked()) {
      assistantEchoGuardUntilRef.current = 0;
      setMicrophoneEnabled(false, "completed");
      updateAppStatus("AI READY");
      setVoiceState("완료");
      return;
    }
    assistantEchoGuardUntilRef.current = Date.now() + ASSISTANT_ECHO_GUARD_MS;
    setMicrophoneEnabled(false, "auto");
    updateAppStatus("ECHO GUARD");
    setVoiceState("에코 차단 중");
    assistantEchoReleaseTimerRef.current = window.setTimeout(() => {
      assistantEchoReleaseTimerRef.current = null;
      if (Date.now() < assistantEchoGuardUntilRef.current) return;
      if (isCompletedHardLocked()) {
        setMicrophoneEnabled(false, "completed");
        updateAppStatus("AI READY");
        setVoiceState("완료");
        return;
      }
      if (demoPhaseRef.current === "idle") {
        setMicrophoneEnabled(false, "auto");
        setVoiceState("대기 중");
        setAssistHint(SCRIPT_TEMPLATES.standbyHint);
        return;
      }
      if (demoPhaseRef.current === "followup_listening") {
        if (!isManualModeRef.current && pcRef.current) {
          setMicrophoneEnabled(true, "auto");
          setVoiceState("고객 말씀 대기 중");
          setAssistHint(SCRIPT_TEMPLATES.followupGuide);
        } else {
          setVoiceState(isListeningEnabledRef.current ? "듣는 중" : "대기 중");
        }
        if (!followupIdleTimerRef.current) startFollowupIdleTimer();
        return;
      }
      if (!isManualModeRef.current && pcRef.current) {
        setMicrophoneEnabled(true, "auto");
        setVoiceState("고객 말씀 대기 중");
        setAssistHint(SCRIPT_TEMPLATES.autoListenHint);
      } else {
        setVoiceState(isListeningEnabledRef.current ? "듣는 중" : "대기 중");
      }
    }, ASSISTANT_ECHO_GUARD_MS);
  }

  function clearPendingResponseTimer() {
    if (pendingResponseTimerRef.current) {
      window.clearTimeout(pendingResponseTimerRef.current);
      pendingResponseTimerRef.current = null;
    }
  }

  function isInsideAssistantEchoGuard() {
    return guardIsInsideAssistantEchoGuard({
      assistantEchoGuardUntil: assistantEchoGuardUntilRef.current,
      lastAssistantFinishedAt: lastAssistantFinishedAtRef.current
    });
  }

  function isAssistantTurnActive() {
    return guardIsAssistantTurnActive({
      isGreetingInProgress: isGreetingInProgressRef.current,
      isAssistantSpeaking: isAssistantSpeakingRef.current,
      isAssistantAudioPlaying: isAssistantAudioPlayingRef.current,
      isResponseInProgress: isResponseInProgressRef.current
    });
  }

  function normalizeSttSegment(text: string) {
    return text.trim().replace(/\s+/g, " ");
  }

  function mergeSttTurnSegments(segments: string[]) {
    const merged: string[] = [];
    for (const segment of segments.map(normalizeSttSegment).filter(Boolean)) {
      const previous = merged[merged.length - 1];
      if (previous && (previous === segment || previous.includes(segment))) continue;
      if (previous && segment.includes(previous)) {
        merged[merged.length - 1] = segment;
        continue;
      }
      merged.push(segment);
    }
    return merged.join(" ").replace(/\s+/g, " ").trim();
  }

  function peekBufferedCustomerTurn() {
    return mergeSttTurnSegments(sttTurnBufferRef.current);
  }

  function consumeBufferedCustomerTurn() {
    const text = peekBufferedCustomerTurn();
    clearSttTurn();
    return text;
  }

  function shouldFlushBufferedTurnSoon(text: string) {
    const clean = text.trim();
    if (!clean) return false;
    if (demoPhaseRef.current === "followup_listening" && (isFollowUpEndIntent(clean) || isFollowUpNewServiceIntent(clean))) return true;
    if (isDemoControlTranscript(clean) || isDemoEndIntent(clean) || isDemoRestartIntent(clean) || isDemoPositiveIntent(clean)) return true;
    const active = activeDemoServiceRef.current;
    if (!active) return detectDemoServiceType(clean) !== "unknown";
    const projected: DemoService = {
      ...active,
      slots: sanitizeDemoSlots({ ...active.slots, ...extractDemoSlots(clean, active) })
    };
    return getDemoMissingFields(projected).length === 0;
  }

  function enqueueFinalTranscript(text: string) {
    if (!sttListenerEnabledRef.current || isCompletedHardLocked()) {
      if (isCompletedHardLocked()) enforceCompletedHardLock("enqueueFinalTranscript");
      return;
    }

    const clean = normalizeSttSegment(text);
    if (!clean) return;
    if (isGreetingInProgressRef.current || isAssistantTurnActive()) return;
    if (!isDemoControlTranscript(clean) && isInsideAssistantEchoGuard()) return;
    if (isAssistantEchoTranscript(clean)) return;

    appendFinalTranscriptSegment(clean);
    if (!userSpeakingRef.current && lastUserSpeechStoppedAtRef.current > 0) {
      scheduleUserTurnProcessing();
    }
  }

  function buildCustomerUtteranceAnalysis(text: string): CustomerUtteranceAnalysis {
    const transcriptValue = text.trim();
    const active = activeDemoServiceRef.current;
    const detected = detectDemoServiceType(transcriptValue);
    const positive = isDemoPositiveIntent(transcriptValue);
    const restart = isDemoRestartIntent(transcriptValue);
    const end = isDemoEndIntent(transcriptValue);
    const slotService = active ?? makeDemoService(transcriptValue);
    const slots = extractDemoSlots(transcriptValue, slotService);
    const projected: DemoService = {
      ...slotService,
      slots: sanitizeDemoSlots({ ...slotService.slots, ...slots })
    };
    const missing = getDemoMissingFields(projected);

    let intent: CustomerUtteranceAnalysis["intent"] = detected;
    if (positive) intent = "confirm";
    if (restart) intent = "restart";
    if (end) intent = "end";

    let nextEvent: CustomerNextEvent = "ignore";
    if (demoPhaseRef.current === "followup_listening" && isFollowUpEndIntent(transcriptValue)) nextEvent = "end_service";
    else if (demoPhaseRef.current === "followup_listening" && isFollowUpNewServiceIntent(transcriptValue)) nextEvent = "start_service";
    else if (end) nextEvent = "end_service";
    else if (restart) nextEvent = "restart_service";
    else if (positive) nextEvent = "confirm_service";
    else if (!active && detected !== "unknown") nextEvent = "start_service";
    else if (active && detected !== "unknown" && !isSameDemoServiceRequest(transcriptValue, active)) nextEvent = "start_service";
    else if (Object.keys(slots).length > 0) nextEvent = missing.length === 0 ? "confirm_service" : "update_slots";
    else if (detected !== "unknown") nextEvent = "start_service";

    const confidence = end || restart || positive
      ? 0.95
      : detected !== "unknown"
        ? 0.9
        : Object.keys(slots).length > 0
          ? 0.72
          : 0.4;

    return {
      transcript: transcriptValue,
      intent,
      slots,
      missing_slots: missing,
      confidence,
      next_event: nextEvent
    };
  }

  function scheduleUserTurnProcessing() {
    if (isCompletedHardLocked()) {
      enforceCompletedHardLock("scheduleUserTurnProcessing");
      return;
    }
    clearPendingResponseTimer();
    const buffered = peekBufferedCustomerTurn();
    const delayMs = shouldFlushBufferedTurnSoon(buffered) ? STT_SLOT_READY_WAIT_MS : STT_TURN_MERGE_WAIT_MS;
    pendingResponseTimerRef.current = window.setTimeout(() => {
      pendingResponseTimerRef.current = null;
      if (isCompletedHardLocked()) {
        enforceCompletedHardLock("scheduleUserTurnProcessing:callback");
        return;
      }
      const text = peekBufferedCustomerTurn();
      if (!isValidUserTranscript(text)) {
        clearSttTurn();
        if (!text) {
          handleNoSpeech();
          return;
        }
        if (text) handleRejectedTranscript(text);
        return;
      }
      try {
        processCustomerTranscript(text);
      } finally {
        clearSttTurn();
      }
    }, delayMs);
  }

  function isValidUserTranscript(text: string) {
    if (isCompletedHardLocked()) return false;
    if (isDemoControlTranscript(text)) return true;
    return isValidFinalTranscript(
      text,
      {
        isGreetingInProgress: isGreetingInProgressRef.current,
        isAssistantSpeaking: isAssistantSpeakingRef.current,
        isAssistantAudioPlaying: isAssistantAudioPlayingRef.current,
        isResponseInProgress: isResponseInProgressRef.current,
        assistantEchoGuardUntil: assistantEchoGuardUntilRef.current,
        lastAssistantFinishedAt: lastAssistantFinishedAtRef.current,
        lastProcessedTranscript: lastProcessedTranscriptRef.current,
        lastAssistantText: lastAssistantTextRef.current
      },
      isContextualShortSlot(text),
      isNoiseLikeTranscript,
      isAssistantEcho
    );
  }

  function hasActiveServiceContext() {
    return Boolean(activeDemoServiceRef.current) || demoPhaseRef.current === "confirming";
  }

  function isDemoControlTranscript(text: string) {
    const clean = text.trim();
    if (!clean) return false;

    if (demoPhaseRef.current === "confirming" && (isDemoPositiveIntent(clean) || isDemoRestartIntent(clean))) return true;
    if (
      demoPhaseRef.current === "collecting" &&
      activeDemoServiceRef.current &&
      activeDemoServiceRef.current.serviceType !== "taxi" &&
      isDemoPositiveIntent(clean)
    ) {
      return true;
    }
    return false;
  }

  function isContextualShortSlot(text: string) {
    const clean = text.trim();
    if (isDemoControlTranscript(clean)) return true;
    if (!hasActiveServiceContext()) return false;
    if (regionKeywords.includes(clean)) return true;
    if (dateKeywords.some((word) => clean.includes(word))) return true;
    if (/^\d{1,2}시$/.test(clean)) return true;
    if (/개인\s*병원|종합\s*병원|피부과|정형외과|내과|소아과/.test(clean)) return true;
    return false;
  }

  function isValidCustomerTranscript(text: string) {
    const clean = text.trim();
    const normalized = clean.toLowerCase().replace(/\s+/g, " ");
    const isDemoControlCommand = isDemoControlTranscript(clean);
    if (!clean) return false;
    if (demoPhaseRef.current === "followup_listening") return true;
    if (isAssistantTurnActive() && !isDemoControlCommand) return false;
    if (!isDemoControlCommand && isInsideAssistantEchoGuard()) return false;
    if (isProbablyForeignNoise(clean) && clean.length < 24) return false;
    if (/고객\s*다른\s*기분나/.test(clean)) return false;
    if (!isDemoControlCommand && normalized === lastProcessedTranscriptRef.current) return false;
    if (!isDemoControlCommand && isAssistantEcho(clean, lastAssistantTextRef.current)) return false;
    if (isContextualShortSlot(clean)) return true;
    if (clean.length <= 2 && !hasActiveServiceContext()) return false;
    return true;
  }

  function handleRejectedTranscript(text: string) {
    if (isProbablyForeignNoise(text)) {
      noiseCountRef.current += 1;
      if (noiseCountRef.current >= 2 && lastIgnoredTranscriptRef.current !== text) {
        lastIgnoredTranscriptRef.current = text;
        appendLog("system", "주변 소리로 인식되어 고객 말씀으로 처리하지 않았습니다. 다시 말씀해 주세요.");
      } else {
        console.debug("Ignored foreign/noise transcript", text);
      }
      return;
    }
    console.debug("Rejected customer transcript before logging", text);
  }

  function setMicrophoneEnabled(enabled: boolean, source: "auto" | "manual" | "completed" = "auto") {
    if (isCompletedHardLocked()) {
      if (enabled) console.log("[DEMO_FLOW] blocked_microphone_enable_after_completed", { source });
      enabled = false;
      source = "completed";
    }
    isListeningEnabledRef.current = enabled;
    setIsPushToTalkActive(source === "manual" && enabled);
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    if (enabled) {
      setVoiceState(source === "manual" ? "듣는 중" : "고객 말씀 대기 중");
      updateAppStatus("LISTENING");
      setAssistHint(source === "manual" ? SCRIPT_TEMPLATES.manualListenHint : SCRIPT_TEMPLATES.autoWaitingHint);
    } else {
      lastPushToTalkAtRef.current = Date.now();
      if (source === "completed") {
        setVoiceState("완료");
        setAssistHint(SCRIPT_TEMPLATES.completedLocked);
      } else {
        setVoiceState("고객 말씀 확인 중");
        setAssistHint(source === "manual" ? SCRIPT_TEMPLATES.manualAnalyzingHint : SCRIPT_TEMPLATES.assistantTurnPausedHint);
      }
    }
  }

  function togglePushToTalk() {
    if (phase !== "call" || isAssistantSpeakingRef.current) return;
    if (isCompletedHardLocked()) return;
    if (demoPhaseRef.current === "idle") {
      recallBabelfish();
      return;
    }
    setMicrophoneEnabled(!isListeningEnabledRef.current, "manual");
  }

  function recallBabelfish() {
    startWatchdog();
    sttListenerEnabledRef.current = true;
    waitingForAdditionalRequestRef.current = false;
    sttTurnBufferRef.current = [];
    sttLastBufferedAtRef.current = 0;
    latestFinalTranscriptRef.current = "";
    activeDemoServiceRef.current = null;
    setDemoPhase("idle");
    setServiceStatus("listening");
    setStatus("draft");
    updateAppStatus("LISTENING");
    setVoiceState("고객 말씀 대기 중");
    const message = SCRIPT_TEMPLATES.recall;
    emitDemoAssistantExact(message, "recall");
  }

  function toggleManualMode() {
    if (isCompletedHardLocked()) {
      enforceCompletedHardLock("toggleManualMode");
      return;
    }
    const next = !isManualModeRef.current;
    isManualModeRef.current = next;
    setIsManualMode(next);
    if (next) {
      setMicrophoneEnabled(false, "manual");
      setAssistHint(SCRIPT_TEMPLATES.manualModeHint);
    } else if (!isAssistantSpeakingRef.current) {
      setMicrophoneEnabled(true, "auto");
      setAssistHint(SCRIPT_TEMPLATES.autoModeHint);
    }
  }

  function stopCall(showSummary = true) {
    if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
    responseTimerRef.current = null;
    clearPendingResponseTimer();
    clearAssistantEchoReleaseTimer();
    clearFollowupIdleTimer();
    stopWatchdog();
    if (completionTimerRef.current) {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
      setIsWaitingDemoCompletion(false);
    }
    completionTimerServiceIdRef.current = null;
    checkingServiceIdRef.current = null;
    greetingSentRef.current = false;
    hasSentGreetingRef.current = false;
    isGreetingInProgressRef.current = false;
    isInitialAudioReadyRef.current = false;
    isDataChannelReadyRef.current = false;
    isRemoteAudioReadyRef.current = false;
    if (greetingTimeoutRef.current) window.clearTimeout(greetingTimeoutRef.current);
    greetingTimeoutRef.current = null;
    isListeningEnabledRef.current = false;
    isAssistantSpeakingRef.current = false;
    isAssistantAudioPlayingRef.current = false;
    isResponseInProgressRef.current = false;
    userSpeakingRef.current = false;
    waitingForAdditionalRequestRef.current = false;
    sttListenerEnabledRef.current = false;
    sttTurnBufferRef.current = [];
    sttLastBufferedAtRef.current = 0;
    latestFinalTranscriptRef.current = "";
    activeDemoServiceRef.current = null;
    setDemoPhase("idle");
    setIsPushToTalkActive(false);
    setVoiceState("대기 중");
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    pcRef.current = null;
    dcRef.current = null;
    streamRef.current = null;
    setConnection("서비스 대기 중");
    setServiceStatus("standby");
    setStatus("standby");
    setAssistHint(standbyMessage);
    appendLog("system", "통화가 종료되었습니다.");
    updateAppStatus("AI READY");
    if (showSummary) setPhase("start");
  }

  const currentDemoService = activeDemoServiceRef.current;
  const currentDemoSlots = currentDemoService?.slots ?? {};
  const currentDemoLabel = currentDemoService ? getDemoServiceLabel(currentDemoService) : "요청 확인 후 안내";
  const currentDemoSummary = currentDemoService ? buildDemoUiSummary(currentDemoService) : "고객 말씀을 기다리고 있습니다.";
  const currentDemoNextMessage = currentDemoService ? buildDemoNextUiMessage(currentDemoService) : DEMO_SCRIPTS.start.unknown;
  const currentDemoPlan = currentDemoService
    ? demoPhase === "completed"
      ? buildDemoFulfillmentSummaryItems(currentDemoService)
      : buildDemoExecutionPlan(currentDemoService)
    : ["고객 요청 대기", "제휴 서비스 확인", "결과 안내"];

  if (phase === "start") {
    return (
      <main className="start-screen">
        <section className="start-panel">
          <div className="brand-lockup hero-brand">
            <img src="/babelfish-logo.png" alt="Babelfish logo" />
            <div>
              <p className="eyebrow">이해 · 연결 · 실행</p>
              <h1>{SERVICE_NAME}</h1>
            </div>
          </div>
          <p className="lead">고객의 요청을 이해하고, 제휴 네트워크와 연결해 실행까지 돕는 Babelfish 온디멘드 컨시어지</p>
          <button className="primary-call" onClick={startCall}>
            <Phone size={22} /> 서비스 시작
          </button>
          {serviceStatus === "standby" && <p className="assist-note">서비스가 종료되었습니다. 필요하시면 다시 Babelfish를 호출해 주세요.</p>}
          {error && <p className="error-text">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand-lockup">
          <img src="/babelfish-logo.png" alt="Babelfish logo" />
          <div>
            <p className="eyebrow">{phase === "summary" ? "실행 계획 확인" : "Babelfish 제휴 네트워크"}</p>
            <h1>{SERVICE_NAME}</h1>
            <p>말을 이해하는 것을 넘어, 원하는 서비스를 연결하고 실행하는 Babelfish</p>
          </div>
        </div>
        <div className="status-cluster">
          <div className={`status-badge ${appStatus.toLowerCase().replaceAll(" ", "-")}`}>{appStatusLabels[appStatus]}</div>
          <div className="call-status"><Mic size={20} /> {voiceState}</div>
          <div className="call-status connected-state">{connection}</div>
          {phase === "call" && <button className="stop-call" onClick={() => stopCall(true)}><CircleStop size={22} /> 종료</button>}
        </div>
      </header>

      <section className="call-layout">
        <div className="conversation-panel">
          <div className="panel-heading">
            <h2>대화 로그</h2>
          </div>
          <div className="voice-tools">
            <button className={`talk-button ${isPushToTalkActive ? "active" : ""}`} onClick={togglePushToTalk} disabled={phase !== "call" || isAssistantSpeakingRef.current}>
              <Mic size={18} /> {serviceStatus === "standby" ? "서비스 시작" : isAssistantSpeakingRef.current ? "AI 응답 중" : isPushToTalkActive ? "듣는 중" : "서비스 시작"}
            </button>
            <label className="manual-toggle">
              <input type="checkbox" checked={isManualMode} onChange={toggleManualMode} />
              <span>수동 말하기 모드</span>
            </label>
            <p>{assistHint}</p>
            <small>기본은 자동으로 듣습니다. 인식이 안 될 때만 화면의 말하기 컨트롤을 사용해 주세요.</small>
            <div className="service-state-grid">
              <span>현재 상태: {demoPhase === "idle" ? "서비스 대기 중" : demoPhase === "greeting" ? "첫 인사 중" : demoPhase === "collecting" ? "정보 수집 중" : demoPhase === "confirming" ? "고객 확인 중" : demoPhase === "checking" ? "제휴사 확인 중" : demoPhase === "followup_listening" ? "후속 요청 대기 중" : demoPhase === "ending" ? "종료 중" : "접수 완료"}</span>
              <span>최근 완료 서비스: {lastCompletedService?.serviceType ?? "없음"}</span>
              <span>만족도 확인: {satisfactionState}</span>
              <span>진행 안내: {isWaitingDemoCompletion ? "결과 확인 중" : demoCompletionHint || "대기 중"}</span>
            </div>
          </div>
          <div className="logs">
            {sortedLogs.map((log) => (
              <article key={log.id} className={`log ${log.role}`}>
                <span>{roleLabels[log.role]}</span>
                <p>{log.text}</p>
              </article>
            ))}
            {assistantDraft && <article className="log assistant"><span>{AI_NAME}</span><p>{assistantDraft}</p></article>}
          </div>
          <p className="demo-phase-hint">데모 상태: {demoPhase}</p>
        </div>

        <div className="insight-grid">
          <InsightCard title="Babelfish가 이해한 내용" tone={demoPhase === "checking" || demoPhase === "completed" ? "ok" : "warn"}>
            <p className="summary-text">{understoodText || currentDemoSummary}</p>
            <div className="confirmation-stack">
              <span className={`confirm-badge ${demoPhase === "checking" || demoPhase === "completed" || demoPhase === "followup_listening" ? "ready" : "pending"}`}>{demoPhase === "confirming" ? "고객 확인 필요" : demoPhase === "collecting" ? "추가 정보 필요" : demoPhase === "checking" ? "제휴사 확인 중" : demoPhase === "completed" ? "완료" : demoPhase === "followup_listening" ? "후속 요청 대기" : demoPhase === "ending" ? "종료 중" : "대기 중"}</span>
              <span>{remainingFieldsRef.current.length > 0 ? `부족 정보: ${remainingFieldsRef.current.join(", ")}` : "부족 정보 없음"}</span>
              <span>{currentDemoNextMessage}</span>
            </div>
            <dl className="slot-grid">
              <div><dt>요청 유형</dt><dd>{currentDemoLabel}</dd></div>
              <div><dt>출발지</dt><dd>{currentDemoSlots.origin ?? "-"}</dd></div>
              <div><dt>도착지</dt><dd>{currentDemoSlots.destination ?? "-"}</dd></div>
              <div><dt>지역/업체</dt><dd>{currentDemoSlots.location ?? currentDemoSlots.providerName ?? "-"}</dd></div>
              <div><dt>예약 일시</dt><dd>{currentDemoSlots.appointmentDateTime ?? currentDemoSlots.callTiming ?? "-"}</dd></div>
              <div><dt>차량/상품</dt><dd>{currentDemoSlots.vehicleInfo ?? currentDemoSlots.productName ?? "-"}</dd></div>
              <div><dt>확인 상태</dt><dd>{demoPhase === "confirming" ? "고객 확인 필요" : demoPhase === "checking" ? "제휴사 확인 중" : demoPhase === "completed" ? "완료" : demoPhase === "followup_listening" ? "후속 요청 대기" : demoPhase === "ending" ? "종료 중" : "정보 수집 중"}</dd></div>
            </dl>
            {finalSummary && <p className="final-summary">{finalSummary}</p>}
          </InsightCard>

          <InsightCard title="Babelfish 이해 내용" tone={currentDemoService ? "ok" : "neutral"}>
            <p className="summary-text">{currentDemoSummary}</p>
            <dl>
              <div><dt>고객 말씀</dt><dd>{currentDemoService?.rawText || "-"}</dd></div>
              <div><dt>Babelfish 해석</dt><dd>{currentDemoLabel}</dd></div>
              <div><dt>서비스 유형</dt><dd>{currentDemoService?.serviceType ?? "unknown"}</dd></div>
              <div><dt>언어</dt><dd>ko 허용</dd></div>
              <div><dt>신뢰도</dt><dd>{currentDemoService ? "100%" : "-"}</dd></div>
            </dl>
          </InsightCard>

          <InsightCard title="Babelfish 제휴 네트워크" tone="neutral">
            <div className="network-summary">
              <span><strong>기본 제휴사</strong>{currentDemoLabel}</span>
              <span><strong>고객 지정 업체</strong>{currentDemoSlots.providerName ?? "없음"}</span>
              <span><strong>추천 기준</strong>제휴사 우선 데모 정책</span>
              <span><strong>연결 상태</strong>{demoPhase === "checking" ? "확인 중" : demoPhase === "completed" ? "접수 완료" : "정보 확인 중"}</span>
            </div>
            <article className="partner">
              <div className="partner-head">
                <strong>{currentDemoLabel}</strong>
                <span>{currentDemoService?.serviceType ?? "대기 중"}</span>
              </div>
              <p>{currentDemoService ? "현재 요청한 서비스의 기본 제휴 네트워크로 연결합니다." : "서비스 요청 후 기본 제휴 네트워크를 안내합니다."}</p>
              <div className="partner-meta">
                <span>데모 기준</span>
                <span>결과 확인</span>
                <span>제휴사 우선</span>
              </div>
            </article>
          </InsightCard>

          <InsightCard title="실행 계획" tone="neutral">
            <ol className="plan-list">
              {currentDemoPlan.map((item) => <li key={item}>{item}</li>)}
            </ol>
            <div className="order-state"><Send size={16} /> {mockOrderId ? `${mockOrderId} ${isWaitingDemoCompletion ? "확인 중" : status === "completed" ? "성공" : status}` : status}</div>
            {demoCompletionHint && <p className="final-summary pending-summary">{demoCompletionHint}</p>}
          </InsightCard>
        </div>
      </section>
    </main>
  );
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // API 장애나 지연이 길어지면 상담원 수기 접수로 넘길 수 있도록 명시적으로 타임아웃을 건다.
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function formatApiError(response: Response) {
  try {
    const data = await response.json();
    return data.message ?? data.error ?? "서버 연결 실패 / API Key 확인 필요";
  } catch {
    return await response.text();
  }
}

function formatClientError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "서버 요청 시간이 초과되었습니다. 상담원 최우선 수기 접수로 이관합니다.";
  }
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return `서버 연결 실패: Express 서버(${API_BASE})가 실행 중인지, PORT=8787과 NEXT_PUBLIC_API_BASE_URL 설정이 일치하는지 확인해 주세요.`;
  }
  if (error instanceof Error) return error.message || "서버 연결 실패 / API Key 확인 필요";
  return "서버 연결 실패 / API Key 확인 필요";
}

function InsightCard({ title, tone, children }: { title: string; tone: "ok" | "warn" | "neutral"; children: React.ReactNode }) {
  return <section className={`insight-card ${tone}`}><h2>{title}</h2>{children}</section>;
}
