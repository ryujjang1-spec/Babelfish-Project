import { mockPartners } from "./partners";
import type { ConciergeAnalysis, LanguageCode, OrderStatus, Partner, PlaceCandidate, ServiceSlots, ServiceType } from "./types";

const quantityWords: Record<string, number> = {
  "열 병": 10,
  "열병": 10,
  "스무 병": 20,
  "스무병": 20,
  "서른 병": 30,
  "서른병": 30
};

const serviceKeywords: Array<{ type: ServiceType; words: string[] }> = [
  { type: "service_improvement_command", words: ["수정해줘", "추가해줘", "반영해줘", "앞으로", "앞으로는", "다음부터", "고쳐줘", "시나리오에 넣어줘", "필수로 물어봐", "화면에 보여줘"] },
  { type: "car_accessory_installation", words: ["블랙박스", "블박", "전후방 카메라", "차량용 카메라", "아이나비 블랙박스", "틴팅", "썬팅", "선팅", "필름", "자동차 필름", "칼트윈", "칼트윈 틴팅", "장착", "시공", "신차 출고"] },
  { type: "family_mobility", words: ["부모님", "아버지", "어머니", "자녀", "아이", "데리러", "모셔다", "병원 모셔다"] },
  { type: "car_inspection", words: ["자동차 검사", "차 검사", "검사소", "종합검사", "정기검사", "검사 예약"] },
  { type: "car_maintenance", words: ["정비", "수리", "엔진", "타이어", "오일", "점검", "정비소", "차량 AS", "차량 as", "자동차 AS", "자동차 as", "에이에스", "블루핸즈", "블루헨즈", "공임나라", "마스터 자동차"] },
  { type: "hospital_reservation", words: ["병원", "진료", "예약", "증상", "의사", "의원", "피부과", "내과", "정형외과", "hospital", "clinic"] },
  { type: "product_purchase", words: ["사다 줘", "사줘", "구매", "장보기", "생수", "물건", "상품", "가격 비교", "리뷰", "buy", "purchase"] },
  { type: "taxi", words: ["택시", "호출", "태워줘", "이동", "병원 갈 차", "가고 싶어", "가고싶어", "가야 해", "가야해", "taxi", "cab"] },
  { type: "delivery", words: ["배송", "배달", "전달", "deliver", "delivery"] }
];

const highTrustWords = ["응급", "법률", "계약", "신분증", "현금 인출", "귀금속", "emergency", "legal"];
const operatorWords = ["상담원", "사람", "직원", "operator", "agent", "human"];
const negotiationWords = ["수수료 비싸", "가격 깎아줘", "깎아", "비싸", "할인", "수수료", "discount", "too expensive", "fee"];
const alternativeWords = ["다른 업체 없어", "다른 업체", "대체", "다른 곳", "another partner", "alternative"];
const requestWords = ["해줘", "불러줘", "사다 줘", "사줘", "예약", "찾아줘", "배달", "배송", "구매", "변경", "깎아줘", "불러", "추천", "연결", "확인", "가고 싶어", "가야 해", "장착", "시공", "buy", "call", "book", "reserve", "deliver", "find", "change", "discount"];
const confirmationWords = ["네", "응", "그래", "그래요", "맞아", "맞아요", "맞습니다", "그렇습니다", "좋아요", "진행해줘", "그렇게 해줘", "알겠습니다"];
const negativeWords = ["아니요", "아니", "그게 아니고", "그게 아니라", "다시 말할게", "취소", "변경할게"];
const noiseFragments = ["음", "어", "아", "에", "오", "allora", "sie hat eine", "karete sinha"];
const registeredPlaceWords: Record<string, string> = {
  "우리집": "등록된 우리집",
  "집": "등록된 집",
  "회사": "등록된 회사",
  "사무실": "등록된 사무실",
  "지난번 장소": "등록된 지난번 장소"
};
const placeCandidateMap: Record<string, string[]> = {
  "판구역": ["판교역"],
  "판규역": ["판교역"],
  "판교": ["판교역", "판교"],
  "서울대": ["서울대병원", "서울대학교"],
  "세브란스": ["신촌 세브란스 병원"],
  "아산병원": ["서울아산병원"],
  "블루헨즈": ["블루핸즈"]
};
const providerNames = [
  "아이나비 M 택시",
  "카카오택시",
  "서울대병원",
  "서울아산병원",
  "신촌 세브란스 병원",
  "강남세브란스병원",
  "세브란스",
  "샤인빔 클리닉 강남점",
  "아름다운 피부나라 의원",
  "자생한방병원",
  "마스터 자동차",
  "공임나라",
  "블루핸즈",
  "블루헨즈",
  "아이나비 장착 제휴점",
  "칼트윈 제휴 시공점",
  "아이나비 블랙박스",
  "칼트윈 틴팅 필름"
];

