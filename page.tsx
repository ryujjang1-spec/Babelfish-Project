"use client";

import { analyzeRequest, hasRequestIntent, isIgnorableUtterance, type ConciergeAnalysis, type OrderStatus } from "../shared";
import { Check, CircleStop, Headphones, Mic, Phone, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const FIRST_MESSAGE = "안녕하세요? 고객님, 온디멘드 서비스에 오신 것을 환영합니다. 고객님이 필요하신 심부름을 잘 이행하겠습니다. 원하시는 내용을 말씀해 주세요. 이동이 필요하시면 ‘택시 불러줘’라고 말씀해 주시면 됩니다. 물품을 사고 싶으시면 제휴된 마켓에서 가격과 배송 조건을 비교하여 가장 합리적인 상품으로 배달까지 도와드리겠습니다.";

type AppStatus = "AI READY" | "CONNECTING" | "LISTENING" | "ANALYZING" | "BUILDING PLAN" | "WAITING APPROVAL" | "SERVER ERROR";

type LogEntry = {
  id: string;
  role: "system" | "user" | "assistant" | "event";
  text: string;
};

const roleLabels: Record<LogEntry["role"], string> = {
  user: "고객",
  assistant: "AI 비서",
  system: "시스템",
  event: "이벤트"
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const greetingSentRef = useRef(false);

  const sortedLogs = useMemo(() => logs.slice(-14), [logs]);

  function appendLog(role: LogEntry["role"], text: string) {
    if (!text.trim()) return;
    setLogs((current) => [...current, { id: makeId(), role, text }]);
  }

  function updateAnalysis(nextTranscript: string) {
    const next = analyzeRequest(nextTranscript);
    setAnalysis(next);
    setStatus(next.escalationRequired ? "operator_transfer" : "draft");
    setAppStatus(next.escalationRequired ? "WAITING APPROVAL" : next.requiredInfo.length > 0 ? "ANALYZING" : "BUILDING PLAN");
  }

  async function startCall() {
    setError(null);
    setConnection("마이크 권한 요청 중");
    setAppStatus("CONNECTING");
    setPhase("call");
    setMockOrderId(null);
    setLogs([]);
    setTranscript("");
    transcriptRef.current = "";
    greetingSentRef.current = false;
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
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = mediaStream;
      mediaStream.getAudioTracks().forEach((track) => pc.addTrack(track, mediaStream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("open", () => {
        appendLog("event", "Realtime 데이터 채널이 열렸습니다.");
        if (greetingSentRef.current) return;
        greetingSentRef.current = true;
        dc.send(JSON.stringify({
          type: "response.create",
          response: {
            instructions: `첫 멘트로 다음 문장을 그대로 말한 뒤 고객 발화를 기다리세요. ${FIRST_MESSAGE}`
          }
        }));
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
      setAppStatus("LISTENING");
    } catch (err) {
      const message = formatClientError(err);
      setAppStatus("SERVER ERROR");
      setError(message);
      appendLog("system", message);
      stopCall(false);
    }
  }

  function handleRealtimeEvent(raw: string) {
    const event = JSON.parse(raw);
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const text = String(event.transcript ?? "");
      appendLog("user", text);
      if (isIgnorableUtterance(text)) {
        appendLog("system", "짧은 확인 발화로 판단해 요청 분석을 갱신하지 않았습니다.");
        setAppStatus("LISTENING");
        return;
      }

      const shouldAnalyze = hasRequestIntent(text);
      const nextTranscript = `${transcriptRef.current}\n${text}`.trim();
      transcriptRef.current = nextTranscript;
      setTranscript(nextTranscript);
      if (shouldAnalyze) {
        updateAnalysis(nextTranscript);
      } else {
        appendLog("system", "요청 의도가 모호해 AI 비서가 추가 질문을 하도록 처리했습니다.");
        setAppStatus("ANALYZING");
      }
      requestAssistantResponse(shouldAnalyze
        ? "고객의 실제 요청을 확인했습니다. 이전 맥락을 유지하고 한국어로 짧게 응답한 뒤 필요한 정보가 있으면 자연스럽게 질문하세요."
        : "고객 요청이 모호합니다. 한국어로 '어떤 심부름이 필요하신지 조금만 더 자세히 말씀해 주세요.'처럼 부드럽게 추가 질문만 하세요.");
    }
    if (event.type === "response.audio_transcript.delta" || event.type === "response.output_text.delta") {
      const nextDraft = `${assistantDraftRef.current}${event.delta ?? ""}`;
      assistantDraftRef.current = nextDraft;
      setAssistantDraft(nextDraft);
    }
    if (event.type === "response.audio_transcript.done" || event.type === "response.output_text.done") {
      const text = String(event.transcript ?? event.text ?? assistantDraftRef.current);
      appendLog("assistant", text);
      assistantDraftRef.current = "";
      setAssistantDraft("");
    }
    if (event.type === "error") appendLog("event", event.error?.message ?? "Realtime error");
  }

  function requestAssistantResponse(instructions?: string) {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({
      type: "response.create",
      response: instructions ? { instructions } : {}
    }));
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
    requestAssistantResponse();
  }

  async function approveOrder() {
    setAppStatus("WAITING APPROVAL");
    try {
      const response = await fetch(`${API_BASE}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript })
      });
      if (!response.ok) throw new Error(await formatApiError(response));
      const data = await response.json();
      setStatus(data.status);
      if (data.orderId) setMockOrderId(data.orderId);
      appendLog("system", data.message ?? "mock 처리 완료");
      sendTextToRealtime("고객이 실행을 승인했습니다. mock 발주 완료를 한국어로 짧게 안내해 주세요.");
    } catch (err) {
      const fallbackOrderId = `LOCAL-${Date.now()}`;
      setStatus("approved");
      setMockOrderId(fallbackOrderId);
      appendLog("system", `${formatClientError(err)} fallback mock orderId ${fallbackOrderId}를 생성했습니다.`);
    }
  }

  function requestChange() {
    setStatus("change_requested");
    setAppStatus("ANALYZING");
    appendLog("system", "변경 요청 모드입니다. 가격, 수수료, 배송, 일정 변경을 말씀해 주세요.");
    sendTextToRealtime("고객이 조건 변경을 원합니다. 이전 맥락을 유지하고 가격, 수수료, 배송, 일정 변경 가능성을 확인해 주세요.");
  }

  function transferOperator() {
    setStatus("operator_transfer");
    setAppStatus("WAITING APPROVAL");
    appendLog("system", "운영자 이관으로 처리했습니다.");
    sendTextToRealtime("운영자에게 이관하겠다고 한국어로 안내해 주세요.");
  }

  function stopCall(showSummary = true) {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    pcRef.current = null;
    dcRef.current = null;
    streamRef.current = null;
    setConnection("종료됨");
    setAppStatus("AI READY");
    if (showSummary) setPhase("summary");
  }

  if (phase === "start") {
    return (
      <main className="start-screen">
        <section className="start-panel">
          <p className="eyebrow">Realtime Concierge Demo</p>
          <h1>온디멘드 컨시어지</h1>
          <p className="lead">고객 요청을 듣고, 수행 가능한 제휴업체 후보와 실행안을 실시간으로 정리합니다.</p>
          <button className="primary-call" onClick={startCall}>
            <Phone size={22} /> AI와 통화 시작
          </button>
          {error && <p className="error-text">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <p className="eyebrow">{phase === "summary" ? "Call Summary" : "Live Call"}</p>
          <h1>온디멘드 컨시어지 실시간 음성 데모</h1>
        </div>
        <div className="status-cluster">
          <div className={`status-badge ${appStatus.toLowerCase().replaceAll(" ", "-")}`}>{appStatus}</div>
          <div className="call-status"><Mic size={18} /> {connection}</div>
        </div>
      </header>

      <section className="call-layout">
        <div className="conversation-panel">
          <div className="panel-heading">
            <h2>대화 로그</h2>
            {phase === "call" && <button className="icon-button danger" onClick={() => stopCall(true)} title="통화 종료"><CircleStop size={20} /></button>}
          </div>
          <div className="logs">
            {sortedLogs.map((log) => (
              <article key={log.id} className={`log ${log.role}`}>
                <span>{roleLabels[log.role]}</span>
                <p>{log.text}</p>
              </article>
            ))}
            {assistantDraft && <article className="log assistant"><span>AI 비서</span><p>{assistantDraft}</p></article>}
          </div>
          <div className="action-row">
            <button onClick={approveOrder} disabled={analysis.escalationRequired || !transcript.trim()}><Check size={18} /> 승인</button>
            <button onClick={requestChange}><RefreshCw size={18} /> 변경</button>
            <button onClick={transferOperator}><Headphones size={18} /> 상담원 연결</button>
          </div>
        </div>

        <div className="insight-grid">
          <InsightCard title="요청 분석" tone={analysis.escalationRequired ? "warn" : "ok"}>
            <p className="summary-text">{analysis.summary}</p>
            <dl>
              <div><dt>서비스 유형</dt><dd>{analysis.serviceType}</dd></div>
              <div><dt>언어</dt><dd>{analysis.detectedLanguage} {analysis.allowedLanguage ? "허용" : "제한"}</dd></div>
              <div><dt>신뢰도</dt><dd>{Math.round(analysis.confidence * 100)}%</dd></div>
              {analysis.quantity && <div><dt>수량</dt><dd>{analysis.quantity}</dd></div>}
            </dl>
            {analysis.negotiationIntent && <p className="pill">가격/수수료 협상 요청</p>}
            {analysis.alternativePartnerIntent && <p className="pill">대체 파트너 요청</p>}
            {analysis.escalationRequired && <p className="warning"><ShieldAlert size={16} /> {analysis.escalationReason}</p>}
          </InsightCard>

          <InsightCard title="제휴업체 매칭" tone="neutral">
            {analysis.partnerCandidates.length === 0 ? <p className="muted">매칭 후보가 없습니다.</p> : analysis.partnerCandidates.map((partner) => (
              <article className="partner" key={partner.id}>
                <strong>{partner.name}</strong>
                <span>{partner.rating}점 · {partner.deliveryMinutes}분 · {partner.baseFee.toLocaleString("ko-KR")}원</span>
                <small>{partner.capabilities.join(" · ")}</small>
              </article>
            ))}
          </InsightCard>

          <InsightCard title="실행안" tone="neutral">
            <ol className="plan-list">
              {analysis.executionPlan.map((item) => <li key={item}>{item}</li>)}
            </ol>
            <div className="order-state"><Send size={16} /> {mockOrderId ? `${mockOrderId} 완료` : status}</div>
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
