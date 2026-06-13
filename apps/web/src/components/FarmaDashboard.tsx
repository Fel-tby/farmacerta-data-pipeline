"use client";

import {
  AlertTriangle,
  Bell,
  Bot,
  Boxes,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Copy,
  FileText,
  Filter,
  Handshake,
  Home,
  Map,
  MapPin,
  PackageCheck,
  Repeat2,
  Search,
  ShieldCheck,
  Sparkles,
  Syringe,
  Warehouse
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cmedPrices,
  loadDashboard,
  loadRegionalPartners,
  getMunicipalityList,
  type DashboardData,
  type RegionalPartnersPayload,
  type MedicationSummary,
  type PartnerProduct,
  type PriceReference,
  type RegionalPartner,
  type RelocationSuggestion,
  type StockRow,
  type UnitPoint,
  type MunicipalityIndexEntry
} from "@farmacerta/data";
import { classifyPriceDeviation, draftPriceAnswer } from "@farmacerta/ai";
import { createContext, useContext } from "react";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

const numberFmt = new Intl.NumberFormat("pt-BR");

type ActiveView = "situacao" | "investigar" | "parceria" | "agir";

const viewTitles: Record<ActiveView, string> = {
  situacao: "Situação Atual",
  investigar: "Investigar",
  parceria: "Parceria Regional",
  agir: "Agir"
};

function riskLabel(level: string) {
  switch (level) {
    case "critico":
      return "Crítico";
    case "alto":
      return "Alto";
    case "moderado":
      return "Moderado";
    default:
      return "Baixo";
  }
}

function riskColor(level: string) {
  switch (level) {
    case "critico":
      return "#ff4d5f";
    case "alto":
      return "#ff7a2f";
    case "moderado":
      return "#ffbd4a";
    default:
      return "#16c8d4";
  }
}