function includesAny(text: string, words: string[]) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

export function normalizeUtterance(text: string) {
  return text.trim().toLowerCase().replace(/[.,!?？]/g, "").replace(/\s+/g, " ");
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

export function isNegativeConfirmation(text: string) {
  const normalized = normalizeUtterance(text);
  return negativeWords.some((word) => normalized.includes(normalizeUtterance(word)));
}

export function isNoiseLikeTranscript(text: string) {
  const normalized = normalizeUtterance(text);
  if (!normalized) return true;
  if (noiseFragments.some((word) => normalizeUtterance(word) === normalized)) return true;
  if (normalized.length <= 2 && !["차", "약"].includes(normalized)) return true;
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
  for (const [word, value] of Object.entries(quantityWords)) {
    if (text.includes(word)) return value;
  }
  const numericBottle = text.match(/(\d+)\s*(병|개|bottles?|ea)/i);
  return numericBottle ? Number(numericBottle[1]) : undefined;
}

export function inferServiceType(text: string): ServiceType {
  const normalized = text.toLowerCase();
  if (includesAny(normalized, serviceKeywords.find((entry) => entry.type === "service_improvement_command")?.words ?? [])) return "service_improvement_command";
  if (includesAny(normalized, serviceKeywords.find((entry) => entry.type === "car_accessory_installation")?.words ?? [])) return "car_accessory_installation";
  if (/(블루핸즈|블루헨즈|공임나라|마스터 자동차).*(예약|정비|검사|점검|수리)/.test(text)) return includesAny(text, ["검사"]) ? "car_inspection" : "car_maintenance";
  const matched = serviceKeywords.filter((entry) => includesAny(normalized, entry.words));
  return matched[0]?.type ?? "unknown";
}

export function hasRequestIntent(text: string) {
  if (isNoiseLikeTranscript(text) || isShortConfirmation(text)) return false;
  if (inferQuantity(text)) return true;
  return includesAny(text, requestWords) || includesAny(text, negotiationWords) || includesAny(text, alternativeWords) || inferServiceType(text) !== "unknown";
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
    if (text.includes(raw)) {
      candidates.push({ raw, candidates: values, slot: inferPlaceSlot(text, raw) });
    }
  }
  return candidates;
}

export function needsPlaceConfirmation(text: string) {
  return getPlaceCandidates(text).length > 0 || /(에서).+(까지)/.test(text);
}

export function buildPlaceConfirmationQuestion(candidates: PlaceCandidate[]) {
  const first = candidates[0];
  if (!first) return "장소명을 다시 확인하겠습니다. 말씀하신 장소가 맞으실까요?";
  const candidateLabel = first.candidates.join(" 또는 ");
  if (first.slot === "destination") return `도착지가 ${candidateLabel}으로 들렸습니다. 맞으실까요?`;
  if (first.slot === "origin") return `출발지가 ${candidateLabel}으로 들렸습니다. 맞으실까요?`;
  return `${first.raw}는 ${candidateLabel}을 말씀하신 걸까요?`;
}

export function extractProviderName(text: string) {
  const direct = providerNames.find((name) => text.includes(name));
  if (direct) return normalizePlaceCandidate(direct);
  const match = text.match(/([가-힣A-Za-z0-9\s]+?)(병원|의원|클리닉|정비소|검사소|택시|자동차|핸즈|나라|필름|제휴점|시공점)/);
  return match ? normalizePlaceCandidate(match[0].trim()) : undefined;
}

function normalizeRegisteredPlace(text: string) {
  return registeredPlaceWords[text] ?? normalizePlaceCandidate(text);
}

