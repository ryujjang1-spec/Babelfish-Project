import dotenv from "dotenv";
import express from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRequest } from "../shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = process.env.DOTENV_CONFIG_PATH ?? resolve(__dirname, "../.env");

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const app = express();

const port = Number(process.env.PORT ?? 8787);
const realtimeModel = process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime";
const realtimeVoice = "coral";
const realtimeVoiceSpeed = 1.0;

const FIRST_MESSAGE = "안녕하세요? 고객님의 비서 바벨피시입니다. 원하시는 서비스를 말씀해 주세요.";

const instructions = `당신은 바벨피시 온디멘드 컨시어지의 젊고 밝은 여성 AI 컨시어지입니다.
바벨피시는 고객 요청을 이해하고, 기본 서비스 인프라와 제휴 네트워크를 연결해 실제 실행까지 돕습니다.
고객 요청을 짧고 명확하게 확인하고, 바벨피시 제휴사와 협력사를 통해 실제 실행 가능한 방식으로 연결합니다.
고객 요청을 이해하면 반드시 제휴업체 또는 고정 브랜드를 먼저 안내한 뒤 다음 질문을 합니다.
택시는 항상 아이나비 M 택시를 먼저 안내합니다.
병원은 항상 바벨피시 제휴 병원을 먼저 안내합니다.
자동차 정비, 수리, AS는 항상 바벨피시 제휴 자동차 서비스 업체를 먼저 안내합니다.
자동차 검사는 항상 바벨피시 제휴 검사소를 먼저 안내합니다.
블랙박스는 항상 아이나비 블랙박스를 먼저 안내합니다.
틴팅과 썬팅은 항상 칼트윈 틴팅 필름을 먼저 안내합니다.
상품 구매는 항상 바벨피시 제휴 협력사를 먼저 안내합니다.
고객이 싫어, 아니, 다른 곳, 내가 원하는 곳, 제휴 말고처럼 명시적으로 거절한 경우에만 고객 지정 업체나 제품을 묻습니다.
고객이 물건 구매를 요청하면 가격과 리뷰를 비교해 추천하고 협력사를 통해 구매와 배송을 안내합니다.
병원 예약은 고객이 다니는 병원을 먼저 묻지 말고 바벨피시 제휴 병원을 먼저 연결하겠다고 안내합니다.
병원 예시는 서울대병원, 서울아산병원, 신촌 세브란스 병원, 샤인빔 클리닉 강남점, 아름다운 피부나라 의원, 자생한방병원입니다.
예약 확정 시 하루 전과 2시간 전 알림을 안내합니다.
자동차 정비는 바벨피시 제휴 자동차 서비스 업체를 먼저 연결하고, 필요하면 탁송 기사 호출까지 연결합니다.
자동차 검사는 원하는 검사 일시에 맞춰 연계 검사소 예약과 탁송 여부를 확인합니다.
자동차 검사와 정비 예시는 마스터 자동차, 공임나라, 블루핸즈입니다.
부모님이나 자녀 이동이 필요하면 택시 또는 기사 연결을 지원합니다.
택시 호출은 아이나비 M 택시로 처리합니다.
고객 말씀은 한국어, 영어, 일본어만 허용하고, AI 답변은 반드시 한국어로만 합니다.
첫 응답은 정확히 다음 문장만 말합니다: ${FIRST_MESSAGE}
첫 응답 이후에는 고객이 실제로 요청을 말할 때만 응답하고, 고객이 말하지 않으면 추가로 말하지 않습니다.
답변은 항상 짧고 친절하게 하며 보통 1~2문장으로 말합니다.
음성은 항상 coral 음성으로 고정하고, 밝고 차분한 젊은 여성 상담원 톤과 일정한 속도를 유지합니다.
매 응답의 말투, 높낮이, 속도는 현재 세션에서 송출되는 톤과 동일하게 유지합니다.
고객 말씀이 끝난 뒤 응답합니다.
고객 요청은 먼저 짧게 확인하고, 중요한 요청은 실행 전에 이해한 내용이 맞는지 되묻습니다.
고객 요청 후에는 반드시 "제가 이해한 내용은 ...입니다. 맞으실까요?" 형식으로 리마인드하고 검증합니다.
소음, 짧은 외국어 조각, AI 음성 에코처럼 고객 말씀이 불확실한 입력에는 실행 안내를 하지 말고 다시 말씀해 달라고 안내합니다.
정보가 부족하면 한 번에 하나씩 질문합니다.
서비스 실행 전에는 고객 확인을 받습니다.`;

