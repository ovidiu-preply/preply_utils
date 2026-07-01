const TRACKED_IDS_STORAGE_KEY = "trackedFlagIdsByDomain";
const FLAG_CACHE_STORAGE_KEY = "flagInfoByDomain";
const STALE_FETCH_THRESHOLD_MS = 2 * 60 * 1000;
const domainUiByDomain = new Map();
let trackedFlagIdsByDomain = {};
let flagInfoByDomain = {};
let highlightedDomain = "";
let highlightedFlagKey = "";

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function setError(message) {
  const errorElement = document.getElementById("error");
  if (!errorElement) {
    return;
  }
  errorElement.textContent = message;
}

function normalizeId(id) {
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sanitizeIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }

  const uniqueIds = [];
  const seen = new Set();
  for (const rawId of ids) {
    const id = normalizeId(rawId);
    if (id === null || seen.has(id)) {
      continue;
    }
    seen.add(id);
    uniqueIds.push(id);
  }

  return uniqueIds;
}

function sanitizeTrackedIdsByDomain(rawMap) {
  const sanitized = {};
  if (!rawMap || typeof rawMap !== "object") {
    return sanitized;
  }

  for (const [domain, ids] of Object.entries(rawMap)) {
    if (typeof domain !== "string" || domain.trim() === "") {
      continue;
    }
    sanitized[domain] = sanitizeIds(ids);
  }
  return sanitized;
}

function sanitizeFlagInfo(rawInfo) {
  if (!rawInfo || typeof rawInfo !== "object") {
    return null;
  }

  const allowedStatuses = new Set(["ok", "not_found", "fetch_failed"]);
  const status = typeof rawInfo.status === "string" ? rawInfo.status : "";
  if (!allowedStatuses.has(status)) {
    return null;
  }

  const sanitized = { status };
  const rawLastFetchedAt = rawInfo.lastFetchedAt;
  if (typeof rawLastFetchedAt === "number" && Number.isFinite(rawLastFetchedAt) && rawLastFetchedAt > 0) {
    sanitized.lastFetchedAt = rawLastFetchedAt;
  }
  if (status === "ok") {
    sanitized.flagName = sanitizeFieldValue(rawInfo.flagName).displayValue;
    sanitized.everyone = sanitizeFieldValue(rawInfo.everyone);
    sanitized.percent = sanitizeFieldValue(rawInfo.percent);
    sanitized.audiencePercent = sanitizeFieldValue(rawInfo.audiencePercent);
  } else if (status === "fetch_failed") {
    sanitized.error =
      typeof rawInfo.error === "string" && rawInfo.error.trim() !== ""
        ? rawInfo.error
        : "Unknown error";
  }

  return sanitized;
}

function sanitizeFlagInfoByDomain(rawMap) {
  const sanitized = {};
  if (!rawMap || typeof rawMap !== "object") {
    return sanitized;
  }

  for (const [domain, byId] of Object.entries(rawMap)) {
    if (typeof domain !== "string" || domain.trim() === "" || !byId || typeof byId !== "object") {
      continue;
    }

    const sanitizedById = {};
    for (const [rawId, rawInfo] of Object.entries(byId)) {
      const id = normalizeId(Number.parseInt(rawId, 10));
      if (id === null) {
        continue;
      }

      const info = sanitizeFlagInfo(rawInfo);
      if (!info) {
        continue;
      }
      sanitizedById[id] = info;
    }

    sanitized[domain] = sanitizedById;
  }

  return sanitized;
}

function isSupportedDomain(domain) {
  return domain === "crew.preply.com" || /^crew\.stage\d+\.preply\.org$/i.test(domain);
}

function extractDomainFromUrl(url) {
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

function extractFlagIdFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const match = parsedUrl.pathname.match(
      /^\/crew\/waffle\/(?:flag|flagexperiment)\/(\d+)\/change\/?$/
    );
    if (!match) {
      return null;
    }

    const parsedId = Number.parseInt(match[1], 10);
    return normalizeId(parsedId);
  } catch {
    return null;
  }
}

function getCurrentTabInfo() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const [activeTab] = tabs;
      const url = activeTab && typeof activeTab.url === "string" ? activeTab.url : "";
      resolve({
        domain: extractDomainFromUrl(url),
        prefillFlagId: extractFlagIdFromUrl(url)
      });
    });
  });
}

