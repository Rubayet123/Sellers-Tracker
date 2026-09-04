import React, { useState, useEffect, useMemo } from "react";
import { 
  Search, 
  ExternalLink, 
  RefreshCw, 
  Calendar, 
  Globe, 
  CheckCircle2, 
  XCircle, 
  Database, 
  FileText, 
  Layers, 
  Download, 
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  ArrowUpDown,
  Sparkles,
  GitBranch,
  Terminal,
  GraduationCap,
  Crown,
  Rocket,
  Copy,
  Check,
  Building2,
  X,
  RotateCcw
} from "lucide-react";

interface SellerRecord {
  seller_id: string;
  domain: string;
  name: string;
  seller_type: string;
  network: string;
  first_seen: string;
  last_seen: string;
  removed_on: string;
  date_source: string;
  journey_seller_id?: string;
  mediavine_seller_id?: string;
  raptive_seller_id?: string;
  status_details?: string;
}

interface LastRunMetrics {
  timestamp_utc?: string;
  date?: string;
  total_tracked_ecosystem?: number;
  active_ecosystem?: number;
  graduated_count?: number;
  journey_to_raptive_count?: number;
  dual_active_count?: number;
  raptive_tracked_count?: number;
  journey?: {
    total_tracked: number;
    active_sellers: number;
    removed_sellers: number;
    new_today: number;
  };
  mediavine_core?: {
    total_tracked: number;
    active_sellers: number;
    removed_sellers: number;
    new_today: number;
  };
  raptive?: {
    total_tracked: number;
    active_sellers: number;
    removed_sellers: number;
    new_today: number;
  };
}

export interface MigrationInfo {
  type: "j_to_m" | "j_to_r" | "m_to_r" | "r_to_m";
  from: string;
  to: string;
  label: string;
  badgeClass: string;
  tooltip: string;
}

export function getMigrationInfo(r: SellerRecord): MigrationInfo | null {
  const details = (r.status_details || "").toLowerCase();
  const net = (r.network || "").toUpperCase();

  // 1. Journey -> Mediavine Premier (Graduated)
  if (
    details.includes("graduated from journey to mediavine") ||
    details.includes("journey to mediavine") ||
    net === "GRADUATED" ||
    (r.journey_seller_id && r.mediavine_seller_id && !r.removed_on && (net.includes("MEDIAVINE") || details.includes("premier joined")))
  ) {
    return {
      type: "j_to_m",
      from: "Journey",
      to: "Mediavine",
      label: "Journey → Mediavine",
      badgeClass: "bg-amber-950/90 text-amber-300 border-amber-800/90",
      tooltip: r.status_details || "Graduated from Journey to Mediavine Premier"
    };
  }

  // 2. Journey -> Raptive (Migrated)
  if (
    details.includes("migrated from journey to raptive") ||
    details.includes("journey to raptive") ||
    (r.journey_seller_id && r.raptive_seller_id && !r.removed_on && (net.includes("RAPTIVE") || details.includes("raptive joined")))
  ) {
    return {
      type: "j_to_r",
      from: "Journey",
      to: "Raptive",
      label: "Journey → Raptive",
      badgeClass: "bg-fuchsia-950/90 text-fuchsia-300 border-fuchsia-800/90",
      tooltip: r.status_details || "Migrated from Journey to Raptive"
    };
  }

  // 3. Mediavine -> Raptive
  if (details.includes("mediavine premier to raptive") || details.includes("mediavine to raptive")) {
    return {
      type: "m_to_r",
      from: "Mediavine",
      to: "Raptive",
      label: "Mediavine → Raptive",
      badgeClass: "bg-rose-950/90 text-rose-300 border-rose-800/90",
      tooltip: r.status_details || "Migrated from Mediavine Premier to Raptive"
    };
  }

  // 4. Raptive -> Mediavine
  if (details.includes("raptive to mediavine")) {
    return {
      type: "r_to_m",
      from: "Raptive",
      to: "Mediavine",
      label: "Raptive → Mediavine",
      badgeClass: "bg-emerald-950/90 text-emerald-300 border-emerald-800/90",
      tooltip: r.status_details || "Migrated from Raptive to Mediavine Premier"
    };
  }

  return null;
}

