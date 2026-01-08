const severityOrder = ["critical", "high", "medium", "low", "info"];
const severityNames = {
  critical: "Критичный",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
  info: "Информационный",
};

const state = {
  issues: [],
  filtered: [],
  reportType: "—",
  severityFilters: new Set(severityOrder),
  reportTypeFilters: new Set(["JSON", "SARIF"]),
  dateFrom: null,
  dateTo: null,
  lastFile: null,
  allReports: [],
  currentPage: 1,
  pageSize: 10,
};

// Issues container will be found dynamically based on current view
let issuesContainer = null;
const severityFilterContainer = document.getElementById("severity-filters");
const searchInput = document.getElementById("search");
const severityBar = document.getElementById("severity-bar");
const historyList = document.getElementById("history-list");
const refreshHistoryBtn = document.getElementById("refresh-history");
const uploadBtn = document.getElementById("upload-btn");
const reportView = document.getElementById("report-view");
const reportViewContent = document.getElementById("report-view-content");
const reportViewTitle = document.getElementById("report-view-title");
const backBtn = document.getElementById("back-btn");
const reportDownloadBtn = document.getElementById("report-download-btn");

// Create a hidden file input for upload button
let fileInput = null;

// Status and error handling removed - no longer needed without upload tab

function normalizeSeverity(raw = "info") {
  const value = String(raw).toLowerCase();
  if (value.includes("critical")) return "critical";
  if (value.includes("high")) return "high";
  if (value.includes("error") || value.includes("err")) return "high";
  if (value.includes("warn")) return "medium";
  if (value.includes("medium")) return "medium";
  if (value.includes("low")) return "low";
  if (value.includes("note")) return "info";
  return "info";
}

function isSarif(data) {
  return Boolean(data && Array.isArray(data.runs));
}

function isSemgrep(data) {
  return Boolean(data && Array.isArray(data.results));
}

function parseSarif(data) {
  const issues = [];

  data.runs.forEach((run, runIndex) => {
    const rules = new Map();
    (run.tool?.driver?.rules || []).forEach((rule) => {
      rules.set(rule.id, rule);
    });

    (run.results || []).forEach((result, resultIndex) => {
      const location = result.locations?.[0]?.physicalLocation;
      const region = location?.region || {};
      const rule = rules.get(result.ruleId) || {};

      issues.push({
        id: `sarif-${runIndex}-${resultIndex}`,
        severity: normalizeSeverity(
          result.level ||
            result.properties?.["problem.severity"] ||
            result.partialFingerprints?.["severity/semgrep"] ||
            "info"
        ),
        message: result.message?.text || "Описание отсутствует",
        ruleId: result.ruleId || rule.name || "rule",
        path: location?.artifactLocation?.uri || "—",
        startLine: region.startLine,
        endLine: region.endLine,
        snippet: region.snippet?.text || "",
        tags: rule.properties?.tags || [],
        references: rule.helpUri ? [rule.helpUri] : [],
        source: "SARIF",
        tool: run.tool?.driver?.name || "",
        fingerprint: Object.values(result.partialFingerprints || {}).join(", "),
      });
    });
  });

  return { issues, type: "SARIF" };
}

function parseSemgrep(data) {
  const issues = (data.results || []).map((result, index) => {
    const tags = [];
    const metadata = result.extra?.metadata || {};
    if (Array.isArray(metadata.cwe)) tags.push(...metadata.cwe);
    if (Array.isArray(metadata.owasp)) tags.push(...metadata.owasp);
    if (metadata.category) tags.push(metadata.category);

    return {
      id: `semgrep-${index}`,
      severity: normalizeSeverity(result.extra?.severity || "info"),
      message: result.extra?.message || "Описание отсутствует",
      ruleId: result.check_id || "rule",
      path: result.path || "—",
      startLine: result.start?.line,
      endLine: result.end?.line,
      snippet: result.extra?.lines || "",
      tags,
      references: metadata.references || [],
      source: "Semgrep JSON",
      tool: "Semgrep",
      fingerprint: result.extra?.fingerprint || "",
    };
  });

  return { issues, type: "Semgrep JSON" };
}

