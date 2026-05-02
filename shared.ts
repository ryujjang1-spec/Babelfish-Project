import { mockPartners } from "./partners";
import type { ConciergeAnalysis, LanguageCode, OrderStatus, Partner, PlaceCandidate, ServiceSlots, ServiceType } from "./types";

const serviceKeywords: Array<{ type: ServiceType; words: string[] }> = [
  { type: "service_improvement_command", words: ["수정해줘", "추가해줘", "반영해줘", "앞으로", "시나리오", "고쳐줘"] },
  { type: "car_accessory_installation", words: ["블랙박스", "블박", "전후방", "차량용 카메라", "아이나비", "틴팅", "썬팅", "선팅", "필름", "칼트윈", "장착", "시공"] },
  { type: "family_mobility", words: ["부모님", "아버지", "어머니", "엄마", "아빠", "아이", "데리러", "모셔다", "병원 모셔다"] },
  { type: "car_inspection", words: ["자동차 검사", "차 검사", "검사소", "종합검사", "정기검사", "검사 예약"] },
  { type: "car_maintenance", words: ["정비", "수리", "엔진", "타이어", "오일", "점검", "차량 AS", "차량 as", "자동차 AS", "자동차 as", "에이에스", "브레이크", "공임나라", "마스터 자동차", "블루핸즈"] },
  { type: "hospital_reservation", words: ["병원", "진료", "예약", "증상", "의사", "의원", "내과", "치과", "정형외과", "피부과", "hospital", "clinic"] },
  { type: "product_purchase", words: ["사줘", "구매", "주문", "장보기", "생수", "물건", "상품", "가격 비교", "리뷰", "buy", "purchase", "쿠팡"] },
  { type: "taxi", words: ["택시", "호출", "불러줘", "이동", "병원 가", "가고 싶어", "가야 해", "카카오택시", "우버", "타다", "taxi", "cab"] },
  { type: "delivery", words: ["배송", "배달", "전달", "deliver", "delivery"] }
];

const requestWords = ["해줘", "불러줘", "사줘", "예약", "찾아줘", "배달", "배송", "구매", "변경", "추천", "연결", "확인", "진행", "장착", "시공", "call", "book", "reserve", "deliver", "find", "buy"];
const confirmationWords = ["응", "네", "예", "그래", "좋아", "맞아", "맞습니다", "그렇습니다", "확인", "해주세요", "해 주세요", "진행해줘", "진행해 주세요", "그렇게 해줘"];
const negativeWords = ["싫어", "싫다", "아니", "아니요", "다른 곳", "내가 원하는 곳", "내가 아는 곳", "제휴 말고", "직접 정할게", "거기 말고", "그게 아니고", "취소", "변경"];
const noiseFragments = ["아", "음", "어", "흠", "allora", "sie hat eine", "karete sinha"];

const registeredPlaceWords: Record<string, string> = {
  "우리집": "등록된 우리집",
  "집": "등록된 집",
  "회사": "등록된 회사",
  "사무실": "등록된 사무실",
  "지난번 주소": "등록된 지난번 주소"
};

const placeCandidateMap: Record<string, string[]> = {
  "판구역": ["판교역"],
  "판규역": ["판교역"],
  "판교": ["판교역", "판교"],
  "서울대": ["서울대병원", "서울대입구"],
  "세브란스": ["신촌 세브란스 병원"],
  "아산병원": ["서울아산병원"],
  "블루핸즈": ["블루핸즈"]
};

const providerNames = [
  "아이나비 M 택시",
  "카카오택시",
  "우버",
  "타다",
  "서울대병원",
  "서울아산병원",
  "신촌 세브란스 병원",
  "샤인빔 클리닉 강남점",
  "아름다운 피부나라 의원",
  "자생한방병원",
  "마스터 자동차",
  "공임나라",
  "블루핸즈",
  "아이나비 블랙박스",
  "칼트윈 틴팅 필름",
  "쿠팡"
];