function getDomainsForRender(storedMap, currentDomain) {
  const storedDomains = Object.keys(storedMap);
  if (!isSupportedDomain(currentDomain)) {
    return storedDomains;
  }

  const filteredStoredDomains = storedDomains.filter((domain) => domain !== currentDomain);
  return [currentDomain, ...filteredStoredDomains];
}

function getFromStorage(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result[key]);
    });
  });
}

function setInStorage(entries) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(entries, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function createFieldValue(displayValue, colorValue) {
  return {
    displayValue: typeof displayValue === "string" ? displayValue : "",
    colorValue: typeof colorValue === "string" ? colorValue : ""
  };
}

function sanitizeFieldValue(rawValue) {
  if (typeof rawValue === "string") {
    return createFieldValue(rawValue, rawValue);
  }
  if (!rawValue || typeof rawValue !== "object") {
    return createFieldValue("", "");
  }
  return createFieldValue(rawValue.displayValue, rawValue.colorValue);
}

function getFieldFromContainer(container) {
  return container.querySelector("input, select, textarea, .readonly");
}

function readFieldValue(field) {
  if (field.classList.contains("readonly")) {
    const textContent = field.textContent || "";
    return createFieldValue(textContent, textContent);
  }

  if (field.tagName.toLowerCase() === "select") {
    const selectedOption = field.options[field.selectedIndex];
    if (!selectedOption) {
      return createFieldValue("", "");
    }
    return createFieldValue(selectedOption.textContent || "", selectedOption.value || "");
  }

  if ("value" in field) {
    return createFieldValue(field.value, field.value);
  }

  const textContent = field.textContent || "";
  return createFieldValue(textContent, textContent);
}

function extractByExactLabel(parsedDocument, labelText) {
  const normalizedWanted = normalizeText(labelText).toLowerCase();
  const labels = Array.from(parsedDocument.querySelectorAll("label"));

  const label = labels.find((candidate) => {
    return normalizeText(candidate.textContent).toLowerCase() === normalizedWanted;
  });

  if (!label) {
    return "";
  }

  const forId = label.getAttribute("for");
  if (forId) {
    const directField = parsedDocument.getElementById(forId);
    if (directField) {
      return readFieldValue(directField);
    }
  }

  const container = label.closest("div, li, tr, td, form");
  const siblingField = container ? getFieldFromContainer(container) : null;
  if (!siblingField) {
    return "";
  }

  return readFieldValue(siblingField);
}

function getFieldsList() {
  return document.getElementById("fields");
}

function clearFields() {
  const fieldsList = getFieldsList();
  if (fieldsList) {
    fieldsList.replaceChildren();
  }
}

function createValueLine(label, value) {
  const line = document.createElement("li");
  line.className = "field-row";
  const labelElement = document.createElement("div");
  labelElement.className = "label";
  labelElement.textContent = label;

  const parsedValue = sanitizeFieldValue(value);
  const normalizedDisplayValue = normalizeText(parsedValue.displayValue);
  const normalizedColorValue = normalizeText(parsedValue.colorValue);

  const valueElement = document.createElement("div");
  valueElement.className = "value value-badge";
  const normalizedLowerColorValue = normalizedColorValue.toLowerCase();
  if (normalizedLowerColorValue === "true") {
    valueElement.classList.add("value-badge-true");
  } else if (normalizedLowerColorValue === "false") {
    valueElement.classList.add("value-badge-false");
  } else if (normalizedDisplayValue !== "") {
    valueElement.classList.add("value-badge-other");
  }
  valueElement.textContent = normalizedDisplayValue || "-";

  line.append(labelElement, valueElement);
  return line;
}

function createStatusBadge(status) {
  const badge = document.createElement("span");
  badge.style.fontSize = "11px";
  badge.style.fontWeight = "700";
  badge.style.marginLeft = "8px";

  if (status === "loading") {
    badge.textContent = "LOADING";
    badge.style.color = "#1565c0";
    return badge;
  }

  if (status === "ok") {
    return null;
  }

  if (status === "not_found") {
    badge.textContent = "NOT FOUND";
    badge.style.color = "#c62828";
    return badge;
  }

  if (status === "idle") {
    badge.textContent = "NOT LOADED";
    badge.style.color = "#6b7280";
    return badge;
  }

  badge.textContent = "FETCH FAILED";
  badge.style.color = "#c62828";
  return badge;
}

function createContextBadge(label) {
  const badge = document.createElement("span");
  badge.className = "context-badge";
  badge.textContent = label;
  return badge;
}

function createFlagNameBadge(label) {
  const badge = document.createElement("span");
  badge.className = "value-badge";
  badge.style.fontSize = "13px";
  badge.style.marginRight = "6px";
  badge.style.color = "#0f766e";
  badge.style.background = "#ccfbf1";
  badge.style.borderColor = "#5eead4";
  badge.textContent = label;
  return badge;
}

function formatRelativeDuration(diffMs) {
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatLastFetchedAt(lastFetchedAt) {
  if (typeof lastFetchedAt !== "number" || !Number.isFinite(lastFetchedAt) || lastFetchedAt <= 0) {
    return "";
  }
  return formatRelativeDuration(Date.now() - lastFetchedAt);
}

function updateLastFetchedLabel(label, lastFetchedAt) {
  if (typeof lastFetchedAt !== "number" || !Number.isFinite(lastFetchedAt) || lastFetchedAt <= 0) {
    label.textContent = "";
    label.classList.remove("flag-last-fetched-stale");
    label.removeAttribute("title");
    return;
  }

  const ageMs = Date.now() - lastFetchedAt;
  const isStale = ageMs >= STALE_FETCH_THRESHOLD_MS;
  const relativeTime = formatLastFetchedAt(lastFetchedAt);
  label.classList.toggle("flag-last-fetched-stale", isStale);
  label.textContent = isStale ? `Fetched ${relativeTime} • stale` : `Fetched ${relativeTime}`;
  label.title = `Last fetched: ${new Date(lastFetchedAt).toLocaleString()}`;
}

function updateAllLastFetchedLabels() {
  const labels = document.querySelectorAll("[data-last-fetched-at]");
  for (const label of labels) {
    const rawTimestamp = Number.parseInt(label.getAttribute("data-last-fetched-at") || "", 10);
    updateLastFetchedLabel(label, rawTimestamp);
  }
}

function makeIconButton(button, { label, iconSrc, size = 14 }) {
  button.setAttribute("aria-label", label);
  button.title = label;

  const icon = document.createElement("img");
  icon.src = iconSrc;
  icon.alt = "";
  icon.width = size;
  icon.height = size;
  icon.style.display = "block";
  button.append(icon);
}

function makeDeleteIconButton(button, label) {
  makeIconButton(button, { label, iconSrc: "delete-icon.png" });
}

function makeRefreshIconButton(button, label) {
  makeIconButton(button, { label, iconSrc: "refresh-icon.png" });
}

function makeTrackIconButton(button, label) {
  makeIconButton(button, { label, iconSrc: "track-icon.png" });
}

function setRefreshButtonLoadingState(button, isLoading) {
  button.disabled = isLoading;
  button.classList.toggle("is-loading", isLoading);
  const label = isLoading ? "Refreshing" : "Refresh";
  button.setAttribute("aria-label", label);
  button.title = label;
}

function getFlagKey(flagInfo) {
  return `${flagInfo.domain}::${flagInfo.id}`;
}

async function removeTrackedFlag(domain, id) {
  const existingIds = getTrackedIdsForDomain(domain);
  if (!existingIds.includes(id)) {
    return true;
  }

  trackedFlagIdsByDomain[domain] = existingIds.filter((trackedId) => trackedId !== id);
  if (flagInfoByDomain[domain] && typeof flagInfoByDomain[domain] === "object") {
    delete flagInfoByDomain[domain][id];
  }
  try {
    await Promise.all([saveTrackedIds(), saveFlagInfoCache()]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot remove tracked ID: ${message}`);
    return false;
  }
}

async function removeTrackedDomain(domain) {
  if (!Object.prototype.hasOwnProperty.call(trackedFlagIdsByDomain, domain)) {
    return true;
  }

  delete trackedFlagIdsByDomain[domain];
  delete flagInfoByDomain[domain];
  try {
    await Promise.all([saveTrackedIds(), saveFlagInfoCache()]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot remove domain: ${message}`);
    return false;
  }
}

function createTrackRow(domain) {
  const row = document.createElement("div");
  row.className = "track-row";

  const input = document.createElement("input");
  input.className = "track-input";
  input.type = "number";
  input.min = "1";
  input.step = "1";
  input.placeholder = "Flag ID";

  const button = document.createElement("button");
  button.className = "track-button";
  button.type = "button";
  makeTrackIconButton(button, "Track flag");
  button.addEventListener("click", () => {
    void handleTrackClick(domain);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleTrackClick(domain);
    }
  });

  row.append(input, button);
  return { row, input };
}

function renderDomainSection(domain) {
  const fieldsList = getFieldsList();
  if (!fieldsList) {
    return;
  }

  const domainSection = document.createElement("li");
  domainSection.classList.add("domain-card");
  const domainHeaderRow = document.createElement("div");
  domainHeaderRow.className = "domain-header-row";

  const domainTitle = document.createElement("div");
  domainTitle.className = "value domain-title";
  domainTitle.textContent = domain;
  domainHeaderRow.append(domainTitle);
  if (domain === highlightedDomain) {
    domainHeaderRow.append(createContextBadge("Current page"));
  }

  const removeDomainButton = document.createElement("button");
  removeDomainButton.className = "remove-domain-button";
  removeDomainButton.type = "button";
  makeDeleteIconButton(removeDomainButton, "Remove domain");
  removeDomainButton.addEventListener("click", () => {
    void (async () => {
      setError("");
      const wasRemoved = await removeTrackedDomain(domain);
      if (wasRemoved) {
        domainUiByDomain.delete(domain);
        domainSection.remove();
      }
    })();
  });

  const refreshButton = document.createElement("button");
  refreshButton.className = "refresh-domain-button";
  refreshButton.type = "button";
  makeRefreshIconButton(refreshButton, "Refresh");
  refreshButton.addEventListener("click", () => {
    void refreshDomainFlags(domain);
  });

  domainHeaderRow.append(refreshButton, removeDomainButton);
  domainSection.append(domainHeaderRow);

  const { row: trackRow, input: trackInput } = createTrackRow(domain);
  domainSection.append(trackRow);

  const domainFlagsList = document.createElement("ul");
  domainFlagsList.setAttribute("data-domain-flags", domain);
  domainSection.append(domainFlagsList);

  fieldsList.append(domainSection);
  domainUiByDomain.set(domain, { trackInput, domainFlagsList, refreshButton });
}

function getDomainFlagsList(domain) {
  const ui = domainUiByDomain.get(domain);
  return ui ? ui.domainFlagsList : null;
}

function renderFlagBlock(flagInfo) {
  const domainFlagsList = getDomainFlagsList(flagInfo.domain);
  if (!domainFlagsList) {
    return;
  }

  const targetUrl = `https://${flagInfo.domain}/crew/waffle/flag/${flagInfo.id}/change/`;
  const flagKey = getFlagKey(flagInfo);
  const existingBlock = domainFlagsList.querySelector(`[data-flag-key="${flagKey}"]`);
  const block = existingBlock || document.createElement("li");
  block.replaceChildren();
  block.setAttribute("data-flag-key", flagKey);

  const titleRow = document.createElement("div");
  titleRow.className = "flag-title-row";

  const title = document.createElement("a");
  title.className = "value flag-title";
  title.href = targetUrl;
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  const inlineFlagName =
    flagInfo.status === "ok" && typeof flagInfo.flagName === "string"
      ? normalizeText(flagInfo.flagName)
      : "";
  title.textContent = `ID ${flagInfo.id}`;

  const status = flagInfo.status || "fetch_failed";
  const statusBadge = createStatusBadge(status);

  const actionsGroup = document.createElement("div");
  actionsGroup.className = "flag-actions";
  actionsGroup.append(title);
  if (inlineFlagName) {
    titleRow.append(createFlagNameBadge(inlineFlagName));
  }
  if (flagKey === highlightedFlagKey) {
    titleRow.append(createContextBadge("Current page flag"));
  }

  const removeButton = document.createElement("button");
  removeButton.className = "remove-button";
  removeButton.type = "button";
  makeDeleteIconButton(removeButton, "Remove");
  removeButton.addEventListener("click", () => {
    void (async () => {
      setError("");
      const wasRemoved = await removeTrackedFlag(flagInfo.domain, flagInfo.id);
      if (wasRemoved) {
        block.remove();
      }
    })();
  });
  if (statusBadge) {
    actionsGroup.append(statusBadge);
  }
  actionsGroup.append(removeButton);
  titleRow.append(actionsGroup);
  block.append(titleRow);
  block.classList.add("flag-card");

  const subList = document.createElement("ul");
  subList.className = "flag-fields-list";

  if (status === "loading") {
    subList.append(createValueLine("Status", "Loading..."));
  } else if (status === "idle") {
    subList.append(createValueLine("Status", "Not loaded. Click Refresh for this domain."));
  } else if (status === "fetch_failed") {
    subList.append(createValueLine("Error", flagInfo.error));
  } else if (status === "ok") {
    subList.append(
      createValueLine("Everyone - used to control the rollout", flagInfo.everyone)
    );
    subList.append(createValueLine("Percent", flagInfo.percent));
    subList.append(createValueLine("Audience percent", flagInfo.audiencePercent));
  }

  block.append(subList);
  const lastFetchedLabel = document.createElement("div");
  lastFetchedLabel.className = "flag-last-fetched";
  if (typeof flagInfo.lastFetchedAt === "number" && Number.isFinite(flagInfo.lastFetchedAt)) {
    lastFetchedLabel.setAttribute("data-last-fetched-at", String(flagInfo.lastFetchedAt));
    updateLastFetchedLabel(lastFetchedLabel, flagInfo.lastFetchedAt);
  }
  block.append(lastFetchedLabel);
  if (!existingBlock) {
    domainFlagsList.append(block);
  }
}

async function saveTrackedIds() {
  await setInStorage({ [TRACKED_IDS_STORAGE_KEY]: trackedFlagIdsByDomain });
}

async function saveFlagInfoCache() {
  await setInStorage({ [FLAG_CACHE_STORAGE_KEY]: flagInfoByDomain });
}

function getTrackedIdsForDomain(domain) {
  return Array.isArray(trackedFlagIdsByDomain[domain])
    ? trackedFlagIdsByDomain[domain]
    : [];
}

async function fetchAndRenderFlag(domain, id) {
  renderFlagBlock({ domain, id, status: "loading" });
  const info = await fetchFlagInfo(domain, id);
  const fetchedInfo = {
    ...info,
    lastFetchedAt: Date.now()
  };
  renderFlagBlock(fetchedInfo);
  if (!flagInfoByDomain[domain] || typeof flagInfoByDomain[domain] !== "object") {
    flagInfoByDomain[domain] = {};
  }
  flagInfoByDomain[domain][id] = sanitizeFlagInfo(fetchedInfo);
  return fetchedInfo;
}

function renderCachedFlag(domain, id) {
  const domainFlags = flagInfoByDomain[domain];
  const cachedInfo =
    domainFlags && typeof domainFlags === "object" ? sanitizeFlagInfo(domainFlags[id]) : null;

  if (!cachedInfo) {
    renderFlagBlock({ domain, id, status: "idle" });
    return;
  }

  renderFlagBlock({ domain, id, ...cachedInfo });
}

async function refreshDomainFlags(domain) {
  setError("");
  const ui = domainUiByDomain.get(domain);
  if (!ui) {
    return;
  }

  const ids = getTrackedIdsForDomain(domain);
  if (ids.length === 0) {
    return;
  }

  setRefreshButtonLoadingState(ui.refreshButton, true);

  try {
    await Promise.all(ids.map((id) => fetchAndRenderFlag(domain, id)));
    await saveFlagInfoCache();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot refresh ${domain}: ${message}`);
  } finally {
    setRefreshButtonLoadingState(ui.refreshButton, false);
  }
}

async function handleTrackClick(domain) {
  setError("");
  const ui = domainUiByDomain.get(domain);
  if (!ui) {
    return;
  }

  const rawValue = ui.trackInput.value.trim();
  const parsed = Number.parseInt(rawValue, 10);
  const id = normalizeId(parsed);
  if (id === null) {
    setError(`Invalid flag ID for ${domain}. Use positive integer.`);
    return;
  }

  const existingIds = getTrackedIdsForDomain(domain);
  if (!existingIds.includes(id)) {
    trackedFlagIdsByDomain[domain] = [...existingIds, id];
    try {
      await saveTrackedIds();
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      setError(`Cannot save tracked ID: ${message}`);
      return;
    }
  }

  ui.trackInput.value = "";
  await fetchAndRenderFlag(domain, id);
  try {
    await saveFlagInfoCache();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot save flag cache: ${message}`);
  }
}