function normalizeReport(data) {
  if (isSarif(data)) return parseSarif(data);
  if (isSemgrep(data)) return parseSemgrep(data);
  throw new Error("Не удалось определить формат файла. Ожидается SARIF или Semgrep JSON.");
}

async function handleFile(file) {
  if (!file) return;
  
  // Upload file to server
  const formData = new FormData();
  formData.append("file", file);
  
  try {
    const response = await fetch("/upload", {
      method: "POST",
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || "Не удалось загрузить файл");
    }
    
    // Reload history to show the new report
    await loadHistory();
  } catch (err) {
    console.error(err);
    alert(`Ошибка загрузки: ${err.message}`);
  }
}


async function loadHistory() {
  try {
    const response = await fetch("/reports");
    if (!response.ok) throw new Error("Не удалось получить список отчётов");
    const data = await response.json();
    state.allReports = data.files || [];
    filterHistory();
    // Render aggregate totals if available
    if (data.totals) {
      renderHistoryTotals(data.totals);
    }
  } catch (err) {
    historyList.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

function filterHistory() {
  // Reset to first page when filtering
  state.currentPage = 1;
  
  const filtered = state.allReports.filter((file) => {
    // Filter by report type
    const reportType = file.report_type || "";
    const matchesType = 
      (reportType.includes("JSON") && state.reportTypeFilters.has("JSON")) ||
      (reportType.includes("SARIF") && state.reportTypeFilters.has("SARIF"));
    
    if (!matchesType) return false;
    
    // Filter by severity - show report if it has at least one issue of selected severity
    const severity = file.severity || {};
    const hasSelectedSeverity = severityOrder.some((level) => {
      if (!state.severityFilters.has(level)) return false;
      const count = severity[level] || 0;
      return count > 0;
    });
    
    if (!hasSelectedSeverity) return false;
    
    // Filter by date range
    if (state.dateFrom || state.dateTo) {
      const reportDate = new Date(file.created * 1000);
      reportDate.setHours(0, 0, 0, 0); // Reset time to start of day
      
      if (state.dateFrom) {
        const fromDate = new Date(state.dateFrom);
        fromDate.setHours(0, 0, 0, 0);
        if (reportDate < fromDate) return false;
      }
      
      if (state.dateTo) {
        const toDate = new Date(state.dateTo);
        toDate.setHours(23, 59, 59, 999); // End of day
        if (reportDate > toDate) return false;
      }
    }
    
    return true;
  });
  
  renderHistory(filtered);
}

function downloadPdf() {
  if (!state.filtered.length && !state.issues.length) {
    alert("Сначала загрузите отчёт");
    return;
  }
  document.body.classList.add("print-mode");
  const cleanup = () => {
    document.body.classList.remove("print-mode");
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 0);
}

function renderHistory(files) {
  historyList.innerHTML = "";
  
  // Remove existing pagination if any
  const existingPagination = document.getElementById("pagination");
  if (existingPagination) {
    existingPagination.remove();
  }
  
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Загруженных отчетов пока нет";
    historyList.appendChild(empty);
    return;
  }

  // Calculate pagination
  const totalPages = Math.ceil(files.length / state.pageSize);
  const startIndex = (state.currentPage - 1) * state.pageSize;
  const endIndex = startIndex + state.pageSize;
  const paginatedFiles = files.slice(startIndex, endIndex);

  paginatedFiles.forEach((file) => {
    const item = document.createElement("div");
    item.className = "history-item";

    const info = document.createElement("div");
    const name = document.createElement("div");
    
    // Build informative label with GitLab metadata
    let labelParts = [];
    
    // Add GitLab branch or tag if available
    if (file.git) {
      if (file.git.tag) {
        labelParts.push(`Tag: ${file.git.tag}`);
      }
      if (file.git.branch) {
        labelParts.push(`Branch: ${file.git.branch}`);
      }
      if (file.git.commit) {
        labelParts.push(`Commit: ${file.git.commit.substring(0, 8)}`);
      }
    }
    
    // If no GitLab metadata, just show filename
    if (labelParts.length === 0) {
      name.textContent = file.name;
    } else {
      // Show GitLab info as primary, filename as secondary
      const primaryLabel = document.createElement("div");
      primaryLabel.textContent = labelParts.join(" • ");
      primaryLabel.style.fontWeight = "600";
      
      const secondaryLabel = document.createElement("div");
      secondaryLabel.textContent = file.name;
      secondaryLabel.className = "muted";
      secondaryLabel.style.fontSize = "0.9em";
      secondaryLabel.style.marginTop = "4px";
      
      name.append(primaryLabel, secondaryLabel);
    }
    
    const date = document.createElement("p");
    date.className = "muted";
    const dt = new Date(file.created * 1000);
    date.textContent = dt.toLocaleString();
    info.append(name, date);

    const openBtn = document.createElement("button");
    openBtn.className = "button ghost";
    openBtn.textContent = "Открыть";
    openBtn.addEventListener("click", () => {
      openReport(file.url, file.name);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "button";
    deleteBtn.textContent = "Удалить";
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("Удалить отчёт?")) return;
      const response = await fetch(file.url, { method: "DELETE" });
      if (!response.ok) {
        alert("Не удалось удалить отчёт");
        return;
      }
      await loadHistory();
    });

    item.append(info, openBtn, deleteBtn);
    historyList.appendChild(item);
  });
  
  // Add pagination controls
  if (totalPages > 1) {
    renderPagination(totalPages, files.length);
  }
}