/**
 * Manual CORS middleware.
 * Vercel frontend must be able to call Render backend from browser.
 * This must be placed before express.json() and before all routes.
 */
app.use((req, res, next) => {
  const origin = req.headers.origin;

  const allowedOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://babelfish-project.vercel.app",
    "https://babelfish-api.onrender.com"
  ];

  const isAllowedOrigin =
    !origin ||
    allowedOrigins.includes(origin) ||
    origin.endsWith(".vercel.app");

  if (origin && isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Babelfish_ondemand_realtime_concierge",
    port,
    realtimeModel,
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY)
  });
});

async function createRealtimeSession(_req: express.Request, res: express.Response) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    res.status(500).json({
      error: "SERVER_CONFIG_ERROR",
      message: "서버 연결 실패 / API Key 확인 필요: OPENAI_API_KEY가 서버 환경변수에 설정되어 있지 않습니다."
    });
    return;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: realtimeModel,
          instructions,
          audio: {
            output: {
              voice: realtimeVoice,
              speed: realtimeVoiceSpeed
            },
            input: {
              noise_reduction: {
                type: "near_field"
              },
              transcription: {
                model: "gpt-4o-transcribe",
                language: "ko",
                prompt:
                  "한국어 온디멘드 컨시어지 대화입니다. 택시, 병원 예약, 자동차 정비, 자동차 검사, 블랙박스, 틴팅, 상품 구매 관련 고객 말씀을 정확히 받아 적어 주세요. 소음이나 바벨피시 음성 에코는 고객 발언으로 확정하지 마세요."
              },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "medium",
                create_response: false,
                interrupt_response: false
              }
            }
          }
        }
      })
    });

    if (!response.ok) {
      const detail = await response.text();

      res.status(response.status).json({
        error: "REALTIME_SESSION_ERROR",
        message: "서버 연결 실패 / API Key 확인 필요: Realtime client secret 발급에 실패했습니다.",
        detail
      });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";

    console.error("Realtime session error", error);

    res.status(502).json({
      error: "OPENAI_NETWORK_ERROR",
      message: "서버 연결 실패 / API Key 확인 필요: OpenAI Realtime API에 연결하지 못했습니다.",
      detail
    });
  }
}

function analyze(req: express.Request, res: express.Response) {
  const transcript = String(req.body?.transcript ?? "");
  res.json(analyzeRequest(transcript));
}

function createMockOrder(req: express.Request, res: express.Response) {
  const analysis = analyzeRequest(String(req.body?.transcript ?? ""));

  if (analysis.escalationRequired) {
    res.status(409).json({
      status: "operator_transfer",
      analysis,
      message: "운영자 확인이 필요한 요청입니다."
    });
    return;
  }

  res.json({
    status: "approved",
    orderId: `MOCK-${Date.now()}`,
    partner: analysis.partnerCandidates[0] ?? null,
    message: analysis.serviceType === "taxi" ? "mock 배차가 완료되었습니다." : "mock 발주가 완료되었습니다.",
    analysis
  });
}

app.post("/realtime/session", createRealtimeSession);
app.post("/analyze", analyze);
app.post("/orders", createMockOrder);

// Backward-compatible aliases for older local builds.
app.post("/api/realtime/session", createRealtimeSession);
app.post("/api/analyze", analyze);
app.post("/api/orders/mock", createMockOrder);

app.listen(port, () => {
  console.log(`Concierge API server listening on http://localhost:${port}`);
});
