import { FLAG_CACHE_STORAGE_KEY, TRACKED_IDS_STORAGE_KEY } from "./constants.js";
import { fetchFlagInfo, getCurrentTabInfo, getDomainsForRender, isSupportedDomain } from "./fetching.js";
import { sanitizeFlagInfo, sanitizeFlagInfoByDomain, sanitizeTrackedIdsByDomain } from "./parsing.js";
import { state } from "./state.js";
import { getFromStorage, setInStorage } from "./storage.js";
import {
  clearFields,
  getFlagKey,
  renderDomainSection,
  renderFlagBlock,
  setError,
  setRefreshButtonLoadingState,
  updateAllLastFetchedLabels
} from "./ui.js";

function normalizeId(id) {
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function saveTrackedIds() {
  await setInStorage({ [TRACKED_IDS_STORAGE_KEY]: state.trackedFlagIdsByDomain });
}

async function saveFlagInfoCache() {
  await setInStorage({ [FLAG_CACHE_STORAGE_KEY]: state.flagInfoByDomain });
}

function getTrackedIdsForDomain(domain) {
  return Array.isArray(state.trackedFlagIdsByDomain[domain])
    ? state.trackedFlagIdsByDomain[domain]
    : [];
}

async function removeTrackedFlag(domain, id) {
  const existingIds = getTrackedIdsForDomain(domain);
  if (!existingIds.includes(id)) {
    return true;
  }

  state.trackedFlagIdsByDomain[domain] = existingIds.filter((trackedId) => trackedId !== id);
  if (state.flagInfoByDomain[domain] && typeof state.flagInfoByDomain[domain] === "object") {
    delete state.flagInfoByDomain[domain][id];
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
  if (!Object.prototype.hasOwnProperty.call(state.trackedFlagIdsByDomain, domain)) {
    return true;
  }

  delete state.trackedFlagIdsByDomain[domain];
  delete state.flagInfoByDomain[domain];
  try {
    await Promise.all([saveTrackedIds(), saveFlagInfoCache()]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot remove domain: ${message}`);
    return false;
  }
}

async function fetchAndRenderFlag(domain, id) {
  renderFlagBlock({ domain, id, status: "loading" }, { onRemoveFlag: handleRemoveFlag });
  const info = await fetchFlagInfo(domain, id);
  const fetchedInfo = {
    ...info,
    lastFetchedAt: Date.now()
  };
  renderFlagBlock(fetchedInfo, { onRemoveFlag: handleRemoveFlag });
  if (!state.flagInfoByDomain[domain] || typeof state.flagInfoByDomain[domain] !== "object") {
    state.flagInfoByDomain[domain] = {};
  }
  state.flagInfoByDomain[domain][id] = sanitizeFlagInfo(fetchedInfo);
  return fetchedInfo;
}

function renderCachedFlag(domain, id) {
  const domainFlags = state.flagInfoByDomain[domain];
  const cachedInfo =
    domainFlags && typeof domainFlags === "object" ? sanitizeFlagInfo(domainFlags[id]) : null;

  if (!cachedInfo) {
    renderFlagBlock({ domain, id, status: "idle" }, { onRemoveFlag: handleRemoveFlag });
    return;
  }

  renderFlagBlock({ domain, id, ...cachedInfo }, { onRemoveFlag: handleRemoveFlag });
}

async function refreshDomainFlags(domain) {
  setError("");
  const ui = state.domainUiByDomain.get(domain);
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
  const ui = state.domainUiByDomain.get(domain);
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
    state.trackedFlagIdsByDomain[domain] = [...existingIds, id];
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

async function handleRemoveFlag(domain, id, block) {
  setError("");
  const wasRemoved = await removeTrackedFlag(domain, id);
  if (wasRemoved) {
    block.remove();
  }
}

async function handleRemoveDomain(domain, domainSection) {
  setError("");
  const wasRemoved = await removeTrackedDomain(domain);
  if (wasRemoved) {
    state.domainUiByDomain.delete(domain);
    domainSection.remove();
  }
}

async function loadFlagInfo() {
  setError("");
  clearFields();
  state.domainUiByDomain.clear();
  let currentDomain = "";
  let prefillFlagId = null;
  state.highlightedDomain = "";
  state.highlightedFlagKey = "";

  try {
    const fromStorage = await getFromStorage(TRACKED_IDS_STORAGE_KEY);
    state.trackedFlagIdsByDomain = sanitizeTrackedIdsByDomain(fromStorage);
  } catch (error) {
    state.trackedFlagIdsByDomain = sanitizeTrackedIdsByDomain(null);
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot read tracked IDs: ${message}`);
  }

  try {
    const fromStorage = await getFromStorage(FLAG_CACHE_STORAGE_KEY);
    state.flagInfoByDomain = sanitizeFlagInfoByDomain(fromStorage);
  } catch (error) {
    state.flagInfoByDomain = sanitizeFlagInfoByDomain(null);
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

  const domains = getDomainsForRender(state.trackedFlagIdsByDomain, currentDomain);
  const currentDomainIds = getTrackedIdsForDomain(currentDomain);
  const isCurrentDomainSupported = isSupportedDomain(currentDomain);
  const isCurrentFlagTracked =
    isCurrentDomainSupported &&
    prefillFlagId !== null &&
    currentDomainIds.includes(prefillFlagId);

  if (isCurrentDomainSupported) {
    state.highlightedDomain = currentDomain;
  }
  if (isCurrentDomainSupported && prefillFlagId !== null) {
    state.highlightedFlagKey = `${currentDomain}::${prefillFlagId}`;
  }

  for (const domain of domains) {
    renderDomainSection(domain, {
      onRemoveDomain: handleRemoveDomain,
      onRefreshDomain: refreshDomainFlags,
      onTrackClick: handleTrackClick
    });
    const ids = getTrackedIdsForDomain(domain);
    for (const id of ids) {
      renderCachedFlag(domain, id);
    }
  }

  if (isCurrentDomainSupported && prefillFlagId !== null && !isCurrentFlagTracked) {
    const ui = state.domainUiByDomain.get(currentDomain);
    if (ui) {
      ui.trackInput.value = String(prefillFlagId);
    }
  }
}

void loadFlagInfo();
setInterval(updateAllLastFetchedLabels, 1000);
