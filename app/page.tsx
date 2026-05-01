"use client";

import {
  analyzeRequest,
  buildPlaceConfirmationQuestion,
  getPlaceCandidates,
  hasRequestIntent,
  isAssistantEcho,
  isHumanSpeechCandidate,
  isLikelyValidUserUtterance,
  isNegativeConfirmation,
  isNoiseLikeTranscript,
  isServiceImprovementCommand,
  isShortConfirmation,
  normalizePlaceCandidate,
  type ConciergeAnalysis,
  type OrderStatus,
  type ServiceSlots
} from "../shared";
import {
  buildDemoSuccessMessage as policyBuildDemoSuccessMessage,
  buildPartnerVoiceSummary as policyBuildPartnerVoiceSummary,
  buildProviderFirstReply as policyBuildProviderFirstReply,
  buildSubmittedMessage as policyBuildSubmittedMessage,
  ensureProviderMention as policyEnsureProviderMention,
  getVisiblePartnerNames as policyGetVisiblePartnerNames,
  joinKoreanList as policyJoinKoreanList
} from "../partnerPolicy";
import { buildContextFallback as stateBuildContextFallback, checkingHint, DEMO_SUCCESS_DELAY_MS, isEndOfServiceIntent, standbyMessage, voiceEndMessage } from "../serviceStateMachine";
import {
  AI_RESPONSE_STUCK_TIMEOUT_MS,
  ASSISTANT_ECHO_GUARD_MS,
  CUSTOMER_RESPONSE_DELAY_MS,
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
import { Check, CircleStop, Headphones, Mic, Phone, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const SERVICE_NAME = "Babelfish_온디멘드 컨시어지";
const AI_NAME = "Babelfish";
const FIRST_MESSAGE = "안녕하세요, Babelfish입니다. 제휴 서비스와 연결해 실행까지 도와드리겠습니다. 원하시는 내용을 말씀해 주세요.";

type AppStatus =
  | "AI READY"
  | "CONNECTING"
  | "GREETING"
  | "AI SPEAKING"
  | "LISTENING"
  | "ANALYZING"
  | "BUILDING PLAN"
  | "WAITING APPROVAL"
  | "WAITING CONFIRMATION"
  | "WAITING DETAIL"
  | "UNSUPPORTED LANGUAGE"
  | "NO SPEECH"
  | "UNCLEAR SPEECH"
  | "ECHO GUARD"
  | "SERVER ERROR";

type VoiceState = "대기 중" | "고객 말씀 대기 중" | "듣는 중" | "고객 말씀 확인 중" | "말씀 미확인" | "소음 무시" | "AI 응답 중" | "에코 차단 중" | "다시 말씀 필요";

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
  | "submitted"
  | "completed"
  | "standby"
  | "feedback_pending";

type PendingSlotConfirmation = {
  slots: ServiceSlots;
  question: string;
  summary: string;
};

type CompletedService = {
  id: string;
  serviceType: string;
  summary: string;
  orderId: string;
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
  "WAITING APPROVAL": "승인 대기",
  "WAITING CONFIRMATION": "확인 대기",
  "WAITING DETAIL": "추가 정보 대기",
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
const foreignNoisePattern = /[ぁ-ゟ゠-ヿ]|allora|sie hat|karete|sinha|です|ます|あなた/i;

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
  const [assistHint, setAssistHint] = useState("기본은 자동으로 듣습니다. 인식이 안 될 때만 버튼을 눌러 다시 말씀해 주세요.");
  const [understoodText, setUnderstoodText] = useState("");
  const [finalSummary, setFinalSummary] = useState("");
  const [approvalReady, setApprovalReady] = useState(false);
  const [approvalBlockReason, setApprovalBlockReason] = useState("고객 요청 확인이 필요합니다.");
  const [serviceStatus, setServiceStatusState] = useState<ServiceStatus>("idle");
  const [confirmedSlots, setConfirmedSlots] = useState<ServiceSlots>({});
  const [pendingSlotSummary, setPendingSlotSummary] = useState("");
  const [lastCompletedService, setLastCompletedService] = useState<CompletedService | null>(null);
  const [satisfactionState, setSatisfactionState] = useState("확인 전");
  const [feedbackNotes, setFeedbackNotes] = useState<string[]>([]);
  const [serviceRules, setServiceRules] = useState<string[]>([]);
  const [demoCompletionHint, setDemoCompletionHint] = useState("");
  const [isWaitingDemoCompletion, setIsWaitingDemoCompletion] = useState(false);
  const [completedServices, setCompletedServices] = useState<CompletedService[]>([]);

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
  const waitingForConfirmationRef = useRef(false);
  const waitingForDetailRef = useRef(false);
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
  const lastProcessedTranscriptRef = useRef("");
  const ignoredEchoCountRef = useRef(0);
  const expectedAssistantMessageRef = useRef("");
  const serviceStatusRef = useRef<ServiceStatus>("idle");
  const confirmedSlotsRef = useRef<ServiceSlots>({});
  const pendingSlotConfirmationRef = useRef<PendingSlotConfirmation | null>(null);
  const waitingForAdditionalRequestRef = useRef(false);
  const waitingForSatisfactionRef = useRef(false);
  const waitingForFeedbackRef = useRef(false);
  const lastCompletedServiceRef = useRef<CompletedService | null>(null);
  const lastSubmittedServiceRef = useRef<CompletedService | null>(null);
  const pendingImprovementRef = useRef("");

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

  function updateSlots(next: ServiceSlots) {
    confirmedSlotsRef.current = { ...confirmedSlotsRef.current, ...next };
    setConfirmedSlots(confirmedSlotsRef.current);
  }

  function updateAnalysis(nextTranscript: string) {
    const next = analyzeRequest(nextTranscript);
    setAnalysis(next);
    setStatus(next.escalationRequired ? "operator_transfer" : next.needsConfirmation ? "waiting_confirmation" : "draft");
    updateAppStatus(next.escalationRequired ? "WAITING APPROVAL" : next.needsConfirmation ? "WAITING CONFIRMATION" : next.requiredInfo.length > 0 ? "WAITING DETAIL" : "BUILDING PLAN");
    return next;
  }

  function getSlotLabel(key: keyof ServiceSlots) {
    const labels: Record<string, string> = {
      origin: "출발지",
      destination: "도착지",
      placeName: "장소명",
      appointmentPlace: "예약 장소",
      serviceLocation: "서비스 지역",
      appointmentDateTime: "예약 일시",
      callTiming: "호출 방식",
      quantity: "수량",
      deliveryAddress: "배송지",
      vehicleInfo: "차량 정보",
      vehicleSymptom: "차량 증상",
      towingRequired: "탁송 여부",
      providerName: "고객 지정 업체",
      productName: "상품명",
      patientInfo: "이용자 정보",
      contactInfo: "연락처",
      improvementTarget: "개선 요청"
    };
    return labels[key] ?? key;
  }

  function formatSlots(slots: ServiceSlots) {
    return Object.entries(slots)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => `${getSlotLabel(key as keyof ServiceSlots)}는 ${value}`)
      .join(", ");
  }

  function mergeAnalysisSlots(analysisValue: ConciergeAnalysis) {
    if (Object.keys(analysisValue.slots).length > 0) updateSlots(analysisValue.slots);
  }

  function getMissingFields(analysisValue = confirmedAnalysisRef.current ?? analysis, slots = confirmedSlotsRef.current) {
    if (analysisValue.serviceType === "taxi") {
      const missing = [];
      if (!slots.origin) missing.push("출발지");
      if (!slots.destination) missing.push("도착지");
      if (!slots.callTiming) missing.push("즉시 호출 또는 예약 호출 여부");
      return missing;
    }
    if (analysisValue.serviceType === "family_mobility") {
      const missing = [];
      if (!slots.origin) missing.push("출발지");
      if (!slots.destination) missing.push("도착지");
      if (!slots.patientInfo) missing.push("탑승자");
      if (!slots.callTiming && !slots.appointmentDateTime) missing.push("이동 시간");
      return missing;
    }
    if (analysisValue.serviceType === "hospital_reservation") {
      const missing = [];
      if (!slots.appointmentPlace && !slots.providerName) missing.push("병원명 또는 진료 지역");
      if (!slots.appointmentDateTime) missing.push("희망 일시");
      return missing;
    }
    if (analysisValue.serviceType === "car_inspection") {
      const missing = [];
      if (!slots.vehicleInfo) missing.push("차량 정보");
      if (!slots.appointmentDateTime) missing.push("희망 검사 일시");
      if (!slots.serviceLocation && !slots.providerName) missing.push("검사 지역 또는 업체");
      if (!slots.towingRequired) missing.push("탁송 여부");
      return missing;
    }
    if (analysisValue.serviceType === "car_maintenance") {
      const missing = [];
      if (!slots.vehicleSymptom) missing.push("차량 증상");
      if (!slots.serviceLocation && !slots.providerName) missing.push("정비 지역 또는 업체");
      if (!slots.appointmentDateTime) missing.push("희망 일시");
      return missing;
    }
    if (analysisValue.serviceType === "car_accessory_installation") {
      const missing = [];
      if (!slots.vehicleInfo) missing.push("차량 종류");
      if (!slots.serviceLocation && !slots.providerName) missing.push("시공 지역");
      if (!slots.appointmentDateTime) missing.push("희망 날짜");
      if (!slots.towingRequired) missing.push("탁송 여부");
      return missing;
    }
    if (analysisValue.serviceType === "product_purchase") {
      const missing = [];
      if (!slots.productName) missing.push("상품명");
      if (!slots.quantity) missing.push("수량");
      if (!slots.deliveryAddress) missing.push("배송지");
      return missing;
    }
    if (analysisValue.serviceType === "service_improvement_command") return ["개선 반영 확인"];
    return analysisValue.requiredInfo;
  }

  function buildInitialConfirmation(analysisValue: ConciergeAnalysis) {
    if (analysisValue.preferredProvider) return buildProviderFirstReply(analysisValue, `${analysisValue.preferredProvider}으로 진행할까요?`);
    if (analysisValue.serviceType === "taxi") return buildProviderFirstReply(analysisValue, "출발지와 도착지를 말씀해 주세요.");
    if (analysisValue.serviceType === "hospital_reservation") return buildProviderFirstReply(analysisValue, "종합병원과 개인 병원 중 어느 쪽을 원하실까요?");
    if (analysisValue.serviceType === "car_maintenance") return buildProviderFirstReply(analysisValue, "차량 증상과 원하시는 지역을 말씀해 주세요.");
    if (analysisValue.serviceType === "car_inspection") return buildProviderFirstReply(analysisValue, "원하시는 검사 날짜와 지역을 말씀해 주세요.");
    if (analysisValue.serviceType === "car_accessory_installation") return buildProviderFirstReply(analysisValue, "차량 종류와 원하시는 시공 지역을 말씀해 주세요.");
    if (analysisValue.serviceType === "product_purchase") return buildProviderFirstReply(analysisValue, "상품명과 수량을 말씀해 주세요.");
    if (analysisValue.serviceType === "service_improvement_command") return `서비스 시나리오 개선 요청으로 이해했습니다. "${analysisValue.rawText}" 내용을 반영하면 될까요?`;
    return analysisValue.confirmationQuestion;
  }

  function getVisiblePartnerNames(analysisValue: ConciergeAnalysis, limit = 3) {
    return policyGetVisiblePartnerNames(analysisValue, limit);
  }

  function joinKoreanList(items: string[]) {
    return policyJoinKoreanList(items);
  }

  function buildPartnerVoiceSummary(analysisValue: ConciergeAnalysis) {
    return policyBuildPartnerVoiceSummary(analysisValue);
  }

  function buildProviderFirstReply(analysisValue: ConciergeAnalysis, nextQuestion: string) {
    return policyBuildProviderFirstReply(analysisValue, nextQuestion);
  }

  function ensureProviderMention(message: string, analysisValue?: ConciergeAnalysis | null) {
    return policyEnsureProviderMention(message, analysisValue);
  }

  function buildNextDetailQuestion(analysisValue: ConciergeAnalysis, field: string) {
    if (analysisValue.serviceType === "taxi" && field === "즉시 호출 또는 예약 호출 여부") return "지금 바로 아이나비 M 택시를 호출할까요, 아니면 예약 호출로 진행할까요?";
    if (analysisValue.serviceType === "taxi") return `${field}를 말씀해 주세요.`;
    if (analysisValue.serviceType === "hospital_reservation" && field.includes("병원")) return "원하시는 병원이 있으시면 말씀해 주세요. 없으면 지역과 증상 기준으로 제휴 병원을 확인하겠습니다.";
    if (analysisValue.serviceType === "car_inspection" && field === "탁송 여부") return "검사소 이동을 위한 탁송도 함께 연결해드릴까요?";
    if (analysisValue.serviceType === "car_accessory_installation" && field === "탁송 여부") return "시공점 이동을 위한 탁송도 함께 연결해드릴까요?";
    if (analysisValue.serviceType === "car_accessory_installation" && field === "차량 종류") return "시공할 차량 종류를 말씀해 주세요.";
    if (analysisValue.serviceType === "car_accessory_installation" && field === "시공 지역") return "원하시는 시공 지역을 말씀해 주세요.";
    return `${field}를 말씀해 주세요.`;
  }

  function askNextDetail(analysisValue: ConciergeAnalysis) {
    const missing = getMissingFields(analysisValue);
    remainingFieldsRef.current = missing;
    if (missing.length === 0) {
      if (analysisValue.serviceType === "service_improvement_command") {
        const rule = confirmedSlotsRef.current.improvementTarget || analysisValue.rawText;
        setServiceRules((current) => Array.from(new Set([...current, rule])));
        setServiceStatus("listening");
        setStatus("draft");
        setFinalSummary(`개선 요청 반영 완료: ${rule}`);
        setUnderstoodText(`서비스 시나리오 개선 요청을 반영했습니다.`);
        setApprovalReady(false);
        setApprovalBlockReason("새 서비스 요청을 기다리고 있습니다.");
        scheduleAssistantResponse("반영했습니다. 다음 시나리오부터 해당 내용을 우선 적용하겠습니다. 추가로 필요한 서비스를 말씀해 주세요.");
        return;
      }
      const summary = buildFinalSummary(analysisValue);
      setFinalSummary(summary);
      setUnderstoodText(summary);
      setApprovalReady(true);
      setApprovalBlockReason("");
      setServiceStatus("ready_for_approval");
      setStatus("ready_for_approval");
      updateAppStatus("WAITING APPROVAL");
      const prompt = `${summary} 승인 버튼을 누르시면 제휴사 확인 접수로 진행하겠습니다.`;
      setAssistHint(prompt);
      scheduleAssistantResponse(prompt, 0, analysisValue);
      return;
    }
    waitingForDetailRef.current = true;
    setApprovalReady(false);
    setApprovalBlockReason(missing[0]);
    setServiceStatus("waiting_detail");
    setStatus("waiting_detail");
    updateAppStatus("WAITING DETAIL");
    const question = buildNextDetailQuestion(analysisValue, missing[0]);
    setAssistHint(question);
    scheduleAssistantResponse(question, 0, analysisValue);
  }

  function buildFinalSummary(analysisValue: ConciergeAnalysis) {
    const slotSummary = formatSlots(confirmedSlotsRef.current);
    if (analysisValue.serviceType === "taxi") return `${slotSummary || "택시 호출 정보"}로 아이나비 M 택시 연결을 진행하는 것으로 최종 확인했습니다.`;
    if (analysisValue.serviceType === "service_improvement_command") return `서비스 개선 요청을 반영하는 것으로 최종 확인했습니다. ${slotSummary}`;
    return `${analysisValue.interpretedText}${slotSummary ? ` / ${slotSummary}` : ""}으로 최종 확인했습니다.`;
  }

  function buildCompletionMessage(analysisValue: ConciergeAnalysis, summary: string) {
    if (analysisValue.serviceType === "taxi") return `아이나비 M 택시 호출 요청이 접수되었습니다. ${formatSlots(confirmedSlotsRef.current) || summary}로 확인했습니다. 추가로 도와드릴 내용이 있으실까요?`;
    if (analysisValue.serviceType === "hospital_reservation") return "병원 예약 요청이 접수되었습니다. 제휴 병원 또는 고객 지정 병원의 예약 가능 여부를 확인한 뒤 안내드리겠습니다. 추가로 필요한 서비스가 있으실까요?";
    if (analysisValue.serviceType === "product_purchase") return "상품 구매 요청이 접수되었습니다. 가격과 리뷰 기준으로 비교 후 협력사 구매 가능 여부를 확인하겠습니다. 추가로 구매하실 상품이 있으실까요?";
    if (analysisValue.serviceType === "car_inspection") return "자동차 검사 예약 요청이 접수되었습니다. 연계 검사소의 예약 가능 여부를 확인하겠습니다. 추가로 탁송이나 정비도 필요하실까요?";
    if (analysisValue.serviceType === "car_maintenance") return "자동차 정비 요청이 접수되었습니다. 가격과 평판 기준으로 연계 정비소를 확인하겠습니다. 추가로 확인하실 차량 관리 항목이 있으실까요?";
    if (analysisValue.serviceType === "car_accessory_installation") return buildDemoSuccessMessage(analysisValue);
    if (analysisValue.serviceType === "family_mobility") return "가족 이동 지원 요청이 접수되었습니다. 택시 또는 기사 연결 상태를 안내드리겠습니다. 추가로 필요한 이동이 있으실까요?";
    return `요청이 접수되었습니다. ${summary} 추가로 도와드릴 내용이 있으실까요?`;
  }

  function buildSubmittedMessage(analysisValue: ConciergeAnalysis) {
    return policyBuildSubmittedMessage(analysisValue);
  }

  function buildDemoSuccessMessage(analysisValue: ConciergeAnalysis) {
    return policyBuildDemoSuccessMessage(analysisValue);
  }

  function startDemoSuccessTimer(analysisValue: ConciergeAnalysis, submittedService: CompletedService) {
    if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    setIsWaitingDemoCompletion(true);
    setDemoCompletionHint(checkingHint());
    completionTimerRef.current = window.setTimeout(() => {
      completionTimerRef.current = null;
      setIsWaitingDemoCompletion(false);
      setDemoCompletionHint("성공 처리 완료. 추가 요청을 확인하고 있습니다.");
      setStatus("completed");
      setServiceStatus("completed");
      lastCompletedServiceRef.current = submittedService;
      setLastCompletedService(submittedService);
      setCompletedServices((current) => [...current, submittedService]);
      waitingForAdditionalRequestRef.current = true;
      setSatisfactionState("추가 요청 확인 중");
      const successMessage = buildDemoSuccessMessage(analysisValue);
      scheduleAssistantResponse(successMessage, 0, analysisValue);
    }, DEMO_SUCCESS_DELAY_MS);
  }

  function getOpeningGreetingMessage() {
    const shouldAskSatisfaction = lastCompletedServiceRef.current && satisfactionState !== "만족 확인" && satisfactionState !== "개선 의견 접수";
    if (shouldAskSatisfaction) {
      waitingForSatisfactionRef.current = true;
      setSatisfactionState("만족도 확인 중");
      return "다시 호출해 주셔서 감사합니다. 이전에 접수한 서비스는 만족스러우셨나요?";
    }
    return FIRST_MESSAGE;
  }

  function scheduleGreetingWhenReady() {
    if (hasSentGreetingRef.current || isGreetingInProgressRef.current) return;
    if (!isDataChannelReadyRef.current || !isRemoteAudioReadyRef.current || !isInitialAudioReadyRef.current) return;
    if (!dcRef.current || dcRef.current.readyState !== "open") return;
    if (!audioRef.current || !pcRef.current || ["failed", "closed"].includes(pcRef.current.connectionState)) return;
    if (isResponseInProgressRef.current) return;
    if (greetingTimeoutRef.current) window.clearTimeout(greetingTimeoutRef.current);
    greetingTimeoutRef.current = window.setTimeout(() => {
      greetingTimeoutRef.current = null;
      sendInitialGreetingOnce();
    }, GREETING_START_DELAY_MS);
  }

  function sendInitialGreetingOnce(retryMessage?: string) {
    if (hasSentGreetingRef.current && !retryMessage) return;
    if (isGreetingInProgressRef.current || isResponseInProgressRef.current) return;
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open" || !audioRef.current) return;
    hasSentGreetingRef.current = true;
    greetingSentRef.current = true;
    isGreetingInProgressRef.current = true;
    isResponseInProgressRef.current = true;
    isAssistantSpeakingRef.current = true;
    isAssistantAudioPlayingRef.current = true;
    lastGreetingStartedAtRef.current = Date.now();
    lastAssistantStartedAtRef.current = Date.now();
    clearPendingResponseTimer();
    setMicrophoneEnabled(false, "auto");
    updateAppStatus("GREETING");
    setVoiceState("AI 응답 중");
    const greetingMessage = retryMessage ?? getOpeningGreetingMessage();
    expectedAssistantMessageRef.current = greetingMessage;
    lastAssistantResponseMessageRef.current = greetingMessage;
    lastAssistantMessageAtRef.current = Date.now();
    appendLog("assistant", greetingMessage);
    dc.send(JSON.stringify({
      type: "response.create",
      response: {
        instructions: `다음 문장만 그대로 말하세요. 다른 설명은 덧붙이지 마세요.\n${greetingMessage}`
      }
    }));
    startGreetingWatchdog();
  }

  function startGreetingWatchdog() {
    if (greetingTimeoutRef.current) window.clearTimeout(greetingTimeoutRef.current);
    greetingTimeoutRef.current = window.setTimeout(() => {
      greetingTimeoutRef.current = null;
      if (!isGreetingInProgressRef.current) return;
      console.warn("Initial greeting stuck. Recovering.");
      isGreetingInProgressRef.current = false;
      isResponseInProgressRef.current = false;
      isAssistantSpeakingRef.current = false;
      isAssistantAudioPlayingRef.current = false;
      setMicrophoneEnabled(false, "auto");
      if (greetingRetryCountRef.current < GREETING_MAX_RETRY) {
        greetingRetryCountRef.current += 1;
        sendInitialGreetingOnce("다시 안내드리겠습니다. Babelfish입니다. 원하시는 서비스를 말씀해 주세요.");
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
    const now = Date.now();
    if (isAssistantTurnActive() && lastAssistantStartedAtRef.current && now - lastAssistantStartedAtRef.current > AI_RESPONSE_STUCK_TIMEOUT_MS) {
      forceRecoverToListening("AI response stuck");
      return;
    }
    if (currentAppStatusRef.current === "ECHO GUARD" && now > assistantEchoGuardUntilRef.current + 500) {
      forceRecoverToListening("Echo guard stuck");
      return;
    }
    if (lastValidUserTurnRef.current && fallbackPromptCountRef.current < MAX_FALLBACK_PROMPT_COUNT && !isAssistantTurnActive()) {
      const userWait = now - lastUserTranscriptAtRef.current;
      const assistantWait = now - lastAssistantMessageAtRef.current;
      if (userWait > USER_TURN_RESPONSE_TIMEOUT_MS && assistantWait > USER_TURN_RESPONSE_TIMEOUT_MS) {
        fallbackPromptCountRef.current += 1;
        const active = confirmedAnalysisRef.current ?? pendingAnalysisRef.current ?? analysis;
        const fallback = buildContextFallback(active);
        lastValidUserTurnRef.current = "";
        scheduleAssistantResponse(fallback, 0, active.serviceType === "unknown" ? null : active);
      }
    }
    if ((serviceStatusRef.current === "submitted" || status === "submitted") && lastSubmittedServiceRef.current && !completionTimerRef.current) {
      startDemoSuccessTimer(confirmedAnalysisRef.current ?? analysis, lastSubmittedServiceRef.current);
    }
  }

  function forceRecoverToListening(reason: string) {
    console.warn(reason);
    isResponseInProgressRef.current = false;
    isAssistantSpeakingRef.current = false;
    isAssistantAudioPlayingRef.current = false;
    clearPendingResponseTimer();
    if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
    responseTimerRef.current = null;
    assistantEchoGuardUntilRef.current = 0;
    if (serviceStatusRef.current === "standby") {
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
      const active = getActiveAnalysis();
      scheduleAssistantResponse(`다시 안내드리겠습니다. ${lastAssistantResponseMessageRef.current}`, 0, active.serviceType === "unknown" ? null : active);
    }
  }

  function buildContextFallback(active: ConciergeAnalysis) {
    return stateBuildContextFallback(active);
  }

  function setPendingSlotConfirmation(slots: ServiceSlots, customQuestion?: string) {
    const summary = formatSlots(slots);
    const placeQuestion = buildPlaceConfirmationQuestion(getPlaceCandidates(Object.values(slots).join(" ")));
    const question = customQuestion ?? (summary ? `${summary}로 이해했습니다. 맞으실까요?` : placeQuestion);
    pendingSlotConfirmationRef.current = { slots, question, summary };
    setPendingSlotSummary(summary);
    setUnderstoodText(summary || understoodText);
    setApprovalReady(false);
    setApprovalBlockReason("고객 확인이 필요합니다.");
    setServiceStatus("waiting_confirmation");
    updateAppStatus("WAITING CONFIRMATION");
    appendLog("system", question);
    scheduleAssistantResponse(question, 0, confirmedAnalysisRef.current ?? pendingAnalysisRef.current ?? analysis);
  }

  async function startCall() {
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
    waitingForConfirmationRef.current = false;
    waitingForDetailRef.current = false;
    detailNotesRef.current = [];
    remainingFieldsRef.current = [];
    confirmedSlotsRef.current = {};
    pendingSlotConfirmationRef.current = null;
    waitingForAdditionalRequestRef.current = false;
    waitingForSatisfactionRef.current = false;
    waitingForFeedbackRef.current = false;
    pendingImprovementRef.current = "";
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
    lastProcessedTranscriptRef.current = "";
    ignoredEchoCountRef.current = 0;
    expectedAssistantMessageRef.current = "";
    setIsPushToTalkActive(false);
    setIsManualMode(false);
    isManualModeRef.current = false;
    setVoiceState("대기 중");
    setAssistHint("AI 첫 인사 후 자동으로 고객 말씀 대기 상태가 됩니다.");
    setUnderstoodText("");
    setFinalSummary("");
    setApprovalReady(false);
    setApprovalBlockReason("고객 요청 확인이 필요합니다.");
    setServiceStatus("listening");
    setConfirmedSlots({});
    setPendingSlotSummary("");
    setDemoCompletionHint("");
    setIsWaitingDemoCompletion(false);
    if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    completionTimerRef.current = null;
    setSatisfactionState(lastCompletedServiceRef.current ? "재호출 시 확인 예정" : "확인 전");
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
    appendLog("system", "통화를 시작합니다. AI가 먼저 인사합니다.");

    try {
      const healthResponse = await fetch(`${API_BASE}/health`);
      if (!healthResponse.ok) throw new Error("서버 연결 실패: Express 서버 /health 확인에 실패했습니다.");

      const tokenResponse = await fetch(`${API_BASE}/realtime/session`, { method: "POST" });
      if (!tokenResponse.ok) throw new Error(await formatApiError(tokenResponse));
      const tokenPayload = await tokenResponse.json();
      const ephemeralKey = tokenPayload.value ?? tokenPayload.client_secret?.value;
      if (!ephemeralKey) throw new Error("Realtime ephemeral key 응답을 찾지 못했습니다.");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.onconnectionstatechange = () => setConnection(pc.connectionState);

      const audio = new Audio();
      audio.autoplay = true;
      audioRef.current = audio;
      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];
        isRemoteAudioReadyRef.current = true;
        void audio.play()
          .catch((playError) => console.warn("Initial remote audio play was delayed", playError))
          .finally(() => {
            isInitialAudioReadyRef.current = true;
            scheduleGreetingWhenReady();
          });
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
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
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
      updateAppStatus("SERVER ERROR");
      setError(message);
      appendLog("system", message);
      stopCall(false);
    }
  }

  function handleRealtimeEvent(raw: string) {
    const event = JSON.parse(raw);
    if (event.type === "input_audio_buffer.speech_started") {
      if (isGreetingInProgressRef.current || isAssistantTurnActive() || isInsideAssistantEchoGuard()) {
        ignoredEchoCountRef.current += 1;
        setVoiceState("에코 차단 중");
        return;
      }
      userSpeakingRef.current = true;
      clearPendingResponseTimer();
      setVoiceState("고객 말씀 대기 중");
      updateAppStatus("LISTENING");
      return;
    }
    if (event.type === "input_audio_buffer.speech_stopped") {
      userSpeakingRef.current = false;
      lastUserSpeechStoppedAtRef.current = Date.now();
      if (isGreetingInProgressRef.current || isAssistantTurnActive() || isInsideAssistantEchoGuard()) return;
      scheduleUserTurnProcessing();
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      if (isGreetingInProgressRef.current || isAssistantTurnActive() || isInsideAssistantEchoGuard()) return;
      const text = String(event.transcript ?? "");
      latestFinalTranscriptRef.current = text;
      if (!userSpeakingRef.current) scheduleUserTurnProcessing();
    }
    if (event.type === "response.created") {
      markAssistantSpeakingStart(false);
    }
    if (event.type === "response.audio.delta") {
      markAssistantSpeakingStart(true);
    }
    if (event.type === "response.audio_transcript.delta" || event.type === "response.output_text.delta") {
      markAssistantSpeakingStart(false);
      if (event.type === "response.audio_transcript.delta" || event.type === "response.output_text.delta") {
        const nextDraft = `${assistantDraftRef.current}${event.delta ?? ""}`;
        assistantDraftRef.current = nextDraft;
        setAssistantDraft(nextDraft);
      }
    }
    if (event.type === "response.audio_transcript.done" || event.type === "response.output_text.done") {
      const text = String(event.transcript ?? event.text ?? assistantDraftRef.current);
      const expected = expectedAssistantMessageRef.current;
      if (expected) {
        lastAssistantTextRef.current = expected;
        expectedAssistantMessageRef.current = "";
      } else {
        appendLog("assistant", text);
        lastAssistantTextRef.current = text;
      }
      lastAssistantSpokeAtRef.current = Date.now();
      assistantDraftRef.current = "";
      setAssistantDraft("");
    }
    if (event.type === "response.audio.done") {
      isAssistantAudioPlayingRef.current = false;
      return;
    }
    if (event.type === "response.done") {
      if (isGreetingInProgressRef.current) {
        if (expectedAssistantMessageRef.current) {
          lastAssistantTextRef.current = expectedAssistantMessageRef.current;
          expectedAssistantMessageRef.current = "";
        }
        completeGreetingTurn();
        return;
      }
      isResponseInProgressRef.current = false;
      isAssistantSpeakingRef.current = false;
      isAssistantAudioPlayingRef.current = false;
      if (expectedAssistantMessageRef.current) {
        lastAssistantTextRef.current = expectedAssistantMessageRef.current;
        expectedAssistantMessageRef.current = "";
      }
      markAssistantSpeakingEnd();
    }
    if (event.type === "error") console.warn(event.error?.message ?? "Realtime error");
  }

  function processCustomerTranscript(text: string) {
    const trimmed = text.trim();
    const withinSpeechWindow = !isManualModeRef.current || isListeningEnabledRef.current || Date.now() - lastPushToTalkAtRef.current < 5000;

    if (!withinSpeechWindow) {
      if (trimmed) {
        console.debug("Ignored transcript while listening is disabled", trimmed);
        setVoiceState("소음 무시");
      }
      return;
    }

    if (!trimmed) {
      handleNoSpeech();
      return;
    }

    if (isAssistantTurnActive() || isInsideAssistantEchoGuard() || (Date.now() - lastAssistantSpokeAtRef.current < ASSISTANT_ECHO_GUARD_MS && isAssistantEcho(trimmed, lastAssistantTextRef.current))) {
      console.debug("Ignored possible assistant echo", trimmed);
      setVoiceState("에코 차단 중");
      return;
    }

    const normalized = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (lastAcceptedTranscriptRef.current === normalized && Date.now() - lastAcceptedAtRef.current < 3500) {
      console.debug("Ignored duplicated transcript", trimmed);
      setVoiceState("대기 중");
      return;
    }
    if (lastProcessedTranscriptRef.current === normalized) {
      console.debug("Ignored already processed transcript", trimmed);
      return;
    }
    if (!isValidCustomerTranscript(trimmed)) {
      handleRejectedTranscript(trimmed);
      return;
    }

    lastValidUserTurnRef.current = trimmed;
    lastUserTranscriptAtRef.current = Date.now();
    fallbackPromptCountRef.current = 0;
    appendLog("user", trimmed);
    setVoiceState("고객 말씀 확인 중");

    if (serviceStatusRef.current === "standby") {
      appendLog("system", "서비스 대기 중입니다. 서비스 시작 버튼을 눌러 다시 시작해 주세요.");
      return;
    }

    if (isContextualShortSlot(trimmed) && handleContextualShortSlot(trimmed)) {
      return;
    }

    if (waitingForFeedbackRef.current) {
      waitingForFeedbackRef.current = false;
      setFeedbackNotes((current) => [...current, trimmed]);
      setSatisfactionState("개선 의견 접수");
      appendLog("system", "말씀 감사합니다. 개선 의견으로 기록하겠습니다. 추가로 필요한 서비스를 말씀해 주세요.");
      scheduleAssistantResponse("말씀 감사합니다. 개선 의견으로 기록하겠습니다. 추가로 필요한 서비스를 말씀해 주세요.");
      return;
    }

    if (waitingForSatisfactionRef.current) {
      waitingForSatisfactionRef.current = false;
      if (isNegativeConfirmation(trimmed) || /별로|불편|문제|싫|멀었/.test(trimmed)) {
        waitingForFeedbackRef.current = true;
        setServiceStatus("feedback_pending");
        setSatisfactionState("불만족 사유 확인 중");
        appendLog("system", "불편을 드려 죄송합니다. 어떤 부분이 불편하셨는지 말씀해 주세요.");
        scheduleAssistantResponse("불편을 드려 죄송합니다. 어떤 부분이 불편하셨는지 말씀해 주세요.");
        return;
      }
      setSatisfactionState("만족 확인");
      appendLog("system", "감사합니다. 추가로 필요한 서비스를 말씀해 주세요.");
      scheduleAssistantResponse("감사합니다. 추가로 필요한 서비스를 말씀해 주세요.");
      return;
    }

    if (waitingForAdditionalRequestRef.current) {
      if (isNegativeConfirmation(trimmed) || isEndOfServiceIntent(trimmed)) {
        waitingForAdditionalRequestRef.current = false;
        setServiceStatus("standby");
        setStatus("standby");
        updateAppStatus("AI READY");
        setVoiceState("대기 중");
        setMicrophoneEnabled(false, "auto");
        appendLog("system", voiceEndMessage);
        scheduleAssistantResponse(voiceEndMessage);
        return;
      }
      waitingForAdditionalRequestRef.current = false;
      resetPendingFlow();
    }

    if (pendingSlotConfirmationRef.current) {
      if (isShortConfirmation(trimmed)) {
        const pending = pendingSlotConfirmationRef.current;
        pendingSlotConfirmationRef.current = null;
        updateSlots(pending.slots);
        detailNotesRef.current = [...detailNotesRef.current, pending.summary];
        setPendingSlotSummary("");
        const active = confirmedAnalysisRef.current ?? pendingAnalysisRef.current ?? analysis;
        setUnderstoodText(`${active.interpretedText} / ${formatSlots(confirmedSlotsRef.current)}`);
        appendLog("system", `${pending.summary}로 확인했습니다.`);
        askNextDetail(active);
        return;
      }
      if (isNegativeConfirmation(trimmed)) {
        const revisedSlots = extractCorrectedSlots(trimmed);
        if (Object.keys(revisedSlots).length > 0) {
          setPendingSlotConfirmation(revisedSlots);
        } else {
          const question = "알겠습니다. 해당 정보를 다시 말씀해 주세요.";
          pendingSlotConfirmationRef.current = null;
          setPendingSlotSummary("");
          appendLog("system", question);
          scheduleAssistantResponse(question);
        }
        return;
      }
    }

    if (isNegativeConfirmation(trimmed) && pendingAnalysisRef.current) {
      if (waitingForDetailRef.current && confirmedAnalysisRef.current) {
        if (remainingFieldsRef.current[0] === "탁송 여부") {
          handleDetailAnswer("탁송은 제외");
        } else {
          appendLog("system", "알겠습니다. 해당 정보를 다시 말씀해 주세요.");
          scheduleAssistantResponse("알겠습니다. 해당 정보를 다시 말씀해 주세요.");
        }
      } else {
        resetPendingFlow();
        appendLog("system", "알겠습니다. 원하시는 내용을 다시 말씀해 주세요.");
        scheduleAssistantResponse("알겠습니다. 원하시는 내용을 다시 말씀해 주세요.");
      }
      return;
    }

    if (isShortConfirmation(trimmed)) {
      appendLog("system", "짧은 확인 말씀으로 판단해 요청 분석을 갱신하지 않았습니다.");
      if (pendingAnalysisRef.current && waitingForConfirmationRef.current) {
        const confirmed = pendingAnalysisRef.current;
        setAnalysis(confirmed);
        confirmedAnalysisRef.current = confirmed;
        waitingForConfirmationRef.current = false;
        mergeAnalysisSlots(confirmed);
        remainingFieldsRef.current = getMissingFields(confirmed);
        waitingForDetailRef.current = remainingFieldsRef.current.length > 0;
        setStatus("draft");
      if (remainingFieldsRef.current.length > 0) {
          askNextDetail(confirmed);
        } else {
          askNextDetail(confirmed);
        }
      } else {
        if (waitingForDetailRef.current && confirmedAnalysisRef.current) {
          const field = remainingFieldsRef.current[0] ?? "추가 정보";
          handleDetailAnswer(field === "개선 반영 확인" ? "반영 승인" : "지금 진행");
        } else {
          updateAppStatus("WAITING DETAIL");
          scheduleAssistantResponse("원하시는 내용을 조금 더 구체적으로 말씀해 주시면 바로 확인해드리겠습니다.");
        }
      }
      return;
    }

    if (waitingForDetailRef.current && confirmedAnalysisRef.current) {
      handleDetailAnswer(trimmed);
      return;
    }

    const analyzed = analyzeRequest(trimmed);
    if (!analyzed.allowedLanguage) {
      handleUnsupportedLanguage();
      return;
    }

    if (isNoiseLikeTranscript(trimmed) || !isHumanSpeechCandidate(trimmed) || !isLikelyValidUserUtterance(trimmed, lastAssistantTextRef.current)) {
      handleNoiseLikeTranscript(trimmed);
      return;
    }

    const shouldAnalyze = hasRequestIntent(trimmed);
    if (!shouldAnalyze || analyzed.serviceType === "unknown" || analyzed.confidence < 0.5) {
      handleUnclearSpeech();
      return;
    }

    noSpeechCountRef.current = 0;
    unclearCountRef.current = 0;
    noiseCountRef.current = 0;
    lastAcceptedTranscriptRef.current = normalized;
    lastAcceptedAtRef.current = Date.now();
    lastProcessedTranscriptRef.current = normalized;
    pendingAnalysisRef.current = analyzed;
    confirmedAnalysisRef.current = null;
    waitingForConfirmationRef.current = true;
    waitingForDetailRef.current = false;
    detailNotesRef.current = [];
    remainingFieldsRef.current = [];
    setUnderstoodText(analyzed.interpretedText);
    setFinalSummary("");
    setApprovalReady(false);
    setApprovalBlockReason("고객 확인이 필요합니다.");
    const nextTranscript = `${transcriptRef.current}\n${trimmed}`.trim();
    transcriptRef.current = nextTranscript;
    setTranscript(nextTranscript);
    const next = updateAnalysis(nextTranscript);
    pendingAnalysisRef.current = next;
    mergeAnalysisSlots(next);
    const confirmation = buildInitialConfirmation(next);
    setAssistHint(confirmation);
    scheduleAssistantResponse(confirmation, 0, next);
  }

  function handleNoSpeech() {
    noSpeechCountRef.current += 1;
    updateAppStatus("NO SPEECH");
    setVoiceState("말씀 미확인");
    const message = noSpeechCountRef.current >= 2
      ? "말씀이 잘 들리지 않았습니다. 원하시는 서비스명만 다시 말씀해 주세요."
      : "말씀이 확인되지 않았습니다. 다시 말씀해 주세요.";
    appendLog("system", message);
    setAssistHint(message);
    if (noSpeechCountRef.current <= 1) scheduleAssistantResponse("죄송합니다. 말씀이 잘 들리지 않았습니다. 다시 한 번 말씀해 주세요.");
    if (noSpeechCountRef.current >= 3) {
      updateAppStatus("WAITING DETAIL");
      setAssistHint("고객 말씀을 다시 기다리고 있습니다.");
    }
  }

  function handleUnclearSpeech() {
    unclearCountRef.current += 1;
    updateAppStatus("UNCLEAR SPEECH");
    setVoiceState("다시 말씀 필요");
    const message = unclearCountRef.current >= 2
      ? "말씀하신 내용을 다시 확인하겠습니다. 원하시는 서비스와 장소를 한 번만 더 말씀해 주세요."
      : "말씀하신 내용 파악이 어려웠습니다. 다시 말씀해 주세요.";
    appendLog("system", message);
    setAssistHint(message);
    if (unclearCountRef.current < 3) scheduleAssistantResponse(message);
    if (unclearCountRef.current >= 3) setAssistHint("고객 말씀을 다시 기다리고 있습니다.");
  }

  function handleUnsupportedLanguage() {
    unclearCountRef.current += 1;
    updateAppStatus("UNSUPPORTED LANGUAGE");
    setVoiceState("다시 말씀 필요");
    appendLog("system", "지원하지 않는 언어이거나 말씀을 정확히 파악하지 못했습니다.");
    setAssistHint("한국어, 영어 또는 일본어로 다시 말씀해 주세요.");
    scheduleAssistantResponse("죄송합니다. 말씀을 정확히 파악하지 못했습니다. 한국어, 영어 또는 일본어로 다시 말씀해 주세요.");
  }

  function handleNoiseLikeTranscript(text: string) {
    noiseCountRef.current += 1;
    updateAppStatus("NO SPEECH");
    setVoiceState("소음 무시");
    const normalized = text.trim().toLowerCase();
    const repeated = lastIgnoredTranscriptRef.current === normalized;
    lastIgnoredTranscriptRef.current = normalized;
    appendLog("system", repeated ? "주변 소음으로 판단해 분석하지 않았습니다." : "고객 말씀이 확인되지 않았습니다.");
    setAssistHint("다시 한 번 또렷하게 말씀해 주세요.");
    if (!repeated && noiseCountRef.current <= 1) {
      scheduleAssistantResponse("죄송합니다. 말씀이 정확히 들리지 않았습니다. 다시 한 번 말씀해 주세요.");
    }
    if (noiseCountRef.current >= 3) {
      setAssistHint("고객 말씀을 다시 기다리고 있습니다.");
    }
  }

  function markAssistantSpeakingStart(audioPlaying = false) {
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
    assistantEchoGuardUntilRef.current = Date.now() + ASSISTANT_ECHO_GUARD_MS;
    setMicrophoneEnabled(false, "auto");
    updateAppStatus("ECHO GUARD");
    setVoiceState("에코 차단 중");
    window.setTimeout(() => {
      if (Date.now() < assistantEchoGuardUntilRef.current) return;
      if (serviceStatusRef.current === "standby") {
        setMicrophoneEnabled(false, "auto");
        setVoiceState("대기 중");
        setAssistHint("서비스 대기 중입니다. 필요하실 때 서비스 시작 버튼을 눌러 주세요.");
        return;
      }
      if (!isManualModeRef.current && pcRef.current) {
        setMicrophoneEnabled(true, "auto");
        setVoiceState("고객 말씀 대기 중");
        setAssistHint("고객 말씀을 기다리고 있습니다. 인식이 안 되면 서비스 시작 버튼을 눌러 다시 시도해 주세요.");
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

  function scheduleUserTurnProcessing() {
    clearPendingResponseTimer();
    pendingResponseTimerRef.current = window.setTimeout(() => {
      pendingResponseTimerRef.current = null;
      const text = latestFinalTranscriptRef.current.trim();
      if (!isValidUserTranscript(text)) {
        if (text) handleRejectedTranscript(text);
        return;
      }
      processCustomerTranscript(text);
    }, CUSTOMER_RESPONSE_DELAY_MS);
  }

  function isValidUserTranscript(text: string) {
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

  function getActiveAnalysis() {
    return confirmedAnalysisRef.current ?? pendingAnalysisRef.current ?? analysis;
  }

  function hasActiveServiceContext() {
    return getActiveAnalysis().serviceType !== "unknown" || waitingForDetailRef.current || waitingForConfirmationRef.current;
  }

  function isContextualShortSlot(text: string) {
    const clean = text.trim();
    if (!hasActiveServiceContext()) return false;
    if (regionKeywords.includes(clean)) return true;
    if (dateKeywords.some((word) => clean.includes(word))) return true;
    if (/^\d{1,2}시$/.test(clean)) return true;
    if (/개인\s*병원|종합\s*병원|피부과|정형외과|내과|소아과/.test(clean)) return true;
    return false;
  }

  function handleContextualShortSlot(text: string) {
    const active = getActiveAnalysis();
    const clean = text.trim();
    const slots: ServiceSlots = {};
    if (regionKeywords.includes(clean)) {
      if (active.serviceType === "taxi" || active.serviceType === "family_mobility") {
        if (!confirmedSlotsRef.current.destination) slots.destination = clean;
        else slots.serviceLocation = clean;
      } else {
        slots.serviceLocation = clean;
      }
    }
    if (dateKeywords.some((word) => clean.includes(word)) || /^\d{1,2}시$/.test(clean)) {
      slots.appointmentDateTime = [confirmedSlotsRef.current.appointmentDateTime, clean].filter(Boolean).join(" ");
    }
    if (/개인\s*병원|종합\s*병원|피부과|정형외과|내과|소아과/.test(clean)) {
      slots.appointmentPlace = clean;
    }
    if (Object.keys(slots).length === 0) return false;

    if (active.serviceType === "hospital_reservation" && slots.serviceLocation) {
      setPendingSlotConfirmation(slots, `${slots.serviceLocation} 지역 기준으로 Babelfish 제휴 병원을 확인하겠습니다. 맞으실까요?`);
      return true;
    }
    if (active.serviceType === "taxi" && slots.destination) {
      setPendingSlotConfirmation(slots, `도착지를 ${slots.destination}으로 이해했습니다. 맞으실까요?`);
      return true;
    }
    if (active.serviceType === "car_maintenance" && slots.serviceLocation) {
      setPendingSlotConfirmation(slots, `${slots.serviceLocation} 지역의 Babelfish 제휴 자동차 서비스 업체를 확인하겠습니다. 맞으실까요?`);
      return true;
    }
    if (active.serviceType === "car_inspection" && slots.serviceLocation) {
      setPendingSlotConfirmation(slots, `${slots.serviceLocation} 지역의 Babelfish 제휴 검사소를 확인하겠습니다. 맞으실까요?`);
      return true;
    }
    if (active.serviceType === "car_accessory_installation" && slots.serviceLocation) {
      setPendingSlotConfirmation(slots, `${slots.serviceLocation} 지역의 아이나비 장착 제휴점 또는 칼트윈 제휴 시공점을 확인하겠습니다. 맞으실까요?`);
      return true;
    }
    setPendingSlotConfirmation(slots);
    return true;
  }

  function isValidCustomerTranscript(text: string) {
    const clean = text.trim();
    const normalized = clean.toLowerCase().replace(/\s+/g, " ");
    if (!clean) return false;
    if (isAssistantTurnActive() || isInsideAssistantEchoGuard()) return false;
    if (isProbablyForeignNoise(clean) && clean.length < 24) return false;
    if (/고객\s*다른\s*기분나/.test(clean)) return false;
    if (normalized === lastProcessedTranscriptRef.current) return false;
    if (isAssistantEcho(clean, lastAssistantTextRef.current)) return false;
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

  function extractCorrectedSlots(text: string): ServiceSlots {
    const active = confirmedAnalysisRef.current ?? pendingAnalysisRef.current ?? analysis;
    const clean = text.replace(/^(아니요|아니|그게 아니고|그게 아니라|잘못 들었어|다시 말할게)[,\s]*/g, "").replace(/이라고$/g, "").trim();
    const analyzed = analyzeRequest(clean);
    const slots: ServiceSlots = { ...analyzed.slots };
    if (!slots.destination && /(판교역|판구역|판규역)/.test(clean)) slots.destination = normalizePlaceCandidate(clean.match(/판교역|판구역|판규역/)?.[0] ?? clean);
    if (!slots.origin && /(우리집|집|회사|사무실)/.test(clean) && /출발/.test(clean)) slots.origin = normalizePlaceCandidate(clean.match(/우리집|집|회사|사무실/)?.[0] ?? clean);
    if (!slots.providerName && analyzed.preferredProvider) slots.providerName = analyzed.preferredProvider;
    if (Object.keys(slots).length === 0 && active.serviceType === "taxi" && clean) slots.destination = normalizePlaceCandidate(clean);
    return slots;
  }

  function buildDetailSlots(text: string, answeredField: string, active: ConciergeAnalysis) {
    const analyzed = analyzeRequest(text);
    const slots: ServiceSlots = { ...analyzed.slots };
    const routeMatch = text.match(/(.+?)(?:에서)\s*(.+?)(?:까지|으로|로)?$/);
    if (routeMatch && (active.serviceType === "taxi" || active.serviceType === "family_mobility")) {
      slots.origin = normalizePlaceCandidate(routeMatch[1].trim());
      slots.destination = normalizePlaceCandidate(routeMatch[2].replace(/(까지|으로|로)$/g, "").trim());
    }
    if (answeredField === "출발지" && !slots.origin) slots.origin = normalizePlaceCandidate(text);
    if (answeredField === "도착지" && !slots.destination) slots.destination = normalizePlaceCandidate(text);
    if (answeredField === "즉시 호출 또는 예약 호출 여부" && !slots.callTiming) slots.callTiming = /(지금|바로|즉시|진행)/.test(text) ? "즉시 호출" : text;
    if (answeredField.includes("병원") && !slots.appointmentPlace) slots.appointmentPlace = analyzed.preferredProvider ?? text;
    if (answeredField.includes("일시") && !slots.appointmentDateTime) slots.appointmentDateTime = text;
    if (answeredField.includes("지역") && !slots.serviceLocation) slots.serviceLocation = normalizePlaceCandidate(text);
    if (answeredField.includes("차량 정보") && !slots.vehicleInfo) slots.vehicleInfo = text;
    if (answeredField === "차량 종류" && !slots.vehicleInfo) slots.vehicleInfo = text;
    if (answeredField.includes("차량 증상") && !slots.vehicleSymptom) slots.vehicleSymptom = text;
    if (answeredField === "탁송 여부" && !slots.towingRequired) slots.towingRequired = isNegativeConfirmation(text) ? "탁송 제외" : text;
    if (answeredField === "시공 지역" && !slots.serviceLocation) slots.serviceLocation = normalizePlaceCandidate(text);
    if (answeredField === "상품명" && !slots.productName) slots.productName = text;
    if (answeredField === "수량" && !slots.quantity) slots.quantity = text;
    if (answeredField === "배송지" && !slots.deliveryAddress) slots.deliveryAddress = text;
    if (answeredField === "개선 반영 확인" && !slots.improvementTarget) slots.improvementTarget = text;
    if (active.serviceType === "service_improvement_command" && !slots.improvementTarget) slots.improvementTarget = active.rawText;
    return slots;
  }

  function handleDetailAnswer(text: string) {
    const confirmed = confirmedAnalysisRef.current;
    if (!confirmed) return;
    const answeredField = remainingFieldsRef.current[0] ?? "추가 정보";
    const slots = buildDetailSlots(text, answeredField, confirmed);
    const nextTranscript = `${transcriptRef.current}\n${text}`.trim();
    transcriptRef.current = nextTranscript;
    setTranscript(nextTranscript);
    setApprovalReady(false);
    waitingForDetailRef.current = false;
    const placeCandidates = getPlaceCandidates(text);
    const question = placeCandidates.length > 0
      ? buildPlaceConfirmationQuestion(placeCandidates)
      : `${formatSlots(slots)}로 이해했습니다. 맞으실까요?`;
    setPendingSlotConfirmation(slots, question);
  }

  function resetPendingFlow() {
    pendingAnalysisRef.current = null;
    confirmedAnalysisRef.current = null;
    waitingForConfirmationRef.current = false;
    waitingForDetailRef.current = false;
    detailNotesRef.current = [];
    remainingFieldsRef.current = [];
    setUnderstoodText("");
    setFinalSummary("");
    setApprovalReady(false);
    setApprovalBlockReason("고객 요청 확인이 필요합니다.");
    setStatus("draft");
    updateAppStatus("LISTENING");
    setAssistHint("고객 요청을 다시 기다리고 있습니다.");
  }

  function safeCreateResponse(payload: { type: "response.create"; response: Record<string, unknown> }) {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return false;
    if (isResponseInProgressRef.current) {
      console.debug("Babelfish response already in progress.");
      return false;
    }
    if (isAssistantSpeakingRef.current || isAssistantAudioPlayingRef.current || isInsideAssistantEchoGuard()) {
      console.debug("Babelfish response skipped during assistant turn or echo guard.");
      return false;
    }
    isResponseInProgressRef.current = true;
    isAssistantSpeakingRef.current = true;
    isAssistantAudioPlayingRef.current = false;
    lastAssistantStartedAtRef.current = Date.now();
    lastAssistantMessageAtRef.current = Date.now();
    markAssistantSpeakingStart(false);
    dc.send(JSON.stringify(payload));
    return true;
  }

  function requestAssistantResponse(instructions?: string) {
    return safeCreateResponse({
      type: "response.create",
      response: instructions ? { instructions: `다음 문장만 그대로 말하세요. 다른 설명은 덧붙이지 마세요.\n${instructions}` } : {}
    });
  }

  function scheduleAssistantResponse(instructions: string, delayMs = 0, relatedAnalysis?: ConciergeAnalysis | null) {
    if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
    responseTimerRef.current = window.setTimeout(() => {
      responseTimerRef.current = null;
      const active = relatedAnalysis ?? getActiveAnalysis();
      const finalInstructions = active.serviceType !== "unknown" ? ensureProviderMention(instructions, active) : instructions;
      lastAssistantResponseMessageRef.current = finalInstructions;
      if (requestAssistantResponse(finalInstructions)) {
        expectedAssistantMessageRef.current = finalInstructions;
        lastAssistantMessageAtRef.current = Date.now();
        appendLog("assistant", finalInstructions);
      } else if (!isAssistantTurnActive()) {
        lastAssistantMessageAtRef.current = Date.now();
        appendLog("assistant", finalInstructions);
        setAssistHint("음성 응답 재시도 가능");
        updateAppStatus("LISTENING");
      }
    }, delayMs);
  }

  function setMicrophoneEnabled(enabled: boolean, source: "auto" | "manual" = "auto") {
    isListeningEnabledRef.current = enabled;
    setIsPushToTalkActive(source === "manual" && enabled);
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    if (enabled) {
      setVoiceState(source === "manual" ? "듣는 중" : "고객 말씀 대기 중");
      updateAppStatus("LISTENING");
      setAssistHint(source === "manual" ? "말씀하신 뒤 다시 버튼을 눌러 확인을 시작하세요." : "고객 말씀을 기다리고 있습니다.");
    } else {
      lastPushToTalkAtRef.current = Date.now();
      setVoiceState("고객 말씀 확인 중");
      setAssistHint(source === "manual" ? "고객 말씀을 확인하고 있습니다." : "AI 응답 중에는 고객 말씀 분석을 잠시 중지합니다.");
    }
  }

  function togglePushToTalk() {
    if (phase !== "call" || isAssistantSpeakingRef.current) return;
    if (serviceStatusRef.current === "standby") {
      recallBabelfish();
      return;
    }
    setMicrophoneEnabled(!isListeningEnabledRef.current, "manual");
  }

  function recallBabelfish() {
    setServiceStatus("listening");
    setStatus("draft");
    updateAppStatus("LISTENING");
    setVoiceState("고객 말씀 대기 중");
    waitingForAdditionalRequestRef.current = false;
    if (lastCompletedServiceRef.current && satisfactionState !== "만족 확인" && satisfactionState !== "개선 의견 접수") {
      waitingForSatisfactionRef.current = true;
      setSatisfactionState("만족도 확인 중");
      const question = `다시 호출해 주셔서 감사합니다. 이전에 접수한 ${lastCompletedServiceRef.current.serviceType} 서비스는 만족스러우셨나요?`;
      appendLog("system", question);
      scheduleAssistantResponse(question);
      return;
    }
    const message = "다시 호출해 주셔서 감사합니다. 추가로 필요한 서비스를 말씀해 주세요.";
    appendLog("system", message);
    scheduleAssistantResponse(message);
  }

  function toggleManualMode() {
    const next = !isManualModeRef.current;
    isManualModeRef.current = next;
    setIsManualMode(next);
    if (next) {
      setMicrophoneEnabled(false, "manual");
      setAssistHint("수동 말하기 모드입니다. 필요할 때 서비스 시작 버튼을 눌러주세요.");
    } else if (!isAssistantSpeakingRef.current) {
      setMicrophoneEnabled(true, "auto");
      setAssistHint("자연 대화 모드입니다. 버튼을 누르지 않아도 말씀하실 수 있습니다.");
    }
  }

  function sendTextToRealtime(text: string) {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }]
      }
    }));
    scheduleAssistantResponse("고객 버튼 입력을 확인했습니다. 이전 맥락을 유지해 한국어 1~2문장으로 짧게 안내하세요.");
  }

  async function approveOrder() {
    if (!approvalReady) {
      const reason = approvalBlockReason || "진행 전 추가 정보가 필요합니다.";
      appendLog("system", `진행 전 추가 정보가 필요합니다. ${reason}`);
      scheduleAssistantResponse(`진행 전 추가 정보가 필요합니다. ${reason}`);
      return;
    }
    updateAppStatus("WAITING APPROVAL");
    const response = await fetch(`${API_BASE}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: finalSummary || transcript })
    });
    const data = await response.json().catch(() => ({
      status: "approved",
      orderId: `FALLBACK-${Date.now()}`,
      message: "승인되었습니다. 제휴사 확인 후 진행 상황을 안내드리겠습니다."
    }));
    const orderId = data.orderId ?? `FALLBACK-${Date.now()}`;
    const active = confirmedAnalysisRef.current ?? analysis;
    const completed: CompletedService = {
      id: orderId,
      serviceType: active.interpretedText || active.serviceType,
      summary: finalSummary || buildFinalSummary(active),
      orderId
    };
    lastSubmittedServiceRef.current = completed;
    waitingForAdditionalRequestRef.current = false;
    setStatus("submitted");
    setServiceStatus("submitted");
    setMockOrderId(orderId);
    setApprovalReady(false);
    setApprovalBlockReason("제휴사 확인 중: 약 10초 내 결과 안내");
    setSatisfactionState("제휴사 확인 중");
    const submittedMessage = buildSubmittedMessage(active);
    setDemoCompletionHint(checkingHint());
    scheduleAssistantResponse(submittedMessage, 0, active);
    startDemoSuccessTimer(active, completed);
  }

  function requestChange() {
    setStatus("change_requested");
    updateAppStatus("ANALYZING");
    appendLog("system", "변경 요청을 접수했습니다.");
    sendTextToRealtime("고객이 조건 변경을 원합니다. 이전 맥락을 유지하고 가격, 수수료, 배송, 일정 변경 가능성을 짧게 확인해 주세요.");
  }

  function transferOperator() {
    setStatus("operator_transfer");
    updateAppStatus("WAITING APPROVAL");
    appendLog("system", "상담원 연결 요청을 접수했습니다.");
    sendTextToRealtime("운영자에게 이관하겠다고 한국어로 안내해 주세요.");
  }

  function stopCall(showSummary = true) {
    if (responseTimerRef.current) window.clearTimeout(responseTimerRef.current);
    responseTimerRef.current = null;
    clearPendingResponseTimer();
    stopWatchdog();
    if (completionTimerRef.current && serviceStatusRef.current !== "submitted") {
      window.clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
      setIsWaitingDemoCompletion(false);
    }
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
    appendLog("system", "통화가 종료되었습니다. 다시 시작하려면 서비스 시작 버튼을 눌러 주세요.");
    updateAppStatus("AI READY");
    if (showSummary) setPhase("start");
  }

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
          {serviceStatus === "standby" && <p className="assist-note">서비스가 종료되었습니다. 필요하시면 서비스 시작 버튼을 눌러 다시 Babelfish를 호출해 주세요.</p>}
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
            <small>기본은 자동으로 듣습니다. 인식이 안 될 때만 버튼을 눌러 다시 말씀해 주세요.</small>
            <div className="service-state-grid">
              <span>현재 상태: {serviceStatus === "standby" ? "서비스 대기 중" : serviceStatus === "submitted" ? "제휴사 확인 중" : serviceStatus === "completed" ? "접수 완료" : serviceStatus === "ready_for_approval" ? "승인 대기" : "서비스 진행 중"}</span>
              <span>최근 완료 서비스: {lastCompletedService?.serviceType ?? "없음"}</span>
              <span>만족도 확인: {satisfactionState}</span>
              <span>진행 안내: {isWaitingDemoCompletion ? "약 10초 내 결과 안내" : demoCompletionHint || "대기 중"}</span>
              {serviceRules.length > 0 && <span>개선 요청: {serviceRules[serviceRules.length - 1]}</span>}
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
          <div className="action-row">
            <button onClick={approveOrder} disabled={analysis.escalationRequired || !approvalReady}><Check size={18} /> 승인</button>
            <button onClick={requestChange}><RefreshCw size={18} /> 변경</button>
            <button onClick={transferOperator}><Headphones size={18} /> 상담원 연결</button>
          </div>
          <p className={`approval-hint ${approvalReady ? "ready" : ""}`}>{approvalReady ? "최종 확인 완료: 승인 가능" : `승인 전 확인 필요: ${approvalBlockReason}`}</p>
        </div>

        <div className="insight-grid">
          <InsightCard title="Babelfish가 이해한 내용" tone={approvalReady ? "ok" : "warn"}>
            <p className="summary-text">{understoodText || analysis.interpretedText || "고객 말씀을 기다리고 있습니다."}</p>
            <div className="confirmation-stack">
              <span className={`confirm-badge ${approvalReady ? "ready" : "pending"}`}>{approvalReady ? "승인 가능" : waitingForConfirmationRef.current ? "고객 확인 필요" : "추가 정보 필요"}</span>
              <span>{remainingFieldsRef.current.length > 0 ? `부족 정보: ${remainingFieldsRef.current.join(", ")}` : analysis.missingFields.length > 0 ? `부족 정보: ${analysis.missingFields.join(", ")}` : "부족 정보 없음"}</span>
              <span>{analysis.nextQuestion || "다음 질문을 준비 중입니다."}</span>
            </div>
            <dl className="slot-grid">
              <div><dt>요청 유형</dt><dd>{analysis.interpretedText || "-"}</dd></div>
              <div><dt>출발지</dt><dd>{confirmedSlots.origin ?? "-"}</dd></div>
              <div><dt>도착지</dt><dd>{confirmedSlots.destination ?? "-"}</dd></div>
              <div><dt>예약 일시</dt><dd>{confirmedSlots.appointmentDateTime ?? confirmedSlots.callTiming ?? "-"}</dd></div>
              <div><dt>고객 지정 업체</dt><dd>{confirmedSlots.providerName ?? analysis.preferredProvider ?? "없음"}</dd></div>
              <div><dt>확인 상태</dt><dd>{pendingSlotSummary ? "장소/정보 확인 필요" : approvalReady ? "최종 확인 완료" : "고객 확인 필요"}</dd></div>
            </dl>
            {pendingSlotSummary && <p className="final-summary pending-summary">{pendingSlotSummary} 확인 대기 중</p>}
            {finalSummary && <p className="final-summary">{finalSummary}</p>}
          </InsightCard>

          <InsightCard title="Babelfish 이해 내용" tone={analysis.escalationRequired ? "warn" : "ok"}>
            <p className="summary-text">{analysis.summary}</p>
            <dl>
              <div><dt>고객 말씀</dt><dd>{analysis.rawText || "-"}</dd></div>
              <div><dt>Babelfish 해석</dt><dd>{analysis.interpretedText || "-"}</dd></div>
              <div><dt>서비스 유형</dt><dd>{analysis.serviceType}</dd></div>
              <div><dt>언어</dt><dd>{analysis.detectedLanguage} {analysis.allowedLanguage ? "허용" : "제한"}</dd></div>
              <div><dt>신뢰도</dt><dd>{Math.round(analysis.confidence * 100)}%</dd></div>
              {analysis.needsConfirmation && <div><dt>확인</dt><dd>고객 확인 필요</dd></div>}
              {analysis.quantity && <div><dt>수량</dt><dd>{analysis.quantity}</dd></div>}
            </dl>
            {analysis.nextQuestion && <p className="muted">{analysis.nextQuestion}</p>}
            {analysis.negotiationIntent && <p className="pill">가격/수수료 협상 요청</p>}
            {analysis.alternativePartnerIntent && <p className="pill">대체 파트너 요청</p>}
            {analysis.escalationRequired && <p className="warning"><ShieldAlert size={16} /> {analysis.escalationReason}</p>}
          </InsightCard>

          <InsightCard title="Babelfish 제휴 네트워크" tone="neutral">
            <div className="network-summary">
              <span><strong>기본 제휴사</strong>{analysis.partnerCandidates.length > 0 ? analysis.partnerCandidates.map((partner) => partner.name).join(" / ") : analysis.defaultProviders.length > 0 ? analysis.defaultProviders.join(" / ") : "요청 확인 후 안내"}</span>
              <span><strong>고객 지정 업체</strong>{analysis.preferredProvider ?? confirmedSlots.providerName ?? "없음"}</span>
              <span><strong>추천 기준</strong>{analysis.recommendationBasis}</span>
              <span><strong>연결 상태</strong>{analysis.providerConnectionLabel}</span>
            </div>
            {analysis.partnerCandidates.length === 0 ? <p className="muted">매칭 후보가 없습니다.</p> : analysis.partnerCandidates.map((partner) => (
              <article className="partner" key={partner.id}>
                <div className="partner-head">
                  <strong>{partner.name}</strong>
                  <span>{partner.category}</span>
                </div>
                <p>{partner.recommendation}</p>
                <div className="partner-meta">
                  <span>평점 {partner.rating}</span>
                  <span>예상 {partner.deliveryMinutes}분</span>
                  <span>{partner.baseFee === 0 ? "예약 확인 후 비용 안내" : `기본 ${partner.baseFee.toLocaleString("ko-KR")}원`}</span>
                </div>
                <small>{partner.capabilities.join(" · ")}</small>
                <div className="linkage-row">{partner.linkage.map((item) => <em key={item}>{item}</em>)}</div>
              </article>
            ))}
          </InsightCard>

          <InsightCard title="실행 계획" tone="neutral">
            <ol className="plan-list">
              {analysis.executionPlan.map((item) => <li key={item}>{item}</li>)}
            </ol>
            <div className="order-state"><Send size={16} /> {mockOrderId ? `${mockOrderId} ${isWaitingDemoCompletion ? "확인 중" : status === "completed" ? "성공" : status}` : status}</div>
            {demoCompletionHint && <p className="final-summary pending-summary">{demoCompletionHint}</p>}
          </InsightCard>
        </div>
      </section>
    </main>
  );
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
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return `서버 연결 실패: Express 서버(${API_BASE})가 실행 중인지, PORT=8787과 NEXT_PUBLIC_API_BASE_URL 설정이 일치하는지 확인해 주세요.`;
  }
  if (error instanceof Error) return error.message || "서버 연결 실패 / API Key 확인 필요";
  return "서버 연결 실패 / API Key 확인 필요";
}

function InsightCard({ title, tone, children }: { title: string; tone: "ok" | "warn" | "neutral"; children: React.ReactNode }) {
  return <section className={`insight-card ${tone}`}><h2>{title}</h2>{children}</section>;
}