async function fetchFlagInfo(domain, flagId) {
  const targetUrl = `https://${domain}/crew/waffle/flag/${flagId}/change/`;

  try {
    const response = await fetch(targetUrl, { method: "GET" });
    if (!response.ok) {
      return {
        domain,
        id: flagId,
        status: response.status === 404 ? "not_found" : "fetch_failed",
        error: `HTTP ${response.status}`
      };
    }

    const wasRedirected =
      response.redirected ||
      !response.url ||
      !response.url.startsWith(targetUrl);
    if (wasRedirected) {
      return {
        domain,
        id: flagId,
        status: "not_found"
      };
    }

    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, "text/html");

    return {
      domain,
      id: flagId,
      status: "ok",
      flagName: sanitizeFieldValue(extractByExactLabel(parsed, "Name:")).displayValue,
      everyone: extractByExactLabel(parsed, "Everyone - used to control the rollout:"),
      percent: extractByExactLabel(parsed, "Percent:"),
      audiencePercent: extractByExactLabel(parsed, "Audience percent:")
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      domain,
      id: flagId,
      status: "fetch_failed",
      error: message
    };
  }
}

async function loadFlagInfo() {
  setError("");
  clearFields();
  domainUiByDomain.clear();
  let currentDomain = "";
  let prefillFlagId = null;
  highlightedDomain = "";
  highlightedFlagKey = "";

  try {
    const fromStorage = await getFromStorage(TRACKED_IDS_STORAGE_KEY);
    trackedFlagIdsByDomain = sanitizeTrackedIdsByDomain(fromStorage);
  } catch (error) {
    trackedFlagIdsByDomain = sanitizeTrackedIdsByDomain(null);
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot read tracked IDs: ${message}`);
  }

  try {
    const fromStorage = await getFromStorage(FLAG_CACHE_STORAGE_KEY);
    flagInfoByDomain = sanitizeFlagInfoByDomain(fromStorage);
  } catch (error) {
    flagInfoByDomain = sanitizeFlagInfoByDomain(null);
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot read flag cache: ${message}`);
  }

  try {
    const currentTabInfo = await getCurrentTabInfo();
    currentDomain = currentTabInfo.domain;
    prefillFlagId = currentTabInfo.prefillFlagId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot read current tab: ${message}`);
  }

  const domains = getDomainsForRender(trackedFlagIdsByDomain, currentDomain);
  const currentDomainIds = getTrackedIdsForDomain(currentDomain);
  const isCurrentDomainSupported = isSupportedDomain(currentDomain);
  const isCurrentFlagTracked =
    isCurrentDomainSupported &&
    prefillFlagId !== null &&
    currentDomainIds.includes(prefillFlagId);

  if (isCurrentDomainSupported) {
    highlightedDomain = currentDomain;
  }
  if (isCurrentDomainSupported && prefillFlagId !== null) {
    highlightedFlagKey = `${currentDomain}::${prefillFlagId}`;
  }

  for (const domain of domains) {
    renderDomainSection(domain);
    const ids = getTrackedIdsForDomain(domain);
    for (const id of ids) {
      renderCachedFlag(domain, id);
    }
  }

  if (isCurrentDomainSupported && prefillFlagId !== null && !isCurrentFlagTracked) {
    const ui = domainUiByDomain.get(currentDomain);
    if (ui) {
      ui.trackInput.value = String(prefillFlagId);
    }
  }
}

void loadFlagInfo();
setInterval(updateAllLastFetchedLabels, 1000);
