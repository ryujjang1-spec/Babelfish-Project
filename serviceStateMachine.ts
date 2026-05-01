import type { ConciergeAnalysis } from "./types";

export const DEMO_SUCCESS_DELAY_MS = 10000;

export const standbyMessage = "서비스가 종료되었습니다. 필요하시면 서비스 시작 버튼을 눌러 다시 Babelfish를 호출해 주세요.";
export const voiceEndMessage = "서비스를 종료하겠습니다. 다시 이용하시려면 서비스 시작 버튼을 눌러 주세요.";

export function isEndOfServiceIntent(text: string) {
  return /종료|끝|그만|없어|괜찮아|됐어|없습니다|나중에/.test(text);
}

export function buildContextFallback(active: ConciergeAnalysis) {
  if (active.serviceType === "hospital_reservation") return "Babelfish 제휴 병원 기준으로 다시 확인하겠습니다. 원하시는 지역이나 날짜를 말씀해 주세요.";
  if (active.serviceType === "taxi") return "아이나비 M 택시 연결을 이어가겠습니다. 출발지와 도착지를 다시 확인해 주세요.";
  if (active.serviceType === "car_inspection") return "Babelfish 제휴 검사소 예약을 이어가겠습니다. 원하시는 날짜와 지역을 말씀해 주세요.";
  if (active.serviceType === "car_maintenance") return "Babelfish 제휴 자동차 서비스 업체 예약을 이어가겠습니다. 차량 증상과 지역을 말씀해 주세요.";
  if (active.serviceType === "car_accessory_installation") return "아이나비 장착 제휴점 또는 칼트윈 제휴 시공점 연결을 이어가겠습니다. 차량 종류와 시공 지역을 말씀해 주세요.";
  if (active.serviceType === "product_purchase") return "Babelfish 제휴 협력사 구매를 이어가겠습니다. 상품명과 수량을 말씀해 주세요.";
  if (active.serviceType === "family_mobility") return "아이나비 M 택시 또는 Babelfish 제휴 이동 서비스를 이어가겠습니다. 출발지와 도착지를 말씀해 주세요.";
  return "원하시는 서비스를 다시 말씀해 주세요. 택시, 병원 예약, 정비, 검사, 구매를 도와드릴 수 있습니다.";
}

export function checkingHint() {
  return "예약 가능 여부를 확인 중입니다. 약 10초 내 결과를 안내드립니다.";
}