function formatDate(date: string) {
  if (!date) return "-";
  const [year, month, day] = date.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function formatStock(value: number) {
  return numberFmt.format(Number(value) || 0);
}

type MunicipalityContextType = {
  dashboard: DashboardData;
  regionalPartners: RegionalPartnersPayload;
  slug: string;
  name: string;
  uf: string;
};

const MunicipalityContext = createContext<MunicipalityContextType | null>(null);

function useMunicipality() {
  const ctx = useContext(MunicipalityContext);
  if (!ctx) {
    throw new Error("useMunicipality must be used within a MunicipalityProvider");
  }
  return ctx;
}

function sourceLine(dashboard: DashboardData) {
  return `Fonte: BNAFAR, posição ${formatDate(dashboard.meta.stockPositionDate)}. Recorte: ${dashboard.unitPoints.length} unidades/CNES com estoque publicado.`;
}

function MetricCard({
  tone,
  icon,
  label,
  value,
  detail,
  footnote
}: {
  tone: "red" | "amber" | "blue" | "green" | "violet";
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  footnote: string;
}) {
  return (
    <article className={`metricCard ${tone}`}>
      <div className="metricIcon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
      <small>{footnote}</small>
    </article>
  );
}

function Sidebar({
  activeView,
  onChange
}: {
  activeView: ActiveView;
  onChange: (view: ActiveView) => void;
}) {
  const items = [
    ["situacao", "Situação Atual", Home],
    ["investigar", "Investigar", Search],
    ["parceria", "Parceria Regional", Handshake],
    ["agir", "Agir", Sparkles]
  ] as const;

  return (
    <aside className="sidebar">
      <div className="brandMark" style={{ background: "var(--cyan)" }}>
        <div className="logoMark">
          <svg viewBox="0 0 100 100" width="38" height="38" style={{ display: 'block' }}>
            {/* Cross */}
            <rect x="39" y="15" width="22" height="70" rx="5" fill="white" />
            <rect x="15" y="39" width="70" height="22" rx="5" fill="white" />
            {/* Diagonal Dots */}
            <circle cx="27" cy="27" r="6.5" fill="#5bc8f5" />
            <circle cx="73" cy="27" r="6.5" fill="#f5c842" />
            <circle cx="27" cy="73" r="6.5" fill="#f5c842" />
            <circle cx="73" cy="73" r="6.5" fill="#f5706a" />
          </svg>
        </div>
      </div>
      <nav aria-label="Módulos do FarmaCerta">
        {items.map(([view, label, Icon]) => (
          <button
            className={activeView === view ? "navItem active" : "navItem"}
            key={view}
            onClick={() => onChange(view)}
            type="button"
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="govBlock">
        <ShieldCheck size={30} />
        <span>Paraíba</span>
        <small>Assistência farmacêutica municipal</small>
      </div>
    </aside>
  );
}

function UnitMap({
  units,
  selected,
  onSelect
}: {
  units: UnitPoint[];
  selected: UnitPoint;
  onSelect: (unit: UnitPoint) => void;
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<Record<string, import("leaflet").CircleMarker>>({});

  const center = useMemo(() => {
    const total = units.reduce(
      (acc, unit) => ({ lat: acc.lat + unit.lat, lon: acc.lon + unit.lon }),
      { lat: 0, lon: 0 }
    );

    return {
      lat: total.lat / units.length,
      lon: total.lon / units.length
    };
  }, [units]);

  useEffect(() => {
    let isMounted = true;

    async function mountMap() {
      const leaflet = await import("leaflet");
      const L = leaflet.default ?? leaflet;

      if (!isMounted || !mapElementRef.current || mapRef.current) return;

      const map = L.map(mapElementRef.current, {
        attributionControl: true,
        scrollWheelZoom: true,
        zoomControl: true
      }).setView([center.lat, center.lon], 12);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19
      }).addTo(map);

      const bounds = L.latLngBounds(units.map((unit) => [unit.lat, unit.lon]));
      map.fitBounds(bounds.pad(0.18));

      units.forEach((unit) => {
        const color = riskColor(unit.riskLevel);
        const marker = L.circleMarker([unit.lat, unit.lon], {
          color,
          fillColor: color,
          fillOpacity: 0.88,
          opacity: 1,
          radius: 7,
          weight: 2
        })
          .bindPopup(`
            <strong>${unit.name}</strong><br />
            CNES ${unit.cnes} - ${unit.neighborhood}<br />
            ${unit.zeroRows} zerados · ${unit.expiredRows} vencidos · ${unit.expiringRows} vencendo
          `)
          .on("click", () => onSelect(unit))
          .addTo(map);

        markersRef.current[unit.cnes] = marker;
      });

      mapRef.current = map;
    }

    mountMap();

    return () => {
      isMounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, [center.lat, center.lon, onSelect, units]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.entries(markersRef.current).forEach(([cnes, marker]) => {
      const unit = units.find((item) => item.cnes === cnes);
      if (!unit) return;

      const isSelected = selected.cnes === cnes;
      const color = riskColor(unit.riskLevel);
      marker.setStyle({
        color,
        fillColor: color,
        radius: isSelected ? 10 : 7,
        weight: isSelected ? 3 : 2
      });

      if (isSelected) marker.openPopup();
    });

    map.panTo([selected.lat, selected.lon], { animate: true });
  }, [selected, units]);

  const { name, dashboard } = useMunicipality();

  return (
    <section className="mapPanel">
      <div className="sectionTitle">
        <div>
          <h2>Mapa operacional de {name}</h2>
          <p>{units.length} unidades/CNES com estoque publicado nesta carga do BNAFAR</p>
        </div>
        <span className="dataPill">Posição {formatDate(dashboard.meta.stockPositionDate)}</span>
      </div>

      <div ref={mapElementRef} className="leafletMap" aria-label="Mapa funcional com unidades do BNAFAR" />

      <div className="mapFooter">
        <div className="legend">
          <span><i className="dot critico" /> Crítico</span>
          <span><i className="dot alto" /> Alto</span>
          <span><i className="dot moderado" /> Moderado</span>
          <span><i className="dot baixo" /> Baixo</span>
        </div>
        <div className="selectedUnit">
          <strong>{selected.name}</strong>
          <span>CNES {selected.cnes} · {selected.neighborhood}</span>
          <span>{selected.zeroRows} zerados · {selected.expiredRows} vencidos · {selected.expiringRows} vencendo</span>
        </div>
      </div>
    </section>
  );
}

type AlertRow = {
  severity?: string;
  action?: string;
  status?: string;
  product?: string;
  unit?: string;
  stock?: number;
  lot?: string;
  validity?: string;
  evidence?: string;
  source?: string;
};

function AlertTable({ rows }: { rows: AlertRow[] }) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Severidade</th>
            <th>Ação</th>
            <th>Produto</th>
            <th>Unidade</th>
            <th>Estoque</th>
            <th>Lote</th>
            <th>Validade</th>
            <th>Evidência</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={`${item.product}-${item.unit}-${item.lot}-${index}`}>
              <td><span className={`severity ${item.severity ?? "baixo"}`}>{riskLabel(item.severity ?? "baixo")}</span></td>
              <td>{item.action ?? item.status ?? "-"}</td>
              <td>{item.product}</td>
              <td>{item.unit}</td>
              <td>{formatStock(Number(item.stock) || 0)}</td>
              <td>{item.lot || "-"}</td>
              <td>{formatDate(item.validity ?? "")}</td>
              <td>{item.evidence ?? item.source ?? "BNAFAR"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Recommendations() {
  const { dashboard } = useMunicipality();
  const cards = dashboard.cards;

  return (
    <section className="sidePanel recommendations">
      <div className="sectionTitle compact">
        <div>
          <h2>Recomendações</h2>
          <p>Sequência operacional sugerida</p>
        </div>
        <Syringe size={22} />
      </div>
      <ol>
        <li><strong>Revisar</strong> lotes vencidos com saldo antes de qualquer dispensa.</li>
        <li><strong>Remanejar</strong> os {cards.relocationProducts} produtos com saldo em outra unidade.</li>
        <li><strong>Comprar</strong> apenas itens sem doador interno evidente.</li>
        <li><strong>Comparar preço</strong> contra BPS/CMED antes de contratar.</li>
      </ol>
    </section>
  );
}

function PriceWorkbench({ compact = true }: { compact?: boolean }) {
  const { dashboard } = useMunicipality();
  const references = dashboard.priceCatalog as PriceReference[];
  const [selectedCode, setSelectedCode] = useState(references[0]?.code ?? "");
  const selected = references.find((item) => item.code === selectedCode) ?? references[0];
  const [price, setPrice] = useState("0.25");

  const numericPrice = Number(price.replace(",", "."));
  const medianPB = selected?.medianPB ?? selected?.medianBrazil ?? 0;

  // Fuzzy match CMED
  const cmedMatch = useMemo(() => {
    if (!selected) return null;
    const pName = selected.product.toLowerCase();
    const pNumbers = pName.match(/\d+/g) || [];

    // Filter items matching substance or product keywords
    const candidates = cmedPrices.produtos.filter((item) => {
      const sub = item.substancia.toLowerCase();
      const prod = item.produto.toLowerCase();
      const subWords = sub.split(/[;,\s\-]+/).filter(w => w.length > 3);
      const prodWords = prod.split(/[;,\s\-]+/).filter(w => w.length > 3);

      const matchesSub = subWords.length > 0 && subWords.some(w => pName.includes(w));
      const matchesProd = prodWords.length > 0 && prodWords.some(w => pName.includes(w));
      return matchesSub || matchesProd;
    });

    if (candidates.length === 0) return null;

    let bestMatch = candidates[0];
    let bestScore = -1;

    for (const cand of candidates) {
      const desc = (cand.apresentacao + " " + cand.substancia).toLowerCase();
      let score = 0;
      for (const num of pNumbers) {
        if (desc.includes(num)) score += 2;
      }
      if (pName.includes("comp") && (desc.includes("comp") || desc.includes("cpr"))) score += 1;
      if (pName.includes("xpe") && (desc.includes("xpe") || desc.includes("xarope"))) score += 1;
      if (pName.includes("inj") && (desc.includes("inj") || desc.includes("fa") || desc.includes("amp"))) score += 1;
      if (pName.includes("cap") && (desc.includes("cap") || desc.includes("cps"))) score += 1;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = cand;
      }
    }
    return bestMatch;
  }, [selected]);

  // Result and alerts
  const result = useMemo(() => {
    if (!selected || !numericPrice || numericPrice <= 0) return null;

    // Standard BPS classification
    const bpsResult = classifyPriceDeviation({
      product: selected.product,
      quotedPrice: numericPrice,
      medianPB,
      observationsPB: selected.observationsPB
    });

    // Check CMED ceiling
    if (cmedMatch && cmedMatch.pmvgSemImpostos && numericPrice > cmedMatch.pmvgSemImpostos) {
      return {
        level: "critico" as const,
        deviation: ((numericPrice - medianPB) / medianPB) * 100,
        isOverCmed: true,
        cmedPrice: cmedMatch.pmvgSemImpostos,
        message: `ALERTA CRÍTICO: Preço de cotação (${currency.format(numericPrice)}) excede o Teto Regulatório da CMED (${currency.format(cmedMatch.pmvgSemImpostos)})! O limite legal de contratação pública foi ultrapassado.`
      };
    }

    if (cmedMatch && cmedMatch.pmvgSemImpostos) {
      return {
        ...bpsResult,
        isOverCmed: false,
        cmedPrice: cmedMatch.pmvgSemImpostos,
        message: `Cotação (${currency.format(numericPrice)}) está dentro do limite legal (Teto CMED: ${currency.format(cmedMatch.pmvgSemImpostos)}), mas apresenta desvio de ${bpsResult.deviation.toFixed(0)}% em relação à mediana BPS-PB.`
      };
    }

    return {
      ...bpsResult,
      isOverCmed: false,
      cmedPrice: null,
      message: `Desvio de ${bpsResult.deviation.toFixed(0)}% sobre a mediana BPS-PB/Brasil disponível.`
    };
  }, [selected, numericPrice, medianPB, cmedMatch]);

  return (
    <section className={compact ? "sidePanel pricePanel" : "tablePanel pricePanel widePanel"}>
      <div className="sectionTitle compact">
        <div>
          <h2>Compra defensável</h2>
          <p>Cotação informada x referências de mercado BPS e limite legal CMED</p>
        </div>
        <CircleDollarSign size={22} />
      </div>

      <div className={compact ? "" : "formGrid"}>
        <label className="field">
          Produto
          <select value={selectedCode} onChange={(event) => setSelectedCode(event.target.value)}>
            {references.map((item) => (
              <option key={item.code} value={item.code}>
                {item.product}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Preço unitário cotado
          <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" />
        </label>
      </div>

      {selected && result ? (
        <div className={`priceResult ${result.level}`}>
          <strong>
            {result.isOverCmed
              ? "Limite Legal Excedido"
              : result.level === "critico"
              ? "Crítico (Sobre BPS)"
              : result.level === "atencao"
              ? "Atenção"
              : "Adequado"}
          </strong>
          <span>{result.message}</span>
          <p>{draftPriceAnswer({
            product: selected.product,
            quotedPrice: numericPrice,
            medianPB,
            observationsPB: selected.observationsPB
          })}</p>
        </div>
      ) : null}

      <div className="referenceGrid">
        <span>Mediana PB</span>
        <strong>{selected?.medianPB ? currency.format(selected.medianPB) : "Sem ref. PB"}</strong>
        <span>Observações PB</span>
        <strong>{numberFmt.format(selected?.observationsPB ?? 0)}</strong>
        
        <span>Teto CMED (PMVG)</span>
        <strong className={result?.isOverCmed ? "text-red" : ""}>
          {cmedMatch?.pmvgSemImpostos ? currency.format(cmedMatch.pmvgSemImpostos) : "Sem ref. CMED"}
        </strong>
        <span>Substância CMED</span>
        <strong style={{ fontSize: "10px", fontWeight: "normal", textTransform: "capitalize" }} title={cmedMatch?.substancia}>
          {cmedMatch?.substancia ? (cmedMatch.substancia.length > 25 ? cmedMatch.substancia.slice(0, 25) + "..." : cmedMatch.substancia) : "-"}
        </strong>

        <span>Mediana Brasil</span>
        <strong>{selected?.medianBrazil ? currency.format(selected.medianBrazil) : "Sem ref."}</strong>
        <span>Observações Brasil</span>
        <strong>{numberFmt.format(selected?.observationsBrazil ?? 0)}</strong>
      </div>

      <p className="caution">
        BNAFAR não traz preço de compra. Comparamos a cotação informada contra a mediana BPS (benchmark de mercado) e o teto regulatório CMED (limite de preço máximo de venda ao governo).
      </p>
    </section>
  );
}

function CopilotPanel({ activeView }: { activeView: string }) {
  const { dashboard } = useMunicipality();
  const cards = dashboard.cards;
  const questions = [
    "O que está sem estoque?",
    "O que pode ser remanejado?",
    "O que vence em 60 dias?",
    "Qual unidade exige revisão primeiro?",
    "Como defender uma compra?"
  ];
  const [question, setQuestion] = useState(questions[0]);
  const [answer, setAnswer] = useState(`${cards.zeroProductCount} produtos estão totalmente zerados no recorte municipal de ${dashboard.meta.municipality}.`);
  const [evidence, setEvidence] = useState<string[]>([sourceLine(dashboard)]);
  const [loading, setLoading] = useState(false);

  async function askCopilot(nextQuestion = question) {
    setQuestion(nextQuestion);
    setLoading(true);
    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nextQuestion, activeView, dashboard })
      });
      const data = await response.json();
      setAnswer(data.answer);
      setEvidence(data.evidence ?? []);
    } catch {
      setAnswer("Não consegui acionar o copiloto agora. O fallback local mantém os indicadores do painel disponíveis.");
      setEvidence([sourceLine(dashboard)]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="sidePanel copilotPanel">
      <div className="sectionTitle compact">
        <div>
          <h2>Copiloto operacional</h2>
          <p>Resposta com evidências e fallback de segurança</p>
        </div>
        <Bot size={22} />
      </div>
      <div className="questionList">
        {questions.map((item) => (
          <button
            className={question === item ? "question active" : "question"}
            key={item}
            onClick={() => askCopilot(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
      <label className="field">
        Pergunta em linguagem natural
        <input value={question} onChange={(event) => setQuestion(event.target.value)} />
      </label>
      <button className="primaryButton" onClick={() => askCopilot()} type="button">
        <Sparkles size={17} /> {loading ? "Analisando..." : "Perguntar"}
      </button>
      <div className="answerBox">
        <Sparkles size={18} />
        <p>{answer}</p>
        <small>{evidence.join(" · ")}</small>
      </div>
    </section>
  );
}

/* ==========================================================================
   ZONA 1: SITUAÇÃO ATUAL
   ========================================================================== */
function SituacaoAtualView({
  onNavigateToInvestigar,
  onNavigateToAgir
}: {
  onNavigateToInvestigar: (tab: "unidades" | "medicamentos" | "lotes") => void;
  onNavigateToAgir: (tab: "remanejar" | "comprar" | "copiloto") => void;
}) {
  const { dashboard } = useMunicipality();
  const units = dashboard.unitPoints as UnitPoint[];
  const medications = dashboard.medicationSummaries as MedicationSummary[];
  const cards = dashboard.cards;

  // Donut Chart calculations (Saúde da Rede)
  const criticoCount = units.filter((u) => u.riskLevel === "critico").length;
  const altoCount = units.filter((u) => u.riskLevel === "alto").length;
  const moderadoCount = units.filter((u) => u.riskLevel === "moderado").length;
  const baixoCount = units.filter((u) => u.riskLevel === "baixo").length;
  const totalUnitsCount = units.length;

  const pctCritico = (criticoCount / totalUnitsCount) * 100;
  const pctAlto = (altoCount / totalUnitsCount) * 100;
  const pctModerado = (moderadoCount / totalUnitsCount) * 100;
  const pctBaixo = (baixoCount / totalUnitsCount) * 100;

  // Stacked Bar calculations (Status Medicamentos)
  const totalMeds = medications.length;
  const medsZerados = medications.filter((m) => m.status === "Zerado no municipio").length;
  const medsRemanejamento = medications.filter((m) => m.status === "Remanejamento possivel").length;
  const medsVencidos = medications.filter((m) => m.status === "Tem lote vencido" || m.status === "Tem vencimento proximo").length;
  const medsComSaldo = medications.filter((m) => m.status === "Com saldo").length;

  const wZerados = (medsZerados / totalMeds) * 100;
  const wRemanejamento = (medsRemanejamento / totalMeds) * 100;
  const wVencidos = (medsVencidos / totalMeds) * 100;
  const wSaldo = (medsComSaldo / totalMeds) * 100;

  // Top 5 Unidades Críticas
  const sortedUnits = [...units].sort((a, b) => b.score - a.score);
  const top5Units = sortedUnits.slice(0, 5);
  const maxScore = Math.max(...top5Units.map((u) => u.score), 1);

  // Cobertura BPS
  const totalMonitored = cards.monitoredProducts || 1179;
  const covPB = cards.priceReferenceCoveragePB || 456;
  const covBrazil = (cards.priceReferenceCoverageBrazil || 761) - covPB;
  const noRef = totalMonitored - covPB - covBrazil;

  const wPB = (covPB / totalMonitored) * 100;
  const wBrazil = (covBrazil / totalMonitored) * 100;
  const wNoRef = (noRef / totalMonitored) * 100;

  return (
    <div className="tabContent">
      <div className="chartsGrid">
        {/* Donut Chart: Saúde da Rede */}
        <article className="chartCard">
          <div className="chartCardHeader">
            <div>
              <h2>Saúde Operacional da Rede</h2>
              <p>Distribuição de postos por nível de criticidade</p>
            </div>
            <MapPin size={18} />
          </div>
          <div className="donutContainer">
            <div className="donutSvgContainer">
              <svg viewBox="0 0 36 36" className="donutSvg">
                {/* Background Track */}
                <circle cx="18" cy="18" r="15.9155" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="4" />
                {/* Critico */}
                <circle
                  className="donutSegment"
                  cx="18"
                  cy="18"
                  r="15.9155"
                  fill="none"
                  stroke="var(--red)"
                  strokeWidth="4"
                  strokeDasharray={`${pctCritico} ${100 - pctCritico}`}
                  strokeDashoffset="25"
                />
                {/* Alto */}
                <circle
                  className="donutSegment"
                  cx="18"
                  cy="18"
                  r="15.9155"
                  fill="none"
                  stroke="var(--amber)"
                  strokeWidth="4"
                  strokeDasharray={`${pctAlto} ${100 - pctAlto}`}
                  strokeDashoffset={25 - pctCritico}
                />
                {/* Moderado */}
                <circle
                  className="donutSegment"
                  cx="18"
                  cy="18"
                  r="15.9155"
                  fill="none"
                  stroke="#ffde6a"
                  strokeWidth="4"
                  strokeDasharray={`${pctModerado} ${100 - pctModerado}`}
                  strokeDashoffset={25 - pctCritico - pctAlto}
                />
                {/* Baixo */}
                <circle
                  className="donutSegment"
                  cx="18"
                  cy="18"
                  r="15.9155"
                  fill="none"
                  stroke="var(--cyan)"
                  strokeWidth="4"
                  strokeDasharray={`${pctBaixo} ${100 - pctBaixo}`}
                  strokeDashoffset={25 - pctCritico - pctAlto - pctModerado}
                />
              </svg>
              <div className="donutCenter">
                <strong>{totalUnitsCount}</strong>
                <span>Postos</span>
              </div>
            </div>
            <div className="donutLegend">
              <div className="donutLegendRow">
                <span className="donutLegendLabel"><i className="donutLegendDot critico" /> Crítico</span>
                <span className="donutLegendValue">{criticoCount}</span>
              </div>
              <div className="donutLegendRow">
                <span className="donutLegendLabel"><i className="donutLegendDot alto" /> Alto</span>
                <span className="donutLegendValue">{altoCount}</span>
              </div>
              <div className="donutLegendRow">
                <span className="donutLegendLabel"><i className="donutLegendDot moderado" /> Moderado</span>
                <span className="donutLegendValue">{moderadoCount}</span>
              </div>
              <div className="donutLegendRow">
                <span className="donutLegendLabel"><i className="donutLegendDot baixo" /> Baixo</span>
                <span className="donutLegendValue">{baixoCount}</span>
              </div>
            </div>
          </div>
        </article>

        {/* Stacked Bar Chart: Status dos Medicamentos */}
        <article className="chartCard">
          <div className="chartCardHeader">
            <div>
              <h2>Status do Catálogo de Medicamentos</h2>
              <p>{totalMeds} itens monitorados sob regras de estoque</p>
            </div>
            <Boxes size={18} />
          </div>
          <div className="stackedBarChart">
            <div className="stackedBarContainer">
              <div
                className="stackedBarSegment"
                style={{ width: `${wZerados}%`, backgroundColor: "var(--red)" }}
                title={`Zerado no município: ${medsZerados} (${wZerados.toFixed(1)}%)`}
              />
              <div
                className="stackedBarSegment"
                style={{ width: `${wRemanejamento}%`, backgroundColor: "var(--cyan)" }}
                title={`Remanejamento possível: ${medsRemanejamento} (${wRemanejamento.toFixed(1)}%)`}
              />
              <div
                className="stackedBarSegment"
                style={{ width: `${wVencidos}%`, backgroundColor: "var(--amber)" }}
                title={`Lotes em risco/vencidos: ${medsVencidos} (${wVencidos.toFixed(1)}%)`}
              />
              <div
                className="stackedBarSegment"
                style={{ width: `${wSaldo}%`, backgroundColor: "var(--green)" }}
                title={`Com saldo seguro: ${medsComSaldo} (${wSaldo.toFixed(1)}%)`}
              />
            </div>
            <div className="stackedBarLegend">
              <div className="stackedLegendItem">
                <span className="stackedLegendLabel"><i className="stackedLegendColor" style={{ backgroundColor: "var(--red)" }} /> Zerados</span>
                <strong className="stackedLegendValue">{medsZerados}</strong>
              </div>
              <div className="stackedLegendItem">
                <span className="stackedLegendLabel"><i className="stackedLegendColor" style={{ backgroundColor: "var(--cyan)" }} /> Remanejáveis</span>
                <strong className="stackedLegendValue">{medsRemanejamento}</strong>
              </div>
              <div className="stackedLegendItem">
                <span className="stackedLegendLabel"><i className="stackedLegendColor" style={{ backgroundColor: "var(--amber)" }} /> Lotes em Risco</span>
                <strong className="stackedLegendValue">{medsVencidos}</strong>
              </div>
              <div className="stackedLegendItem">
                <span className="stackedLegendLabel"><i className="stackedLegendColor" style={{ backgroundColor: "var(--green)" }} /> Com Saldo</span>
                <strong className="stackedLegendValue">{medsComSaldo}</strong>
              </div>
            </div>
          </div>
        </article>

        {/* Horizontal Ranking: Top 5 Unidades Críticas */}
        <article className="chartCard">
          <div className="chartCardHeader">
            <div>
              <h2>Top 5 Unidades Críticas</h2>
              <p>Ordenado por score ponderado de ruptura municipal</p>
            </div>
            <AlertTriangle size={18} />
          </div>
          <div className="rankingList">
            {top5Units.map((u) => {
              const pctWidth = (u.score / maxScore) * 100;
              return (
                <div key={u.cnes} className="rankingRow">
                  <span className="rankingLabel" title={u.name}>{u.name}</span>
                  <div className="rankingBarTrack">
                    <div className={`rankingBarFill ${u.riskLevel}`} style={{ width: `${pctWidth}%` }} />
                  </div>
                  <span className="rankingValue">{u.score}</span>
                </div>
              );
            })}
          </div>
        </article>

        {/* Cobertura BPS */}
        <article className="chartCard">
          <div className="chartCardHeader">
            <div>
              <h2>Cobertura de Referência de Preços BPS</h2>
              <p>Disponibilidade de preço de referência público</p>
            </div>
            <CircleDollarSign size={18} />
          </div>
          <div className="bpsCoverageWrapper">
            <div className="bpsMetricsRow">
              <span>Mediana BPS-PB Disponível</span>
              <strong>{((covPB / totalMonitored) * 100).toFixed(0)}%</strong>
            </div>
            <div className="bpsBarTrack">
              <div className="bpsBarFill pb" style={{ width: `${wPB}%` }} title={`BPS-PB: ${covPB} itens (${wPB.toFixed(1)}%)`} />
              <div className="bpsBarFill brasil" style={{ width: `${wBrazil}%` }} title={`BPS-Brasil: ${covBrazil} itens (${wBrazil.toFixed(1)}%)`} />
              <div className="bpsBarFill semref" style={{ width: `${wNoRef}%` }} title={`Sem referência: ${noRef} itens (${wNoRef.toFixed(1)}%)`} />
            </div>
            <div className="bpsLegend">
              <span className="bpsLegendItem"><i className="donutLegendDot" style={{ backgroundColor: "var(--blue)", width: 6, height: 6 }} /> BPS-PB ({covPB})</span>
              <span className="bpsLegendItem"><i className="donutLegendDot" style={{ backgroundColor: "var(--cyan)", width: 6, height: 6 }} /> BPS-Brasil ({covBrazil})</span>
              <span className="bpsLegendItem"><i className="donutLegendDot" style={{ backgroundColor: "rgba(255,255,255,0.2)", width: 6, height: 6 }} /> Sem Ref ({noRef})</span>
            </div>
          </div>
        </article>
      </div>

      {/* Cards de Acesso Rápido */}
      <div className="quickActionsGrid">
        <button className="actionLinkCard" onClick={() => onNavigateToInvestigar("medicamentos")} type="button">
          <h3><Boxes size={18} /> {medsZerados} Medicamentos Zerados</h3>
          <p>Identifique desabastecimentos completos no município de {dashboard.meta.municipality} e consulte unidades alternativas.</p>
          <span>Investigar Medicamentos &rarr;</span>
        </button>

        <button className="actionLinkCard" onClick={() => onNavigateToInvestigar("lotes")} type="button">
          <h3><CalendarClock size={18} /> {cards.expiredPositiveRows} Lotes Vencidos com Saldo</h3>
          <p>Localize lotes vencidos ou com vencimento próximo de forma unificada para suspender dispensações inseguras.</p>
          <span>Revisar Lotes &rarr;</span>
        </button>

        <button className="actionLinkCard" onClick={() => onNavigateToAgir("remanejar")} type="button">
          <h3><Repeat2 size={18} /> {cards.relocationProducts} Remanejamentos Sugeridos</h3>
          <p>Visualize as transferências recomendadas entre postos com excedente e postos desabastecidos.</p>
          <span>Planejar Transferências &rarr;</span>
        </button>

        <button className="actionLinkCard" onClick={() => onNavigateToAgir("comprar")} type="button">
          <h3><CircleDollarSign size={18} /> Preços de Cotação</h3>
          <p>Valide preços cotados de fornecedores contra medianas de mercado BPS e tetos legais da CMED.</p>
          <span>Verificar Preços &rarr;</span>
        </button>
      </div>
    </div>
  );
}

/* ==========================================================================
   ZONA 2: INVESTIGAR (DRILL-DOWN GEOGRÁFICO E DE DADOS)
   ========================================================================== */
function InvestigarView({
  activeTab,
  setActiveTab,
  selectedUnit,
  setSelectedUnit
}: {
  activeTab: "unidades" | "medicamentos" | "lotes";
  setActiveTab: (tab: "unidades" | "medicamentos" | "lotes") => void;
  selectedUnit: UnitPoint;
  setSelectedUnit: (unit: UnitPoint) => void;
}) {
  return (
    <div className="tabContent">
      <div className="tabBar">
        <button
          className={activeTab === "unidades" ? "tabButton active" : "tabButton"}
          onClick={() => setActiveTab("unidades")}
          type="button"
        >
          <MapPin size={16} />
          <span>Por Unidade</span>
        </button>
        <button
          className={activeTab === "medicamentos" ? "tabButton active" : "tabButton"}
          onClick={() => setActiveTab("medicamentos")}
          type="button"
        >
          <PackageCheck size={16} />
          <span>Por Medicamento</span>
        </button>
        <button
          className={activeTab === "lotes" ? "tabButton active" : "tabButton"}
          onClick={() => setActiveTab("lotes")}
          type="button"
        >
          <Warehouse size={16} />
          <span>Por Lote / Validade</span>
        </button>
      </div>

      {activeTab === "unidades" ? (
        <UnitsView selectedUnit={selectedUnit} setSelectedUnit={setSelectedUnit} />
      ) : null}

      {activeTab === "medicamentos" ? (
        <MedicationsView />
      ) : null}

      {activeTab === "lotes" ? (
        <StockViewWithTimeline />
      ) : null}
    </div>
  );
}

function MedicationsView() {
  const { dashboard } = useMunicipality();
  const medications = dashboard.medicationSummaries as MedicationSummary[];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("todos");
  const filtered = medications.filter((item) => {
    const text = `${item.product} ${item.code} ${item.programs.join(" ")} ${item.status}`.toLowerCase();
    const matchesQuery = text.includes(query.toLowerCase());
    const matchesStatus = status === "todos" || item.status === status;
    return matchesQuery && matchesStatus;
  });
  const selected = filtered[0] ?? medications[0];

  return (
    <section className="moduleGrid" style={{ animation: "fadeIn 0.2s" }}>
      <div className="mainColumn">
        <section className="tablePanel">
          <div className="tableHeader">
            <div>
              <h2>Medicamentos Monitorados</h2>
              <p>Catálogo consolidado com indicação visual de cobertura na rede</p>
            </div>
            <div className="toolbar">
              <label className="searchBox">
                <Search size={18} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto, CATMAT ou programa" />
              </label>
              <select className="selectFilter" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="todos">Todos os status</option>
                <option value="Zerado no municipio">Zerado no município</option>
                <option value="Remanejamento possivel">Remanejamento possível</option>
                <option value="Tem lote vencido">Tem lote vencido</option>
                <option value="Tem vencimento proximo">Tem vencimento próximo</option>
                <option value="Com saldo">Com saldo</option>
              </select>
            </div>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Risco</th>
                  <th>Medicamento</th>
                  <th>CATMAT</th>
                  <th>Estoque total</th>
                  <th>Cobertura na Rede</th>
                  <th>Zeradas</th>
                  <th>Venc.</th>
                  <th>Preço</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 120).map((item) => {
                  const pct = item.unitCount > 0 ? (item.unitsWithStock / item.unitCount) * 100 : 0;
                  return (
                    <tr key={`${item.code}-${item.product}`}>
                      <td><span className={`severity ${item.severity}`}>{riskLabel(item.severity)}</span></td>
                      <td>{item.product}<small>{item.status}</small></td>
                      <td>{item.code || "-"}</td>
                      <td>{formatStock(item.totalStock)}</td>
                      <td>
                        <div className="sparkBarTrack">
                          <div
                            className={`sparkBarFill ${pct < 30 ? "critico" : pct < 60 ? "alto" : ""}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span>{item.unitsWithStock}/{item.unitCount}</span>
                      </td>
                      <td>{item.zeroUnits}</td>
                      <td>{item.expiredRows + item.expiringRows}</td>
                      <td>{item.hasPriceReferencePB ? "BPS-PB" : "Sem PB"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <aside className="rightRail">
        <section className="sidePanel">
          <div className="sectionTitle compact">
            <div>
              <h2>Detalhe do medicamento</h2>
              <p>{selected?.code || "Sem CATMAT"}</p>
            </div>
            <PackageCheck size={22} />
          </div>
          {selected ? (
            <div className="detailStack">
              <strong>{selected.product}</strong>
              <span className={`severity ${selected.severity}`}>{selected.status}</span>
              <div className="referenceGrid">
                <span>Estoque total</span><strong>{formatStock(selected.totalStock)}</strong>
                <span>Unidades com saldo</span><strong>{selected.unitsWithStock}</strong>
                <span>Unidades zeradas</span><strong>{selected.zeroUnits}</strong>
                <span>Lotes em alerta</span><strong>{selected.expiredRows + selected.expiringRows}</strong>
              </div>
              <p className="caution">Programas: {selected.programs.join(", ") || "não informado"}.</p>
              <div className="miniList">
                {selected.lots.slice(0, 6).map((lot) => (
                  <div key={`${lot.unit}-${lot.lot}-${lot.validity}`}>
                    <strong>{lot.unit}</strong>
                    <span>{lot.status} · lote {lot.lot || "-"} · validade {formatDate(lot.validity)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </aside>
    </section>
  );
}

function StockViewWithTimeline() {
  const { dashboard } = useMunicipality();
  const rows = dashboard.stockRows as StockRow[];
  const units = dashboard.unitPoints as UnitPoint[];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("todos");
  const [unit, setUnit] = useState("todas");

  const filtered = rows.filter((row) => {
    const matchesQuery = `${row.product} ${row.code} ${row.lot}`.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = status === "todos" || row.status === status;
    const matchesUnit = unit === "todas" || row.cnes === unit;
    return matchesQuery && matchesStatus && matchesUnit;
  });

  return (
    <section className="tablePanel" style={{ animation: "fadeIn 0.2s" }}>
      <div className="tableHeader">
        <div>
          <h2>Estoque e Lotes Publicados (BNAFAR)</h2>
          <p>{numberFmt.format(filtered.length)} registros de {numberFmt.format(rows.length)} linhas reais</p>
        </div>
        <div className="toolbar">
          <label className="searchBox">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Produto, CATMAT ou lote" />
          </label>
          <select className="selectFilter" value={unit} onChange={(event) => setUnit(event.target.value)}>
            <option value="todas">Todas as unidades</option>
            {units.map((item) => (
              <option key={item.cnes} value={item.cnes}>{item.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Linha do tempo de filtros */}
      <div className="timelineFilter">
        <button
          className={status === "todos" ? "timelineTab active" : "timelineTab"}
          onClick={() => setStatus("todos")}
          type="button"
        >
          <strong>{rows.length}</strong>
          <span>Todos</span>
        </button>
        <button
          className={status === "Vencido" ? "timelineTab active" : "timelineTab"}
          onClick={() => setStatus("Vencido")}
          type="button"
        >
          <strong>{dashboard.cards.expiredPositiveRows}</strong>
          <span>Vencidos</span>
        </button>
        <button
          className={status === "Vence em 30 dias" ? "timelineTab active" : "timelineTab"}
          onClick={() => setStatus("Vence em 30 dias")}
          type="button"
        >
          <strong>{dashboard.cards.expiring30Rows}</strong>
          <span>Vence &lt; 30 dias</span>
        </button>
        <button
          className={status === "Vence em 60 dias" || status === "Vence in 60 dias" ? "timelineTab active" : "timelineTab"}
          onClick={() => setStatus("Vence em 60 dias")}
          type="button"
        >
          <strong>{dashboard.cards.expiring60Rows}</strong>
          <span>Vence &lt; 60 dias</span>
        </button>
        <button
          className={status === "Com saldo" ? "timelineTab active" : "timelineTab"}
          onClick={() => setStatus("Com saldo")}
          type="button"
        >
          <strong>{rows.filter((r) => r.status === "Com saldo").length}</strong>
          <span>Com Saldo Seguro</span>
        </button>
      </div>

      <div className="tableWrap tallTable">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Produto</th>
              <th>Unidade</th>
              <th>Estoque</th>
              <th>Lote</th>
              <th>Validade</th>
              <th>Programa</th>
              <th>Origem</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 260).map((row) => (
              <tr key={row.id}>
                <td><span className={`severity ${row.severity}`}>{row.status}</span></td>
                <td>{row.product}<small>{row.code}</small></td>
                <td>{row.unit}<small>CNES {row.cnes}</small></td>
                <td>{formatStock(row.stock)}</td>
                <td>{row.lot || "-"}</td>
                <td>{formatDate(row.validity)}</td>
                <td>{row.program || "-"}</td>
                <td>{row.origin || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UnitsView({
  selectedUnit,
  setSelectedUnit
}: {
  selectedUnit: UnitPoint;
  setSelectedUnit: (unit: UnitPoint) => void;
}) {
  const { dashboard } = useMunicipality();
  const units = dashboard.unitPoints as UnitPoint[];
  const rows = (dashboard.stockRows as StockRow[]).filter((row) => row.cnes === selectedUnit.cnes);

  return (
    <section className="moduleGrid" style={{ animation: "fadeIn 0.2s" }}>
      <div className="mainColumn">
        <UnitMap units={units} selected={selectedUnit} onSelect={setSelectedUnit} />
        <section className="tablePanel">
          <div className="tableHeader">
            <div>
              <h2>Estoque da unidade selecionada</h2>
              <p>{selectedUnit.name} · CNES {selectedUnit.cnes}</p>
            </div>
            <span className={`severity ${selectedUnit.riskLevel}`}>{riskLabel(selectedUnit.riskLevel)}</span>
          </div>
          <AlertTable rows={rows.filter((row) => row.status !== "Com saldo").slice(0, 16)} />
        </section>
      </div>
      <aside className="rightRail">
        <section className="sidePanel">
          <div className="sectionTitle compact">
            <div>
              <h2>Ranking de unidades</h2>
              <p>Somente CNES com estoque publicado</p>
            </div>
            <MapPin size={22} />
          </div>
          <div className="unitList">
            {units.map((unit) => (
              <button
                className={unit.cnes === selectedUnit.cnes ? "unitRow active" : "unitRow"}
                key={unit.cnes}
                onClick={() => setSelectedUnit(unit)}
                type="button"
              >
                <strong>{unit.name}</strong>
                <span>{unit.zeroRows} zerados · {unit.expiredRows} vencidos · score {unit.score}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>
    </section>
  );
}

/* ==========================================================================
   ZONA 3: AGIR (CENTRO DE DECISÃO OPERACIONAL)
   ========================================================================== */
function AgirView({
  activeTab,
  setActiveTab
}: {
  activeTab: "remanejar" | "comprar" | "copiloto";
  setActiveTab: (tab: "remanejar" | "comprar" | "copiloto") => void;
}) {
  return (
    <div className="tabContent">
      <div className="tabBar">
        <button
          className={activeTab === "remanejar" ? "tabButton active" : "tabButton"}
          onClick={() => setActiveTab("remanejar")}
          type="button"
        >
          <Repeat2 size={16} />
          <span>Remanejar</span>
        </button>
        <button
          className={activeTab === "comprar" ? "tabButton active" : "tabButton"}
          onClick={() => setActiveTab("comprar")}
          type="button"
        >
          <CircleDollarSign size={16} />
          <span>Comprar Defensável</span>
        </button>
        <button
          className={activeTab === "copiloto" ? "tabButton active" : "tabButton"}
          onClick={() => setActiveTab("copiloto")}
          type="button"
        >
          <Bot size={16} />
          <span>Copiloto</span>
        </button>
      </div>

      {activeTab === "remanejar" ? <RelocationView /> : null}
      {activeTab === "comprar" ? <PurchaseView /> : null}
      {activeTab === "copiloto" ? (
        <section className="moduleGrid" style={{ animation: "fadeIn 0.2s" }}>
          <div className="mainColumn">
            <div className="tablePanel" style={{ padding: "24px" }}>
              <h2>Consultoria e Diagnóstico via Copiloto</h2>
              <p style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px", marginBottom: "20px" }}>
                Questione faltas, preços fora do esperado e desvios nas compras de forma direta com dados do BNAFAR.
              </p>
              <CopilotPanel activeView="agir" />
            </div>
          </div>
          <aside className="rightRail">
            <Recommendations />
          </aside>
        </section>
      ) : null}
    </div>
  );
}

function RelocationView() {
  const { dashboard } = useMunicipality();
  const relocation = dashboard.relocation as RelocationSuggestion[];
  const [justification, setJustification] = useState<string | null>(null);
  const [justifiedProduct, setJustifiedProduct] = useState<string | null>(null);

  function handleGenerateJustification(item: RelocationSuggestion) {
    const text = `JUSTIFICATIVA DE REMANEJAMENTO OPERACIONAL - FARMAOPERACIONAL
----------------------------------------------------------------------
Medicamento: ${item.product}
Data da Solicitação: ${new Date().toLocaleDateString("pt-BR")}
Base de Dados: BNAFAR de ${formatDate(dashboard.meta.stockPositionDate)}

Conforme auditoria periódica do estoque municipal de ${dashboard.meta.municipality}/${dashboard.meta.state}, recomenda-se o remanejamento imediato do medicamento supracitado.

Destinatários Desabastecidos (Estoque Zero):
${item.zeroUnits.map((u) => ` - ${u}`).join("\n")}

Unidades Doadoras Disponíveis (Saldo Saudável):
${item.donorUnits.map((u) => ` - ${u}`).join("\n")}

Quantidade Total de Saldo Operacional em Doadoras: ${formatStock(item.availableStock)} unidades.

Ação Recomendada:
Movimentar lotes válidos das unidades doadoras para os postos com desabastecimento crítico, restabelecendo a assistência básica local e otimizando a validade dos lotes de forma a prevenir descarte por vencimento.`;

    setJustification(text);
    setJustifiedProduct(item.product);
  }

  return (
    <section className="moduleGrid" style={{ animation: "fadeIn 0.2s" }}>
      <div className="mainColumn">
        <section className="tablePanel">
          <div className="tableHeader">
            <div>
              <h2>Oportunidades de Remanejamento Interno</h2>
              <p>Produtos sem estoque em postos específicos, mas com estoque disponível para transferência em doadoras</p>
            </div>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Medicamento</th>
                  <th>Postos Zerados</th>
                  <th>Postos Doadoras</th>
                  <th>Saldo Disponível</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {relocation.map((item) => (
                  <tr key={item.product}>
                    <td><strong>{item.product}</strong></td>
                    <td>
                      <div className="remediationFlow">
                        <span className="remediationBadge">{item.zeroUnits.length} zerado(s)</span>
                      </div>
                    </td>
                    <td>
                      <div className="remediationFlow">
                        <span className="remediationDonor">{item.donorUnits.length} doadora(s)</span>
                      </div>
                    </td>
                    <td><strong>{formatStock(item.availableStock)}</strong></td>
                    <td>
                      <button
                        className="actionButton"
                        onClick={() => handleGenerateJustification(item)}
                        type="button"
                      >
                        Justificar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <aside className="rightRail">
        <section className="sidePanel">
          <div className="sectionTitle compact">
            <div>
              <h2>Painel de Justificativa</h2>
              <p>Modelos de remanejamento administrativo</p>
            </div>
            <ClipboardList size={22} />
          </div>

          {justification ? (
            <div className="detailStack" style={{ animation: "fadeIn 0.2s" }}>
              <strong>{justifiedProduct}</strong>
              <textarea
                className="reportText"
                style={{ height: "260px", fontSize: "11.5px", fontFamily: "monospace", marginTop: "10px" }}
                readOnly
                value={justification}
              />
              <button
                className="primaryButton"
                onClick={() => navigator.clipboard?.writeText(justification)}
                type="button"
                style={{ marginTop: "10px" }}
              >
                <Copy size={17} /> Copiar Justificativa
              </button>
            </div>
          ) : (
            <div style={{ color: "var(--muted)", fontSize: "13px", padding: "20px 0", textAlign: "center" }}>
              Selecione "Justificar" ao lado do produto desejado para formatar a nota de transferência oficial.
            </div>
          )}
        </section>
        <Recommendations />
      </aside>
    </section>
  );
}

function PurchaseView() {
  const { dashboard } = useMunicipality();
  const relocation = dashboard.relocation as RelocationSuggestion[];

  return (
    <section className="moduleGrid" style={{ animation: "fadeIn 0.2s" }}>
      <div className="mainColumn">
        <PriceWorkbench compact={false} />
        <section className="tablePanel">
          <div className="tableHeader">
            <div>
              <h2>Produtos com referência BPS</h2>
              <p>Preços de mediana regional e nacional disponíveis em auditoria pública</p>
            </div>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Código</th>
                  <th>Mediana PB</th>
                  <th>Obs. PB</th>
                  <th>Mediana Brasil</th>
                  <th>Obs. Brasil</th>
                </tr>
              </thead>
              <tbody>
                {(dashboard.priceCatalog as PriceReference[]).slice(0, 40).map((item) => (
                  <tr key={`${item.code}-${item.product}`}>
                    <td>{item.product}</td>
                    <td>{item.code}</td>
                    <td>{item.medianPB ? currency.format(item.medianPB) : "Sem PB"}</td>
                    <td>{numberFmt.format(item.observationsPB)}</td>
                    <td>{item.medianBrazil ? currency.format(item.medianBrazil) : "Sem ref."}</td>
                    <td>{numberFmt.format(item.observationsBrazil)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <aside className="rightRail">
        <section className="sidePanel">
          <div className="sectionTitle compact">
            <div>
              <h2>Antes de comprar</h2>
              <p>Defesa operacional com estoque real</p>
            </div>
            <Repeat2 size={22} />
          </div>
          <div className="miniList">
            {relocation.slice(0, 6).map((item) => (
              <div key={item.product}>
                <strong>{item.product}</strong>
                <span>{item.zeroUnits.length} unidade(s) zerada(s), {item.donorUnits.length} doadora(s), saldo {formatStock(item.availableStock)}</span>
              </div>
            ))}
          </div>
          <p className="caution">A tela não afirma preço pago pelo município: compara uma cotação informada com BPS-PB/Brasil.</p>
        </section>
        <CopilotPanel activeView="compra" />
      </aside>
    </section>
  );
}

/* ==========================================================================
   RELATÓRIOS AUDITÁVEIS (REMOVIDO)
   ========================================================================== */

/* ==========================================================================
   PARCERIA REGIONAL (COMPRA CONJUNTA E CONSÓRCIOS)
   ========================================================================== */
interface PartnerProductWithStock {
  catmat: string;
  produto: string;
  totalEstoque: number;
}

function SVGRelationMap({
  partners,
  selected,
  onSelect,
  baseName
}: {
  partners: RegionalPartner[];
  selected: RegionalPartner | null;
  onSelect: (p: RegionalPartner) => void;
  baseName: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<RegionalPartner | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const plotted = useMemo(() => {
    // Sort by overlap DESC to show the top 12 candidates
    return [...partners].sort((a, b) => b.produtosZeradosEmComum - a.produtosZeradosEmComum).slice(0, 12);
  }, [partners]);

  const maxOverlap = useMemo(() => {
    return Math.max(...plotted.map((p) => p.produtosZeradosEmComum), 1);
  }, [plotted]);

  const handleMouseMove = (e: React.MouseEvent, partner: RegionalPartner) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltipPos({
      x: e.clientX - rect.left + 15,
      y: e.clientY - rect.top + 15
    });
    setHovered(partner);
  };

  const handleMouseLeave = () => {
    setHovered(null);
    setTooltipPos(null);
  };

  return (
    <div className="radarMapCard" ref={containerRef}>
      <div className="radarMapHeader">
        <h3>
          <Handshake size={18} className="text-cyan" />
          Radar de Proximidade Regional (Top 12 Candidatos a Compra Conjunta)
        </h3>
        <p>Proporção radial exata de distância (raio máximo de 120 km)</p>
      </div>
      <div className="svgWrapper">
        <svg viewBox="0 0 400 400" className="relationSvg">
          {/* Concentric rings with actual radio values */}
          <circle cx="200" cy="200" r="90" fill="none" stroke="rgba(22, 200, 212, 0.08)" strokeWidth="1.5" strokeDasharray="4 4" />
          <circle cx="200" cy="200" r="130" fill="none" stroke="rgba(22, 200, 212, 0.08)" strokeWidth="1.5" strokeDasharray="4 4" />
          <circle cx="200" cy="200" r="170" fill="none" stroke="rgba(22, 200, 212, 0.08)" strokeWidth="1.5" strokeDasharray="4 4" />

          {/* Ring Labels */}
          <text x="200" y="105" textAnchor="middle" className="ringLabel">40 km</text>
          <text x="200" y="65" textAnchor="middle" className="ringLabel">80 km</text>
          <text x="200" y="25" textAnchor="middle" className="ringLabel">120 km</text>

          {/* Lines and Nodes */}
          {plotted.map((p, index) => {
            const angle = (index * 2 * Math.PI) / plotted.length - Math.PI / 2;
            const r = 50 + (p.distKm / 120) * 120;
            const x = 200 + r * Math.cos(angle);
            const y = 200 + r * Math.sin(angle);
            const isSelected = selected?.cod === p.cod;

            // Node radius proportional to products in common (overlap) - min 5px, max 12px
            const nodeRadius = 5 + (p.produtosZeradosEmComum / maxOverlap) * 7;

            return (
              <g
                key={p.cod}
                className={`mapNodeGroup ${isSelected ? "active" : ""}`}
                onClick={() => onSelect(p)}
                onMouseMove={(e) => handleMouseMove(e, p)}
                onMouseLeave={handleMouseLeave}
                style={{ cursor: "pointer" }}
              >
                <line
                  x1="200"
                  y1="200"
                  x2={x}
                  y2={y}
                  stroke={isSelected ? "var(--cyan)" : "rgba(255,255,255,0.06)"}
                  strokeWidth={isSelected ? "2" : "1"}
                  strokeDasharray={isSelected ? "none" : "3 3"}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? nodeRadius + 2.5 : nodeRadius}
                  fill={isSelected ? "var(--cyan)" : "rgba(22, 200, 212, 0.35)"}
                  stroke="var(--bg)"
                  strokeWidth="2"
                  className={isSelected ? "pulse" : ""}
                />
                <text
                  x={x}
                  y={y - 12 - (isSelected ? 2.5 : 0)}
                  textAnchor="middle"
                  fill={isSelected ? "#fff" : "var(--muted)"}
                  fontSize="9.5px"
                  fontWeight={isSelected ? "bold" : "500"}
                  style={{ userSelect: "none" }}
                >
                  {p.municipio}
                </text>
              </g>
            );
          })}

          {/* Center node - Base */}
          <circle cx="200" cy="200" r="11" fill="var(--green)" stroke="var(--bg)" strokeWidth="2.5" />
          <circle cx="200" cy="200" r="18" fill="none" stroke="var(--green)" strokeWidth="1" strokeDasharray="2 2" className="pulse-slow" />
          <text
            x="200"
            y="222"
            textAnchor="middle"
            fill="var(--green)"
            fontSize="10px"
            fontWeight="bold"
            style={{ userSelect: "none" }}
          >
            {baseName}
          </text>
        </svg>
      </div>

      {/* Tooltip flutuante */}
      {hovered && tooltipPos && (
        <div
          className="radarTooltip"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`
          }}
        >
          <strong>📍 {hovered.municipio}</strong>
          <span>{hovered.distKm.toFixed(1)} km de distância</span>
          <span>{hovered.produtosZeradosEmComum} itens em comum (ambos zerados)</span>
        </div>
      )}

      <div className="mapLegend">
        <span><i className="dot green" /> {baseName} (Base)</span>
        <span><i className="dot cyan" /> Candidato a Compra Conjunta</span>
      </div>
    </div>
  );
}

function ParceriaRegionalView() {
  const { regionalPartners, dashboard } = useMunicipality();
  const [tab, setTab] = useState<"municipio" | "produto">("municipio");
  const [query, setQuery] = useState("");
  const [selectedPartner, setSelectedPartner] = useState<RegionalPartner | null>(
    regionalPartners.parceiros[0] || null
  );
  
  const [oficioText, setOficioText] = useState<string | null>(null);
  const [justifiedProduct, setJustifiedProduct] = useState<string | null>(null);
  const [isLegalModalOpen, setIsLegalModalOpen] = useState(false);

  // Totais
  const totalPartners = regionalPartners.meta.totalMunicipiosParceiros;
  
  // Total de oportunidades unicas produto x municipio
  const totalOpportunities = useMemo(() => {
    return regionalPartners.parceiros.reduce((sum, p) => sum + p.produtos.length, 0);
  }, [regionalPartners]);

  const bestPartner = useMemo(() => {
    return regionalPartners.parceiros[0] || null;
  }, [regionalPartners]);

  // Filter partners
  const filteredPartners = useMemo(() => {
    return regionalPartners.parceiros
      .filter((p) => p.municipio.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.produtosZeradosEmComum - a.produtosZeradosEmComum);
  }, [query, regionalPartners]);

  // Product-centric index
  const productsMap = useMemo(() => {
    const map: Record<string, { product: string; code: string; partners: Array<{ name: string; dist: number }> }> = {};

    regionalPartners.parceiros.forEach((p) => {
      p.produtos.forEach((prod) => {
        const code = prod.catmat;
        if (!map[code]) {
          map[code] = {
            product: prod.produto,
            code,
            partners: []
          };
        }
        map[code].partners.push({
          name: p.municipio,
          dist: p.distKm
        });
      });
    });

    return Object.values(map)
      .map((item) => {
        const sortedP = [...item.partners].sort((a, b) => a.dist - b.dist);
        const bestPartner = sortedP[0];
        return {
          ...item,
          partnersCount: item.partners.length,
          bestPartner
        };
      })
      .sort((a, b) => b.partnersCount - a.partnersCount);
  }, []);

  // Filter products
  const filteredProducts = useMemo(() => {
    return productsMap.filter((p) =>
      `${p.product} ${p.code}`.toLowerCase().includes(query.toLowerCase())
    );
  }, [productsMap, query]);

  // Generate Letter (Ofício)
  function handleGenerateOficio(partner: RegionalPartner, selectedMeds?: PartnerProduct[]) {
    const medsList = selectedMeds && selectedMeds.length > 0 
      ? selectedMeds 
      : partner.produtos.slice(0, 5);

    const text = `OFÍCIO DE CONSULTA OPERACIONAL PARA COMPRA CONJUNTA
----------------------------------------------------------------------
De: Coordenação Municipal de Assistência Farmacêutica
    ${dashboard.meta.municipality} / ${dashboard.meta.state}
Para: Secretaria Municipal de Saúde de ${partner.municipio.toUpperCase()} / ${dashboard.meta.state}
Assunto: Proposta de Aquisição Compartilhada de Medicamentos
Referência Legal: Art. 15 da Lei Federal nº 8.666/1993 (SRP)
                  Lei Federal nº 11.107/2005 (Consórcios Públicos)
                  Portaria MS/GM nº 3.916/1998 (Política Nacional de Medicamentos)

Prezado(a) Gestor(a),

Com o objetivo de promover a racionalização dos recursos públicos e garantir o abastecimento de medicamentos essenciais no âmbito do Sistema Único de Saúde (SUS), identificamos, através de auditoria de dados públicos (posição de estoque BNAFAR de 06/06/2026), que ambos os nossos municípios apresentam ausência de estoque nos mesmos itens listados abaixo.

Esta falta em comum configura uma necessidade regional compartilhada que justifica uma atuação coordenada. Considerando a proximidade de aproximadamente ${partner.distKm.toFixed(1)} km entre nossos municípios, propomos consulta para verificar a viabilidade de:

1. COMPRA CONJUNTA REGIONALIZADA através de consórcios intermunicipais de saúde (Lei Federal nº 11.107/2005) ou licitações compartilhadas, para ganho de escala e redução do preço unitário;
2. ADESÃO COMPARTILHADA A ATA DE REGISTRO DE PREÇOS (SRP) de forma conjunta, conforme faculta a legislação vigente.

Itens prioritários com falta de estoque em comum para planejamento de compra conjunta:
${medsList.map((m) => ` - ${m.produto} (CATMAT: ${m.catmat}) - Estoque ${dashboard.meta.municipality}: 0 | Estoque ${partner.municipio}: 0`).join("\n")}

Certos da atenção que o tema merece para o fortalecimento da nossa rede regional de assistência à saúde e ganho de eficiência nas contratações públicas, aguardamos manifestação de interesse para agendamento de reunião técnica de alinhamento.

Respeitosamente,

__________________________________________________
Gestão de Assistência Farmacêutica
Secretaria Municipal de Saúde
${dashboard.meta.municipality} / ${dashboard.meta.state}`;

    setOficioText(text);
    setJustifiedProduct(`${partner.municipio} - ${medsList.length} itens`);
  }

  function handleProductOficio(productName: string, catmat: string, partnerName: string) {
    const partner = regionalPartners.parceiros.find((p) => p.municipio === partnerName);
    if (!partner) return;
    
    const pProd = partner.produtos.find((p) => p.catmat === catmat);
    if (pProd) {
      handleGenerateOficio(partner, [pProd]);
    }
  }

  async function handleCopy() {
    if (oficioText) {
      await navigator.clipboard?.writeText(oficioText);
    }
  }

  function handleDownload() {
    if (!oficioText || !selectedPartner) return;
    const element = document.createElement("a");
    const file = new Blob([oficioText], { type: "text/plain;charset=utf-8" });
    element.href = URL.createObjectURL(file);
    element.download = `oficio_compra_conjunta_${selectedPartner.municipio.toLowerCase()}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  }

  return (
    <div className="tabContent">
      {/* Zona Superior: Indicadores Simplificados (3 Cards) */}
      <div className="metricsGrid">
        <MetricCard
          tone="red"
          icon={<Boxes size={24} />}
          label={`Produtos Zerados em ${dashboard.meta.municipality}`}
          value={numberFmt.format(regionalPartners.meta.totalProdutosZeradosCG)}
          detail="Medicamentos sem estoque no município"
          footnote={`${dashboard.meta.state} (Raio ${regionalPartners.meta.raioBuscaKm}km)`}
        />
        <MetricCard
          tone="blue"
          icon={<Handshake size={24} />}
          label="Municípios com Mesma Falta"
          value={numberFmt.format(totalPartners)}
          detail={`Candidatos a compra conjunta (raio ${regionalPartners.meta.raioBuscaKm}km)`}
          footnote="Consórcios e SRP"
        />
        <MetricCard
          tone="amber"
          icon={<MapPin size={24} />}
          label="Maior Sobreposição"
          value={bestPartner?.municipio ?? "-"}
          detail={bestPartner ? `${bestPartner.produtosZeradosEmComum} itens em comum · ${bestPartner.distKm.toFixed(1)} km` : ""}
          footnote="Parceiro prioritário"
        />
      </div>

      {/* Modal Base Legal (Acessível via link/badge discreto) */}
      {isLegalModalOpen ? (
        <div className="modalOverlay" onClick={() => setIsLegalModalOpen(false)}>
          <div className="modalContent" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h3>Fundamentação Legal para Parcerias de Compras Conjuntas</h3>
              <button className="closeButton" onClick={() => setIsLegalModalOpen(false)}>×</button>
            </div>
            <div className="modalBody textFlow">
              <h4>1. Lei Federal nº 8.666/1993, Art. 15 (Registro de Preços)</h4>
              <p>
                O Sistema de Registro de Preços (SRP) faculta a outros órgãos públicos municipais a adesão como "caronas" a atas vigentes. Evita a necessidade de abertura de novos processos licitatórios repetitivos para os mesmos itens, gerando ganho de escala e agilidade.
              </p>
              <h4>2. Lei Federal nº 11.107/2005 (Consórcios Públicos)</h4>
              <p>
                Dispõe sobre normas gerais de contratação de consórcios públicos. Municípios limítrofes podem formalizar consórcios intermunicipais de saúde para compras centralizadas de medicamentos. Isso permite a negociação de preços drasticamente menores junto a distribuidores farmacêuticos.
              </p>
              <h4>3. Portaria MS/GM nº 3.916/1998 (Política Nacional de Medicamentos)</h4>
              <p>
                Prevê a organização de aquisições compartilhadas na assistência farmacêutica municipal e estadual, incentivando a cooperação federativa no remanejamento de saldos para combater o desabastecimento local.
              </p>
            </div>
            <div className="modalFooter">
              <button className="primaryButton" onClick={() => setIsLegalModalOpen(false)}>Entendido</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ZONA CENTRAL DE DESTAQUE: RADAR (55%) + DETALHES E OFÍCIO (45%) */}
      <div className="radarHeroGrid">
        {/* Radar SVG (Protagonista) */}
        <SVGRelationMap
          partners={filteredPartners}
          selected={selectedPartner}
          onSelect={setSelectedPartner}
          baseName={dashboard.meta.municipality}
        />

        {/* Painel de Detalhes do Parceiro Selecionado e Gerador de Ofício */}
        <div className="radarDetailsCard">
          {selectedPartner ? (
            <div className="partnerFocusCard">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h3 style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <MapPin size={18} className="text-cyan" />
                    {selectedPartner.municipio}
                  </h3>
                  <p>{selectedPartner.distKm.toFixed(1)} km de distância de {dashboard.meta.municipality}</p>
                </div>
                <button 
                  className="actionButton"
                  onClick={() => setIsLegalModalOpen(true)}
                  style={{ fontSize: "10px", padding: "4px 8px", background: "rgba(255,255,255,0.05)", display: "inline-flex", alignItems: "center", gap: "4px" }}
                >
                  <ShieldCheck size={14} /> Ver Base Legal
                </button>
              </div>

              <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: "600", marginTop: "10px", display: "block" }}>
                Faltas em comum ({selectedPartner.produtosZeradosEmComum} itens zerados em ambos):
              </span>
              <p style={{ fontSize: "11.5px", color: "var(--muted)", margin: "4px 0 10px 0", lineHeight: "1.4" }}>
                Estes itens estão zerados em ambos os municípios. Uma licitação conjunta pode reduzir o custo unitário.
              </p>
              <div className="tableWrap" style={{ maxHeight: "150px", overflowY: "auto", border: "1px solid var(--line)", borderRadius: "8px" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPartner.produtos.slice(0, 20).map((prod) => (
                      <tr key={prod.catmat}>
                        <td><span style={{ fontSize: "11px" }}>{prod.produto}</span></td>
                        <td><span className="severity red" style={{ fontSize: "10px", padding: "2px 6px" }}>Ambos zerados</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                <button
                  className="primaryButton"
                  onClick={() => handleGenerateOficio(selectedPartner)}
                  type="button"
                  style={{ width: "100%" }}
                >
                  <FileText size={16} /> Gerar Ofício para {selectedPartner.municipio}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ color: "var(--muted)", fontSize: "13px", padding: "40px 20px", textAlign: "center" }}>
              Selecione um município no radar para consultar as faltas em comum e gerar o ofício.
            </div>
          )}

          {/* Área do Ofício (Integrado diretamente no fluxo) */}
          {oficioText ? (
            <div className="detailStack" style={{ animation: "fadeIn 0.2s", borderTop: "1px solid var(--line)", paddingTop: "15px", marginTop: "10px" }}>
              <strong style={{ fontSize: "12px" }}>Rascunho do Ofício Administrativo:</strong>
              <textarea
                className="reportText"
                style={{ height: "130px", fontSize: "10.5px", fontFamily: "monospace", marginTop: "8px" }}
                readOnly
                value={oficioText}
              />
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button className="primaryButton" onClick={handleCopy} type="button" style={{ flex: 1, fontSize: "12px", padding: "6px 12px" }}>
                  <Copy size={15} /> Copiar
                </button>
                <button className="primaryButton" onClick={handleDownload} type="button" style={{ flex: 1, backgroundColor: "var(--blue)", fontSize: "12px", padding: "6px 12px" }}>
                  <FileText size={15} /> Baixar .TXT
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ZONA INFERIOR: TABS E LISTAGEM DETALHADA */}
      <div className="tablePanel" style={{ marginTop: "20px" }}>
        <div className="tableHeader">
          <div className="tabBar" style={{ borderBottom: "none", marginBottom: 0, paddingLeft: 0 }}>
            <button
              className={tab === "municipio" ? "tabButton active" : "tabButton"}
              onClick={() => { setTab("municipio"); setQuery(""); }}
              type="button"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <Map size={16} />
              <span>Lista de Municípios ({filteredPartners.length})</span>
            </button>
            <button
              className={tab === "produto" ? "tabButton active" : "tabButton"}
              onClick={() => { setTab("produto"); setQuery(""); }}
              type="button"
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <Boxes size={16} />
              <span>Consulta por Produto ({productsMap.length})</span>
            </button>
          </div>

          <div className="toolbar">
            <label className="searchBox">
              <Search size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === "municipio" ? "Filtrar município..." : "Filtrar medicamento..."}
              />
            </label>
          </div>
        </div>

        {tab === "municipio" ? (
          <div className="parceriaList" style={{ padding: "15px" }}>
            {filteredPartners.slice(0, 50).map((p) => {
              const isSelected = selectedPartner?.cod === p.cod;
              return (
                <div
                  key={p.cod}
                  className={`municipioPartnerCard ${isSelected ? "active" : ""}`}
                  onClick={() => setSelectedPartner(p)}
                >
                  <div className="cardHeader">
                    <h4 style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      <MapPin size={15} className="text-cyan" />
                      {p.municipio}
                    </h4>
                    <span className="distanceTag">{p.distKm.toFixed(0)} km</span>
                  </div>
                  <div className="cardDetails">
                    {p.produtosZeradosEmComum} <span>itens zerados em comum</span>
                  </div>
                  <div className="cardActions" style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <button
                      className="actionButton"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPartner(p);
                        handleGenerateOficio(p);
                      }}
                      type="button"
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                    >
                      Gerar Ofício
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Tab B: Por Produto Simplificado */
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Municípios com Mesmo Zero</th>
                  <th>Parceiro Mais Próximo</th>
                  <th>Distância Mínima</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.slice(0, 100).map((item) => {
                  return (
                    <tr key={item.code}>
                      <td><strong>{item.product}</strong></td>
                      <td>
                        <span className="severity red" style={{ fontSize: "11px" }}>
                          {item.partnersCount} municípios zerados
                        </span>
                      </td>
                      <td>
                        <strong>{item.bestPartner?.name ?? "-"}</strong> 
                      </td>
                      <td>
                        {item.bestPartner ? (
                          <strong>{item.bestPartner.dist.toFixed(0)} km</strong>
                        ) : "-"}
                      </td>
                      <td>
                        <button
                          className="actionButton"
                          onClick={() => {
                            if (item.bestPartner) {
                              handleProductOficio(item.product, item.code, item.bestPartner.name);
                            }
                          }}
                          type="button"
                          style={{ fontSize: "11px", padding: "4px 8px" }}
                        >
                          Consultar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   EXPORT DASHBOARD PRINCIPAL
   ========================================================================== */
export function FarmaDashboard() {
  const [activeView, setActiveView] = useState<ActiveView>("situacao");
  const [selectedUnit, setSelectedUnit] = useState<UnitPoint | null>(null);
  const [investigarTab, setInvestigarTab] = useState<"unidades" | "medicamentos" | "lotes">("unidades");
  const [agirTab, setAgirTab] = useState<"remanejar" | "comprar" | "copiloto">("remanejar");

  const [municipalityList, setMunicipalityList] = useState<MunicipalityIndexEntry[]>([]);
  const [selectedMunicipality, setSelectedMunicipality] = useState<MunicipalityIndexEntry | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [partners, setPartners] = useState<RegionalPartnersPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMunicipalityList()
      .then((list) => {
        setMunicipalityList(list);
        const defaultMun = list.find((m) => m.slug === "campina-grande") || list[0];
        if (defaultMun) {
          handleSelect(defaultMun);
        } else {
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  async function handleSelect(mun: MunicipalityIndexEntry) {
    setLoading(true);
    try {
      const dbData = await loadDashboard(mun.uf, mun.slug);
      const partnersData = await loadRegionalPartners(mun.uf, mun.slug);
      setDashboard(dbData);
      setPartners(partnersData);
      setSelectedMunicipality(mun);
      setSelectedUnit((dbData.unitPoints as UnitPoint[])[0] || null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading || !dashboard || !partners || !selectedMunicipality) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#0d0f12",
        color: "#ffffff",
        fontFamily: "sans-serif"
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            border: "4px solid rgba(255,255,255,0.1)",
            borderLeftColor: "#3b82f6",
            borderRadius: "50%",
            width: "40px",
            height: "40px",
            animation: "spin 1s linear infinite",
            margin: "0 auto 16px"
          }} />
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}} />
          <div>Carregando FarmaCerta...</div>
        </div>
      </div>
    );
  }

  return (
    <MunicipalityContext.Provider value={{
      dashboard,
      regionalPartners: partners,
      slug: selectedMunicipality.slug,
      name: selectedMunicipality.name,
      uf: selectedMunicipality.uf
    }}>
      <main className="appShell" key={selectedMunicipality.slug}>
        <Sidebar activeView={activeView} onChange={setActiveView} />
        <section className="workspace">
          <header className="topbar">
            <div>
              <span className="eyebrow">FarmaCerta</span>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "4px" }}>
                <h1 style={{ margin: 0 }}>Gestão de Saúde Pública ·</h1>
                <select
                  value={selectedMunicipality.slug}
                  onChange={(e) => {
                    const found = municipalityList.find((m) => m.slug === e.target.value);
                    if (found) handleSelect(found);
                  }}
                  style={{
                    backgroundColor: "#161b22",
                    color: "#c9d1d9",
                    border: "1px solid #30363d",
                    borderRadius: "6px",
                    padding: "6px 12px",
                    fontSize: "16px",
                    fontWeight: "bold",
                    outline: "none",
                    cursor: "pointer"
                  }}
                >
                  {municipalityList.map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.name} / {m.uf}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="topActions">
              <span className="sourceBadge">BNAFAR real · {formatDate(dashboard.meta.stockPositionDate)}</span>
              <button className="iconButton" aria-label="Notificações" type="button"><Bell size={20} /></button>
              <div className="avatar">JF</div>
            </div>
          </header>

          {activeView === "situacao" ? (
            <SituacaoAtualView
              onNavigateToInvestigar={(tab) => {
                setInvestigarTab(tab);
                setActiveView("investigar");
              }}
              onNavigateToAgir={(tab) => {
                setAgirTab(tab);
                setActiveView("agir");
              }}
            />
          ) : null}

          {activeView === "investigar" ? (
            <InvestigarView
              activeTab={investigarTab}
              setActiveTab={setInvestigarTab}
              selectedUnit={selectedUnit || (dashboard.unitPoints as UnitPoint[])[0]}
              setSelectedUnit={setSelectedUnit}
            />
          ) : null}

          {activeView === "agir" ? (
            <AgirView
              activeTab={agirTab}
              setActiveTab={setAgirTab}
            />
          ) : null}

          {activeView === "parceria" ? <ParceriaRegionalView /> : null}

          <footer className="dataFooter">
            <ClipboardList size={18} />
            <span>
              Dados reais: BNAFAR posição de estoque, {selectedMunicipality.name}/{selectedMunicipality.uf}. O recorte contém {dashboard.unitPoints.length} unidades/CNES com estoque publicado nesta carga. Preço: BPS 2023-2025; CMED preparada como referência complementar.
            </span>
          </footer>
        </section>
      </main>
    </MunicipalityContext.Provider>
  );
}
