export type CopilotIntent =
  | "rupture"
  | "expiration"
  | "relocation"
  | "price-check"
  | "technical-note";

export type CopilotAnswer = {
  intent: CopilotIntent;
  answer: string;
  evidence: string[];
};

export type PriceCheckInput = {
  product: string;
  quotedPrice: number;
  medianPB: number;
  observationsPB: number;
  medianBrazil?: number | null;
  observationsBrazil?: number;
};

export function classifyPriceDeviation(input: PriceCheckInput) {
  if (!input.medianPB || input.medianPB <= 0) {
    return { level: "sem_referencia" as const, deviation: 0 };
  }

  const deviation = ((input.quotedPrice / input.medianPB) - 1) * 100;

  if (deviation <= 25) {
    return { level: "adequado" as const, deviation };
  }

  if (deviation <= 100) {
    return { level: "atencao" as const, deviation };
  }

  return { level: "critico" as const, deviation };
}

export function draftPriceAnswer(input: PriceCheckInput) {
  const result = classifyPriceDeviation(input);
  if (result.level === "sem_referencia") {
    return `Sem referência suficiente: não há mediana BPS válida para ${input.product}.`;
  }

  const level =
    result.level === "critico"
      ? "Crítico"
      : result.level === "atencao"
        ? "Atenção"
        : "Adequado";

  return `${level}: preço cotado de R$ ${input.quotedPrice.toFixed(2)} para ${input.product}, mediana BPS-PB/Brasil disponível de R$ ${input.medianPB.toFixed(2)} e desvio de ${result.deviation.toFixed(0)}%. Referência PB baseada em ${input.observationsPB} compras da Paraíba.`;
}
