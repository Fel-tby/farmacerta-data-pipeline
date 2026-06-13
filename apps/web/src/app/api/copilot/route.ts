import { NextResponse } from "next/server";
import type { DashboardData } from "@farmacerta/data";
import defaultDashboard from "@farmacerta/data/src/municipios/pb/campina-grande/dashboard.json";

type CopilotRequest = {
  question?: string;
  activeView?: string;
  dashboard?: DashboardData;
};

type CopilotResponse = {
  answer: string;
  evidence: string[];
  mode: "deterministic" | "llm";
};

function baseEvidence(dashboard: DashboardData) {
  const [year, month, day] = dashboard.meta.stockPositionDate.split("-");
  return [
    `Fonte: ${dashboard.meta.stockSource}, posição ${day}/${month}/${year}.`,
    `Recorte: ${dashboard.unitPoints.length} unidades/CNES com estoque publicado no BNAFAR para ${dashboard.meta.municipality}/${dashboard.meta.state}.`
  ];
}

function deterministicAnswer(question: string, dashboard: DashboardData): CopilotResponse {
  const cards = dashboard.cards;
  const normalized = question
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const topUnit = dashboard.unitPoints[0];
  const topRelocation = dashboard.relocation[0];
  const topPrice = dashboard.priceCatalog.find((item) => item.observationsPB > 0);

  if (normalized.includes("preco") || normalized.includes("compra") || normalized.includes("bps")) {
    return {
      answer:
        `Para compra defensável, informe uma cotação unitária e compare com BPS-${dashboard.meta.state}/Brasil. ` +
        `Há ${cards.priceReferenceCoveragePB} itens do recorte com referência BPS-${dashboard.meta.state} e ${cards.priceReferenceCoverageBrazil} com referência BPS Brasil. ` +
        `Exemplo com referência: ${topPrice?.product ?? "item com BPS disponível"}.`,
      evidence: [
        ...baseEvidence(dashboard),
        "BNAFAR não traz preço de compra; preço precisa vir de cotação informada, BPS ou CMED."
      ],
      mode: "deterministic"
    };
  }

  if (normalized.includes("venc")) {
    return {
      answer:
        `${cards.expiredPositiveRows} registros possuem saldo positivo com validade vencida, ` +
        `e ${cards.expiring60Rows} registros vencem em até 60 dias. A ação segura é revisar/segregar vencidos e priorizar giro dos próximos vencimentos.`,
      evidence: [
        ...baseEvidence(dashboard),
        "Regra: dt_validade vencida ou em até 60 dias, considerando apenas qt_estoque maior que zero."
      ],
      mode: "deterministic"
    };
  }

  if (normalized.includes("remanej")) {
    return {
      answer:
        `${cards.relocationProducts} produtos aparecem zerados em alguma unidade e com saldo positivo em outra. ` +
        `O maior caso listado é ${topRelocation?.product ?? "um item com doador interno"}, com saldo disponível de ${topRelocation?.availableStock ?? 0}.`,
      evidence: [
        ...baseEvidence(dashboard),
        "Regra: produto com qt_estoque = 0 em unidade receptora e qt_estoque > 0 em unidade doadora."
      ],
      mode: "deterministic"
    };
  }

  if (normalized.includes("unidade") || normalized.includes("prioridade") || normalized.includes("revisao")) {
    return {
      answer:
        `A unidade que aparece primeiro no ranking de risco é ${topUnit.name}, CNES ${topUnit.cnes}. ` +
        `Ela tem ${topUnit.zeroRows} registros zerados, ${topUnit.expiredRows} vencidos com saldo e ${topUnit.expiringRows} vencendo.`,
      evidence: [
        ...baseEvidence(dashboard),
        "Regra de ranking: registros zerados + vencidos com peso maior + vencimentos próximos."
      ],
      mode: "deterministic"
    };
  }

  return {
    answer:
      `${cards.zeroProductCount} produtos estão totalmente zerados no recorte municipal de ${dashboard.meta.municipality}, ` +
      `somando ${cards.zeroStockRows} registros de estoque zero. Isso é ruptura no recorte publicado, não previsão de demanda.`,
    evidence: [
      ...baseEvidence(dashboard),
      "Regra: soma municipal de qt_estoque por produto igual a zero."
    ],
    mode: "deterministic"
  };
}

async function llmAnswer(question: string, fallback: CopilotResponse, dashboard: DashboardData) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const payload = {
      model: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
      instructions:
        "Você é o copiloto do FarmaCerta. Responda em português, de forma curta, operacional e auditável. Use apenas o contexto fornecido. Se o dado não existir, diga que não existe no recorte. Não invente consumo histórico, preço de compra, prescrição, dispensação ou previsão.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                pergunta: question,
                fallback,
                municipio: dashboard.meta.municipality,
                uf: dashboard.meta.state,
                metricas: dashboard.cards,
                dataQuality: dashboard.dataQuality,
                topUnits: dashboard.unitPoints.slice(0, 5),
                topRelocation: dashboard.relocation.slice(0, 5),
                topPrices: dashboard.priceCatalog.slice(0, 5)
              })
            }
          ]
        }
      ]
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) return fallback;
    const data = await response.json();
    const answer = data.output_text;
    if (!answer || typeof answer !== "string") return fallback;

    return {
      ...fallback,
      answer,
      mode: "llm" as const
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  let body: CopilotRequest = {};
  try {
    body = (await request.json()) as CopilotRequest;
  } catch {
    body = {};
  }

  const dashboard = body.dashboard || (defaultDashboard as DashboardData);
  const question = body.question?.trim() || "O que está sem estoque?";
  const fallback = deterministicAnswer(question, dashboard);
  const answer = await llmAnswer(question, fallback, dashboard);

  return NextResponse.json(answer);
}