export default function App() {
  const [data, setData] = useState<SellerRecord[]>([]);
  const [metrics, setMetrics] = useState<LastRunMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeNetwork, setActiveNetwork] = useState<"ALL" | "JOURNEY" | "MEDIAVINE_CORE" | "RAPTIVE" | "GRADUATED" | "CROSS_NETWORK">("ALL");
  const [sellerType, setSellerType] = useState("ALL");
  const [filterTld, setFilterTld] = useState("ALL");
  const [sortKey, setSortKey] = useState<"first_seen" | "domain" | "name" | "network" | "seller_type" | "seller_id" | "status">("first_seen");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [showRemoved, setShowRemoved] = useState(false);
  const [showPretracking, setShowPretracking] = useState(false);
  const [exactMatch, setExactMatch] = useState(false);
  const [activePreset, setActivePreset] = useState<"all" | "active" | "new7d" | "y2026" | "multi" | "churned" | "j_to_m" | "j_to_r" | "all_migrations">("all");
  const [entityFilter, setEntityFilter] = useState<{ type: "name" | "seller_id"; value: string } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [activeTab, setActiveTab] = useState<"viewer" | "repo_guide">("viewer");
  const [copiedDomain, setCopiedDomain] = useState<string | null>(null);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState("");
  const [bulkResults, setBulkResults] = useState<{ domain: string; status: "found" | "not_found"; record?: SellerRecord }[] | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        // Load data from sellers.csv (or docs/sellers.csv)
        let csvText = "";
        try {
          const resp = await fetch("/sellers.csv");
          if (resp.ok) csvText = await resp.text();
        } catch {
          // fallback
        }

        if (!csvText) {
          const resp = await fetch("/docs/sellers.csv");
          csvText = await resp.text();
        }
        
        // Fast CSV line parsing
        const lines = csvText.split("\n");
        const parsed: SellerRecord[] = [];
        
        // Header detection
        const header = lines[0] ? lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, "")) : [];
        const isUnified = header.includes("network") || header[3] === "network";

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const parts: string[] = [];
          let insideQuotes = false;
          let currentStr = "";
          
          for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
              insideQuotes = !insideQuotes;
            } else if (char === ',' && !insideQuotes) {
              parts.push(currentStr.trim());
              currentStr = "";
            } else {
              currentStr += char;
            }
          }
          parts.push(currentStr.trim());

          if (isUnified && parts.length >= 7) {
            // domain, name, seller_type, network, first_seen, last_seen, removed_on, seller_id, journey_seller_id, mediavine_seller_id, raptive_seller_id, date_source, status_details
            parsed.push({
              domain: parts[0],
              name: parts[1],
              seller_type: parts[2] || "PUBLISHER",
              network: parts[3] || "JOURNEY",
              first_seen: parts[4],
              last_seen: parts[5],
              removed_on: parts[6],
              seller_id: parts[7] || "",
              journey_seller_id: parts[8] || "",
              mediavine_seller_id: parts[9] || "",
              raptive_seller_id: parts[10] || "",
              date_source: parts[11] || "tracker",
              status_details: parts[12] || ""
            });
          } else if (parts.length >= 7) {
            // Legacy schema: seller_id, domain, name, seller_type, first_seen, last_seen, removed_on, date_source
            parsed.push({
              seller_id: parts[0],
              domain: parts[1],
              name: parts[2],
              seller_type: parts[3] || "PUBLISHER",
              network: "JOURNEY",
              first_seen: parts[4],
              last_seen: parts[5],
              removed_on: parts[6],
              date_source: parts[7] || "tracker"
            });
          }
        }
        setData(parsed);

        // Load metrics
        try {
          const metResp = await fetch("/data/last_run.json");
          if (metResp.ok) {
            const metJson = await metResp.json();
            setMetrics(metJson);
          }
        } catch {
          // metrics fallback
        }
      } catch (err) {
        console.error("Error loading CSV feed:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  // Compute Network counts
  const networkCounts = useMemo(() => {
    let journey = 0;
    let core = 0;
    let raptive = 0;
    let j_to_m = 0;
    let j_to_r = 0;
    let cross = 0;
    data.forEach(r => {
      const net = (r.network || "JOURNEY").toUpperCase();
      const mig = getMigrationInfo(r);

      if (net.includes("JOURNEY") || net === "BOTH") journey++;
      if (net.includes("MEDIAVINE_CORE") || net === "BOTH" || net === "GRADUATED") core++;
      if (net.includes("RAPTIVE") || net.includes("ADTHRIVE")) raptive++;
      if (mig?.type === "j_to_m") j_to_m++;
      if (mig?.type === "j_to_r") j_to_r++;
      if (net === "BOTH" || net.includes(",")) cross++;
    });
    return { all: data.length, journey, core, raptive, j_to_m, j_to_r, cross, grad: j_to_m };
  }, [data]);

  // Compute publisher frequency for multi-domain filter
  const publisherCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(r => {
      const n = (r.name || "").trim().toLowerCase();
      if (n) counts[n] = (counts[n] || 0) + 1;
    });
    return counts;
  }, [data]);

  // Overall Statistics (Dynamically scoped to selected network)
  const stats = useMemo(() => {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const cutoffStr = oneWeekAgo.toISOString().split("T")[0];

    const scoped = data.filter(r => {
      const net = (r.network || "JOURNEY").toUpperCase();
      const mig = getMigrationInfo(r);

      if (activeNetwork === "JOURNEY") return net.includes("JOURNEY") || net === "BOTH";
      if (activeNetwork === "MEDIAVINE_CORE") return net.includes("MEDIAVINE_CORE") || net === "BOTH" || net === "GRADUATED";
      if (activeNetwork === "RAPTIVE") return net.includes("RAPTIVE") || net.includes("ADTHRIVE");
      if (activeNetwork === "GRADUATED") return mig?.type === "j_to_m" || net === "GRADUATED";
      if (activeNetwork === "CROSS_NETWORK") return net === "BOTH" || net.includes(",");
      return true; // ALL
    });

    const total = scoped.length;
    let active = 0;
    let new7d = 0;

    scoped.forEach(r => {
      const isRemoved = Boolean(r.removed_on);
      if (!isRemoved) {
        active++;
        if (r.first_seen >= cutoffStr) new7d++;
      }
    });

    return { total, active, new7d, graduated: networkCounts.j_to_m, journeyToRaptive: networkCounts.j_to_r };
  }, [data, activeNetwork, networkCounts]);

  // Filter & Sort
  const filteredData = useMemo(() => {
    const q = search.trim().toLowerCase();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const cutoff7d = oneWeekAgo.toISOString().split("T")[0];

    const result = data.filter(r => {
      const domain = (r.domain || "").toLowerCase();
      const name = (r.name || "").toLowerCase();
      const sid = (r.seller_id || "").toLowerCase();
      const jsid = (r.journey_seller_id || "").toLowerCase();
      const msid = (r.mediavine_seller_id || "").toLowerCase();
      const rsid = (r.raptive_seller_id || "").toLowerCase();
      const net = (r.network || "JOURNEY").toUpperCase();
      const removed = (r.removed_on || "").trim();
      const fs = (r.first_seen || "").trim();

      // Network filter
      if (activeNetwork === "JOURNEY") {
        if (!net.includes("JOURNEY") && net !== "BOTH") return false;
      } else if (activeNetwork === "MEDIAVINE_CORE") {
        if (!net.includes("MEDIAVINE_CORE") && net !== "BOTH" && net !== "GRADUATED") return false;
      } else if (activeNetwork === "RAPTIVE") {
        if (!net.includes("RAPTIVE") && !net.includes("ADTHRIVE")) return false;
      } else if (activeNetwork === "GRADUATED") {
        const mig = getMigrationInfo(r);
        if (mig?.type !== "j_to_m" && net !== "GRADUATED") return false;
      } else if (activeNetwork === "CROSS_NETWORK") {
        if (net !== "BOTH" && !net.includes(",")) return false;
      }

      // Entity filter
      if (entityFilter) {
        if (entityFilter.type === "seller_id") {
          const target = entityFilter.value.toLowerCase();
          if (sid !== target && jsid !== target && msid !== target && rsid !== target) return false;
        } else if (entityFilter.type === "name") {
          if ((r.name || "").trim().toLowerCase() !== entityFilter.value.toLowerCase()) return false;
        }
      }

      // Removed filter
      if (removed === "pre-tracking") {
        if (!showPretracking && activePreset !== "churned") return false;
      } else if (removed !== "") {
        if (!showRemoved && activePreset !== "churned") return false;
      }

      // Presets
      if (activePreset === "new7d") {
        if (fs < cutoff7d || removed) return false;
      } else if (activePreset === "y2026") {
        if (!fs.startsWith("2026") || removed) return false;
      } else if (activePreset === "multi") {
        if (!name || (publisherCounts[name] || 0) < 3) return false;
      } else if (activePreset === "active") {
        if (removed) return false;
      } else if (activePreset === "churned") {
        if (!removed) return false;
      } else if (activePreset === "j_to_m") {
        const mig = getMigrationInfo(r);
        if (mig?.type !== "j_to_m") return false;
      } else if (activePreset === "j_to_r") {
        const mig = getMigrationInfo(r);
        if (mig?.type !== "j_to_r") return false;
      } else if (activePreset === "all_migrations") {
        const mig = getMigrationInfo(r);
        if (!mig) return false;
      }

      // Seller Type
      if (sellerType !== "ALL" && r.seller_type !== sellerType) return false;

      // TLD Filter
      if (filterTld !== "ALL") {
        if (filterTld === "OTHER") {
          const known = [".com", ".org", ".net", ".co.uk", ".ca", ".de", ".fr", ".io", ".blog"];
          if (known.some(ext => domain.endsWith(ext))) return false;
        } else {
          if (!domain.endsWith(filterTld)) return false;
        }
      }

      // Search Query
      if (q) {
        if (exactMatch) {
          if (domain !== q && name !== q && sid !== q && jsid !== q && msid !== q && rsid !== q) return false;
        } else {
          if (!domain.includes(q) && !name.includes(q) && !sid.includes(q) && !jsid.includes(q) && !msid.includes(q) && !rsid.includes(q)) {
            return false;
          }
        }
      }

      return true;
    });

    // Sort
    result.sort((a, b) => {
      let aVal = "";
      let bVal = "";

      switch (sortKey) {
        case "domain":
          aVal = a.domain || "";
          bVal = b.domain || "";
          break;
        case "name":
          aVal = a.name || "";
          bVal = b.name || "";
          break;
        case "network":
          aVal = a.network || "";
          bVal = b.network || "";
          break;
        case "seller_type":
          aVal = a.seller_type || "";
          bVal = b.seller_type || "";
          break;
        case "seller_id":
          const aNum = parseInt(a.seller_id, 10);
          const bNum = parseInt(b.seller_id, 10);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return sortDirection === "asc" ? aNum - bNum : bNum - aNum;
          }
          aVal = a.seller_id || "";
          bVal = b.seller_id || "";
          break;
        case "first_seen":
          aVal = a.first_seen || "";
          bVal = b.first_seen || "";
          break;
        case "status":
          aVal = a.removed_on || "active";
          bVal = b.removed_on || "active";
          break;
        default:
          aVal = a.first_seen || "";
          bVal = b.first_seen || "";
      }

      const comp = aVal.localeCompare(bVal);
      return sortDirection === "asc" ? comp : -comp;
    });

    return result;
  }, [data, search, activeNetwork, entityFilter, sellerType, filterTld, showRemoved, showPretracking, exactMatch, activePreset, sortKey, sortDirection, publisherCounts]);

  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));
  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage, pageSize]);

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection(key === "first_seen" ? "desc" : "asc");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedDomain(text);
    setTimeout(() => setCopiedDomain(null), 2000);
  };

  const hasActiveFilters = Boolean(
    entityFilter || 
    search.trim() !== "" || 
    activeNetwork !== "ALL" || 
    activePreset !== "all" || 
    sellerType !== "ALL" || 
    filterTld !== "ALL" || 
    showRemoved || 
    showPretracking || 
    exactMatch
  );

  const handleResetAllFilters = () => {
    setEntityFilter(null);
    setSearch("");
    setActiveNetwork("ALL");
    setActivePreset("all");
    setSellerType("ALL");
    setFilterTld("ALL");
    setShowRemoved(false);
    setShowPretracking(false);
    setExactMatch(false);
    setCurrentPage(1);
  };

  const renderNetworkChips = (net: string, item?: SellerRecord) => {
    const upper = (net || "").toUpperCase();
    const mig = item ? getMigrationInfo(item) : null;

    const chips: React.ReactNode[] = [];
    if (upper.includes("JOURNEY") || upper === "BOTH") {
      chips.push(
        <span key="j" className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-cyan-950/80 text-cyan-300 border border-cyan-800/80 font-semibold" title="Active on Journey by Mediavine">
          Journey
        </span>
      );
    }
    if (upper.includes("MEDIAVINE_CORE") || upper === "BOTH" || upper === "MEDIAVINE" || (upper === "GRADUATED" && !chips.some(c => (c as any)?.key === "mv"))) {
      chips.push(
        <span key="mv" className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-indigo-950/80 text-indigo-300 border border-indigo-800/80 font-semibold" title="Current network: Mediavine Premier">
          Mediavine
        </span>
      );
    }
    if (upper.includes("RAPTIVE") || upper.includes("ADTHRIVE")) {
      chips.push(
        <span key="rap" className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-purple-950/80 text-purple-300 border border-purple-800/80 font-semibold" title="Current network: Raptive (AdThrive)">
          Raptive
        </span>
      );
    }

    if (chips.length === 0) {
      chips.push(
        <span key="fallback" className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-slate-800 text-slate-300 border border-slate-700 font-medium">
          {net || "Journey"}
        </span>
      );
    }

    return (
      <div className="flex flex-col gap-1 items-start">
        <div className="inline-flex items-center gap-1 flex-wrap">{chips}</div>
        {mig && (
          <span 
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border cursor-help ${mig.badgeClass}`}
            title={mig.tooltip}
          >
            {mig.type === "j_to_m" ? "🎓" : "🔀"} {mig.label}
          </span>
        )}
      </div>
    );
  };

  const handleRunBulk = () => {
    if (!bulkInput.trim()) return;
    const rawTokens = bulkInput.split(/[\n,;\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
    const cleaned = rawTokens.map(t => t.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]);
    const unique: string[] = Array.from(new Set(cleaned));

    const domainMap = new Map<string, SellerRecord>();
    data.forEach(r => {
      const d = (r.domain || "").toLowerCase().trim();
      if (d) domainMap.set(d, r);
    });

    const results = unique.map(domain => {
      const match = domainMap.get(domain);
      return {
        domain,
        status: match ? ("found" as const) : ("not_found" as const),
        record: match
      };
    });

    setBulkResults(results);
  };

  const handleExportBulkFound = () => {
    if (!bulkResults) return;
    const found = bulkResults.filter(r => r.status === "found" && r.record);
    if (found.length === 0) return;
    const headers = ["domain", "name", "seller_type", "network", "first_seen", "last_seen", "removed_on", "seller_id", "journey_seller_id", "mediavine_seller_id", "raptive_seller_id"];
    const rows = found.map(item => {
      const r = item.record!;
      return [
        `"${r.domain || ""}"`,
        `"${(r.name || "").replace(/"/g, '""')}"`,
        `"${r.seller_type || ""}"`,
        `"${r.network || ""}"`,
        `"${r.first_seen || ""}"`,
        `"${r.last_seen || ""}"`,
        `"${r.removed_on || ""}"`,
        `"${r.seller_id || ""}"`,
        `"${r.journey_seller_id || ""}"`,
        `"${r.mediavine_seller_id || ""}"`,
        `"${r.raptive_seller_id || ""}"`
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `bulk_checker_found_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportCSV = () => {
    if (filteredData.length === 0) return;
    const headers = ["domain", "name", "seller_type", "network", "first_seen", "last_seen", "removed_on", "seller_id", "journey_seller_id", "mediavine_seller_id", "raptive_seller_id"];
    const rows = filteredData.map(r => [
      `"${r.domain || ""}"`,
      `"${(r.name || "").replace(/"/g, '""')}"`,
      `"${r.seller_type || ""}"`,
      `"${r.network || ""}"`,
      `"${r.first_seen || ""}"`,
      `"${r.last_seen || ""}"`,
      `"${r.removed_on || ""}"`,
      `"${r.seller_id || ""}"`,
      `"${r.journey_seller_id || ""}"`,
      `"${r.mediavine_seller_id || ""}"`,
      `"${r.raptive_seller_id || ""}"`
    ].join(","));

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ecosystem_export_${activeNetwork.toLowerCase()}_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#080c15] text-slate-200 font-sans flex flex-col antialiased selection:bg-cyan-500/20 selection:text-cyan-300">
      
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-[#0b101d]/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-cyan-500/20 to-indigo-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-mono font-bold text-sm shadow-sm">
              MV
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-slate-100 text-base tracking-tight">Ad Network Sellers Ecosystem Tracker</h1>
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 rounded flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  MULTI-FEED
                </span>
              </div>
              <p className="text-xs text-slate-400 font-normal">Tracking Journey, Mediavine Premier & Raptive feeds with graduation and cross-network analysis</p>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="flex items-center gap-2 sm:gap-3 text-xs font-mono flex-wrap">
            <div className="bg-slate-900/90 border border-slate-800/80 px-3 py-1.5 rounded-md flex items-center gap-2 shadow-sm">
              <span className="text-slate-400">Active Sites:</span>
              <span className="text-emerald-400 font-bold">{stats.active.toLocaleString()}</span>
            </div>
            <div 
              onClick={() => { setActiveNetwork("JOURNEY"); setCurrentPage(1); }}
              className="bg-slate-900/90 border border-slate-800/80 px-3 py-1.5 rounded-md flex items-center gap-2 shadow-sm cursor-pointer hover:border-cyan-500/50 transition hidden sm:flex"
              title="Click to view Journey publishers"
            >
              <span className="text-slate-400">Journey:</span>
              <span className="text-cyan-400 font-bold">{networkCounts.journey.toLocaleString()}</span>
            </div>
            <div 
              onClick={() => { setActiveNetwork("MEDIAVINE_CORE"); setCurrentPage(1); }}
              className="bg-slate-900/90 border border-slate-800/80 px-3 py-1.5 rounded-md flex items-center gap-2 shadow-sm cursor-pointer hover:border-indigo-500/50 transition hidden sm:flex"
              title="Click to view Mediavine Premier publishers"
            >
              <span className="text-slate-400">Mediavine:</span>
              <span className="text-indigo-400 font-bold">{networkCounts.core.toLocaleString()}</span>
            </div>
            <div 
              onClick={() => { setActiveNetwork("RAPTIVE"); setCurrentPage(1); }}
              className="bg-slate-900/90 border border-slate-800/80 px-3 py-1.5 rounded-md flex items-center gap-2 shadow-sm cursor-pointer hover:border-purple-500/50 transition hidden sm:flex"
              title="Click to view Raptive publishers"
            >
              <span className="text-slate-400">Raptive:</span>
              <span className="text-purple-400 font-bold">{networkCounts.raptive.toLocaleString()}</span>
            </div>
            <div 
              onClick={() => { setActivePreset("j_to_m"); setActiveNetwork("ALL"); setCurrentPage(1); }}
              className="bg-slate-900/90 border border-slate-800/80 px-3 py-1.5 rounded-md flex items-center gap-2 shadow-sm cursor-pointer hover:border-amber-500/50 transition"
              title="Click to view publishers who graduated from Journey to Mediavine Premier"
            >
              <span className="text-slate-400">J → MV:</span>
              <span className="text-amber-400 font-bold">🎓 {networkCounts.j_to_m.toLocaleString()}</span>
            </div>
            <div 
              onClick={() => { setActivePreset("j_to_r"); setActiveNetwork("ALL"); setCurrentPage(1); }}
              className="bg-slate-900/90 border border-slate-800/80 px-3 py-1.5 rounded-md flex items-center gap-2 shadow-sm cursor-pointer hover:border-fuchsia-500/50 transition hidden md:flex"
              title="Click to view publishers who migrated from Journey to Raptive"
            >
              <span className="text-slate-400">J → Raptive:</span>
              <span className="text-fuchsia-400 font-bold">🔀 {networkCounts.j_to_r.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-4 space-y-4">

        {/* Main Search & Filter Card */}
        <div className="bg-[#0e1526] border border-slate-800 rounded-lg p-4 space-y-3 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
            
            {/* Search Input */}
            <div className="lg:col-span-4 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="w-4 h-4 text-slate-500" />
              </div>
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                placeholder="Search domain, publisher name, or seller ID..."
                className="w-full bg-[#080c14] border border-slate-700/80 rounded-md pl-9 pr-8 py-2 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-slate-200"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Network Dropdown Filter */}
            <div className="lg:col-span-2">
              <select
                value={activeNetwork}
                onChange={e => { setActiveNetwork(e.target.value as typeof activeNetwork); setCurrentPage(1); }}
                className="w-full bg-[#080c14] border border-cyan-700/60 text-cyan-300 font-semibold rounded-md px-3 py-2 text-xs focus:outline-none focus:border-cyan-400 font-mono cursor-pointer"
              >
                <option value="ALL" className="bg-[#080c14] text-slate-200">All Networks ({networkCounts.all.toLocaleString()})</option>
                <option value="JOURNEY" className="bg-[#080c14] text-cyan-300">Journey ({networkCounts.journey.toLocaleString()})</option>
                <option value="MEDIAVINE_CORE" className="bg-[#080c14] text-indigo-300">Mediavine ({networkCounts.core.toLocaleString()})</option>
                <option value="RAPTIVE" className="bg-[#080c14] text-purple-300">Raptive ({networkCounts.raptive.toLocaleString()})</option>
                <option value="CROSS_NETWORK" className="bg-[#080c14] text-emerald-300">Cross-Network ({networkCounts.cross.toLocaleString()})</option>
              </select>
            </div>

            {/* Status / Preset Filter Dropdown */}
            <div className="lg:col-span-2">
              <select
                value={activePreset}
                onChange={e => { setActivePreset(e.target.value as typeof activePreset); setCurrentPage(1); }}
                className="w-full bg-[#080c14] border border-slate-700/80 rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono cursor-pointer"
              >
                <option value="all">All Status Presets</option>
                <option value="active">🟢 Active Sites Only</option>
                <option value="j_to_m">🎓 Journey → Mediavine ({networkCounts.j_to_m.toLocaleString()})</option>
                <option value="j_to_r">🔀 Journey → Raptive ({networkCounts.j_to_r.toLocaleString()})</option>
                <option value="all_migrations">🔁 All Migrations ({(networkCounts.j_to_m + networkCounts.j_to_r).toLocaleString()})</option>
                <option value="new7d">⚡ Added Last 7 Days</option>
                <option value="y2026">📅 2026 Additions</option>
                <option value="multi">🏢 Multi-Domain (3+)</option>
                <option value="churned">🔴 Churned / Removed</option>
              </select>
            </div>

            {/* Seller Type Filter */}
            <div className="lg:col-span-2">
              <select
                value={sellerType}
                onChange={e => { setSellerType(e.target.value); setCurrentPage(1); }}
                className="w-full bg-[#080c14] border border-slate-700/80 rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              >
                <option value="ALL">All Seller Types</option>
                <option value="PUBLISHER">PUBLISHER only</option>
                <option value="INTERMEDIARY">INTERMEDIARY only</option>
                <option value="BOTH">BOTH only</option>
              </select>
            </div>

            {/* TLD Filter */}
            <div className="lg:col-span-2">
              <select
                value={filterTld}
                onChange={e => { setFilterTld(e.target.value); setCurrentPage(1); }}
                className="w-full bg-[#080c14] border border-slate-700/80 rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
              >
                <option value="ALL">All Extensions</option>
                <option value=".com">.com</option>
                <option value=".org">.org</option>
                <option value=".net">.net</option>
                <option value=".co.uk">.co.uk</option>
                <option value=".ca">.ca</option>
                <option value=".de">.de</option>
                <option value=".fr">.fr</option>
                <option value=".io">.io</option>
                <option value=".blog">.blog</option>
                <option value="OTHER">Other extensions</option>
              </select>
            </div>

          </div>

          {/* Secondary Controls & Export */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-300 hover:text-slate-100">
                <input
                  type="checkbox"
                  checked={showRemoved}
                  onChange={e => setShowRemoved(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-rose-500"
                />
                <span>Show Removed</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-300 hover:text-slate-100">
                <input
                  type="checkbox"
                  checked={showPretracking}
                  onChange={e => setShowPretracking(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-amber-500"
                />
                <span>Show Pre-tracking Legacy</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-300 hover:text-slate-100">
                <input
                  type="checkbox"
                  checked={exactMatch}
                  onChange={e => setExactMatch(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-cyan-500"
                />
                <span>Exact Match</span>
              </label>
            </div>

            <div className="flex items-center gap-3 ml-auto flex-wrap">
              <span className="font-mono text-slate-400">{filteredData.length.toLocaleString()} matching records</span>
              <button
                onClick={() => { setIsBulkOpen(true); setBulkResults(null); }}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 rounded font-mono text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer"
              >
                <Search className="w-3.5 h-3.5 text-cyan-400" />
                <span>Bulk Domain Checker</span>
              </button>
              <button
                onClick={handleExportCSV}
                className="px-3 py-1 bg-cyan-700 hover:bg-cyan-600 text-white rounded font-mono text-xs flex items-center gap-1.5 transition shadow-sm font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-cyan-200" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>
        </div>

        {/* Domain Publisher Name Database Table */}
        <div className="bg-[#0c1220] border border-slate-800 rounded-lg overflow-hidden shadow">
          {/* Active Filter Tab & Table Header Bar (Positioned directly above database table) */}
          <div className="bg-[#090f1d] border-b border-slate-800 px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex items-center gap-2 font-mono font-semibold text-slate-200">
                <Database className="w-3.5 h-3.5 text-cyan-400" />
                <span>Domain Publisher Name Database</span>
              </div>

              {hasActiveFilters && (
                <div className="h-4 w-px bg-slate-700 mx-1 hidden sm:block"></div>
              )}

              {/* Entity Filter Tab (Publisher or Seller ID) */}
              {entityFilter && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-cyan-950 border border-cyan-500/80 text-cyan-200 text-xs font-mono shadow-sm">
                  {entityFilter.type === "name" ? (
                    <Building2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  ) : (
                    <span className="text-cyan-400 font-bold">#</span>
                  )}
                  <span className="text-slate-400 font-sans">
                    {entityFilter.type === "name" ? "Publisher:" : "Seller ID:"}
                  </span>
                  <span className="font-semibold text-white truncate max-w-[280px]">
                    "{entityFilter.value}"
                  </span>
                  <button
                    onClick={() => setEntityFilter(null)}
                    className="ml-1 p-0.5 hover:bg-cyan-800/80 rounded text-cyan-300 hover:text-white transition cursor-pointer"
                    title="Remove entity filter"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Search Chip */}
              {search.trim() !== "" && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono">
                  <Search className="w-3 h-3 text-slate-400" />
                  <span className="text-slate-400 font-sans">Search:</span>
                  <span className="font-semibold text-white">"{search}"</span>
                  <button
                    onClick={() => setSearch("")}
                    className="ml-0.5 p-0.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition cursor-pointer"
                    title="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Network Chip */}
              {activeNetwork !== "ALL" && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono">
                  <span className="text-slate-400 font-sans">Network:</span>
                  <span className="font-semibold text-cyan-300">
                    {activeNetwork === "JOURNEY" ? "Journey" :
                     activeNetwork === "MEDIAVINE_CORE" ? "Mediavine Premier" :
                     activeNetwork === "RAPTIVE" ? "Raptive" :
                     activeNetwork === "GRADUATED" ? "Graduated" : "Cross-Network"}
                  </span>
                  <button
                    onClick={() => setActiveNetwork("ALL")}
                    className="ml-0.5 p-0.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition cursor-pointer"
                    title="Reset network filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Preset Chip */}
              {activePreset !== "all" && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono">
                  <span className="text-slate-400 font-sans">Preset:</span>
                  <span className="font-semibold text-amber-300">
                    {activePreset === "active" ? "Active Sites" :
                     activePreset === "j_to_m" ? "🎓 Journey → Mediavine" :
                     activePreset === "j_to_r" ? "🔀 Journey → Raptive" :
                     activePreset === "all_migrations" ? "🔁 All Migrations" :
                     activePreset === "new7d" ? "Added Last 7 Days" :
                     activePreset === "y2026" ? "2026 Additions" :
                     activePreset === "multi" ? "Multi-Domain (3+)" : "Churned / Removed"}
                  </span>
                  <button
                    onClick={() => setActivePreset("all")}
                    className="ml-0.5 p-0.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition cursor-pointer"
                    title="Reset preset filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Seller Type Chip */}
              {sellerType !== "ALL" && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono">
                  <span className="text-slate-400 font-sans">Type:</span>
                  <span className="font-semibold text-slate-200">{sellerType}</span>
                  <button
                    onClick={() => setSellerType("ALL")}
                    className="ml-0.5 p-0.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition cursor-pointer"
                    title="Reset type filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* TLD Chip */}
              {filterTld !== "ALL" && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono">
                  <span className="text-slate-400 font-sans">TLD:</span>
                  <span className="font-semibold text-slate-200">{filterTld}</span>
                  <button
                    onClick={() => setFilterTld("ALL")}
                    className="ml-0.5 p-0.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition cursor-pointer"
                    title="Reset TLD filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Right side: Count & Reset button */}
            <div className="flex items-center gap-3 ml-auto">
              <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                {filteredData.length.toLocaleString()} matching records
              </span>
              {hasActiveFilters && (
                <button
                  onClick={handleResetAllFilters}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-mono flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                  title="Reset all applied filters"
                >
                  <RotateCcw className="w-3 h-3 text-slate-400" />
                  <span>Reset All Filters</span>
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto min-h-[380px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-[#090e1a] text-slate-400 uppercase tracking-wider font-semibold font-mono select-none">
                  <th className="py-3 px-3 w-12 text-center text-slate-500">#</th>
                  
                  <th 
                    onClick={() => handleSort("domain")}
                    className="py-3 px-4 min-w-[210px] cursor-pointer hover:text-slate-100 hover:bg-slate-800/40 transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Domain</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>

                  <th 
                    onClick={() => handleSort("name")}
                    className="py-3 px-4 min-w-[200px] cursor-pointer hover:text-slate-100 hover:bg-slate-800/40 transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Publisher Name</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>

                  <th 
                    onClick={() => handleSort("network")}
                    className="py-3 px-3 w-36 cursor-pointer hover:text-slate-100 hover:bg-slate-800/40 transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Network</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>

                  <th 
                    onClick={() => handleSort("seller_type")}
                    className="py-3 px-3 w-24 cursor-pointer hover:text-slate-100 hover:bg-slate-800/40 transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Type</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>

                  <th 
                    onClick={() => handleSort("seller_id")}
                    className="py-3 px-3 w-28 font-mono cursor-pointer hover:text-slate-100 hover:bg-slate-800/40 transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Seller ID</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>

                  <th 
                    onClick={() => handleSort("first_seen")}
                    className="py-3 px-3 w-28 font-mono cursor-pointer hover:text-slate-100 hover:bg-slate-800/40 transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>First Seen</span>
                      <ArrowUpDown className="w-3 h-3 text-cyan-400" />
                    </div>
                  </th>

                  <th 
                    onClick={() => handleSort("status")}
                    className="py-3 px-3 w-28 font-mono cursor-pointer hover:text-slate-100 hover:bg-slate-800/40 transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Status</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-slate-500 font-sans">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-cyan-500" />
                      <div>Loading Mediavine Ecosystem data...</div>
                    </td>
                  </tr>
                ) : pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-slate-500 font-sans">
                      No matching records found.
                    </td>
                  </tr>
                ) : (
                  pageItems.map((item, idx) => {
                    const rowNum = (currentPage - 1) * pageSize + idx + 1;
                    const domain = item.domain || "—";
                    const name = item.name || "—";
                    const sid = item.seller_id || item.journey_seller_id || item.mediavine_seller_id || item.raptive_seller_id || "—";
                    const sellerType = item.seller_type || "PUBLISHER";
                    const firstSeen = item.first_seen || "—";
                    const removedOn = (item.removed_on || "").trim();
                    const net = (item.network || "JOURNEY").toUpperCase();

                    // Network Badge
                    const networkBadge = renderNetworkChips(net, item);

                    const url = domain.startsWith("http") ? domain : `https://${domain}`;

                    return (
                      <tr key={`${domain}-${sid}-${idx}`} className="hover:bg-slate-800/40 transition-colors group">
                        <td className="py-2.5 px-3 text-center text-slate-500 text-[11px]">{rowNum}</td>
                        
                        {/* Domain */}
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {domain !== "—" ? (
                              <div className="flex items-center gap-1.5">
                                <a 
                                  href={url} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-cyan-400 hover:text-cyan-300 hover:underline inline-flex items-center gap-1 font-semibold"
                                >
                                  <span>{domain}</span>
                                  <ExternalLink className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                                </a>
                                <button
                                  onClick={() => copyToClipboard(domain)}
                                  className="text-slate-500 hover:text-cyan-300 p-0.5 rounded opacity-0 group-hover:opacity-100 transition"
                                  title="Copy domain"
                                >
                                  {copiedDomain === domain ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </div>
                        </td>

                        {/* Publisher Name */}
                        <td className="py-2.5 px-4 text-slate-300 font-sans text-xs truncate max-w-[240px]">
                          {name !== "—" ? (
                            <button
                              onClick={() => {
                                setEntityFilter({ type: "name", value: name });
                                setCurrentPage(1);
                              }}
                              className="text-left hover:text-cyan-300 hover:underline decoration-dotted transition truncate max-w-[220px]"
                              title={`Filter by publisher: ${name}`}
                            >
                              {name}
                            </button>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>

                        {/* Network */}
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col gap-0.5 items-start">
                            {networkBadge}
                            {item.status_details && !getMigrationInfo(item) && (
                              <span
                                className="text-[10px] text-slate-400 font-sans truncate max-w-[210px] cursor-help"
                                title={item.status_details}
                              >
                                {item.status_details}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Seller Type */}
                        <td className="py-2.5 px-3 text-slate-400">
                          <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px]">{sellerType}</span>
                        </td>

                        {/* Seller ID */}
                        <td className="py-2.5 px-3 text-slate-400 text-xs">
                          {sid !== "—" ? (
                            <button
                              onClick={() => {
                                setEntityFilter({ type: "seller_id", value: sid });
                                setCurrentPage(1);
                              }}
                              className="hover:text-cyan-300 hover:underline decoration-dotted transition text-slate-300"
                              title={`Filter by seller ID: ${sid}`}
                            >
                              {sid}
                            </button>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>

                        {/* First Seen */}
                        <td className="py-2.5 px-3 text-slate-200 text-xs whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span>{firstSeen}</span>
                            {item.date_source === "historical_import" && (
                              <span
                                className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono tracking-tight"
                                title="Historical baseline verified date"
                              >
                                hist
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-2.5 px-3 text-[11px] whitespace-nowrap">
                          {removedOn === "pre-tracking" ? (
                            <span className="text-amber-400/90 font-medium">Pre-tracking</span>
                          ) : removedOn ? (
                            <span className="text-rose-400">Left {removedOn}</span>
                          ) : (
                            <span className="text-emerald-400 font-medium">Active</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="border-t border-slate-800/90 px-4 py-3 bg-[#090e1a] flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 text-xs"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={250}>250</option>
                </select>
              </div>
              <span>Page {currentPage} of {totalPages}</span>
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(1)}
                className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
              >
                « First
              </button>
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
              >
                ‹ Prev
              </button>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
              >
                Next ›
              </button>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30"
              >
                Last »
              </button>
            </div>
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-[#070a12] mt-auto py-5 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 font-sans">
          <div className="flex items-center gap-2 flex-wrap">
            <span>Official Feeds:</span>
            <a href="https://sellers.journeymv.com/sellers.json" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline font-mono">sellers.journeymv.com</a>
            <span>•</span>
            <a href="https://www.mediavine.com/sellers.json" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline font-mono">mediavine.com</a>
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px]">
            <span>Serverless Multi-Feed Tracker</span>
            <span>•</span>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300">GitHub Pages & Actions</a>
          </div>
        </div>
      </footer>

      {/* Bulk Domain Checker Modal */}
      {isBulkOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#0e1526] border border-slate-700/80 rounded-xl max-w-2xl w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400 text-sm font-bold font-mono">
                  🔍
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 text-sm">Ecosystem Bulk Domain Checker</h3>
                  <p className="text-xs text-slate-400">Paste up to 500 domain URLs to verify if they are in Journey, Premier, or Graduated</p>
                </div>
              </div>
              <button 
                onClick={() => setIsBulkOpen(false)}
                className="text-slate-400 hover:text-slate-100 text-base font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-300 font-mono">Paste Domains (one per line, or comma separated):</label>
              <textarea
                rows={5}
                value={bulkInput}
                onChange={e => setBulkInput(e.target.value)}
                placeholder={"example.com\nrecipesite.org\nhttps://anotherblog.co.uk"}
                className="w-full bg-[#080c14] border border-slate-700 rounded-md p-3 text-xs text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                onClick={handleRunBulk}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md text-xs font-bold font-mono transition flex items-center gap-1.5 shadow cursor-pointer"
              >
                <span>Check Domains Across Ecosystem</span>
              </button>
              <button
                onClick={() => { setBulkInput(""); setBulkResults(null); }}
                className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                Clear
              </button>
            </div>

            {/* Bulk Results Area */}
            {bulkResults && (
              <div className="space-y-2 pt-2 border-t border-slate-800 max-h-64 overflow-y-auto">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300 font-semibold">
                    Found {bulkResults.filter(r => r.status === "found").length} of {bulkResults.length} queried domains
                  </span>
                  {bulkResults.some(r => r.status === "found") && (
                    <button 
                      onClick={handleExportBulkFound}
                      className="text-cyan-400 hover:underline text-xs cursor-pointer"
                    >
                      Export Found CSV
                    </button>
                  )}
                </div>
                <div className="space-y-1.5 text-xs font-mono">
                  {bulkResults.map((res, i) => (
                    <div 
                      key={i} 
                      className={`p-2 rounded border flex items-center justify-between gap-2 ${
                        res.status === "found" 
                          ? "bg-slate-900/90 border-slate-700" 
                          : "bg-slate-950/60 border-slate-800/60 opacity-60"
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span>{res.status === "found" ? "🟢" : "⚪"}</span>
                        <span className="font-semibold text-slate-200 truncate">{res.domain}</span>
                        {res.record && (
                          <span className="text-[11px] text-slate-400 truncate">
                            ({res.record.name})
                          </span>
                        )}
                      </div>
                      <div>
                        {res.record ? (
                          renderNetworkChips(res.record.network, res.record)
                        ) : (
                          <span className="text-[10px] text-slate-500">Not Found</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
