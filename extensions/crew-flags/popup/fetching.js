import { extractByExactLabel, sanitizeFieldValue } from "./parsing.js";

function normalizeId(id) {
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function isSupportedDomain(domain) {
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

export function getCurrentTabInfo() {
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

export function getDomainsForRender(storedMap, currentDomain) {
  const storedDomains = Object.keys(storedMap);
  if (!isSupportedDomain(currentDomain)) {
    return storedDomains;
  }

  const filteredStoredDomains = storedDomains.filter((domain) => domain !== currentDomain);
  return [currentDomain, ...filteredStoredDomains];
}

export async function fetchFlagInfo(domain, flagId) {
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