function includesAny(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

export function normalizeUtterance(text: string) {
  return text.trim().toLowerCase().replace(/[.,!?]/g, "").replace(/\s+/g, " ");
}

export function detectLanguage(text: string): LanguageCode {
  const normalized = normalizeUtterance(text);
  if (!normalized) return "ko";
  if (/[\u0400-\u04ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f]/.test(normalized)) return "unsupported";
  if (/[\u3040-\u30ff]/.test(normalized)) return "ja";
  if (/[\u4e00-\u9fff]/.test(normalized) && !/[\u3040-\u30ff\uac00-\ud7af]/.test(normalized)) return "unsupported";
  if (/[a-zA-Z]/.test(normalized) && !/[\uac00-\ud7af]/.test(normalized)) return "en";
  return "ko";
}

export function isShortConfirmation(text: string) {
  const normalized = normalizeUtterance(text);
  return confirmationWords.some((word) => normalizeUtterance(word) === normalized);
}

export function hasConfirmationIntent(text: string) {
  const normalized = normalizeUtterance(text);
  if (!normalized) return false;
  return confirmationWords.some((word) => {
    const confirmation = normalizeUtterance(word);
    return normalized === confirmation || normalized.includes(confirmation);
  });
}

export function isNegativeConfirmation(text: string) {
  const normalized = normalizeUtterance(text);
  return negativeWords.some((word) => normalized.includes(normalizeUtterance(word)));
}

export function isPartnerRefusal(text: string) {
  return isNegativeConfirmation(text);
}

export function isNoiseLikeTranscript(text: string) {
  const normalized = normalizeUtterance(text);
  if (!normalized) return true;
  if (noiseFragments.some((word) => normalizeUtterance(word) === normalized)) return true;
  if (normalized.length <= 2 && !["차", "집"].includes(normalized)) return true;
  if (/^[a-z\s]{3,18}$/i.test(normalized) && !includesAny(normalized, requestWords) && !includesAny(normalized, serviceKeywords.flatMap((entry) => entry.words))) return true;
  return false;
}

export function isAssistantEcho(text: string, lastAssistantText?: string) {
  const normalized = normalizeUtterance(text);
  const assistant = normalizeUtterance(lastAssistantText ?? "");
  if (!normalized || !assistant) return false;
  if (normalized.length <= 8 && assistant.includes(normalized)) return true;
  return normalized.includes(assistant.slice(0, Math.min(24, assistant.length)));
}

export function isLikelyValidUserUtterance(text: string, lastAssistantText?: string) {
  if (isNoiseLikeTranscript(text)) return false;
  if (isAssistantEcho(text, lastAssistantText)) return false;
  const language = detectLanguage(text);
  return language === "ko" || language === "en" || language === "ja";
}

export function isHumanSpeechCandidate(text: string) {
  return isLikelyValidUserUtterance(text);
}

export function inferQuantity(text: string): number | undefined {
  const match = text.match(/(\d+)\s*(개|병|박스|묶음|ea|bottles?)/i);
  if (match) return Number(match[1]);
  if (/열\s*병|10\s*병/.test(text)) return 10;
  if (/스무\s*병|20\s*병/.test(text)) return 20;
  if (/서른\s*병|30\s*병/.test(text)) return 30;
  return undefined;
}

export function inferServiceType(text: string): ServiceType {
  const normalized = text.toLowerCase();
  if (/(검사소|자동차 검사|차 검사|정기검사|종합검사)/.test(normalized)) return "car_inspection";
  if (/(블랙박스|블박|전후방|틴팅|썬팅|선팅|칼트윈|차량용 카메라)/.test(normalized)) return "car_accessory_installation";
  if (/(수리|정비|차량 as|자동차 as|에이에스|공임나라|블루핸즈|마스터 자동차)/i.test(normalized)) return "car_maintenance";
  const matched = serviceKeywords.filter((entry) => includesAny(normalized, entry.words));
  return matched[0]?.type ?? "unknown";
}

export function hasRequestIntent(text: string) {
  if (isNoiseLikeTranscript(text) || isShortConfirmation(text)) return false;
  if (inferQuantity(text)) return true;
  return includesAny(text, requestWords) || inferServiceType(text) !== "unknown";
}

export function isServiceImprovementCommand(text: string) {
  return inferServiceType(text) === "service_improvement_command";
}

export function normalizePlaceCandidate(text: string) {
  const normalized = text.trim();
  return placeCandidateMap[normalized]?.[0] ?? registeredPlaceWords[normalized] ?? normalized;
}

export function getPlaceCandidates(text: string): PlaceCandidate[] {
  const candidates: PlaceCandidate[] = [];
  for (const [raw, values] of Object.entries(placeCandidateMap)) {
    if (text.includes(raw)) candidates.push({ raw, candidates: values, slot: inferPlaceSlot(text, raw) });
  }
  return candidates;
}

export function buildPlaceConfirmationQuestion(candidates: PlaceCandidate[]) {
  const first = candidates[0];
  if (!first) return "주소명을 다시 확인하겠습니다. 말씀하신 장소가 맞으실까요?";
  const candidateLabel = first.candidates.join(" 또는 ");
  if (first.slot === "destination") return `도착지가 ${candidateLabel}으로 들렸습니다. 맞으실까요?`;
  if (first.slot === "origin") return `출발지가 ${candidateLabel}으로 들렸습니다. 맞으실까요?`;
  return `${first.raw}은 ${candidateLabel}을 말씀하신 걸까요?`;
}

export function extractProviderName(text: string) {
  const direct = providerNames.find((name) => text.includes(name));
  if (direct) return normalizePlaceCandidate(direct);
  const match = text.match(/([가-힣A-Za-z0-9\s]+?)(병원|의원|클리닉|정비소|검사소|택시|자동차|필름|시공점|마켓|쿠팡)/);
  return match ? normalizePlaceCandidate(match[0].trim()) : undefined;
}

export function extractServiceSlots(text: string, serviceType: ServiceType): ServiceSlots {
  const slots: ServiceSlots = {};
  const routeMatch = text.match(/(.+?)(?:에서)\s*(.+?)(?:까지|으로|로)?$/);
  if (routeMatch && (serviceType === "taxi" || serviceType === "family_mobility")) {
    slots.origin = normalizePlaceCandidate(routeMatch[1].trim());
    slots.destination = normalizePlaceCandidate(routeMatch[2].replace(/(까지|으로|로)$/g, "").trim());
  }
  const provider = serviceType === "service_improvement_command" ? undefined : extractProviderName(text);
  if (provider) {
    slots.providerName = provider;
    slots.appointmentPlace = provider;
  }
  const timeMatch = text.match(/((다음\s*주\s*)?[월화수목금토일]요일|오늘|내일|모레|오전\s*\d*시?|오후\s*\d*시?|\d+시)/g);
  if (timeMatch) slots.appointmentDateTime = timeMatch.join(" ");
  const locationMatch = text.match(/(수원|성남|분당|판교|강남|서울|송파|잠실|용인|광교|일산|부천|안양|과천|하남|위례|마포|신촌|부산|대구|인천|근처)/);
  if (locationMatch) slots.serviceLocation = normalizePlaceCandidate(locationMatch[0]);
  const vehicleMatch = text.match(/(현대|기아|제네시스|벤츠|BMW|아우디|그랜저|쏘나타|아반떼|카니발|차량|자동차|SUV|세단)[\w\s.0-9가-힣]*/i);
  if (vehicleMatch) slots.vehicleInfo = vehicleMatch[0].trim();
  if (/(엔진오일|타이어|브레이크|엔진|수리|점검|교환|고장)/.test(text)) slots.vehicleSymptom = text;
  if (/(전후방|블랙박스|블박|아이나비)/.test(text)) slots.productName = "아이나비 블랙박스";
  if (/(틴팅|썬팅|선팅|칼트윈|필름)/.test(text)) slots.productName = slots.productName ? `${slots.productName} + 칼트윈 틴팅 필름` : "칼트윈 틴팅 필름";
  const quantity = inferQuantity(text);
  if (quantity) slots.quantity = `${quantity}개`;
  if (/(지금 바로|즉시|바로)/.test(text)) slots.callTiming = "즉시 호출";
  if (/(예약|나중|오후|오전|내일|다음)/.test(text)) slots.callTiming = slots.callTiming ?? "예약 호출";
  if (isServiceImprovementCommand(text)) slots.improvementTarget = text;
  return slots;
}

export function analyzeRequest(transcript: string): ConciergeAnalysis {
  const rawText = transcript.trim();
  if (!rawText || isNoiseLikeTranscript(rawText)) return emptyAnalysis(rawText, "말씀을 확인하지 못했습니다.");

  const detectedLanguage = detectLanguage(rawText);
  const allowedLanguage = detectedLanguage !== "unsupported";
  if (!allowedLanguage) {
    return {
      ...emptyAnalysis(rawText, "지원하지 않는 언어이거나 말씀을 정확히 파악하지 못했습니다."),
      allowedLanguage: false,
      detectedLanguage,
      confidence: 0.12,
      nextQuestion: "한국어, 영어 또는 일본어로 다시 말씀해 주세요.",
      confirmationQuestion: "한국어, 영어 또는 일본어로 다시 말씀해 주세요."
    };
  }

  const serviceType = inferServiceType(rawText);
  const quantity = inferQuantity(rawText);
  const requiredInfo = buildRequiredInfo(serviceType, rawText, quantity);
  const confidence = serviceType === "unknown" ? 0.38 : requiredInfo.length === 0 ? 0.88 : 0.74;
  const slots = extractServiceSlots(rawText, serviceType);
  const preferredProvider = slots.providerName;
  const partnerCandidates = mockPartners
    .filter((partner) => partner.serviceTypes.includes(serviceType))
    .sort((a, b) => b.rating - a.rating || a.baseFee - b.baseFee)
    .slice(0, 4);
  const preferredProviderIsPartner = Boolean(preferredProvider && mockPartners.some((partner) => partner.name.includes(preferredProvider) || preferredProvider.includes(partner.name)));

  return {
    serviceType,
    rawText,
    interpretedText: buildInterpretedText(serviceType, quantity, rawText),
    allowedLanguage,
    detectedLanguage,
    requiredInfo,
    missingFields: requiredInfo,
    quantity,
    negotiationIntent: /가격|수수료|할인|깎아|비싸|discount|fee/i.test(rawText),
    alternativePartnerIntent: isPartnerRefusal(rawText),
    confidence,
    needsConfirmation: serviceType !== "unknown" || confidence < 0.8,
    confirmationQuestion: buildConfirmationQuestion(serviceType, confidence, rawText),
    nextQuestion: buildNextQuestion(serviceType, rawText),
    partnerIntro: buildPartnerIntro(serviceType, rawText),
    escalationRequired: /상담원|사람|직원|operator|agent|human/i.test(rawText),
    escalationReason: /상담원|사람|직원|operator|agent|human/i.test(rawText) ? "고객이 상담원 연결을 요청했습니다." : undefined,
    summary: buildSummary(serviceType, quantity, rawText),
    executionPlan: buildExecutionPlan(serviceType, requiredInfo, rawText),
    partnerCandidates,
    slots,
    preferredProvider,
    preferredProviderIsPartner,
    defaultProviders: buildDefaultProviders(serviceType, rawText),
    providerConnectionLabel: buildProviderConnectionLabel(serviceType, preferredProvider, preferredProviderIsPartner, rawText),
    recommendationBasis: buildRecommendationBasis(serviceType, rawText)
  };
}

function emptyAnalysis(rawText: string, summary: string): ConciergeAnalysis {
  return {
    serviceType: "unknown",
    rawText,
    interpretedText: "",
    allowedLanguage: true,
    detectedLanguage: "ko",
    requiredInfo: [],
    missingFields: [],
    negotiationIntent: false,
    alternativePartnerIntent: false,
    confidence: 0.2,
    needsConfirmation: false,
    confirmationQuestion: "원하시는 서비스를 짧게 말씀해 주세요.",
    nextQuestion: "택시 호출, 병원 예약, 자동차 정비, 자동차 검사, 블랙박스, 틴팅, 상품 구매처럼 말씀해 주세요.",
    partnerIntro: "",
    escalationRequired: false,
    summary,
    executionPlan: ["고객 말씀을 기다리는 중입니다."],
    partnerCandidates: [],
    slots: {},
    preferredProviderIsPartner: false,
    defaultProviders: [],
    providerConnectionLabel: "고객 말씀 확인 중",
    recommendationBasis: "요청 확인 후 제휴 네트워크를 안내합니다."
  };
}

function buildRequiredInfo(serviceType: ServiceType, text: string, quantity?: number) {
  const missing: string[] = [];
  const hasLocation = /(에서|으로|까지|주소|출발|도착|서울|강남|수원|분당|판교|근처|지역)/i.test(text);
  const hasTime = /(지금|오늘|내일|\d+시|오전|오후|다음)/i.test(text);
  if (serviceType === "taxi") {
    if (!/(에서|출발)/.test(text)) missing.push("출발지");
    if (!/(까지|도착|목적지)/.test(text)) missing.push("도착지");
    if (!hasTime && !/(지금|바로|즉시)/.test(text)) missing.push("즉시 호출 또는 예약 호출 여부");
  }
  if (serviceType === "product_purchase") {
    if (!quantity && !/(생수|물건|상품|사줘|구매|주문)/.test(text)) missing.push("상품명");
    if (!quantity) missing.push("수량");
    if (!hasLocation) missing.push("배송지");
  }
  if (serviceType === "hospital_reservation") {
    if (!/(병원|의원|내과|치과|정형외과|피부과|서울|강남|수원|분당|판교)/.test(text)) missing.push("진료과 또는 지역");
    if (!hasTime) missing.push("희망 일시");
  }
  if (serviceType === "car_maintenance") {
    if (!/(수리|정비|점검|엔진|오일|타이어|브레이크|고장)/.test(text)) missing.push("차량 증상");
    if (!hasLocation) missing.push("정비 지역");
    if (!hasTime) missing.push("희망 일시");
  }
  if (serviceType === "car_inspection") {
    if (!hasLocation) missing.push("검사 지역");
    if (!hasTime) missing.push("희망 검사 일시");
  }
  if (serviceType === "car_accessory_installation") {
    if (!/(차량|자동차|현대|기아|제네시스|벤츠|BMW|아우디)/.test(text)) missing.push("차량 종류");
    if (!hasLocation) missing.push("시공 지역");
    if (!hasTime) missing.push("희망 날짜");
  }
  if (serviceType === "family_mobility") {
    if (!hasLocation) missing.push("출발지와 도착지");
    if (!hasTime) missing.push("이동 시간");
    missing.push("탑승자 연락처");
  }
  if (serviceType === "unknown") missing.push("서비스 유형");
  if (serviceType === "service_improvement_command") missing.push("개선 반영 확인");
  return Array.from(new Set(missing));
}

function accessoryMode(text: string) {
  const hasBlackbox = /(블랙박스|블박|전후방|아이나비)/.test(text);
  const hasTinting = /(틴팅|썬팅|선팅|칼트윈|필름)/.test(text);
  if (hasBlackbox && hasTinting) return "package";
  if (hasTinting) return "tinting";
  return "blackbox";
}

function buildInterpretedText(serviceType: ServiceType, quantity?: number, text = "") {
  if (serviceType === "taxi") return "아이나비 M 택시 호출 요청";
  if (serviceType === "product_purchase") return `${quantity ? `${quantity}개 ` : ""}상품 구매와 배송 요청`;
  if (serviceType === "hospital_reservation") return "Babelfish 제휴 병원 예약 요청";
  if (serviceType === "car_maintenance") return "Babelfish 제휴 자동차 서비스 업체 예약 요청";
  if (serviceType === "car_inspection") return "Babelfish 제휴 검사소 예약 요청";
  if (serviceType === "car_accessory_installation") {
    const mode = accessoryMode(text);
    if (mode === "package") return "아이나비 블랙박스와 칼트윈 틴팅 필름 패키지 시공 요청";
    if (mode === "tinting") return "칼트윈 틴팅 필름 시공 요청";
    return "아이나비 블랙박스 장착 요청";
  }
  if (serviceType === "family_mobility") return "가족 이동 지원 요청";
  if (serviceType === "delivery") return "배송 또는 전달 요청";
  if (serviceType === "service_improvement_command") return "서비스 시나리오 개선 요청";
  return "말씀하신 내용 파악 대기";
}

function buildPartnerIntro(serviceType: ServiceType, text = "") {
  if (serviceType === "taxi") return "아이나비 M 택시를 연결해드리겠습니다.";
  if (serviceType === "hospital_reservation") return "Babelfish 제휴 병원을 먼저 연결해드리겠습니다.";
  if (serviceType === "car_maintenance") return "Babelfish 제휴 자동차 서비스 업체를 먼저 연결해드리겠습니다.";
  if (serviceType === "car_inspection") return "Babelfish 제휴 검사소를 먼저 연결해드리겠습니다.";
  if (serviceType === "product_purchase") return "Babelfish 제휴 협력사를 통해 가격과 리뷰를 비교해 구매까지 연결해드리겠습니다.";
  if (serviceType === "family_mobility") return "Babelfish 제휴 이동 서비스를 먼저 연결해드리겠습니다.";
  if (serviceType === "car_accessory_installation") {
    const mode = accessoryMode(text);
    if (mode === "package") return "아이나비 블랙박스와 칼트윈 틴팅 필름 패키지 시공으로 연결해드리겠습니다.";
    if (mode === "tinting") return "칼트윈 틴팅 필름 시공으로 연결해드리겠습니다.";
    return "아이나비 블랙박스 장착 서비스로 연결해드리겠습니다.";
  }
  return "";
}

function buildConfirmationQuestion(serviceType: ServiceType, confidence: number, text = "") {
  if (serviceType === "unknown" || confidence < 0.5) return "말씀하신 내용을 파악하기 어렵습니다. 다시 말씀해 주세요.";
  return `${buildInterpretedText(serviceType, undefined, text)}으로 이해했습니다. 맞으실까요?`;
}

function buildNextQuestion(serviceType: ServiceType, text = "") {
  if (serviceType === "product_purchase") return "상품명과 수량을 말씀해 주세요.";
  if (serviceType === "hospital_reservation") return "원하시는 진료과와 지역을 말씀해 주세요.";
  if (serviceType === "car_maintenance") return "차량 증상과 원하시는 지역을 말씀해 주세요.";
  if (serviceType === "car_inspection") return "원하시는 검사 지역과 날짜를 말씀해 주세요.";
  if (serviceType === "car_accessory_installation") return "차량 종류와 시공 지역을 말씀해 주세요.";
  if (serviceType === "family_mobility") return "출발지와 도착지를 말씀해 주세요.";
  if (serviceType === "taxi") return "출발지와 도착지를 말씀해 주세요.";
  if (serviceType === "service_improvement_command") return "이 개선 요청을 서비스 시나리오에 반영하면 될까요?";
  return "원하시는 서비스를 짧게 말씀해 주세요.";
}

function buildSummary(serviceType: ServiceType, quantity?: number, text = "") {
  return `${buildInterpretedText(serviceType, quantity, text)}입니다.`;
}

function buildExecutionPlan(serviceType: ServiceType, missing: string[], text = "") {
  if (missing.length > 0) return [`추가 확인 필요: ${missing.join(", ")}`, "정보가 확인되면 제휴 서비스 접수로 진행합니다."];
  if (serviceType === "taxi") return ["출발지와 도착지 확인", "아이나비 M 택시 호출 접수", "10초 안에 데모 배차 완료 안내"];
  if (serviceType === "hospital_reservation") return ["진료과와 지역 확인", "Babelfish 제휴 병원 예약 접수", "10초 안에 데모 접수 완료 안내"];
  if (serviceType === "car_maintenance") return ["차량 증상 확인", "Babelfish 제휴 자동차 서비스 업체 접수", "10초 안에 데모 접수 완료 안내"];
  if (serviceType === "car_inspection") return ["검사 지역과 날짜 확인", "Babelfish 제휴 검사소 접수", "10초 안에 데모 접수 완료 안내"];
  if (serviceType === "car_accessory_installation") return ["차량 종류와 시공 지역 확인", "고정 브랜드 시공 접수", "10초 안에 데모 접수 완료 안내"];
  if (serviceType === "product_purchase") return ["상품명과 수량 확인", "Babelfish 제휴 협력사 구매 접수", "10초 안에 데모 접수 완료 안내"];
  return ["고객 말씀 확인", "제휴 서비스 연결 가능 여부 확인", "고객 승인 후 접수"];
}

function buildDefaultProviders(serviceType: ServiceType, text = "") {
  if (serviceType === "taxi") return ["아이나비 M 택시"];
  if (serviceType === "hospital_reservation") return ["Babelfish 제휴 병원"];
  if (serviceType === "car_maintenance") return ["Babelfish 제휴 자동차 서비스 업체", "마스터 자동차", "공임나라", "블루핸즈"];
  if (serviceType === "car_inspection") return ["Babelfish 제휴 검사소", "마스터 자동차", "공임나라", "블루핸즈"];
  if (serviceType === "car_accessory_installation") {
    const mode = accessoryMode(text);
    if (mode === "package") return ["아이나비 블랙박스", "칼트윈 틴팅 필름"];
    if (mode === "tinting") return ["칼트윈 틴팅 필름"];
    return ["아이나비 블랙박스"];
  }
  if (serviceType === "product_purchase" || serviceType === "delivery") return ["Babelfish 제휴 협력사"];
  if (serviceType === "family_mobility") return ["Babelfish 제휴 이동 서비스", "아이나비 M 택시"];
  return [];
}

function buildProviderConnectionLabel(serviceType: ServiceType, preferredProvider?: string, isPartner = false, text = "") {
  if (preferredProvider) return isPartner ? `${preferredProvider} 제휴 연결 가능 여부 확인 대기` : `${preferredProvider} 고객 지정 업체 연결 가능 여부 확인 대기`;
  if (serviceType === "taxi") return "아이나비 M 택시 연결 정보 확인 중";
  if (serviceType === "hospital_reservation") return "Babelfish 제휴 병원 예약 가능 여부 확인 대기";
  if (serviceType === "car_maintenance") return "Babelfish 제휴 자동차 서비스 업체 예약 가능 여부 확인 대기";
  if (serviceType === "car_inspection") return "Babelfish 제휴 검사소 예약 가능 여부 확인 대기";
  if (serviceType === "car_accessory_installation") return buildPartnerIntro(serviceType, text);
  if (serviceType === "product_purchase") return "Babelfish 제휴 협력사 가격/리뷰 비교 대기";
  return "요청 확인 후 연결 가능 여부 확인";
}

function buildRecommendationBasis(serviceType: ServiceType, text = "") {
  if (serviceType === "taxi" || serviceType === "family_mobility") return "아이나비 M 택시 또는 제휴 이동 서비스 기준으로 연결합니다.";
  if (serviceType === "hospital_reservation") return "Babelfish 제휴 병원을 먼저 확인합니다.";
  if (serviceType === "car_maintenance") return "마스터 자동차, 공임나라, 블루핸즈 등 제휴 자동차 서비스 업체를 우선 확인합니다.";
  if (serviceType === "car_inspection") return "Babelfish 제휴 검사소를 먼저 확인합니다.";
  if (serviceType === "car_accessory_installation") return buildPartnerIntro(serviceType, text);
  if (serviceType === "product_purchase") return "Babelfish 제휴 협력사의 가격과 리뷰를 기준으로 비교합니다.";
  return "고객 요청 확인 후 제휴 네트워크를 우선 안내합니다.";
}

function inferPlaceSlot(text: string, raw: string): PlaceCandidate["slot"] {
  const index = Math.max(0, text.indexOf(raw));
  const before = text.slice(0, index);
  const after = text.slice(index + raw.length);
  if (before.includes("에서")) return "destination";
  if (after.includes("에서")) return "origin";
  if (text.includes("까지") || before.includes("도착")) return "destination";
  return "placeName";
}

export { mockPartners };
export type { ConciergeAnalysis, LanguageCode, OrderStatus, Partner, PlaceCandidate, ServiceSlots, ServiceType };
