import {
  COLLAPSED_DOMAINS_STORAGE_KEY,
  DEFAULT_POPUP_HEIGHT,
  DEFAULT_POPUP_WIDTH,
  EXPERIMENT_SETUP_STORAGE_KEY,
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
  sanitizeExperimentSetupByDomain,
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

const EXPERIMENT_SETUP_DOMAIN = "crew.preply.com";
let pendingExperimentRemoveId = null;

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

function setupTabsUi() {
  const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]")).filter(
    (element) => element instanceof HTMLButtonElement
  );
  const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]")).filter(
    (element) => element instanceof HTMLElement
  );

  if (tabButtons.length === 0 || tabPanels.length === 0) {
    return;
  }

  const activateTab = (targetTab) => {
    for (const button of tabButtons) {
      const isActive = button.dataset.tabTarget === targetTab;
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive) {
        button.focus();
      }
    }

    for (const panel of tabPanels) {
      const isActive = panel.dataset.tabPanel === targetTab;
      panel.toggleAttribute("hidden", !isActive);
    }
  };

  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      const targetTab = button.dataset.tabTarget || "";
      if (!targetTab) {
        return;
      }
      activateTab(targetTab);
    });

    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
        return;
      }
      event.preventDefault();
      const currentIndex = tabButtons.indexOf(button);
      if (currentIndex < 0) {
        return;
      }
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + tabButtons.length) % tabButtons.length;
      const nextButton = tabButtons[nextIndex];
      const nextTab = nextButton.dataset.tabTarget || "";
      if (nextTab) {
        activateTab(nextTab);
      }
    });
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

async function saveExperimentSetup() {
  await setInStorage({ [EXPERIMENT_SETUP_STORAGE_KEY]: state.experimentSetupByDomain });
}

function getTrackedIdsForDomain(domain) {
  return Array.isArray(state.trackedFlagIdsByDomain[domain])
    ? state.trackedFlagIdsByDomain[domain]
    : [];
}

function getExperimentSetupIdsForDomain(domain) {
  return Array.isArray(state.experimentSetupByDomain[domain]) ? state.experimentSetupByDomain[domain] : [];
}

function getExperimentFlagOptions() {
  const trackedIds = getTrackedIdsForDomain(EXPERIMENT_SETUP_DOMAIN);
  const domainFlagInfo = state.flagInfoByDomain[EXPERIMENT_SETUP_DOMAIN];
  if (!domainFlagInfo || typeof domainFlagInfo !== "object" || trackedIds.length === 0) {
    return [];
  }

  const options = [];
  for (const id of trackedIds) {
    const info = sanitizeFlagInfo(domainFlagInfo[id]);
    if (!info || info.status !== "ok" || typeof info.flagName !== "string") {
      continue;
    }
    if (!info.flagName.startsWith("exp_")) {
      continue;
    }
    options.push({
      id,
      name: info.flagName
    });
  }

  options.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }
    return left.id - right.id;
  });

  return options;
}

function reconcileExperimentSetup() {
  const options = getExperimentFlagOptions();
  const optionIds = new Set(options.map((option) => option.id));
  const selectedIds = getExperimentSetupIdsForDomain(EXPERIMENT_SETUP_DOMAIN);
  const filteredIds = selectedIds.filter((id) => optionIds.has(id));
  const hasChanged = filteredIds.length !== selectedIds.length;
  if (hasChanged) {
    state.experimentSetupByDomain[EXPERIMENT_SETUP_DOMAIN] = filteredIds;
    void saveExperimentSetup();
  }
  return options;
}