export function extractServiceSlots(text: string, serviceType: ServiceType): ServiceSlots {
  const slots: ServiceSlots = {};
  const routeMatch = text.match(/(.+?)(?:에서)\s*(.+?)(?:까지|으로|로)?$/);
  if (routeMatch && (serviceType === "taxi" || serviceType === "family_mobility")) {
    slots.origin = normalizeRegisteredPlace(routeMatch[1].trim());
    slots.destination = normalizePlaceCandidate(routeMatch[2].replace(/(까지|으로|로)$/g, "").trim());
  }
  const provider = serviceType === "service_improvement_command" ? undefined : extractProviderName(text);
  if (provider) {
    slots.providerName = provider;
    slots.appointmentPlace = provider;
  }
  const timeMatch = text.match(/((다음\s*주\s*)?[월화수목금토일]요일|오늘|내일|모레|오전\s*\d*시?|오후\s*\d*시?|\d+시)/g);
  if (timeMatch) slots.appointmentDateTime = timeMatch.join(" ");
  const locationMatch = text.match(/(수원|성남|분당|판교|강남|서울|송파|잠실|용인|광교|일산|부천|안양|과천|하남|위례|마포|신촌|부산|대구|인천|근처|인근)/);
  if (locationMatch) slots.serviceLocation = normalizePlaceCandidate(locationMatch[0]);
  const vehicleMatch = text.match(/(쉐보레|현대|기아|제네시스|벤츠|BMW|아우디|임팔라|쏘나타|그랜저|아반떼|카니발|싼타페)[\w\s.0-9가-힣]*/i);
  if (vehicleMatch) slots.vehicleInfo = vehicleMatch[0].trim();
  if (/(엔진오일|타이어|브레이크|엔진|수리|점검|교환)/.test(text)) slots.vehicleSymptom = text;
  if (/(전후방|블랙박스|블박|아이나비)/.test(text)) slots.productName = "아이나비 블랙박스";
  if (/(틴팅|썬팅|선팅|칼트윈|필름)/.test(text)) slots.productName = slots.productName ? `${slots.productName} + 칼트윈 틴팅 필름` : "칼트윈 틴팅 필름";
  const quantity = inferQuantity(text);
  if (quantity) slots.quantity = `${quantity}개/병`;
  if (/(지금|바로|즉시)/.test(text)) slots.callTiming = "즉시 호출";
  if (/(예약|나중|오후|오전|내일|다음)/.test(text)) slots.callTiming = slots.callTiming ?? "예약 호출";
  if (isServiceImprovementCommand(text)) slots.improvementTarget = text;
  return slots;
}