function renderPagination(totalPages, totalItems) {
  const pagination = document.createElement("div");
  pagination.id = "pagination";
  pagination.className = "pagination";
  
  const info = document.createElement("span");
  info.className = "pagination-info";
  const startItem = (state.currentPage - 1) * state.pageSize + 1;
  const endItem = Math.min(state.currentPage * state.pageSize, totalItems);
  info.textContent = `Показано ${startItem}-${endItem} из ${totalItems}`;
  
  const controls = document.createElement("div");
  controls.className = "pagination-controls";
  
  // Previous button
  const prevBtn = document.createElement("button");
  prevBtn.className = "button ghost";
  prevBtn.textContent = "←";
  prevBtn.disabled = state.currentPage === 1;
  prevBtn.addEventListener("click", () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      filterHistory();
    }
  });
  
  // Page numbers
  const pageNumbers = document.createElement("div");
  pageNumbers.className = "page-numbers";
  
  // Show page numbers (max 5 visible)
  const maxVisible = 5;
  let startPage = Math.max(1, state.currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  
  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }
  
  if (startPage > 1) {
    const firstBtn = document.createElement("button");
    firstBtn.className = "button ghost";
    firstBtn.textContent = "1";
    firstBtn.addEventListener("click", () => {
      state.currentPage = 1;
      filterHistory();
    });
    pageNumbers.appendChild(firstBtn);
    
    if (startPage > 2) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "muted";
      ellipsis.textContent = "...";
      pageNumbers.appendChild(ellipsis);
    }
  }
  
  for (let i = startPage; i <= endPage; i++) {
    const pageBtn = document.createElement("button");
    pageBtn.className = "button ghost";
    pageBtn.textContent = i.toString();
    if (i === state.currentPage) {
      pageBtn.classList.add("active");
    }
    pageBtn.addEventListener("click", () => {
      state.currentPage = i;
      filterHistory();
    });
    pageNumbers.appendChild(pageBtn);
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "muted";
      ellipsis.textContent = "...";
      pageNumbers.appendChild(ellipsis);
    }
    
    const lastBtn = document.createElement("button");
    lastBtn.className = "button ghost";
    lastBtn.textContent = totalPages.toString();
    lastBtn.addEventListener("click", () => {
      state.currentPage = totalPages;
      filterHistory();
    });
    pageNumbers.appendChild(lastBtn);
  }
  
  // Next button
  const nextBtn = document.createElement("button");
  nextBtn.className = "button ghost";
  nextBtn.textContent = "→";
  nextBtn.disabled = state.currentPage === totalPages;
  nextBtn.addEventListener("click", () => {
    if (state.currentPage < totalPages) {
      state.currentPage++;
      filterHistory();
    }
  });
  
  controls.append(prevBtn, pageNumbers, nextBtn);
  pagination.append(info, controls);
  
  // Insert pagination after history list
  const historyPanel = document.getElementById("history-panel");
  historyPanel.appendChild(pagination);
}

