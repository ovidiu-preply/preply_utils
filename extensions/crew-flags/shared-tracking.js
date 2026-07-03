const TRACKED_IDS_STORAGE_KEY = "trackedFlagIdsByDomain";
const FLAG_CACHE_STORAGE_KEY = "flagInfoByDomain";

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
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
    sanitized.iteration = sanitizeFieldValue(rawInfo.iteration);
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

    const wasRedirected = response.redirected || !response.url || !response.url.startsWith(targetUrl);
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
      audiencePercent: extractByExactLabel(parsed, "Audience percent:"),
      iteration: extractByExactLabel(parsed, "Iteration:")
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

export async function getTrackedIdsByDomain() {
  const fromStorage = await getFromStorage(TRACKED_IDS_STORAGE_KEY);
  return sanitizeTrackedIdsByDomain(fromStorage);
}

export async function isFlagTracked(domain, rawId) {
  const id = normalizeId(Number.parseInt(String(rawId), 10));
  if (!domain || id === null) {
    return false;
  }
  const trackedByDomain = await getTrackedIdsByDomain();
  const trackedIds = Array.isArray(trackedByDomain[domain]) ? trackedByDomain[domain] : [];
  return trackedIds.includes(id);
}

export async function ensureTrackedFlagWithCache(domain, rawId) {
  const id = normalizeId(Number.parseInt(String(rawId), 10));
  if (!domain || id === null) {
    throw new Error("Invalid domain or flag id.");
  }

  const [trackedFromStorage, cacheFromStorage] = await Promise.all([
    getFromStorage(TRACKED_IDS_STORAGE_KEY),
    getFromStorage(FLAG_CACHE_STORAGE_KEY)
  ]);
  const trackedIdsByDomain = sanitizeTrackedIdsByDomain(trackedFromStorage);
  const flagInfoByDomain = sanitizeFlagInfoByDomain(cacheFromStorage);

  const existingIds = Array.isArray(trackedIdsByDomain[domain]) ? trackedIdsByDomain[domain] : [];
  if (!existingIds.includes(id)) {
    trackedIdsByDomain[domain] = [...existingIds, id];
  }

  const info = await fetchFlagInfo(domain, id);
  const fetchedInfo = { ...info, lastFetchedAt: Date.now() };
  if (!flagInfoByDomain[domain] || typeof flagInfoByDomain[domain] !== "object") {
    flagInfoByDomain[domain] = {};
  }
  flagInfoByDomain[domain][id] = sanitizeFlagInfo(fetchedInfo);

  await setInStorage({
    [TRACKED_IDS_STORAGE_KEY]: trackedIdsByDomain,
    [FLAG_CACHE_STORAGE_KEY]: flagInfoByDomain
  });

  return { id, fetchedInfo, trackedIdsByDomain, flagInfoByDomain };
}
