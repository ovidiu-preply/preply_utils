import {
  COLLAPSED_DOMAINS_STORAGE_KEY,
  DEFAULT_POPUP_HEIGHT,
  DEFAULT_POPUP_WIDTH,
  FLAG_CACHE_STORAGE_KEY,
  MAX_POPUP_HEIGHT,
  MAX_POPUP_WIDTH,
  MIN_POPUP_DIMENSION,
  POPUP_SETTINGS_STORAGE_KEY,
  TRACKED_IDS_STORAGE_KEY
} from "./constants.js";
import { fetchFlagInfo, getCurrentTabInfo, getDomainsForRender, isSupportedDomain } from "./fetching.js";
import {
  sanitizeCollapsedDomainsByDomain,
  sanitizeFlagInfo,
  sanitizeFlagInfoByDomain,
  sanitizeTrackedIdsByDomain
} from "./parsing.js";
import { state } from "./state.js";
import { getFromStorage, setInStorage } from "./storage.js";
import {
  clearFields,
  getFlagKey,
  renderDomainSection,
  renderFlagBlock,
  setError,
  setRefreshButtonLoadingState,
  updateDomainFlagCount,
  updateAllLastFetchedLabels
} from "./ui.js";

function normalizeId(id) {
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sanitizePopupDimension(value, fallbackValue, maxValue) {
  const parsedValue = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsedValue)) {
    return fallbackValue;
  }
  if (parsedValue < MIN_POPUP_DIMENSION) {
    return MIN_POPUP_DIMENSION;
  }
  if (parsedValue > maxValue) {
    return maxValue;
  }
  return parsedValue;
}

function sanitizePopupSettings(rawSettings) {
  const settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  return {
    width: sanitizePopupDimension(settings.width, DEFAULT_POPUP_WIDTH, MAX_POPUP_WIDTH),
    height: sanitizePopupDimension(settings.height, DEFAULT_POPUP_HEIGHT, MAX_POPUP_HEIGHT)
  };
}

function applyPopupSettings(settings) {
  document.documentElement.style.width = `${settings.width}px`;
  document.documentElement.style.height = `${settings.height}px`;
  document.body.style.width = `${settings.width}px`;
  document.body.style.height = `${settings.height}px`;
}

function syncPopupSettingsForm(settings) {
  const widthInput = document.getElementById("popup-width-input");
  const heightInput = document.getElementById("popup-height-input");
  if (!(widthInput instanceof HTMLInputElement) || !(heightInput instanceof HTMLInputElement)) {
    return;
  }
  widthInput.value = String(settings.width);
  heightInput.value = String(settings.height);
}

function getPopupSettingsFromForm() {
  const widthInput = document.getElementById("popup-width-input");
  const heightInput = document.getElementById("popup-height-input");
  if (!(widthInput instanceof HTMLInputElement) || !(heightInput instanceof HTMLInputElement)) {
    return state.popupSettings;
  }
  return sanitizePopupSettings({
    width: widthInput.value,
    height: heightInput.value
  });
}

async function loadPopupSettings() {
  try {
    const rawSettings = await getFromStorage(POPUP_SETTINGS_STORAGE_KEY);
    state.popupSettings = sanitizePopupSettings(rawSettings);
  } catch (error) {
    state.popupSettings = sanitizePopupSettings(null);
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot read popup settings: ${message}`);
  }
  applyPopupSettings(state.popupSettings);
  syncPopupSettingsForm(state.popupSettings);
}

async function savePopupSettings() {
  const settings = getPopupSettingsFromForm();
  state.popupSettings = settings;
  applyPopupSettings(settings);
  syncPopupSettingsForm(settings);
  try {
    await setInStorage({ [POPUP_SETTINGS_STORAGE_KEY]: settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot save popup settings: ${message}`);
  }
}