export function analyzeRequest(transcript: string): ConciergeAnalysis {
  const rawText = transcript.trim();
  if (!rawText || isNoiseLikeTranscript(rawText)) {
    return emptyAnalysis(rawText, "말씀이 확인되지 않았습니다.");
  }

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
  const negotiationIntent = includesAny(rawText, negotiationWords);
  const alternativePartnerIntent = includesAny(rawText, alternativeWords);
  const operatorRequested = includesAny(rawText, operatorWords);
  const highTrust = includesAny(rawText, highTrustWords);
  const requiredInfo = buildRequiredInfo(serviceType, rawText, quantity);
  const confidence = operatorRequested || highTrust ? 0.7 : serviceType === "unknown" ? 0.38 : requiredInfo.length === 0 ? 0.88 : 0.74;
  const escalationRequired = operatorRequested || highTrust;
  const escalationReason = operatorRequested
    ? "고객이 상담원 연결을 요청했습니다."
    : highTrust
      ? "고신뢰 서비스로 운영자 확인이 필요합니다."
      : undefined;

  const partnerCandidates = mockPartners
    .filter((partner) => partner.serviceTypes.includes(serviceType))
    .sort((a, b) => b.rating - a.rating || a.baseFee - b.baseFee)
    .slice(0, 4);
  const slots = extractServiceSlots(rawText, serviceType);
  const preferredProvider = slots.providerName;
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
    negotiationIntent,
    alternativePartnerIntent,
    confidence,
    needsConfirmation: serviceType !== "unknown" || confidence < 0.8,
    confirmationQuestion: buildConfirmationQuestion(serviceType, requiredInfo, confidence, rawText),
    nextQuestion: buildNextQuestion(serviceType, rawText),
    partnerIntro: buildPartnerIntro(serviceType, rawText),
    escalationRequired,
    escalationReason,
    summary: buildSummary(serviceType, quantity, negotiationIntent, alternativePartnerIntent, rawText),
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
    nextQuestion: "택시 호출, 병원 예약, 상품 구매처럼 짧게 말씀해 주세요.",
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
  const hasLocation = /(에서|으로|까지|주소|출발|도착|서울|강남|수원|성남|분당|판교|역|병원|집|회사|지역|station|address)/i.test(text);
  const hasTime = /(지금|오늘|내일|\d+시|오전|오후|분|now|today|tomorrow)/i.test(text);
  if (serviceType === "taxi") {
    if (!/(에서)/.test(text)) missing.push("출발지");
    if (!/(까지|도착|목적지)/.test(text)) missing.push("도착지");
    if (!hasTime && !/(지금|바로|즉시)/.test(text)) missing.push("즉시 호출 또는 예약 호출 여부");
  }
  if (serviceType === "product_purchase") {
    if (!quantity && !/(생수|물건|상품|사줘|구매)/.test(text)) missing.push("상품명과 수량");
    if (!hasLocation) missing.push("배송지");
  }
  if (serviceType === "hospital_reservation") {
    if (!/(병원|의원|피부과|내과|정형외과|서울|강남|수원|성남|분당|판교)/.test(text)) missing.push("병원명 또는 진료 지역");
    if (!hasTime) missing.push("희망 일시");
  }
  if (serviceType === "car_maintenance") missing.push("차량 증상과 희망 지역");
  if (serviceType === "car_inspection" && !hasTime) missing.push("희망 검사 일시");
  if (serviceType === "car_accessory_installation") {
    if (!/(차량|신차|현대|기아|쉐보레|벤츠|BMW|아우디)/.test(text)) missing.push("차량 종류");
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
  const hasBlackbox = /(블랙박스|블박|전후방|차량용 카메라|아이나비)/.test(text);
  const hasTinting = /(틴팅|썬팅|선팅|칼트윈|필름)/.test(text);
  if (hasBlackbox && hasTinting) return "package";
  if (hasTinting) return "tinting";
  return "blackbox";
}

function buildInterpretedText(serviceType: ServiceType, quantity?: number, text = "") {
  if (serviceType === "taxi") return "아이나비 M 택시 호출 요청";
  if (serviceType === "product_purchase") return `${quantity ? `${quantity}개/병 ` : ""}상품 구매와 배송 요청`;
  if (serviceType === "hospital_reservation") return "병원 예약 요청";
  if (serviceType === "car_maintenance") return "자동차 정비 요청";
  if (serviceType === "car_inspection") return "자동차 검사 예약 요청";
  if (serviceType === "car_accessory_installation") {
    const mode = accessoryMode(text);
    if (mode === "package") return "아이나비 블랙박스와 칼트윈 틴팅 필름 패키지 시공 요청";
    if (mode === "tinting") return "칼트윈 틴팅 필름 시공 요청";
    return "아이나비 블랙박스 장착 요청";
  }
  if (serviceType === "family_mobility") return "가족 이동 지원 요청";
  if (serviceType === "delivery") return "배송 또는 전달 요청";
  if (serviceType === "service_improvement_command") return "서비스 시나리오 개선 요청";
  return "말씀하신 내용 파악이 어려웠습니다.";
}

function buildPartnerIntro(serviceType: ServiceType, text = "") {
  if (serviceType === "hospital_reservation") return "종합병원은 서울아산병원을 우선 추천드립니다. 개인 병원은 제휴된 샤인빔 클리닉 강남점과 아름다운 피부나라 의원을 추천드립니다.";
  if (serviceType === "car_inspection") return "자동차 검사는 제휴된 인근의 마스터 자동차를 우선 추천드립니다. 검사 예약과 탁송 가능 여부를 함께 확인할 수 있습니다.";
  if (serviceType === "car_maintenance") return "차량 AS는 제휴된 인근의 마스터 자동차를 우선 추천드립니다. 정비 예약과 탁송 연계까지 확인할 수 있습니다.";
  if (serviceType === "car_accessory_installation") {
    const mode = accessoryMode(text);
    if (mode === "package") return "아이나비 블랙박스와 칼트윈 틴팅 필름 패키지 시공으로 연결합니다.";
    if (mode === "tinting") return "칼트윈 틴팅 필름 기준으로 칼트윈 제휴 시공점에 연결합니다.";
    return "아이나비 블랙박스 기준으로 아이나비 장착 제휴점에 연결합니다.";
  }
  if (serviceType === "product_purchase") return "Babelfish 제휴 협력사를 통해 가격과 리뷰를 비교한 뒤 구매와 배송을 도와드립니다.";
  if (serviceType === "taxi") return "아이나비 M 택시로 배차해드리겠습니다.";
  if (serviceType === "family_mobility") return "가족 이동 지원으로 아이나비 M 택시 또는 제휴 이동 서비스를 연결합니다.";
  if (serviceType === "service_improvement_command") return "서비스 시나리오 개선 요청으로 이해했습니다.";
  return "";
}

function buildConfirmationQuestion(serviceType: ServiceType, missing: string[], confidence: number, text = "") {
  const interpreted = buildInterpretedText(serviceType, undefined, text);
  if (serviceType === "unknown" || confidence < 0.5) return "말씀하신 내용 파악이 어려웠습니다. 다시 말씀해 주세요.";
  return `${interpreted}으로 이해했습니다. 맞으실까요?`;
}

function buildNextQuestion(serviceType: ServiceType, text = "") {
  if (serviceType === "product_purchase") return "상품명과 수량, 배송지를 말씀해 주세요.";
  if (serviceType === "hospital_reservation") return "평소 다니시는 병원이 있으실까요?";
  if (serviceType === "car_maintenance") return "차량 증상과 원하시는 지역을 말씀해 주세요.";
  if (serviceType === "car_inspection") return "원하시는 검사 날짜와 시간이 있으실까요?";
  if (serviceType === "car_accessory_installation") {
    const mode = accessoryMode(text);
    if (mode === "package") return "차량 종류와 원하시는 시공 지역을 말씀해 주세요.";
    if (mode === "tinting") return "차량 종류와 전면, 측후면, 전체 시공 중 원하는 구성을 말씀해 주세요.";
    return "차량 종류와 원하시는 시공 지역을 말씀해 주세요.";
  }
  if (serviceType === "family_mobility") return "탑승자와 출발지, 도착지를 말씀해 주세요.";
  if (serviceType === "taxi") return "출발지와 목적지를 말씀해 주세요.";
  if (serviceType === "delivery") return "받는 분과 배송지를 말씀해 주세요.";
  if (serviceType === "service_improvement_command") return "이 개선 요청을 서비스 시나리오에 반영하면 될까요?";
  return "원하시는 서비스를 짧게 말씀해 주세요.";
}

function buildSummary(serviceType: ServiceType, quantity?: number, negotiation?: boolean, alternative?: boolean, text = "") {
  if (negotiation) return "가격 또는 수수료 조정 요청입니다.";
  if (alternative) return "대체 제휴사 확인 요청입니다.";
  return `${buildInterpretedText(serviceType, quantity, text)}입니다.`;
}

function buildExecutionPlan(serviceType: ServiceType, missing: string[], text = "") {
  if (serviceType === "product_purchase") return ["상품명과 수량 확인", "가격/리뷰 기준 비교", "협력사 구매 및 배송 확인"];
  if (serviceType === "hospital_reservation") return ["기존 이용 병원 확인", "희망 일시 확인", "예약 및 알림 설정", "필요 시 택시 연계"];
  if (serviceType === "car_maintenance") return ["차량 증상 확인", "가격/평판 기준 정비소 추천", "예약 가능 시간 확인", "필요 시 탁송 기사 호출"];
  if (serviceType === "car_inspection") return ["희망 검사 일시 확인", "연계 검사소 예약 확인", "필요 시 탁송 연계"];
  if (serviceType === "car_accessory_installation") {
    const mode = accessoryMode(text);
    if (mode === "package") return ["아이나비 블랙박스 구성 확인", "칼트윈 틴팅 시공 범위 확인", "시공 지역과 희망 날짜 확인", "필요 시 탁송 연결"];
    if (mode === "tinting") return ["칼트윈 틴팅 필름 시공 범위 확인", "차량 종류와 시공 지역 확인", "칼트윈 제휴 시공점 예약 확인", "필요 시 탁송 연결"];
    return ["아이나비 블랙박스 전후방 여부 확인", "차량 종류와 시공 지역 확인", "아이나비 장착 제휴점 예약 확인", "필요 시 탁송 연결"];
  }
  if (serviceType === "family_mobility") return ["탑승자와 목적지 확인", "아이나비 M 택시 또는 기사 연계", "이동 상태 안내"];
  if (serviceType === "taxi") return ["출발지와 목적지 확인", "호출 시간 확인", "아이나비 M 택시 호출 연계"];
  if (serviceType === "service_improvement_command") return ["개선 요청 내용 확인", "고객 확인 후 시나리오 규칙에 반영", "다음 서비스부터 적용"];
  if (missing.length > 0) return [`추가 확인 필요: ${missing.join(", ")}`, "정보가 확인되면 제휴사 실행안을 확정합니다."];
  return ["고객 말씀 확인", "제휴사 처리 가능 여부 확인", "고객 승인 후 실행"];
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

function buildDefaultProviders(serviceType: ServiceType, text = "") {
  if (serviceType === "taxi") return ["아이나비 M 택시"];
  if (serviceType === "hospital_reservation") return ["서울아산병원", "서울대병원", "신촌 세브란스 병원", "샤인빔 클리닉 강남점", "아름다운 피부나라 의원", "자생한방병원"];
  if (serviceType === "car_maintenance" || serviceType === "car_inspection") return ["마스터 자동차", "공임나라", "블루핸즈"];
  if (serviceType === "car_accessory_installation") {
    const mode = accessoryMode(text);
    if (mode === "tinting") return ["칼트윈 제휴 시공점"];
    if (mode === "package") return ["아이나비 장착 제휴점", "칼트윈 제휴 시공점"];
    return ["아이나비 장착 제휴점"];
  }
  if (serviceType === "product_purchase" || serviceType === "delivery") return ["Babelfish 제휴 마켓"];
  if (serviceType === "family_mobility") return ["아이나비 M 택시", "제휴 기사 네트워크"];
  return [];
}

function buildProviderConnectionLabel(serviceType: ServiceType, preferredProvider?: string, isPartner = false, text = "") {
  if (preferredProvider) return isPartner ? `${preferredProvider} 제휴 연결 가능 여부 확인 대기` : `${preferredProvider} 고객 지정 업체 연결 가능 여부 확인 대기`;
  if (serviceType === "taxi") return "아이나비 M 택시 연결 정보 확인 중";
  if (serviceType === "hospital_reservation") return "제휴 병원 예약 가능 여부 확인 대기";
  if (serviceType === "car_maintenance") return "제휴 자동차 서비스 업체 정비 가능 여부 확인 대기";
  if (serviceType === "car_inspection") return "제휴 검사소 예약 가능 여부 확인 대기";
  if (serviceType === "car_accessory_installation") {
    const mode = accessoryMode(text);
    if (mode === "tinting") return "칼트윈 제휴 시공점 예약 가능 여부 확인 대기";
    if (mode === "package") return "아이나비 장착 제휴점과 칼트윈 제휴 시공점 확인 대기";
    return "아이나비 장착 제휴점 예약 가능 여부 확인 대기";
  }
  if (serviceType === "product_purchase") return "제휴 협력사 가격/리뷰 비교 대기";
  return "요청 확인 후 연결 가능 여부 확인";
}

function buildRecommendationBasis(serviceType: ServiceType, text = "") {
  if (serviceType === "taxi" || serviceType === "family_mobility") return "출발지, 도착지, 호출 시간을 기준으로 연결합니다.";
  if (serviceType === "hospital_reservation") return "종합병원은 서울아산병원, 개인 병원은 샤인빔 클리닉 강남점과 아름다운 피부나라 의원을 우선 추천합니다.";
  if (serviceType === "car_maintenance" || serviceType === "car_inspection") return "인근 제휴사 중 마스터 자동차를 우선 추천하고, 일정과 탁송 가능 여부를 확인합니다.";
  if (serviceType === "car_accessory_installation") {
    const mode = accessoryMode(text);
    if (mode === "tinting") return "틴팅은 칼트윈 틴팅 필름과 칼트윈 제휴 시공점을 기준으로 확인합니다.";
    if (mode === "package") return "아이나비 블랙박스와 칼트윈 틴팅 필름 패키지 시공을 기준으로 확인합니다.";
    return "블랙박스는 아이나비 블랙박스와 아이나비 장착 제휴점을 기준으로 확인합니다.";
  }
  if (serviceType === "product_purchase") return "가격, 리뷰, 배송 가능 여부를 기준으로 비교합니다.";
  if (serviceType === "service_improvement_command") return "확인 후 데모 시나리오 규칙에 반영합니다.";
  return "고객 요청 확인 후 추천 기준을 정합니다.";
}

export { mockPartners } from "./partners";
export type { ConciergeAnalysis, LanguageCode, OrderStatus, Partner, PlaceCandidate, ServiceSlots, ServiceType } from "./types";