function buildSeverityFilters() {
  severityFilterContainer.innerHTML = "";

  // Add report type filters (JSON and SARIF)
  const reportTypes = [
    { id: "JSON", label: "JSON" },
    { id: "SARIF", label: "SARIF" }
  ];
  
  reportTypes.forEach((type) => {
    const chip = document.createElement("button");
    chip.className = `chip active report-type-${type.id}`;
    chip.dataset.type = type.id;
    chip.textContent = type.label;
    chip.addEventListener("click", () => toggleReportType(type.id, chip));
    severityFilterContainer.appendChild(chip);
  });

  // Add severity filters
  severityOrder.forEach((level) => {
    const chip = document.createElement("button");
    chip.className = `chip active severity-${level}`;
    chip.dataset.level = level;
    chip.innerHTML = `<span class="dot" style="background: var(--${level})"></span>${
      severityNames[level]
    }`;
    chip.addEventListener("click", () => toggleSeverity(level, chip));
    severityFilterContainer.appendChild(chip);
  });
}

function toggleReportType(type, chip) {
  if (state.reportTypeFilters.has(type) && state.reportTypeFilters.size === 1) {
    return; // минимум один тип
  }
  if (state.reportTypeFilters.has(type)) {
    state.reportTypeFilters.delete(type);
    chip.classList.remove("active");
  } else {
    state.reportTypeFilters.add(type);
    chip.classList.add("active");
  }
  // Always filter history when toggling report type (only used in history view)
  if (state.allReports && state.allReports.length > 0) {
    filterHistory();
  }
}

function toggleSeverity(level, chip) {
  if (state.severityFilters.has(level) && state.severityFilters.size === 1) {
    return; // минимум один уровень
  }
  if (state.severityFilters.has(level)) {
    state.severityFilters.delete(level);
    chip.classList.remove("active");
  } else {
    state.severityFilters.add(level);
    chip.classList.add("active");
  }
  
  // Check if we're in history view by checking if report view is hidden
  const reportViewPanel = document.getElementById("report-view");
  const isReportViewVisible = reportViewPanel && 
    reportViewPanel.style.display !== "none" && 
    reportViewPanel.style.display !== "";
  
  if (isReportViewVisible) {
    // We're viewing a report, filter issues within the report
    applyFilters();
  } else if (state.allReports && state.allReports.length > 0) {
    // We're in history view, filter the reports list
    filterHistory();
  }
}

function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();

  state.filtered = state.issues.filter((issue) => {
    const matchesSeverity = state.severityFilters.has(issue.severity);
    const matchesQuery = !query
      ? true
      : [
          issue.message,
          issue.ruleId,
          issue.path,
          issue.tags?.join(" "),
          issue.fingerprint,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);

    return matchesSeverity && matchesQuery;
  });

  state.filtered.sort((a, b) => {
    const severityDiff =
      severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
    if (severityDiff !== 0) return severityDiff;

    const pathDiff = (a.path || "").localeCompare(b.path || "");
    if (pathDiff !== 0) return pathDiff;

    return (a.startLine || 0) - (b.startLine || 0);
  });

  renderSummary();
  renderSeverityBar();
  renderIssues();
}

function renderSummary() {
  const total = state.filtered.length;
  const files = new Set(state.filtered.map((i) => i.path)).size;
  const rules = new Set(state.filtered.map((i) => i.ruleId)).size;

  document.getElementById("total-findings").textContent = total || "—";
  document.getElementById("total-files").textContent = files || "—";
  document.getElementById("total-rules").textContent = rules || "—";
  document.getElementById("report-type").textContent = state.reportType || "—";
}

