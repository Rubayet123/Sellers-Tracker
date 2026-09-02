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
  Terminal
} from "lucide-react";

interface SellerRecord {
  seller_id: string;
  domain: string;
  name: string;
  seller_type: string;
  first_seen: string;
  last_seen: string;
  removed_on: string;
  date_source: string;
}

interface LastRunMetrics {
  timestamp_utc?: string;
  date?: string;
  total_tracked?: number;
  active_sellers?: number;
  removed_sellers?: number;
  live_feed_count?: number;
  new_today?: number;
  removed_today?: number;
  reactivated_today?: number;
}

export default function App() {
  const [data, setData] = useState<SellerRecord[]>([]);
  const [metrics, setMetrics] = useState<LastRunMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sellerType, setSellerType] = useState("ALL");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "domain-asc" | "domain-desc">("newest");
  const [showRemoved, setShowRemoved] = useState(false);
  const [showPretracking, setShowPretracking] = useState(false);
  const [filterYear, setFilterYear] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"viewer" | "repo_guide">("viewer");
  const pageSize = 50;

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        // Load data from docs/sellers.csv
        const resp = await fetch("/docs/sellers.csv");
        const csvText = await resp.text();
        
        // Simple fast CSV line parsing
        const lines = csvText.split("\n");
        const parsed: SellerRecord[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          // Split respecting basic CSV commas
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

          if (parts.length >= 8) {
            parsed.push({
              seller_id: parts[0],
              domain: parts[1],
              name: parts[2],
              seller_type: parts[3] || "PUBLISHER",
              first_seen: parts[4],
              last_seen: parts[5],
              removed_on: parts[6],
              date_source: parts[7]
            });
          }
        }
        setData(parsed);

        // Load metrics if available
        try {
          const metResp = await fetch("/data/last_run.json");
          if (metResp.ok) {
            const metJson = await metResp.json();
            setMetrics(metJson);
          }
        } catch {
          // fallback
        }
      } catch (err) {
        console.error("Failed to load sellers CSV:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const stats = useMemo(() => {
    let active = 0;
    let removed = 0;
    let pretracking = 0;
    let recent = 0;
    
    data.forEach(item => {
      if (item.removed_on === "pre-tracking") {
        pretracking++;
      } else if (item.removed_on) {
        removed++;
      } else {
        active++;
        if (item.first_seen >= "2026-01-01") {
          recent++;
        }
      }
    });

    return {
      total: data.length,
      active,
      removed,
      pretracking,
      recent
    };
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    
    return data.filter(item => {
      // Status filter
      if (item.removed_on === "pre-tracking") {
        if (!showPretracking) return false;
      } else if (item.removed_on) {
        if (!showRemoved) return false;
      }

      // Year filter
      if (filterYear !== "ALL") {
        if (!item.first_seen.startsWith(filterYear)) return false;
      }

      // Seller Type
      if (sellerType !== "ALL" && item.seller_type !== sellerType) {
        return false;
      }

      // Search Query
      if (q) {
        const matchDomain = item.domain.toLowerCase().includes(q);
        const matchName = item.name.toLowerCase().includes(q);
        const matchId = item.seller_id.toLowerCase().includes(q);
        if (!matchDomain && !matchName && !matchId) return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === "newest") {
        return b.first_seen.localeCompare(a.first_seen) || a.domain.localeCompare(b.domain);
      }
      if (sortBy === "oldest") {
        return a.first_seen.localeCompare(b.first_seen) || a.domain.localeCompare(b.domain);
      }
      if (sortBy === "domain-asc") {
        return a.domain.localeCompare(b.domain);
      }
      if (sortBy === "domain-desc") {
        return b.domain.localeCompare(a.domain);
      }
      return 0;
    });
  }, [data, search, sellerType, sortBy, showRemoved, showPretracking, filterYear]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage]);

  const handleExport = () => {
    const headers = "seller_id,domain,name,seller_type,first_seen,last_seen,removed_on,date_source\n";
    const rows = filtered.map(r => 
      `"${r.seller_id}","${r.domain}","${r.name.replace(/"/g, '""')}","${r.seller_type}","${r.first_seen}","${r.last_seen}","${r.removed_on}","${r.date_source}"`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `journey_sellers_filtered_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-200 font-sans flex flex-col selection:bg-cyan-500/20 selection:text-cyan-300">
      
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-[#0c1220]/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-cyan-950/80 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-mono font-bold text-sm shadow-inner">
              MV
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-slate-100 text-base tracking-tight">Mediavine Journey Sellers Tracker</h1>
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-cyan-950 text-cyan-400 border border-cyan-800/60 rounded">
                  STATIC &bull; SERVERLESS
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Daily diff tracker for <a href="https://sellers.journeymv.com/sellers.json" target="_blank" rel="noreferrer" className="text-cyan-400/80 hover:underline">sellers.journeymv.com/sellers.json</a>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("viewer")}
              className={`px-3 py-1.5 rounded text-xs font-medium transition flex items-center gap-1.5 ${activeTab === "viewer" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"}`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Data Viewer</span>
            </button>
            <button
              onClick={() => setActiveTab("repo_guide")}
              className={`px-3 py-1.5 rounded text-xs font-medium transition flex items-center gap-1.5 ${activeTab === "repo_guide" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"}`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>GitHub Setup Guide</span>
            </button>
          </div>
        </div>
      </header>

      {/* Metrics Row */}
      <section className="border-b border-slate-800/80 bg-[#0a0f1c]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div className="bg-[#0e1628] border border-slate-800/90 px-3 py-2 rounded-md">
            <div className="text-slate-400 text-[11px]">Active Journey Sites</div>
            <div className="text-emerald-400 text-base font-bold mt-0.5">{stats.active.toLocaleString()}</div>
          </div>
          <div className="bg-[#0e1628] border border-slate-800/90 px-3 py-2 rounded-md">
            <div className="text-slate-400 text-[11px]">Added (2026)</div>
            <div className="text-cyan-400 text-base font-bold mt-0.5">+{stats.recent.toLocaleString()}</div>
          </div>
          <div className="bg-[#0e1628] border border-slate-800/90 px-3 py-2 rounded-md">
            <div className="text-slate-400 text-[11px]">Historical Legacy (Pre-Track)</div>
            <div className="text-amber-400 text-base font-bold mt-0.5">{stats.pretracking.toLocaleString()}</div>
          </div>
          <div className="bg-[#0e1628] border border-slate-800/90 px-3 py-2 rounded-md">
            <div className="text-slate-400 text-[11px]">Total Tracked Records</div>
            <div className="text-slate-100 text-base font-bold mt-0.5">{stats.total.toLocaleString()}</div>
          </div>
        </div>
      </section>

      {/* Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-4">
        {activeTab === "repo_guide" ? (
          <div className="space-y-6">
            <div className="bg-[#0d1424] border border-slate-800 rounded-lg p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-cyan-400" />
                Repository Structure &amp; GitHub Setup Instructions
              </h2>
              <p className="text-sm text-slate-300">
                All repo files (<code className="text-cyan-300 font-mono bg-slate-900 px-1.5 py-0.5 rounded">.github/workflows/update-sellers.yml</code>, <code className="text-cyan-300 font-mono bg-slate-900 px-1.5 py-0.5 rounded">scripts/</code>, <code className="text-cyan-300 font-mono bg-slate-900 px-1.5 py-0.5 rounded">data/</code>, and <code className="text-cyan-300 font-mono bg-slate-900 px-1.5 py-0.5 rounded">docs/</code>) have been created and initialized with the historical seed dataset.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="bg-[#080c14] border border-slate-800 p-4 rounded-md space-y-2">
                  <div className="text-cyan-400 font-semibold text-sm">1. Push to your GitHub Repo</div>
                  <pre className="text-slate-300 overflow-x-auto p-2 bg-slate-950 rounded">
{`git init
git add .
git commit -m "feat: setup mediavine journey sellers tracker"
git branch -M main
git remote add origin https://github.com/<YOUR_USER>/<REPO>.git
git push -u origin main`}
                  </pre>
                </div>

                <div className="bg-[#080c14] border border-slate-800 p-4 rounded-md space-y-2">
                  <div className="text-emerald-400 font-semibold text-sm">2. GitHub Actions Permissions</div>
                  <p className="text-slate-400 font-sans text-xs">
                    In your GitHub repo: Go to <strong>Settings</strong> &rarr; <strong>Actions</strong> &rarr; <strong>General</strong> &rarr; <strong>Workflow permissions</strong> &rarr; select <strong>Read and write permissions</strong>.
                  </p>
                </div>

                <div className="bg-[#080c14] border border-slate-800 p-4 rounded-md space-y-2">
                  <div className="text-amber-400 font-semibold text-sm">3. Enable GitHub Pages</div>
                  <p className="text-slate-400 font-sans text-xs">
                    Go to <strong>Settings</strong> &rarr; <strong>Pages</strong> &rarr; Source: <strong>Deploy from a branch</strong> &rarr; Branch: <strong>main</strong> &rarr; Folder: <strong>/docs</strong>.
                  </p>
                </div>

                <div className="bg-[#080c14] border border-slate-800 p-4 rounded-md space-y-2">
                  <div className="text-purple-400 font-semibold text-sm">4. Automated Daily Sync</div>
                  <p className="text-slate-400 font-sans text-xs">
                    Workflow runs every day at <strong>07:00 UTC</strong>. Python script diffs feed against <code className="text-slate-200">data/sellers.csv</code> and commits updates only if changed.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Filter & Search Controls */}
            <div className="bg-[#0d1424] border border-slate-800 rounded-lg p-4 space-y-3.5 shadow-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
                {/* Search Bar */}
                <div className="lg:col-span-5 relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                    placeholder="Search by domain, publisher name, or seller ID..."
                    className="w-full bg-[#080c14] border border-slate-700/80 rounded-md pl-9 pr-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500/70 focus:ring-1 focus:ring-cyan-500/50 font-mono"
                  />
                  {search && (
                    <button 
                      onClick={() => setSearch("")}
                      className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-200"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Seller Type */}
                <div className="lg:col-span-3">
                  <select
                    value={sellerType}
                    onChange={(e) => { setSellerType(e.target.value); setCurrentPage(1); }}
                    className="w-full bg-[#080c14] border border-slate-700/80 rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/70 font-mono"
                  >
                    <option value="ALL">All Seller Types</option>
                    <option value="PUBLISHER">PUBLISHER only</option>
                    <option value="INTERMEDIARY">INTERMEDIARY only</option>
                    <option value="BOTH">BOTH only</option>
                  </select>
                </div>

                {/* Sort dropdown */}
                <div className="lg:col-span-4">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="w-full bg-[#080c14] border border-slate-700/80 rounded-md px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/70 font-mono"
                  >
                    <option value="newest">Sort: First Seen (Newest First)</option>
                    <option value="oldest">Sort: First Seen (Oldest First)</option>
                    <option value="domain-asc">Sort: Domain (A &rarr; Z)</option>
                    <option value="domain-desc">Sort: Domain (Z &rarr; A)</option>
                  </select>
                </div>
              </div>

              {/* Toggles & Actions */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-2.5 border-t border-slate-800/80 text-xs text-slate-400">
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300 hover:text-slate-100">
                    <input 
                      type="checkbox" 
                      checked={showRemoved} 
                      onChange={(e) => { setShowRemoved(e.target.checked); setCurrentPage(1); }}
                      className="rounded bg-slate-900 border-slate-700 text-rose-500" 
                    />
                    <span>Show Removed</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none text-slate-300 hover:text-slate-100">
                    <input 
                      type="checkbox" 
                      checked={showPretracking} 
                      onChange={(e) => { setShowPretracking(e.target.checked); setCurrentPage(1); }}
                      className="rounded bg-slate-900 border-slate-700 text-amber-500" 
                    />
                    <span>Show Pre-tracking Legacy</span>
                  </label>
                  <div className="flex items-center gap-1.5 pl-2 border-l border-slate-800">
                    <span className="text-slate-400">Year:</span>
                    <select
                      value={filterYear}
                      onChange={(e) => { setFilterYear(e.target.value); setCurrentPage(1); }}
                      className="bg-[#080c14] border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                    >
                      <option value="ALL">All Years</option>
                      <option value="2026">2026</option>
                      <option value="2025">2025</option>
                      <option value="2024">2024</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-mono text-slate-400">
                    {filtered.length.toLocaleString()} matching records
                  </span>
                  <button
                    onClick={handleExport}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded font-mono text-xs flex items-center gap-1.5 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-[#0c1220] border border-slate-800 rounded-lg overflow-hidden shadow">
              <div className="overflow-x-auto min-h-[380px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-[#080d18] text-slate-400 uppercase tracking-wider font-semibold font-mono">
                      <th className="py-3 px-3 w-12 text-center">#</th>
                      <th className="py-3 px-4 min-w-[220px]">Domain</th>
                      <th className="py-3 px-4 min-w-[200px]">Publisher Name</th>
                      <th className="py-3 px-3 w-28">Type</th>
                      <th className="py-3 px-3 w-28 font-mono">Seller ID</th>
                      <th className="py-3 px-3 w-32 font-mono">First Seen</th>
                      <th className="py-3 px-3 w-32 font-mono">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-slate-400 font-sans">
                          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-cyan-400" />
                          Loading tracking dataset...
                        </td>
                      </tr>
                    ) : currentRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-slate-500 font-sans">
                          No matching records found for the specified filters.
                        </td>
                      </tr>
                    ) : (
                      currentRows.map((item, idx) => {
                        const rowNum = (currentPage - 1) * pageSize + idx + 1;
                        const isPretracking = item.removed_on === "pre-tracking";
                        const isRemoved = Boolean(item.removed_on && !isPretracking);

                        return (
                          <tr key={`${item.seller_id}-${idx}`} className="hover:bg-slate-800/40 transition-colors group">
                            <td className="py-2.5 px-3 text-center text-slate-500 text-[11px]">{rowNum}</td>
                            <td className="py-2.5 px-4 font-mono">
                              <div className="flex items-center flex-wrap gap-y-1">
                                <a
                                  href={item.domain.startsWith("http") ? item.domain : `https://${item.domain}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-cyan-400 hover:text-cyan-300 hover:underline inline-flex items-center gap-1 group-hover:text-cyan-300"
                                >
                                  <span>{item.domain}</span>
                                  <ExternalLink className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                                </a>

                                {isPretracking && (
                                  <span className="inline-block px-1.5 py-0.2 text-[10px] bg-amber-950/70 text-amber-300 border border-amber-800/60 rounded ml-1.5 font-sans font-medium">
                                    pre-tracking
                                  </span>
                                )}
                                {isRemoved && (
                                  <span className="inline-block px-1.5 py-0.2 text-[10px] bg-rose-950/70 text-rose-300 border border-rose-800/60 rounded ml-1.5 font-sans font-medium">
                                    removed
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-slate-300 font-sans text-xs truncate max-w-[260px]" title={item.name}>
                              {item.name || "—"}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-xs text-slate-400">
                              <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px]">
                                {item.seller_type}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-400 text-xs truncate max-w-[120px]" title={item.seller_id}>
                              {item.seller_id}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-200 text-xs whitespace-nowrap">
                              {item.first_seen}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                              {isPretracking ? (
                                <span className="text-amber-400">Pre-tracking</span>
                              ) : isRemoved ? (
                                <span className="text-rose-400">Left {item.removed_on}</span>
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
              <div className="border-t border-slate-800/90 px-4 py-3 bg-[#080d18] flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-slate-400">
                <div className="flex items-center gap-2">
                  <span>Page</span>
                  <span className="text-slate-200 font-bold">{currentPage}</span>
                  <span>of</span>
                  <span className="text-slate-200 font-bold">{totalPages}</span>
                  <span className="text-slate-600">|</span>
                  <span>{filtered.length.toLocaleString()} items</span>
                </div>

                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => setCurrentPage(1)} 
                    disabled={currentPage === 1}
                    className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="First page"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} 
                    disabled={currentPage === 1}
                    className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <button 
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} 
                    disabled={currentPage === totalPages}
                    className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => setCurrentPage(totalPages)} 
                    disabled={currentPage === totalPages}
                    className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Last page"
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-[#070a12] mt-auto py-5 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            Data sourced directly from Mediavine Journey <a href="https://sellers.journeymv.com/sellers.json" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline font-mono">sellers.json</a>
          </div>
          <div className="flex items-center gap-4">
            <span>Zero Server Maintenance</span>
            <span>&bull;</span>
            <span>GitHub Actions &amp; Pages Architecture</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
