import type { ConciergeAnalysis } from "./types";

export function getVisiblePartnerNames(analysisValue: ConciergeAnalysis, limit = 3) {
  const names = analysisValue.partnerCandidates.map((partner) => partner.name);
  if (analysisValue.preferredProvider) {
    return [analysisValue.preferredProvider, ...names.filter((name) => name !== analysisValue.preferredProvider)].slice(0, limit);
  }
  return names.slice(0, limit);
}

export function joinKoreanList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]}와 ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${items[items.length - 1]}`;
}

function hasBlackboxIntent(text: string) {
  return /블랙박스|블박|전후방|차량용\s*카메라|아이나비/.test(text);
}

function hasTintingIntent(text: string) {
  return /틴팅|썬팅|선팅|칼트윈|필름/.test(text);
}

export function buildPartnerVoiceSummary(analysisValue: ConciergeAnalysis) {
  const names = getVisiblePartnerNames(analysisValue);
  const list = joinKoreanList(names);

  if (analysisValue.serviceType === "taxi") {
    return `${list || "아이나비 M 택시"}로 배차해드리겠습니다. 제휴 호출이라 배차 상태와 이동 안내를 함께 확인할 수 있습니다.`;
  }

  if (analysisValue.serviceType === "hospital_reservation") {
    if (analysisValue.preferredProvider) {
      return `${analysisValue.preferredProvider} 예약을 원하시는 것으로 이해했습니다. Babelfish 제휴 병원을 이용하시면 예약 알림과 아이나비 M 택시 연계까지 함께 도와드릴 수 있습니다.`;
    }
    return `Babelfish 제휴 병원으로 ${list || "서울아산병원"}을 우선 확인해드리겠습니다. 예약 가능 여부와 진료과 확인이 안정적이기 때문입니다.`;
  }

  if (analysisValue.serviceType === "car_maintenance") {
    if (analysisValue.preferredProvider) {
      return `${analysisValue.preferredProvider} 정비 예약을 원하시는 것으로 이해했습니다. Babelfish 제휴 자동차 서비스 업체 기준으로도 가격과 평판을 비교할 수 있습니다.`;
    }
    return `Babelfish 제휴 자동차 서비스 업체로 ${list || "마스터 자동차"}를 우선 확인해드리겠습니다. 가격과 평판, 예약 가능 시간, 필요 시 탁송 연결까지 확인할 수 있습니다.`;
  }

  if (analysisValue.serviceType === "car_inspection") {
    if (analysisValue.preferredProvider) {
      return `${analysisValue.preferredProvider} 검사 예약을 원하시는 것으로 이해했습니다. Babelfish 제휴 검사소 기준으로도 예약 가능 여부를 확인할 수 있습니다.`;
    }
    return `Babelfish 제휴 검사소로 ${list || "마스터 자동차"}를 우선 확인해드리겠습니다. 검사 예약과 탁송 가능 여부를 함께 확인할 수 있습니다.`;
  }

  if (analysisValue.serviceType === "car_accessory_installation") {
    const text = analysisValue.rawText;
    const blackbox = hasBlackboxIntent(text);
    const tinting = hasTintingIntent(text);
    if (blackbox && tinting) return "아이나비 블랙박스와 칼트윈 틴팅 필름 패키지 시공으로 연결해드리겠습니다.";
    if (tinting) return "칼트윈 틴팅 필름 시공으로 연결해드리겠습니다. 칼트윈 제휴 시공점에서 예약 가능 여부를 확인합니다.";
    return "아이나비 블랙박스 장착 서비스로 연결해드리겠습니다. 아이나비 장착 제휴점에서 시공 가능 여부를 확인합니다.";
  }

  if (analysisValue.serviceType === "product_purchase") {
    return `Babelfish 제휴 협력사${list ? `인 ${list}` : ""}를 통해 가격과 리뷰를 비교해 구매와 배송까지 연결해드리겠습니다.`;
  }

  if (analysisValue.serviceType === "family_mobility") {
    return "아이나비 M 택시 또는 Babelfish 제휴 이동 서비스를 연결해드리겠습니다.";
  }

  return "";
}

export function buildProviderFirstReply(analysisValue: ConciergeAnalysis, nextQuestion: string) {
  return `${buildPartnerVoiceSummary(analysisValue)} ${nextQuestion}`.trim();
}

export function ensureProviderMention(message: string, analysisValue?: ConciergeAnalysis | null) {
  if (!analysisValue || analysisValue.serviceType === "unknown" || analysisValue.serviceType === "service_improvement_command") return message;

  const visibleNames = getVisiblePartnerNames(analysisValue, 4);
  const hasVisibleName = visibleNames.some((name) => message.includes(name));
  const hasProviderPhrase =
    (analysisValue.serviceType === "taxi" && message.includes("아이나비 M 택시")) ||
    (analysisValue.serviceType === "hospital_reservation" && message.includes("Babelfish 제휴 병원")) ||
    (analysisValue.serviceType === "car_maintenance" && message.includes("Babelfish 제휴 자동차 서비스 업체")) ||
    (analysisValue.serviceType === "car_inspection" && message.includes("Babelfish 제휴 검사소")) ||
    (analysisValue.serviceType === "car_accessory_installation" &&
      (message.includes("아이나비 블랙박스") || message.includes("칼트윈 틴팅 필름") || message.includes("아이나비 장착 제휴점") || message.includes("칼트윈 제휴 시공점"))) ||
    (analysisValue.serviceType === "product_purchase" && message.includes("Babelfish 제휴 협력사")) ||
    (analysisValue.serviceType === "family_mobility" && (message.includes("아이나비 M 택시") || message.includes("Babelfish 제휴 이동 서비스")));

  if (hasVisibleName || hasProviderPhrase) return message;
  return `${buildPartnerVoiceSummary(analysisValue)} ${message}`.trim();
}

export function buildSubmittedMessage(analysisValue: ConciergeAnalysis) {
  if (analysisValue.serviceType === "taxi") return "아이나비 M 택시 호출 요청이 접수되었습니다. 10초 안에 배차 완료 여부를 안내드리겠습니다.";
  if (analysisValue.serviceType === "hospital_reservation") return "Babelfish 제휴 병원 예약 가능 여부를 확인 중입니다. 10초 안에 예약 결과를 안내드리겠습니다.";
  if (analysisValue.serviceType === "car_maintenance") return "Babelfish 제휴 자동차 서비스 업체의 정비 예약 가능 여부를 확인 중입니다. 10초 안에 결과를 안내드리겠습니다.";
  if (analysisValue.serviceType === "car_inspection") return "Babelfish 제휴 검사소 예약 가능 여부를 확인 중입니다. 10초 안에 결과를 안내드리겠습니다.";
  if (analysisValue.serviceType === "car_accessory_installation") return `${buildPartnerVoiceSummary(analysisValue)} 데모에서는 10초 안에 결과를 안내드리겠습니다.`;
  if (analysisValue.serviceType === "product_purchase") return "Babelfish 제휴 협력사를 통한 상품 구매 가능 여부를 확인 중입니다. 10초 안에 결과를 안내드리겠습니다.";
  if (analysisValue.serviceType === "family_mobility") return "아이나비 M 택시 또는 Babelfish 제휴 이동 서비스 연결 상태를 확인 중입니다. 10초 안에 결과를 안내드리겠습니다.";
  return "제휴사 연결 가능 여부를 확인 중입니다. 10초 안에 결과를 안내드리겠습니다.";
}

export function buildDemoSuccessMessage(analysisValue: ConciergeAnalysis) {
  const endPrompt = "추가로 도와드릴 내용이 있으실까요? 서비스 종료를 원하시면 종료라고 말씀해 주세요.";
  if (analysisValue.serviceType === "taxi") return `아이나비 M 택시 배차가 완료되었습니다. ${endPrompt}`;
  if (analysisValue.serviceType === "hospital_reservation") return `Babelfish 제휴 병원 예약 요청이 성공적으로 접수되었습니다. ${endPrompt}`;
  if (analysisValue.serviceType === "car_maintenance") return `Babelfish 제휴 자동차 서비스 업체 예약 요청이 성공적으로 접수되었습니다. ${endPrompt}`;
  if (analysisValue.serviceType === "car_inspection") return `Babelfish 제휴 검사소 예약 요청이 성공적으로 접수되었습니다. ${endPrompt}`;
  if (analysisValue.serviceType === "car_accessory_installation") {
    const text = analysisValue.rawText;
    const blackbox = hasBlackboxIntent(text);
    const tinting = hasTintingIntent(text);
    if (blackbox && tinting) return `아이나비 블랙박스와 칼트윈 틴팅 필름 패키지 시공 요청이 성공적으로 접수되었습니다. ${endPrompt}`;
    if (tinting) return `칼트윈 틴팅 필름 시공 요청이 성공적으로 접수되었습니다. ${endPrompt}`;
    return `아이나비 블랙박스 장착 요청이 성공적으로 접수되었습니다. ${endPrompt}`;
  }
  if (analysisValue.serviceType === "product_purchase") return `Babelfish 제휴 협력사를 통한 구매 요청이 성공적으로 접수되었습니다. ${endPrompt}`;
  if (analysisValue.serviceType === "family_mobility") return `Babelfish 제휴 이동 서비스 요청이 성공적으로 접수되었습니다. ${endPrompt}`;
  return `제휴사 연결 요청이 성공적으로 접수되었습니다. ${endPrompt}`;
}