function renderHistoryTotals(totals) {
  document.getElementById("total-findings").textContent = totals.total_findings || "—";
  document.getElementById("total-files").textContent = totals.total_files || "—";
  document.getElementById("total-rules").textContent = totals.total_rules || "—";
  document.getElementById("report-type").textContent = totals.total_reports ? `${totals.total_reports} отчётов` : "—";
  
  // Update severity bar with aggregate totals
  const severityCounts = {
    critical: totals.severity.critical || 0,
    high: totals.severity.high || 0,
    medium: totals.severity.medium || 0,
    low: totals.severity.low || 0,
    info: totals.severity.info || 0,
  };
  renderSeverityBarFromCounts(severityCounts);
}

function renderSeverityBarFromCounts(counts) {
  const max = Math.max(...Object.values(counts), 1);
  severityBar.innerHTML = "";

  severityOrder.forEach((level) => {
    const slice = document.createElement("div");
    slice.className = "slice";

    const bar = document.createElement("span");
    bar.style.width = `${(counts[level] / max) * 100}%`;
    bar.style.background = `var(--${level})`;
    slice.appendChild(bar);

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = `${severityNames[level]} · ${counts[level]}`;
    slice.appendChild(label);

    severityBar.appendChild(slice);
  });
}

function renderSeverityBar() {
  const counts = severityOrder.reduce((acc, level) => ({ ...acc, [level]: 0 }), {});
  state.filtered.forEach((issue) => {
    counts[issue.severity] = (counts[issue.severity] || 0) + 1;
  });

  const max = Math.max(...Object.values(counts), 1);
  severityBar.innerHTML = "";

  severityOrder.forEach((level) => {
    const slice = document.createElement("div");
    slice.className = "slice";

    const bar = document.createElement("span");
    bar.style.width = `${(counts[level] / max) * 100}%`;
    bar.style.background = `var(--${level})`;
    slice.appendChild(bar);

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = `${severityNames[level]} · ${counts[level]}`;
    slice.appendChild(label);

    severityBar.appendChild(slice);
  });
}

function renderIssues() {
  // Get the issues container - use report view if visible, otherwise null (won't render)
  const reportViewVisible = reportView && reportView.style.display !== "none" && reportView.style.display !== "";
  issuesContainer = reportViewVisible 
    ? document.getElementById("issues")
    : null;
  
  if (!issuesContainer) return; // Don't render if not in report view
  
  issuesContainer.innerHTML = "";

  if (!state.filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.issues.length
      ? "Ничего не найдено с такими фильтрами"
      : "Загрузите отчёт, чтобы увидеть результаты";
    issuesContainer.appendChild(empty);
    return;
  }

  state.filtered.forEach((issue) => {
    const card = document.createElement("article");
    card.className = "issue-card";

    const header = document.createElement("div");
    header.className = "issue-header";

    const severity = document.createElement("span");
    severity.className = "severity-pill";
    severity.style.background = `var(--${issue.severity})`;
    severity.textContent = severityNames[issue.severity] || issue.severity;

    const rule = document.createElement("span");
    rule.className = "rule-id";
    rule.textContent = issue.ruleId;

    const path = document.createElement("span");
    path.className = "path";
    path.textContent = `${issue.path}:${issue.startLine || "?"}`;

    header.append(severity, rule, path);

    const message = document.createElement("p");
    message.className = "message";
    message.textContent = issue.message;

    const meta = document.createElement("div");
    meta.className = "meta";
    if (issue.source) meta.append(childMeta(`Источник: ${issue.source}`));
    if (issue.tool) meta.append(childMeta(`Инструмент: ${issue.tool}`));
    if (issue.fingerprint) meta.append(childMeta(`Fingerprint: ${issue.fingerprint}`));
    if (issue.tags?.length) meta.append(childMeta(`Тэги: ${issue.tags.join(", ")}`));
    if (issue.references?.length)
      meta.append(childMeta(`Справка: ${issue.references.join(", ")}`));

    const snippet = document.createElement("pre");
    snippet.className = "snippet";
    snippet.textContent = issue.snippet || "Фрагмент кода не предоставлен";

    card.append(header, message, meta, snippet);
    issuesContainer.appendChild(card);
  });
}

