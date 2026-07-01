const STORAGE_KEY = "trackedFlagIdsByDomain";
const domainUiByDomain = new Map();
let trackedFlagIdsByDomain = {};

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

function getCurrentTabDomain() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const [activeTab] = tabs;
      const url = activeTab && typeof activeTab.url === "string" ? activeTab.url : "";
      resolve(extractDomainFromUrl(url));
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

function getFieldFromContainer(container) {
  return container.querySelector("input, select, textarea, .readonly");
}

function readFieldValue(field) {
  if (field.classList.contains("readonly")) {
    return field.textContent || "";
  }

  if (field.tagName.toLowerCase() === "select") {
    const selectedOption = field.options[field.selectedIndex];
    return selectedOption ? selectedOption.textContent || "" : "";
  }

  if ("value" in field) {
    return field.value;
  }

  return field.textContent || "";
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
  const labelElement = document.createElement("div");
  labelElement.className = "label";
  labelElement.textContent = label;

  const valueElement = document.createElement("div");
  valueElement.className = "value";
  valueElement.textContent = normalizeText(value) || "-";

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
    badge.textContent = "OK";
    badge.style.color = "#1e7a1e";
    return badge;
  }

  if (status === "not_found") {
    badge.textContent = "NOT FOUND";
    badge.style.color = "#c62828";
    return badge;
  }

  badge.textContent = "FETCH FAILED";
  badge.style.color = "#c62828";
  return badge;
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
  try {
    await saveTrackedIds();
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
  try {
    await saveTrackedIds();
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
  button.textContent = "Track";
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
  const domainHeaderRow = document.createElement("div");
  domainHeaderRow.className = "domain-header-row";

  const domainTitle = document.createElement("div");
  domainTitle.className = "value domain-title";
  domainTitle.textContent = domain;
  domainHeaderRow.append(domainTitle);

  const removeDomainButton = document.createElement("button");
  removeDomainButton.className = "remove-domain-button";
  removeDomainButton.type = "button";
  removeDomainButton.textContent = "Remove domain";
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
  domainHeaderRow.append(removeDomainButton);
  domainSection.append(domainHeaderRow);

  const { row: trackRow, input: trackInput } = createTrackRow(domain);
  domainSection.append(trackRow);

  const domainFlagsList = document.createElement("ul");
  domainFlagsList.setAttribute("data-domain-flags", domain);
  domainSection.append(domainFlagsList);

  fieldsList.append(domainSection);
  domainUiByDomain.set(domain, { trackInput, domainFlagsList });
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

  const title = document.createElement("a");
  title.className = "value";
  title.href = targetUrl;
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.textContent = `Flag ID ${flagInfo.id}`;
  title.style.display = "inline-block";
  title.style.marginBottom = "8px";

  const status = flagInfo.status || "fetch_failed";
  const statusBadge = createStatusBadge(status);
  titleRow.append(title, statusBadge);

  const removeButton = document.createElement("button");
  removeButton.className = "remove-button";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    void (async () => {
      setError("");
      const wasRemoved = await removeTrackedFlag(flagInfo.domain, flagInfo.id);
      if (wasRemoved) {
        block.remove();
      }
    })();
  });
  titleRow.append(removeButton);
  block.append(titleRow);

  const subList = document.createElement("ul");
  subList.style.marginBottom = "14px";

  if (status === "loading") {
    subList.append(createValueLine("Status", "Loading..."));
  } else if (status === "fetch_failed") {
    subList.append(createValueLine("Error", flagInfo.error));
  } else if (status === "ok") {
    subList.append(createValueLine("Flag name", flagInfo.flagName));
    subList.append(
      createValueLine("Everyone - used to control the rollout", flagInfo.everyone)
    );
    subList.append(createValueLine("Percent", flagInfo.percent));
    subList.append(createValueLine("Audience percent", flagInfo.audiencePercent));
  }

  block.append(subList);
  if (!existingBlock) {
    domainFlagsList.append(block);
  }
}

async function saveTrackedIds() {
  await setInStorage({ [STORAGE_KEY]: trackedFlagIdsByDomain });
}

function getTrackedIdsForDomain(domain) {
  return Array.isArray(trackedFlagIdsByDomain[domain])
    ? trackedFlagIdsByDomain[domain]
    : [];
}

async function fetchAndRenderFlag(domain, id) {
  renderFlagBlock({ domain, id, status: "loading" });
  const info = await fetchFlagInfo(domain, id);
  renderFlagBlock(info);
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
      flagName: extractByExactLabel(parsed, "Name:"),
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

  try {
    const fromStorage = await getFromStorage(STORAGE_KEY);
    trackedFlagIdsByDomain = sanitizeTrackedIdsByDomain(fromStorage);
  } catch (error) {
    trackedFlagIdsByDomain = sanitizeTrackedIdsByDomain(null);
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot read tracked IDs: ${message}`);
  }

  try {
    currentDomain = await getCurrentTabDomain();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot read current tab: ${message}`);
  }

  const fetchTasks = [];
  const domains = getDomainsForRender(trackedFlagIdsByDomain, currentDomain);
  for (const domain of domains) {
    renderDomainSection(domain);
    const ids = getTrackedIdsForDomain(domain);
    for (const id of ids) {
      fetchTasks.push(fetchAndRenderFlag(domain, id));
    }
  }

  await Promise.all(fetchTasks);
}

void loadFlagInfo();