function renderExperimentSetupSection() {
  const selectElement = document.getElementById("experiment-flag-select");
  const addButton = document.getElementById("experiment-setup-add-button");
  const listElement = document.getElementById("experiment-setup-list");
  const emptyElement = document.getElementById("experiment-setup-empty");
  if (
    !(selectElement instanceof HTMLSelectElement) ||
    !(addButton instanceof HTMLButtonElement) ||
    !(listElement instanceof HTMLElement) ||
    !(emptyElement instanceof HTMLElement)
  ) {
    return;
  }

  const options = reconcileExperimentSetup();
  const selectedIds = getExperimentSetupIdsForDomain(EXPERIMENT_SETUP_DOMAIN);
  const selectedIdSet = new Set(selectedIds);

  selectElement.replaceChildren();
  const selectableOptions = options.filter((option) => !selectedIdSet.has(option.id));
  if (selectableOptions.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No tracked exp_ flags available";
    selectElement.append(option);
    selectElement.disabled = true;
    addButton.disabled = true;
  } else {
    for (const optionInfo of selectableOptions) {
      const option = document.createElement("option");
      option.value = String(optionInfo.id);
      option.textContent = `${optionInfo.name} (ID ${optionInfo.id})`;
      selectElement.append(option);
    }
    selectElement.disabled = false;
    addButton.disabled = false;
  }

  listElement.replaceChildren();
  const selectedById = new Map(options.map((option) => [option.id, option]));
  for (const id of selectedIds) {
    const option = selectedById.get(id);
    if (!option) {
      continue;
    }

    const item = document.createElement("li");
    item.className = "experiment-setup-item";

    const itemLabel = document.createElement("div");
    itemLabel.className = "experiment-setup-item-label";
    itemLabel.textContent = `${option.name} (ID ${id})`;

    const actions = document.createElement("div");
    actions.className = "experiment-setup-item-actions";
    if (pendingExperimentRemoveId === id) {
      const confirmButton = document.createElement("button");
      confirmButton.className = "experiment-setup-confirm-button";
      confirmButton.type = "button";
      confirmButton.textContent = "Confirm";
      confirmButton.addEventListener("click", () => {
        void handleRemoveExperimentFlag(id);
      });

      const cancelButton = document.createElement("button");
      cancelButton.className = "experiment-setup-cancel-button";
      cancelButton.type = "button";
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", () => {
        pendingExperimentRemoveId = null;
        renderExperimentSetupSection();
      });

      actions.append(confirmButton, cancelButton);
    } else {
      const removeButton = document.createElement("button");
      removeButton.className = "experiment-setup-remove-button";
      removeButton.type = "button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        pendingExperimentRemoveId = id;
        renderExperimentSetupSection();
      });
      actions.append(removeButton);
    }

    item.append(itemLabel, actions);
    listElement.append(item);
  }

  emptyElement.toggleAttribute("hidden", listElement.childElementCount > 0);
}

async function handleAddExperimentFlag() {
  setError("");
  const selectElement = document.getElementById("experiment-flag-select");
  if (!(selectElement instanceof HTMLSelectElement)) {
    return;
  }
  const parsedId = Number.parseInt(selectElement.value, 10);
  const selectedId = normalizeId(parsedId);
  if (selectedId === null) {
    return;
  }

  const selectedIds = getExperimentSetupIdsForDomain(EXPERIMENT_SETUP_DOMAIN);
  if (selectedIds.includes(selectedId)) {
    return;
  }

  const availableIdSet = new Set(getExperimentFlagOptions().map((option) => option.id));
  if (!availableIdSet.has(selectedId)) {
    setError("Flag not available for experiment setup.");
    return;
  }

  state.experimentSetupByDomain[EXPERIMENT_SETUP_DOMAIN] = [...selectedIds, selectedId];
  try {
    await saveExperimentSetup();
    renderExperimentSetupSection();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot save experiment setup: ${message}`);
  }
}

async function handleRemoveExperimentFlag(id) {
  const selectedIds = getExperimentSetupIdsForDomain(EXPERIMENT_SETUP_DOMAIN);
  if (!selectedIds.includes(id)) {
    return;
  }

  pendingExperimentRemoveId = null;
  state.experimentSetupByDomain[EXPERIMENT_SETUP_DOMAIN] = selectedIds.filter(
    (selectedId) => selectedId !== id
  );
  try {
    await saveExperimentSetup();
    renderExperimentSetupSection();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot save experiment setup: ${message}`);
  }
}

function setupExperimentSetupUi() {
  const addButton = document.getElementById("experiment-setup-add-button");
  const selectElement = document.getElementById("experiment-flag-select");
  if (!(addButton instanceof HTMLButtonElement) || !(selectElement instanceof HTMLSelectElement)) {
    return;
  }

  addButton.addEventListener("click", () => {
    void handleAddExperimentFlag();
  });
  selectElement.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    void handleAddExperimentFlag();
  });
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
    renderExperimentSetupSection();
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
  delete state.experimentSetupByDomain[domain];
  try {
    await Promise.all([
      saveTrackedIds(),
      saveFlagInfoCache(),
      saveCollapsedDomains(),
      saveExperimentSetup()
    ]);
    renderExperimentSetupSection();
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
    renderExperimentSetupSection();
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
    renderExperimentSetupSection();
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
    renderExperimentSetupSection();
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
    const fromStorage = await getFromStorage(EXPERIMENT_SETUP_STORAGE_KEY);
    state.experimentSetupByDomain = sanitizeExperimentSetupByDomain(fromStorage);
  } catch (error) {
    state.experimentSetupByDomain = sanitizeExperimentSetupByDomain(null);
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot read experiment setup: ${message}`);
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

  renderExperimentSetupSection();
}

async function initializePopup() {
  setupTabsUi();
  setupPopupSettingsUi();
  setupExperimentSetupUi();
  await loadPopupSettings();
  await loadFlagInfo();
}

void initializePopup();
setInterval(updateAllLastFetchedLabels, 1000);