function childMeta(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function setupFileInput() {
  // Create a hidden file input element
  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,.sarif,.sarif.json";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);
    
    fileInput.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) {
        handleFile(file);
      }
      // Reset input so the same file can be selected again
      fileInput.value = "";
    });
  }
}

function setupSearch() {
  searchInput.addEventListener("input", () => applyFilters());
}

function setupDateFilters() {
  const dateFromInput = document.getElementById("date-from");
  const dateToInput = document.getElementById("date-to");
  
  // Set default values: from 7 days ago to today
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);
  
  // Format dates as YYYY-MM-DD for date inputs
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const fromDateStr = formatDate(sevenDaysAgo);
  const toDateStr = formatDate(today);
  
  if (dateFromInput) {
    dateFromInput.value = fromDateStr;
    state.dateFrom = fromDateStr;
    dateFromInput.addEventListener("change", (event) => {
      state.dateFrom = event.target.value || null;
      filterHistory();
    });
  }
  
  if (dateToInput) {
    dateToInput.value = toDateStr;
    state.dateTo = toDateStr;
    dateToInput.addEventListener("change", (event) => {
      state.dateTo = event.target.value || null;
      filterHistory();
    });
  }
}

async function loadRemoteReport(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Не удалось загрузить удалённый отчёт");
    const json = await response.json();
    const parsed = normalizeReport(json);
    state.issues = parsed.issues;
    state.reportType = parsed.type;
    state.lastFile = null;
    applyFilters();
  } catch (err) {
    console.error(err);
    alert(`Ошибка загрузки отчёта: ${err.message}`);
  }
}

function openReport(url, name) {
  // Update URL hash for client-side routing
  window.location.hash = `report=${encodeURIComponent(url)}`;
  showReportView(url, name);
}

function showReportView(url, name) {
  // Hide history panel and show report view
  document.getElementById("history-panel").style.display = "none";
  reportView.style.display = "block";
  reportViewTitle.textContent = name || "Отчёт";
  
  // Enable download button (will be enabled after report loads)
  reportDownloadBtn.disabled = false;
  
  // Load and display the report
  loadRemoteReport(url);
}

function hideReportView() {
  // Show history panel and hide report view
  document.getElementById("history-panel").style.display = "block";
  reportView.style.display = "none";
  
  // Clear URL hash
  window.location.hash = "";
  
  // Clear issues when hiding report view
  const issuesContainer = document.getElementById("issues");
  if (issuesContainer) {
    issuesContainer.innerHTML = "";
  }
}

function handleRoute() {
  const hash = window.location.hash;
  if (hash.startsWith("#report=")) {
    const url = decodeURIComponent(hash.substring(8));
    // Extract name from URL or use default
    const urlParts = url.split("/");
    const name = urlParts[urlParts.length - 1] || "Отчёт";
    showReportView(url, name);
  } else {
    hideReportView();
  }
}

function init() {
  buildSeverityFilters();
  setupFileInput();
  setupSearch();
  setupDateFilters();
  refreshHistoryBtn.addEventListener("click", loadHistory);
  uploadBtn.addEventListener("click", () => {
    if (fileInput) {
      fileInput.click();
    }
  });
  backBtn.addEventListener("click", () => {
    hideReportView();
  });
  reportDownloadBtn.addEventListener("click", downloadPdf);
  
  // Handle client-side routing
  window.addEventListener("hashchange", handleRoute);
  
  renderSummary();
  renderSeverityBar();
  renderIssues();

  // Load history on page load since it's the default view
  loadHistory();

  // Handle initial route
  handleRoute();
  
  // Also support old ?report= query parameter for backwards compatibility
  const reportParam = new URLSearchParams(window.location.search).get("report");
  if (reportParam && !window.location.hash) {
    openReport(reportParam, "Отчёт");
  }
}

init();
