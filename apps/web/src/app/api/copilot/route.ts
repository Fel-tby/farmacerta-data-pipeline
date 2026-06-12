import { NextResponse } from "next/server";
import { campinaDashboard } from "@farmacerta/data";

type CopilotRequest = {
  question?: string;
  activeView?: string;
};

type CopilotResponse = {
  answer: string;
  evidence: string[];
  mode: "deterministic" | "llm";
};

function baseEvidence() {
  const [year, month, day] = campinaDashboard.meta.stockPositionDate.split("-");
  return [
    `Fonte: ${campinaDashboard.meta.stockSource}, posição ${day}/${month}/${year}.`,
    "Recorte: 26 unidades/CNES com estoque publicado no BNAFAR para Campina Grande/PB."
  ];
}

function deterministicAnswer(question: string): CopilotResponse {
  const cards = campinaDashboard.cards;
  const normalized = question
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const topUnit = campinaDashboard.unitPoints[0];
  const topRelocation = campinaDashboard.relocation[0];
  const topPrice = campinaDashboard.priceCatalog.find((item) => item.observationsPB > 0);

  if (normalized.includes("preco") || normalized.includes("compra") || normalized.includes("bps")) {
    return {
      answer:
        `Para compra defensável, informe uma cotação unitária e compare com BPS-PB/Brasil. ` +
        `Há ${cards.priceReferenceCoveragePB} itens do recorte com referência BPS-PB e ${cards.priceReferenceCoverageBrazil} com referência BPS Brasil. ` +
        `Exemplo com referência: ${topPrice?.product ?? "item com BPS disponível"}.`,
      evidence: [
        ...baseEvidence(),
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
        ...baseEvidence(),
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
        ...baseEvidence(),
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
        ...baseEvidence(),
        "Regra de ranking: registros zerados + vencidos com peso maior + vencimentos próximos."
      ],
      mode: "deterministic"
    };
  }

  return {
    answer:
      `${cards.zeroProductCount} produtos estão totalmente zerados no recorte municipal de Campina Grande, ` +
      `somando ${cards.zeroStockRows} registros de estoque zero. Isso é ruptura no recorte publicado, não previsão de demanda.`,
    evidence: [
      ...baseEvidence(),
      "Regra: soma municipal de qt_estoque por produto igual a zero."
    ],
    mode: "deterministic"
  };
}

async function llmAnswer(question: string, fallback: CopilotResponse) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const payload = {
      model: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
      instructions:
        "Você é o copiloto do FarmaCerta PB. Responda em português, de forma curta, operacional e auditável. Use apenas o contexto fornecido. Se o dado não existir, diga que não existe no recorte. Não invente consumo histórico, preço de compra, prescrição, dispensação ou previsão.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                pergunta: question,
                fallback,
                metricas: campinaDashboard.cards,
                dataQuality: campinaDashboard.dataQuality,
                topUnits: campinaDashboard.unitPoints.slice(0, 5),
                topRelocation: campinaDashboard.relocation.slice(0, 5),
                topPrices: campinaDashboard.priceCatalog.slice(0, 5)
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

  const question = body.question?.trim() || "O que está sem estoque?";
  const fallback = deterministicAnswer(question);
  const answer = await llmAnswer(question, fallback);

  return NextResponse.json(answer);
}
