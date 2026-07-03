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
  normalizeText,
  sanitizeCollapsedDomainsByDomain,
  sanitizeExperimentSetupByDomain,
  sanitizeFieldValue,
  sanitizeFlagInfo,
  sanitizeFlagInfoByDomain,
  sanitizeTrackedIdsByDomain
} from "./parsing.js";
import { state } from "./state.js";
import { getFromStorage, setInStorage } from "./storage.js";
import {
  clearFields,
  getFlagKey,
  makeDeleteIconButton,
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
const TARGET_ROLLOUT_MAX_LENGTH = 40;
const EXPERIMENT_SECTION_FLAG_FIELDS = [
  { key: "rolloutFlagId", label: "Rollout flag" },
  { key: "studentAFlagId", label: "Student A flag" },
  { key: "studentBFlagId", label: "Student B flag" },
  { key: "aaFlagId", label: "Is AA experiment" }
];

function sanitizeTargetRolloutValue(value) {
  return normalizeText(value).slice(0, TARGET_ROLLOUT_MAX_LENGTH);
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

function createEmptyExperimentSection(sectionId) {
  return {
    id: sectionId,
    experimentFlagId: null,
    targetRollout: "",
    rolloutFlagId: null,
    studentAFlagId: null,
    studentBFlagId: null,
    aaFlagId: null,
    isAaExperiment: false
  };
}

function getExperimentSectionsForDomain(domain) {
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
  const optionsById = new Map(options.map((option) => [option.id, option]));
  const currentSections = getExperimentSectionsForDomain(EXPERIMENT_SETUP_DOMAIN);
  const normalizedSections = [];
  const usedParentIds = new Set();
  const usedFieldIds = new Set();
  let hasChanged = false;

  for (const section of currentSections) {
    const sectionId = normalizeId(section?.id) ?? normalizedSections.length + 1;
    const nextSection = createEmptyExperimentSection(sectionId);
    nextSection.isAaExperiment = Boolean(section?.isAaExperiment);
    nextSection.targetRollout = sanitizeTargetRolloutValue(section?.targetRollout);
    if (nextSection.targetRollout !== section?.targetRollout) {
      hasChanged = true;
    }
    const experimentFlagId = normalizeId(section?.experimentFlagId);
    const experimentOption = experimentFlagId !== null ? optionsById.get(experimentFlagId) : null;
    if (
      experimentFlagId !== null &&
      optionIds.has(experimentFlagId) &&
      experimentOption &&
      experimentOption.name.startsWith("exp_") &&
      !usedParentIds.has(experimentFlagId)
    ) {
      nextSection.experimentFlagId = experimentFlagId;
      usedParentIds.add(experimentFlagId);
    } else if (experimentFlagId !== null) {
      hasChanged = true;
    }
    for (const field of EXPERIMENT_SECTION_FLAG_FIELDS) {
      const rawId = normalizeId(section?.[field.key]);
      if (field.key === "aaFlagId" && nextSection.isAaExperiment) {
        if (rawId !== null) {
          hasChanged = true;
        }
        continue;
      }
      const option = rawId !== null ? optionsById.get(rawId) : null;
      const hasValidPrefix =
        option &&
        (field.key === "aaFlagId" ? option.name.startsWith("exp_") : option.name.startsWith("flag_"));
      const isSameAsSectionParent =
        field.key === "aaFlagId" && rawId !== null && rawId === normalizeId(nextSection.experimentFlagId);
      const isAvailable =
        rawId !== null &&
        optionIds.has(rawId) &&
        Boolean(hasValidPrefix) &&
        !usedFieldIds.has(rawId) &&
        !isSameAsSectionParent;
      if (isAvailable) {
        nextSection[field.key] = rawId;
        usedFieldIds.add(rawId);
      } else if (rawId !== null) {
        hasChanged = true;
      }
    }
    normalizedSections.push(nextSection);
  }

  if (normalizedSections.length !== currentSections.length) {
    hasChanged = true;
  }
  if (hasChanged) {
    state.experimentSetupByDomain[EXPERIMENT_SETUP_DOMAIN] = normalizedSections;
    void saveExperimentSetup();
  }
  return {
    options,
    sections: hasChanged ? normalizedSections : currentSections
  };
}

function getUsedExperimentFieldIds(sections, ignoredSectionId, ignoredFieldKey) {
  const usedIds = new Set();
  for (const section of sections) {
    for (const field of EXPERIMENT_SECTION_FLAG_FIELDS) {
      if (section.id === ignoredSectionId && field.key === ignoredFieldKey) {
        continue;
      }
      const id = normalizeId(section[field.key]);
      if (id !== null) {
        usedIds.add(id);
      }
    }
  }
  return usedIds;
}

function getUsedSectionParentExperimentIds(sections) {
  const usedParentIds = new Set();
  for (const section of sections) {
    const experimentFlagId = normalizeId(section.experimentFlagId);
    if (experimentFlagId !== null) {
      usedParentIds.add(experimentFlagId);
    }
  }
  return usedParentIds;
}

function getTopExpSeedOptions(options, sections) {
  const usedIds = getUsedSectionParentExperimentIds(sections);
  return options.filter((option) => option.name.startsWith("exp_") && !usedIds.has(option.id));
}

function getFieldOptions(options, sections, sectionId, fieldKey) {
  const usedIds = getUsedExperimentFieldIds(sections, sectionId, fieldKey);
  const currentSection = sections.find((section) => section.id === sectionId);
  const currentSectionParentId = normalizeId(currentSection?.experimentFlagId);
  if (fieldKey === "aaFlagId") {
    return options.filter(
      (option) =>
        option.name.startsWith("exp_") &&
        !usedIds.has(option.id) &&
        option.id !== currentSectionParentId
    );
  }
  return options.filter((option) => option.name.startsWith("flag_") && !usedIds.has(option.id));
}

function createExperimentDeleteIconButton() {
  const button = document.createElement("button");
  button.className = "experiment-field-remove-button";
  button.type = "button";
  button.setAttribute("aria-label", "Clear selected flag");
  button.title = "Clear selected flag";

  const icon = document.createElement("img");
  icon.src = "delete-icon.png";
  icon.alt = "";
  button.append(icon);
  return button;
}

function formatExperimentInlineMetric(rawValue) {
  const displayValue = normalizeText(sanitizeFieldValue(rawValue).displayValue);
  return displayValue || "-";
}

function parsePercentNumber(rawValue) {
  const normalizedValue = normalizeText(rawValue).replace(/,/gu, ".");
  if (!normalizedValue) {
    return null;
  }
  const match = normalizedValue.match(/^(-?\d+(?:\.\d+)?)\s*%?$/u);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function arePercentValuesEqual(rawValue, expectedValue) {
  const actualValue = parsePercentNumber(rawValue);
  if (actualValue === null || typeof expectedValue !== "number" || !Number.isFinite(expectedValue)) {
    return false;
  }
  return Math.abs(actualValue - expectedValue) < 0.000001;
}

function isYesOrTrueValue(rawValue) {
  return /^(yes|true)\b/u.test(normalizeText(rawValue).toLowerCase());
}

function getExperimentFlagMetrics(flagId) {
  const domainFlagInfo = state.flagInfoByDomain[EXPERIMENT_SETUP_DOMAIN];
  if (!domainFlagInfo || typeof domainFlagInfo !== "object") {
    return null;
  }
  const info = sanitizeFlagInfo(domainFlagInfo[flagId]);
  if (!info || info.status !== "ok") {
    return null;
  }
  const everyoneField = sanitizeFieldValue(info.everyone);
  return {
    everyone: formatExperimentInlineMetric(everyoneField),
    everyoneColor: normalizeText(everyoneField.colorValue).toLowerCase(),
    percent: formatExperimentInlineMetric(info.percent),
    audiencePercent: formatExperimentInlineMetric(info.audiencePercent)
  };
}

function getExperimentFlagValidationState(section, fieldKey, flagId) {
  const metrics = getExperimentFlagMetrics(flagId);
  const normalizedEveryoneDisplay = normalizeText(metrics?.everyone).toLowerCase();
  const normalizedEveryoneColor = normalizeText(metrics?.everyoneColor).toLowerCase();
  const isBooleanLikeEveryoneValue =
    /^(true|false)\b/u.test(normalizedEveryoneDisplay) ||
    normalizedEveryoneColor === "true" ||
    normalizedEveryoneColor === "false";
  const isEveryoneValid = !isBooleanLikeEveryoneValue;
  const isAudiencePercentValid = arePercentValuesEqual(metrics?.audiencePercent, 100);

  if (fieldKey === "rolloutFlagId") {
    if (Boolean(section.isAaExperiment)) {
      const isEveryoneValidForAaRollout =
        isYesOrTrueValue(normalizedEveryoneDisplay) || isYesOrTrueValue(normalizedEveryoneColor);
      return {
        isValidated: true,
        hasValidationError: !isEveryoneValidForAaRollout,
        metricStates: {
          everyone: isEveryoneValidForAaRollout,
          percent: null,
          audiencePercent: null
        }
      };
    }
    const targetRolloutPercent = parsePercentNumber(section.targetRollout);
    const isPercentValid = arePercentValuesEqual(metrics?.percent, targetRolloutPercent);
    return {
      isValidated: true,
      hasValidationError: !isEveryoneValid || !isAudiencePercentValid || !isPercentValid,
      metricStates: {
        everyone: isEveryoneValid,
        percent: isPercentValid,
        audiencePercent: isAudiencePercentValid
      }
    };
  }

  if (
    fieldKey === "experimentFlagId" ||
    fieldKey === "studentAFlagId" ||
    fieldKey === "studentBFlagId"
  ) {
    const isPercentValid = arePercentValuesEqual(metrics?.percent, 50);
    return {
      isValidated: true,
      hasValidationError: !isEveryoneValid || !isAudiencePercentValid || !isPercentValid,
      metricStates: {
        everyone: isEveryoneValid,
        percent: isPercentValid,
        audiencePercent: isAudiencePercentValid
      }
    };
  }

  return {
    hasValidationError: false,
    isValidated: false,
    metricStates: {
      everyone: null,
      percent: null,
      audiencePercent: null
    }
  };
}

function createExperimentFlagInlineMeta(flagId, validationState) {
  const metrics = getExperimentFlagMetrics(flagId);
  const container = document.createElement("div");
  container.className = "experiment-flag-inline-meta";
  const badgeValues = metrics
    ? [
        { key: "everyone", value: metrics.everyone },
        { key: "percent", value: metrics.percent },
        { key: "audiencePercent", value: metrics.audiencePercent }
      ]
    : [
        { key: "everyone", value: "-" },
        { key: "percent", value: "-" },
        { key: "audiencePercent", value: "-" }
      ];
  for (const badgeValue of badgeValues) {
    const item = document.createElement("span");
    item.className = "experiment-flag-inline-meta-item";
    const metricIsValid = validationState.metricStates?.[badgeValue.key];
    const shouldShowMetricState = validationState.isValidated && typeof metricIsValid === "boolean";
    item.classList.toggle(
      "experiment-flag-inline-meta-item-error",
      shouldShowMetricState && !metricIsValid
    );
    item.classList.toggle(
      "experiment-flag-inline-meta-item-valid",
      shouldShowMetricState && metricIsValid
    );
    item.textContent = badgeValue.value;
    container.append(item);
  }
  return container;
}

function createExperimentFlagDetails(
  selectedFlag,
  validationState = { hasValidationError: false, isValidated: false, metricStates: null }
) {
  const details = document.createElement("div");
  details.className = "experiment-field-selected-details";
  const badge = document.createElement("span");
  badge.className = "value-badge";
  badge.classList.toggle("value-badge-false", validationState.isValidated && validationState.hasValidationError);
  badge.classList.toggle("value-badge-true", validationState.isValidated && !validationState.hasValidationError);
  badge.textContent = `${selectedFlag.name} (ID ${selectedFlag.id})`;
  details.append(badge, createExperimentFlagInlineMeta(selectedFlag.id, validationState));
  return details;
}

function appendSelectedExperimentFlag(fieldValue, section, selectedFlag, sectionId, fieldKey) {
  fieldValue.className = "experiment-field-selected";
  const validationState = getExperimentFlagValidationState(section, fieldKey, selectedFlag.id);
  const details = createExperimentFlagDetails(selectedFlag, validationState);
  const removeButton = createExperimentDeleteIconButton();
  removeButton.addEventListener("click", () => {
    void handleClearExperimentFlag(sectionId, fieldKey);
  });
  fieldValue.append(details, removeButton);
}

function getDerivedExperimentNameParts(experimentName) {
  if (typeof experimentName !== "string") {
    return null;
  }
  const aaMatch = /^exp_(.+)_tutor_AA$/u.exec(experimentName);
  if (aaMatch) {
    const experimentBaseName = aaMatch[1];
    if (!experimentBaseName) {
      return null;
    }
    return {
      rollout: `flag_${experimentBaseName}_rollout_AA`,
      studentA: `flag_${experimentBaseName}_student_group_A_AA`,
      studentB: `flag_${experimentBaseName}_student_group_B_AA`,
      aa: null
    };
  }

  const mainMatch = /^exp_(.+)_tutor$/u.exec(experimentName);
  if (!mainMatch) {
    return null;
  }
  const experimentBaseName = mainMatch[1];
  if (!experimentBaseName) {
    return null;
  }
  return {
    rollout: `flag_${experimentBaseName}_rollout`,
    studentA: `flag_${experimentBaseName}_student_group_A`,
    studentB: `flag_${experimentBaseName}_student_group_B`,
    aa: `exp_${experimentBaseName}_tutor_AA`
  };
}

function autoAssignExperimentSectionFlags(section, options, sections) {
  const experimentFlagId = normalizeId(section.experimentFlagId);
  if (experimentFlagId === null) {
    return;
  }
  const optionsById = new Map(options.map((option) => [option.id, option]));
  const optionsByName = new Map(options.map((option) => [option.name, option]));
  const experimentOption = optionsById.get(experimentFlagId);
  const expectedNames = getDerivedExperimentNameParts(experimentOption?.name);
  if (!expectedNames) {
    return;
  }

  const usedIds = getUsedExperimentFieldIds(sections, section.id, null);
  const tryAssign = (fieldKey, expectedName, expectedPrefix) => {
    if (typeof expectedName !== "string" || expectedName.length === 0) {
      return;
    }
    if (normalizeId(section[fieldKey]) !== null) {
      return;
    }
    const option = optionsByName.get(expectedName);
    if (!option || !option.name.startsWith(expectedPrefix)) {
      return;
    }
    if (usedIds.has(option.id)) {
      return;
    }
    section[fieldKey] = option.id;
    usedIds.add(option.id);
  };

  tryAssign("rolloutFlagId", expectedNames.rollout, "flag_");
  tryAssign("studentAFlagId", expectedNames.studentA, "flag_");
  tryAssign("studentBFlagId", expectedNames.studentB, "flag_");
  if (!Boolean(section.isAaExperiment)) {
    tryAssign("aaFlagId", expectedNames.aa, "exp_");
  }
}

async function handleSelectExperimentFlag(sectionId, fieldKey, rawFlagId) {
  const selectedFlagId = normalizeId(Number.parseInt(String(rawFlagId), 10));
  if (selectedFlagId === null) {
    return;
  }

  const availableFlagIds = new Set(getExperimentFlagOptions().map((option) => option.id));
  if (!availableFlagIds.has(selectedFlagId)) {
    setError("Selected flag is not available.");
    return;
  }

  const sections = getExperimentSectionsForDomain(EXPERIMENT_SETUP_DOMAIN);
  const section = sections.find((currentSection) => currentSection.id === sectionId);
  if (!section) {
    return;
  }

  const usedIds = getUsedExperimentFieldIds(sections, sectionId, fieldKey);
  if (usedIds.has(selectedFlagId)) {
    setError("Flag already selected in another dropdown.");
    return;
  }

  if (fieldKey === "aaFlagId" && selectedFlagId === normalizeId(section.experimentFlagId)) {
    setError("AA experiment cannot match the section parent experiment.");
    return;
  }

  const availableOptions = getFieldOptions(getExperimentFlagOptions(), sections, sectionId, fieldKey);
  if (!availableOptions.some((option) => option.id === selectedFlagId)) {
    setError("Selected flag is not valid for this field.");
    return;
  }

  section[fieldKey] = selectedFlagId;
  try {
    await saveExperimentSetup();
    renderExperimentSetupSection();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot save experiment setup: ${message}`);
  }
}

async function handleClearExperimentFlag(sectionId, fieldKey) {
  const sections = getExperimentSectionsForDomain(EXPERIMENT_SETUP_DOMAIN);
  const section = sections.find((currentSection) => currentSection.id === sectionId);
  if (!section) {
    return;
  }
  section[fieldKey] = null;
  try {
    await saveExperimentSetup();
    renderExperimentSetupSection();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot save experiment setup: ${message}`);
  }
}

async function handleToggleSectionAaExperiment(sectionId, isAaExperiment) {
  const sections = getExperimentSectionsForDomain(EXPERIMENT_SETUP_DOMAIN);
  const section = sections.find((currentSection) => currentSection.id === sectionId);
  if (!section) {
    return;
  }
  section.isAaExperiment = Boolean(isAaExperiment);
  if (section.isAaExperiment) {
    section.aaFlagId = null;
  }
  try {
    await saveExperimentSetup();
    renderExperimentSetupSection();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot save experiment setup: ${message}`);
  }
}

async function handleUpdateSectionTargetRollout(
  sectionId,
  targetRollout,
  { forceValidationRender = false } = {}
) {
  const sections = getExperimentSectionsForDomain(EXPERIMENT_SETUP_DOMAIN);
  const section = sections.find((currentSection) => currentSection.id === sectionId);
  if (!section) {
    return;
  }
  const nextTargetRollout = sanitizeTargetRolloutValue(targetRollout);
  if (nextTargetRollout === section.targetRollout) {
    if (forceValidationRender) {
      renderExperimentSetupSection();
    }
    return;
  }
  section.targetRollout = nextTargetRollout;
  try {
    await saveExperimentSetup();
    if (forceValidationRender) {
      renderExperimentSetupSection();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot save experiment setup: ${message}`);
  }
}

async function handleAddExperimentSection(rawExperimentFlagId) {
  const experimentFlagId = normalizeId(Number.parseInt(String(rawExperimentFlagId), 10));
  if (experimentFlagId === null) {
    return;
  }

  const sections = getExperimentSectionsForDomain(EXPERIMENT_SETUP_DOMAIN);
  const availableSeedIds = new Set(getTopExpSeedOptions(getExperimentFlagOptions(), sections).map((option) => option.id));
  if (!availableSeedIds.has(experimentFlagId)) {
    setError("Selected main exp flag is not available.");
    return;
  }

  const nextSectionId =
    sections.reduce((maxId, section) => Math.max(maxId, normalizeId(section.id) || 0), 0) + 1;
  const newSection = createEmptyExperimentSection(nextSectionId);
  newSection.experimentFlagId = experimentFlagId;
  autoAssignExperimentSectionFlags(newSection, getExperimentFlagOptions(), sections);
  state.experimentSetupByDomain[EXPERIMENT_SETUP_DOMAIN] = [
    ...sections,
    newSection
  ];
  try {
    await saveExperimentSetup();
    renderExperimentSetupSection();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot save experiment setup: ${message}`);
  }
}

async function handleRemoveExperimentSection(sectionId) {
  const sections = getExperimentSectionsForDomain(EXPERIMENT_SETUP_DOMAIN);
  const nextSections = sections.filter((section) => section.id !== sectionId);
  if (nextSections.length === sections.length) {
    return;
  }
  state.experimentSetupByDomain[EXPERIMENT_SETUP_DOMAIN] = nextSections;
  try {
    await saveExperimentSetup();
    renderExperimentSetupSection();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setError(`Cannot save experiment setup: ${message}`);
  }
}

function renderExperimentSetupSection() {
  const popupMainElement = document.querySelector("main");
  const previousScrollTop = popupMainElement instanceof HTMLElement ? popupMainElement.scrollTop : null;
  const activeElement = document.activeElement;
  const activeTargetRolloutInput =
    activeElement instanceof HTMLInputElement && activeElement.id.startsWith("target-rollout-")
      ? {
          id: activeElement.id,
          selectionStart: activeElement.selectionStart,
          selectionEnd: activeElement.selectionEnd
        }
      : null;

  const addSectionButton = document.getElementById("experiment-setup-add-section-button");
  const createSelect = document.getElementById("experiment-setup-create-select");
  const listElement = document.getElementById("experiment-setup-list");
  const emptyElement = document.getElementById("experiment-setup-empty");
  if (
    !(addSectionButton instanceof HTMLButtonElement) ||
    !(createSelect instanceof HTMLSelectElement) ||
    !(listElement instanceof HTMLElement) ||
    !(emptyElement instanceof HTMLElement)
  ) {
    return;
  }

  const { options, sections } = reconcileExperimentSetup();
  const optionsById = new Map(options.map((option) => [option.id, option]));
  const previousCreateValue = createSelect.value;
  const seedOptions = getTopExpSeedOptions(options, sections);
  createSelect.replaceChildren();
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Select main exp flag";
  createSelect.append(defaultOption);
  for (const option of seedOptions) {
    const optionElement = document.createElement("option");
    optionElement.value = String(option.id);
    optionElement.textContent = `${option.name} (ID ${option.id})`;
    createSelect.append(optionElement);
  }
  if (seedOptions.some((option) => String(option.id) === previousCreateValue)) {
    createSelect.value = previousCreateValue;
  }
  const canAddSection = seedOptions.length > 0;
  addSectionButton.disabled = !canAddSection;
  createSelect.disabled = !canAddSection;

  listElement.replaceChildren();
  for (const [sectionIndex, section] of sections.entries()) {
    const item = document.createElement("li");
    item.className = "experiment-section-card";

    const sectionExperimentFlagId = normalizeId(section.experimentFlagId);
    const sectionExperimentFlag =
      sectionExperimentFlagId !== null ? optionsById.get(sectionExperimentFlagId) : null;
    const header = document.createElement("div");
    header.className = "experiment-section-header";
    const title = document.createElement("h3");
    title.className = "experiment-section-title";
    const sectionName = sectionExperimentFlagId
      ? sectionExperimentFlag?.name || `Section ${sectionIndex + 1}`
      : `Section ${sectionIndex + 1}`;
    title.textContent = sectionName;
    const removeSectionButton = document.createElement("button");
    removeSectionButton.className = "experiment-section-remove-icon-button";
    removeSectionButton.type = "button";
    makeDeleteIconButton(removeSectionButton, "Remove section");
    removeSectionButton.addEventListener("click", () => {
      void handleRemoveExperimentSection(section.id);
    });
    header.append(title, removeSectionButton);
    item.append(header);
    if (sectionExperimentFlag) {
      const sectionExperimentValidation = getExperimentFlagValidationState(
        section,
        "experimentFlagId",
        sectionExperimentFlag.id
      );
      const sectionExperimentMeta = createExperimentFlagDetails(
        sectionExperimentFlag,
        sectionExperimentValidation
      );
      sectionExperimentMeta.classList.add("experiment-section-main-flag");
      item.append(sectionExperimentMeta);
    }

    if (!Boolean(section.isAaExperiment)) {
      const targetRolloutRow = document.createElement("div");
      targetRolloutRow.className = "experiment-field-row";
      const targetRolloutLabel = document.createElement("label");
      targetRolloutLabel.className = "experiment-field-label";
      targetRolloutLabel.textContent = "Target rollout";
      const targetRolloutInput = document.createElement("input");
      targetRolloutInput.className = "experiment-field-text-input";
      targetRolloutInput.type = "text";
      targetRolloutInput.placeholder = "e.g. 50%";
      targetRolloutInput.maxLength = TARGET_ROLLOUT_MAX_LENGTH;
      targetRolloutInput.value = sanitizeTargetRolloutValue(section.targetRollout);
      targetRolloutInput.addEventListener("input", () => {
        void handleUpdateSectionTargetRollout(section.id, targetRolloutInput.value, {
          forceValidationRender: true
        });
      });
      targetRolloutLabel.htmlFor = `target-rollout-${section.id}`;
      targetRolloutInput.id = `target-rollout-${section.id}`;
      targetRolloutRow.append(targetRolloutLabel, targetRolloutInput);
      item.append(targetRolloutRow);
    }

    for (const field of EXPERIMENT_SECTION_FLAG_FIELDS) {
      const row = document.createElement("div");
      row.className = "experiment-field-row";

      const label = document.createElement("div");
      label.className = "experiment-field-label";

      const selectedFlagId = normalizeId(section[field.key]);
      const selectedFlag = selectedFlagId !== null ? optionsById.get(selectedFlagId) : null;
      const fieldValue = document.createElement("div");
      const isAaField = field.key === "aaFlagId";
      const isAaExperiment = Boolean(section.isAaExperiment);
      const hasSelectedValue = selectedFlagId !== null && Boolean(selectedFlag);

      if (isAaField && hasSelectedValue) {
        label.textContent = "AA experiment";
        appendSelectedExperimentFlag(fieldValue, section, selectedFlag, section.id, field.key);
      } else if (isAaField) {
        label.classList.add("experiment-field-label-with-checkbox");
        const labelText = document.createElement("span");
        labelText.textContent = field.label;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "experiment-aa-checkbox";
        checkbox.checked = isAaExperiment;
        checkbox.addEventListener("change", () => {
          void handleToggleSectionAaExperiment(section.id, checkbox.checked);
        });
        label.append(labelText, checkbox);

        if (!isAaExperiment) {
          const select = document.createElement("select");
          select.className = "experiment-field-select";
          const defaultOption = document.createElement("option");
          defaultOption.value = "";
          defaultOption.textContent = "Select flag";
          select.append(defaultOption);

          const availableOptions = getFieldOptions(options, sections, section.id, field.key);
          for (const option of availableOptions) {
            const optionElement = document.createElement("option");
            optionElement.value = String(option.id);
            optionElement.textContent = `${option.name} (ID ${option.id})`;
            select.append(optionElement);
          }
          if (selectedFlagId !== null) {
            select.value = String(selectedFlagId);
          }
          select.disabled = availableOptions.length === 0;
          select.addEventListener("change", () => {
            if (select.value === "") {
              void handleClearExperimentFlag(section.id, field.key);
              return;
            }
            void handleSelectExperimentFlag(section.id, field.key, select.value);
          });
          row.classList.toggle("experiment-field-row-error", selectedFlagId === null);
          fieldValue.append(select);
        }
      } else {
        label.textContent = field.label;

        if (hasSelectedValue) {
          appendSelectedExperimentFlag(fieldValue, section, selectedFlag, section.id, field.key);
        } else {
          const select = document.createElement("select");
          select.className = "experiment-field-select";
          const defaultOption = document.createElement("option");
          defaultOption.value = "";
          defaultOption.textContent = "Select flag";
          select.append(defaultOption);

          const availableOptions = getFieldOptions(options, sections, section.id, field.key);
          for (const option of availableOptions) {
            const optionElement = document.createElement("option");
            optionElement.value = String(option.id);
            optionElement.textContent = `${option.name} (ID ${option.id})`;
            select.append(optionElement);
          }
          select.disabled = availableOptions.length === 0;
          select.addEventListener("change", () => {
            void handleSelectExperimentFlag(section.id, field.key, select.value);
          });
          fieldValue.append(select);
        }
      }

      row.append(label, fieldValue);
      item.append(row);
    }

    listElement.append(item);
  }

  emptyElement.toggleAttribute("hidden", listElement.childElementCount > 0);

  if (popupMainElement instanceof HTMLElement && typeof previousScrollTop === "number") {
    popupMainElement.scrollTop = previousScrollTop;
  }

  if (activeTargetRolloutInput) {
    const nextActiveInput = document.getElementById(activeTargetRolloutInput.id);
    if (nextActiveInput instanceof HTMLInputElement) {
      nextActiveInput.focus();
      if (
        typeof activeTargetRolloutInput.selectionStart === "number" &&
        typeof activeTargetRolloutInput.selectionEnd === "number"
      ) {
        nextActiveInput.setSelectionRange(
          activeTargetRolloutInput.selectionStart,
          activeTargetRolloutInput.selectionEnd
        );
      }
    }
  }
}

function setupExperimentSetupUi() {
  const addButton = document.getElementById("experiment-setup-add-section-button");
  const createSelect = document.getElementById("experiment-setup-create-select");
  if (!(addButton instanceof HTMLButtonElement) || !(createSelect instanceof HTMLSelectElement)) {
    return;
  }

  const handleAdd = () => {
    void handleAddExperimentSection(createSelect.value);
  };
  addButton.addEventListener("click", () => {
    handleAdd();
  });
  createSelect.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    handleAdd();
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
