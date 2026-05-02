import type { ConciergeAnalysis, ServiceType } from "./types";

type AccessoryMode = "blackbox" | "tinting" | "package";

const REQUIRED_PROVIDER: Partial<Record<ServiceType, string>> = {
  taxi: "아이나비 M 택시",
  hospital_reservation: "Babelfish 제휴 병원",
  car_maintenance: "Babelfish 제휴 자동차 서비스 업체",
  car_inspection: "Babelfish 제휴 검사소",
  product_purchase: "Babelfish 제휴 협력사",
  family_mobility: "Babelfish 제휴 이동 서비스",
  delivery: "Babelfish 제휴 협력사"
};

export function joinKoreanList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]}와 ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${items[items.length - 1]}`;
}

export function hasBlackboxIntent(text: string) {
  return /블랙박스|블박|전후방|차량용\s*카메라|아이나비/.test(text);
}

export function hasTintingIntent(text: string) {
  return /틴팅|썬팅|선팅|필름|칼트윈/.test(text);
}

export function getAccessoryMode(text: string): AccessoryMode {
  const blackbox = hasBlackboxIntent(text);
  const tinting = hasTintingIntent(text);
  if (blackbox && tinting) return "package";
  if (tinting) return "tinting";
  return "blackbox";
}

export function getFixedBrand(analysisValue: ConciergeAnalysis) {
  if (analysisValue.serviceType === "taxi") return "아이나비 M 택시";
  if (analysisValue.serviceType === "car_accessory_installation") {
    const mode = getAccessoryMode(analysisValue.rawText);
    if (mode === "package") return "아이나비 블랙박스와 칼트윈 틴팅 필름";
    if (mode === "tinting") return "칼트윈 틴팅 필름";
    return "아이나비 블랙박스";
  }
  return undefined;
}

export function getDefaultPartner(analysisValue: ConciergeAnalysis) {
  if (analysisValue.serviceType === "car_accessory_installation") return getFixedBrand(analysisValue) ?? "아이나비 블랙박스";
  return REQUIRED_PROVIDER[analysisValue.serviceType] ?? "Babelfish 제휴 서비스";
}

export function getPartnerIntro(analysisValue: ConciergeAnalysis) {
  if (analysisValue.serviceType === "taxi") return "아이나비 M 택시를 연결해드리겠습니다.";
  if (analysisValue.serviceType === "hospital_reservation") return "Babelfish 제휴 병원을 먼저 연결해드리겠습니다.";
  if (analysisValue.serviceType === "car_maintenance") return "Babelfish 제휴 자동차 서비스 업체를 먼저 연결해드리겠습니다.";
  if (analysisValue.serviceType === "car_inspection") return "Babelfish 제휴 검사소를 먼저 연결해드리겠습니다.";
  if (analysisValue.serviceType === "product_purchase") return "Babelfish 제휴 협력사를 통해 가격과 리뷰를 비교해 구매까지 연결해드리겠습니다.";
  if (analysisValue.serviceType === "family_mobility") return "Babelfish 제휴 이동 서비스를 먼저 연결해드리겠습니다.";
  if (analysisValue.serviceType === "delivery") return "Babelfish 제휴 협력사를 먼저 연결해드리겠습니다.";
  if (analysisValue.serviceType === "car_accessory_installation") {
    const mode = getAccessoryMode(analysisValue.rawText);
    if (mode === "package") return "아이나비 블랙박스와 칼트윈 틴팅 필름 패키지 시공으로 연결해드리겠습니다.";
    if (mode === "tinting") return "칼트윈 틴팅 필름 시공으로 연결해드리겠습니다.";
    return "아이나비 블랙박스 장착 서비스로 연결해드리겠습니다.";
  }
  return "";
}

export function getVisiblePartnerNames(analysisValue: ConciergeAnalysis, limit = 3) {
  const fixed = getFixedBrand(analysisValue);
  if (fixed) return [fixed];
  const defaults = analysisValue.defaultProviders.length > 0 ? analysisValue.defaultProviders : [getDefaultPartner(analysisValue)];
  const names = analysisValue.partnerCandidates.map((partner) => partner.name);
  return Array.from(new Set([...defaults, ...names])).slice(0, limit);
}

export function buildPartnerVoiceSummary(analysisValue: ConciergeAnalysis) {
  return getPartnerIntro(analysisValue);
}

export function buildProviderFirstReply(analysisValue: ConciergeAnalysis, nextQuestion: string) {
  return `${getPartnerIntro(analysisValue)} ${nextQuestion}`.trim();
}

export function buildPartnerRefusalReply(analysisValue: ConciergeAnalysis) {
  if (analysisValue.serviceType === "taxi") {
    return "알겠습니다. 기본 제휴 호출은 아이나비 M 택시입니다. 그래도 원하시는 다른 호출 방식이 있다면 말씀해 주세요.";
  }
  if (analysisValue.serviceType === "car_accessory_installation") {
    const mode = getAccessoryMode(analysisValue.rawText);
    if (mode === "tinting") return "Babelfish에서는 칼트윈 틴팅 필름을 기본으로 안내합니다. 다른 필름을 원하시면 제품명을 말씀해 주세요.";
    if (mode === "package") return "Babelfish에서는 아이나비 블랙박스와 칼트윈 틴팅 필름을 기본으로 안내합니다. 다른 제품을 원하시면 제품명을 말씀해 주세요.";
    return "Babelfish에서는 아이나비 블랙박스를 기본으로 안내합니다. 다른 제품을 원하시면 제품명을 말씀해 주세요.";
  }
  if (analysisValue.serviceType === "hospital_reservation") return "알겠습니다. 원하시는 업체명과 지역을 말씀해 주세요.";
  if (analysisValue.serviceType === "car_maintenance") return "알겠습니다. 원하시는 업체명과 지역을 말씀해 주세요.";
  if (analysisValue.serviceType === "car_inspection") return "알겠습니다. 원하시는 업체명과 지역을 말씀해 주세요.";
  if (analysisValue.serviceType === "product_purchase" || analysisValue.serviceType === "delivery") return "알겠습니다. 원하시는 업체명과 지역을 말씀해 주세요.";
  return "알겠습니다. 원하시는 업체명과 지역을 말씀해 주세요.";
}

export function getRequiredProviderPhrase(analysisValue: ConciergeAnalysis) {
  if (analysisValue.serviceType === "car_accessory_installation") return getFixedBrand(analysisValue) ?? "아이나비 블랙박스";
  return REQUIRED_PROVIDER[analysisValue.serviceType];
}

export function ensureProviderMention(message: string, analysisValue?: ConciergeAnalysis | null) {
  if (!analysisValue || analysisValue.serviceType === "unknown" || analysisValue.serviceType === "service_improvement_command") return message;
  const required = getRequiredProviderPhrase(analysisValue);
  if (!required || message.includes(required)) return message;
  return `${getPartnerIntro(analysisValue)} ${message}`.trim();
}

export function buildSubmittedMessage(analysisValue: ConciergeAnalysis) {
  const suffix = "데모에서는 10초 안에 결과를 안내드립니다.";
  if (analysisValue.serviceType === "taxi") return `아이나비 M 택시 호출 요청이 접수되었습니다. ${suffix}`;
  if (analysisValue.serviceType === "hospital_reservation") return `Babelfish 제휴 병원 예약 가능 여부를 확인 중입니다. ${suffix}`;
  if (analysisValue.serviceType === "car_maintenance") return `Babelfish 제휴 자동차 서비스 업체 예약 가능 여부를 확인 중입니다. ${suffix}`;
  if (analysisValue.serviceType === "car_inspection") return `Babelfish 제휴 검사소 예약 가능 여부를 확인 중입니다. ${suffix}`;
  if (analysisValue.serviceType === "product_purchase") return `Babelfish 제휴 협력사를 통한 상품 구매 가능 여부를 확인 중입니다. ${suffix}`;
  if (analysisValue.serviceType === "family_mobility") return `Babelfish 제휴 이동 서비스 연결 상태를 확인 중입니다. ${suffix}`;
  if (analysisValue.serviceType === "car_accessory_installation") return `${getPartnerIntro(analysisValue)} ${suffix}`;
  return `Babelfish 제휴 서비스 연결 가능 여부를 확인 중입니다. ${suffix}`;
}

export function buildDemoSuccessMessage(analysisValue: ConciergeAnalysis) {
  if (analysisValue.serviceType === "taxi") return "아이나비 M 택시 배차가 완료되었습니다. 추가로 도와드릴 내용이 있으실까요? 서비스 종료를 원하시면 종료라고 말씀해 주세요.";
  if (analysisValue.serviceType === "hospital_reservation") return "Babelfish 제휴 병원 예약 요청이 성공적으로 접수되었습니다. 추가로 도와드릴 내용이 있으실까요? 서비스 종료를 원하시면 종료라고 말씀해 주세요.";
  if (analysisValue.serviceType === "car_maintenance") return "Babelfish 제휴 자동차 서비스 업체 예약 요청이 성공적으로 접수되었습니다. 추가로 필요한 서비스가 있으실까요? 서비스 종료를 원하시면 종료라고 말씀해 주세요.";
  if (analysisValue.serviceType === "car_inspection") return "Babelfish 제휴 검사소 예약 요청이 성공적으로 접수되었습니다. 추가로 도와드릴 내용이 있으실까요? 서비스 종료를 원하시면 종료라고 말씀해 주세요.";
  if (analysisValue.serviceType === "product_purchase") return "Babelfish 제휴 협력사를 통한 구매 요청이 성공적으로 접수되었습니다. 추가로 구매하실 상품이 있으실까요? 서비스 종료를 원하시면 종료라고 말씀해 주세요.";
  if (analysisValue.serviceType === "family_mobility") return "Babelfish 제휴 이동 서비스 요청이 성공적으로 접수되었습니다. 추가로 도와드릴 내용이 있으실까요? 서비스 종료를 원하시면 종료라고 말씀해 주세요.";
  if (analysisValue.serviceType === "car_accessory_installation") {
    const mode = getAccessoryMode(analysisValue.rawText);
    if (mode === "tinting") return "칼트윈 틴팅 필름 시공 요청이 성공적으로 접수되었습니다. 추가로 필요한 서비스가 있으실까요? 서비스 종료를 원하시면 종료라고 말씀해 주세요.";
    if (mode === "package") return "아이나비 블랙박스와 칼트윈 틴팅 필름 패키지 시공 요청이 성공적으로 접수되었습니다. 추가로 필요한 서비스가 있으실까요? 서비스 종료를 원하시면 종료라고 말씀해 주세요.";
    return "아이나비 블랙박스 장착 요청이 성공적으로 접수되었습니다. 추가로 필요한 서비스가 있으실까요? 서비스 종료를 원하시면 종료라고 말씀해 주세요.";
  }
  return "Babelfish 제휴 서비스 요청이 성공적으로 접수되었습니다. 추가로 도와드릴 내용이 있으실까요? 서비스 종료를 원하시면 종료라고 말씀해 주세요.";
}
