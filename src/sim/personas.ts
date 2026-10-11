// 6 buyer personas with deterministic behavior.

export interface Persona {
  id: string;
  name: string;
  priceSensitivity: number; // 0-1, higher = more sensitive to price
  topicInterests: string[];
  channelAffinity: Record<"web" | "x", number>; // weight per channel
  complaintProbability: number; // 0-1
  referencePrice: number; // cents, their mental anchor
}

export const PERSONAS: Persona[] = [
  {
    id: "budget_freelancer",
    name: "Budget Freelancer",
    priceSensitivity: 0.8,
    topicInterests: ["spreadsheet", "guide", "planner"],
    channelAffinity: { web: 0.7, x: 0.3 },
    complaintProbability: 0.15,
    referencePrice: 1200,
  },
  {
    id: "dev_founder",
    name: "Dev Founder",
    priceSensitivity: 0.3,
    topicInterests: ["rules_pack", "code_kit", "prompt_pack"],
    channelAffinity: { web: 0.4, x: 0.6 },
    complaintProbability: 0.05,
    referencePrice: 4900,
  },
  {
    id: "student",
    name: "Student",
    priceSensitivity: 0.9,
    topicInterests: ["guide", "planner", "prompt_pack"],
    channelAffinity: { web: 0.5, x: 0.5 },
    complaintProbability: 0.1,
    referencePrice: 900,
  },
  {
    id: "agency_owner",
    name: "Agency Owner",
    priceSensitivity: 0.2,
    topicInterests: ["rules_pack", "code_kit", "prompt_pack", "spreadsheet"],
    channelAffinity: { web: 0.6, x: 0.4 },
    complaintProbability: 0.08,
    referencePrice: 4900,
  },
  {
    id: "hobbyist",
    name: "Hobbyist",
    priceSensitivity: 0.6,
    topicInterests: ["planner", "guide", "spreadsheet"],
    channelAffinity: { web: 0.8, x: 0.2 },
    complaintProbability: 0.05,
    referencePrice: 1500,
  },
  {
    id: "bargain_hunter",
    name: "Bargain Hunter",
    priceSensitivity: 0.95,
    topicInterests: ["spreadsheet", "planner", "guide", "prompt_pack"],
    channelAffinity: { web: 0.5, x: 0.5 },
    complaintProbability: 0.25,
    referencePrice: 800,
  },
];

export function getPersonaById(id: string): Persona | undefined {
  return PERSONAS.find((p) => p.id === id);
}