function setupPopupSettingsUi() {
  const settingsToggleButton = document.getElementById("settings-toggle");
  const settingsPanel = document.getElementById("settings-panel");
  const saveSettingsButton = document.getElementById("save-settings-button");
  const widthInput = document.getElementById("popup-width-input");
  const heightInput = document.getElementById("popup-height-input");

  if (!(settingsToggleButton instanceof HTMLButtonElement) || !(settingsPanel instanceof HTMLElement)) {
    return;
  }

  settingsToggleButton.setAttribute("aria-expanded", "false");
  settingsToggleButton.addEventListener("click", () => {
    const isOpen = !settingsPanel.hasAttribute("hidden");
    settingsPanel.toggleAttribute("hidden", isOpen);
    settingsToggleButton.setAttribute("aria-expanded", isOpen ? "false" : "true");
  });

  if (saveSettingsButton instanceof HTMLButtonElement) {
    saveSettingsButton.addEventListener("click", () => {
      void savePopupSettings();
    });
  }

  const handleSubmitOnEnter = (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void savePopupSettings();
  };

  if (widthInput instanceof HTMLInputElement) {
    widthInput.addEventListener("keydown", handleSubmitOnEnter);
  }
  if (heightInput instanceof HTMLInputElement) {
    heightInput.addEventListener("keydown", handleSubmitOnEnter);
  }
}

async function saveTrackedIds() {
  await setInStorage({ [TRACKED_IDS_STORAGE_KEY]: state.trackedFlagIdsByDomain });
}

async function saveFlagInfoCache() {
  await setInStorage({ [FLAG_CACHE_STORAGE_KEY]: state.flagInfoByDomain });
}

async function saveCollapsedDomains() {
  await setInStorage({ [COLLAPSED_DOMAINS_STORAGE_KEY]: state.collapsedDomainsByDomain });
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
  delete state.collapsedDomainsByDomain[domain];
  try {
    await Promise.all([saveTrackedIds(), saveFlagInfoCache(), saveCollapsedDomains()]);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot remove domain: ${message}`);
    return false;
  }
}

function isDomainCollapsed(domain) {
  return Boolean(state.collapsedDomainsByDomain[domain]);
}

async function handleToggleDomainCollapse(domain, isCollapsed) {
  state.collapsedDomainsByDomain[domain] = isCollapsed;
  try {
    await saveCollapsedDomains();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot save collapsed domains: ${message}`);
  }
}

async function fetchAndRenderFlag(domain, id) {
  renderFlagBlock(
    { domain, id, status: "loading" },
    { onRemoveFlag: handleRemoveFlag, onReorderFlags: handleReorderFlags }
  );
  const info = await fetchFlagInfo(domain, id);
  const fetchedInfo = {
    ...info,
    lastFetchedAt: Date.now()
  };
  renderFlagBlock(fetchedInfo, { onRemoveFlag: handleRemoveFlag, onReorderFlags: handleReorderFlags });
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
    renderFlagBlock(
      { domain, id, status: "idle" },
      { onRemoveFlag: handleRemoveFlag, onReorderFlags: handleReorderFlags }
    );
    return;
  }

  renderFlagBlock(
    { domain, id, ...cachedInfo },
    { onRemoveFlag: handleRemoveFlag, onReorderFlags: handleReorderFlags }
  );
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
    updateDomainFlagCount(domain);
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

async function handleReorderFlags(domain, orderedIds) {
  const currentIds = getTrackedIdsForDomain(domain);
  if (orderedIds.length !== currentIds.length) {
    return;
  }
  const orderedSet = new Set(orderedIds);
  if (orderedSet.size !== currentIds.length) {
    return;
  }
  if (currentIds.some((id) => !orderedSet.has(id))) {
    return;
  }
  const isSameOrder = currentIds.every((id, index) => id === orderedIds[index]);
  if (isSameOrder) {
    return;
  }

  state.trackedFlagIdsByDomain[domain] = orderedIds;
  try {
    await saveTrackedIds();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot reorder tracked IDs: ${message}`);
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
    const fromStorage = await getFromStorage(COLLAPSED_DOMAINS_STORAGE_KEY);
    state.collapsedDomainsByDomain = sanitizeCollapsedDomainsByDomain(fromStorage);
  } catch (error) {
    state.collapsedDomainsByDomain = sanitizeCollapsedDomainsByDomain(null);
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot read collapsed domains: ${message}`);
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
      onTrackClick: handleTrackClick,
      onReorderFlags: handleReorderFlags,
      onToggleDomainCollapse: handleToggleDomainCollapse,
      isDomainCollapsed
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

async function initializePopup() {
  setupPopupSettingsUi();
  await loadPopupSettings();
  await loadFlagInfo();
}

void initializePopup();
setInterval(updateAllLastFetchedLabels, 1000);
