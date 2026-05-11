import type { ConciergeAnalysis } from "./types";

export const DEMO_SUCCESS_DELAY_MS = 10000;

export const standbyMessage = "서비스가 종료되었습니다. 다시 이용하시려면 서비스 시작 버튼을 눌러 주세요.";
export const voiceEndMessage = "서비스를 종료하겠습니다. 다시 이용하시려면 서비스 시작 버튼을 눌러 주세요.";

export function isEndOfServiceIntent(text: string) {
  return /종료|끝|그만|없어|없습니다|괜찮아|괜찮습니다/.test(text);
}

export function buildContextFallback(active: ConciergeAnalysis) {
  if (active.serviceType === "hospital_reservation") return "Babelfish 제휴 병원을 기준으로 이어가겠습니다. 진료과와 지역, 희망 일시를 말씀해 주세요.";
  if (active.serviceType === "taxi") return "아이나비 M 택시 연결을 이어가겠습니다. 출발지와 도착지를 다시 확인해 주세요.";
  if (active.serviceType === "car_inspection") return "Babelfish 제휴 검사소 예약을 이어가겠습니다. 차량 정보와 검사 지역, 희망 일시를 말씀해 주세요.";
  if (active.serviceType === "car_maintenance") return "Babelfish 제휴 자동차 서비스 업체 예약을 이어가겠습니다. 차량 증상과 지역, 희망 일시를 말씀해 주세요.";
  if (active.serviceType === "car_accessory_installation") return "아이나비 블랙박스 또는 칼트윈 틴팅 필름 시공을 이어가겠습니다. 차량 종류와 시공 지역, 희망 일시를 말씀해 주세요.";
  if (active.serviceType === "product_purchase") return "Babelfish 제휴 협력사를 통한 구매를 이어가겠습니다. 상품명과 수량을 말씀해 주세요.";
  if (active.serviceType === "family_mobility") return "Babelfish 제휴 이동 서비스를 이어가겠습니다. 출발지와 도착지를 말씀해 주세요.";
  return "원하시는 서비스를 다시 말씀해 주세요. 택시, 병원 예약, 정비, 검사, 블랙박스, 틴팅, 상품 구매를 도와드릴 수 있습니다.";
}

export function checkingHint() {
  return "데모에서는 10초 안에 결과를 안내드립니다.";
}
