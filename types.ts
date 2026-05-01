export type LanguageCode = "ko" | "en" | "ja" | "unsupported";

export type ServiceType =
  | "taxi"
  | "product_purchase"
  | "hospital_reservation"
  | "car_maintenance"
  | "car_inspection"
  | "car_accessory_installation"
  | "family_mobility"
  | "delivery"
  | "service_improvement_command"
  | "operator_transfer"
  | "unknown";

export type Partner = {
  id: string;
  name: string;
  category: string;
  serviceTypes: ServiceType[];
  baseFee: number;
  deliveryMinutes: number;
  rating: number;
  location?: string;
  reservationRequired?: boolean;
  supportsPickup?: boolean;
  supportsTakSong?: boolean;
  notes?: string;
  recommendation: string;
  linkage: string[];
  capabilities: string[];
};

export type ConciergeAnalysis = {
  serviceType: ServiceType;
  rawText: string;
  interpretedText: string;
  allowedLanguage: boolean;
  detectedLanguage: LanguageCode;
  requiredInfo: string[];
  missingFields: string[];
  quantity?: number;
  negotiationIntent: boolean;
  alternativePartnerIntent: boolean;
  confidence: number;
  needsConfirmation: boolean;
  confirmationQuestion: string;
  nextQuestion: string;
  partnerIntro: string;
  escalationRequired: boolean;
  escalationReason?: string;
  summary: string;
  executionPlan: string[];
  partnerCandidates: Partner[];
  slots: ServiceSlots;
  preferredProvider?: string;
  preferredProviderIsPartner: boolean;
  defaultProviders: string[];
  providerConnectionLabel: string;
  recommendationBasis: string;
};

export type OrderStatus =
  | "idle"
  | "draft"
  | "waiting_confirmation"
  | "waiting_detail"
  | "ready_for_approval"
  | "approved"
  | "submitted"
  | "completed"
  | "standby"
  | "feedback_pending"
  | "change_requested"
  | "operator_transfer";

export type ServiceSlots = {
  origin?: string;
  destination?: string;
  placeName?: string;
  appointmentPlace?: string;
  serviceLocation?: string;
  appointmentDateTime?: string;
  callTiming?: string;
  quantity?: string;
  deliveryAddress?: string;
  vehicleInfo?: string;
  vehicleSymptom?: string;
  towingRequired?: string;
  providerName?: string;
  productName?: string;
  patientInfo?: string;
  contactInfo?: string;
  improvementTarget?: string;
};

export type PlaceCandidate = {
  raw: string;
  candidates: string[];
  slot?: keyof Pick<ServiceSlots, "origin" | "destination" | "placeName" | "appointmentPlace" | "serviceLocation">;
};
