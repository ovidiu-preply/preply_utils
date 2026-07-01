import { STALE_FETCH_THRESHOLD_MS } from "./constants.js";
import { normalizeText, sanitizeFieldValue } from "./parsing.js";
import { state } from "./state.js";

export function setError(message) {
  const errorElement = document.getElementById("error");
  if (!errorElement) {
    return;
  }
  errorElement.textContent = message;
}

function getFieldsList() {
  return document.getElementById("fields");
}

export function clearFields() {
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

function createPercentagesLine(percent, audiencePercent) {
  const line = document.createElement("li");
  line.className = "field-row";

  const labelElement = document.createElement("div");
  labelElement.className = "label";
  labelElement.textContent = "Percent / Audience percent";

  const valuesContainer = document.createElement("div");
  valuesContainer.style.display = "inline-flex";
  valuesContainer.style.alignItems = "center";
  valuesContainer.style.flexWrap = "wrap";
  valuesContainer.style.gap = "6px";
  valuesContainer.append(
    createValueLine("Percent", percent).lastElementChild,
    createValueLine("Audience percent", audiencePercent).lastElementChild
  );

  line.append(labelElement, valuesContainer);
  return line;
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

function createFlagErrorBadge(label) {
  const badge = document.createElement("span");
  badge.className = "value-badge value-badge-false";
  badge.style.fontSize = "13px";
  badge.style.marginRight = "6px";
  badge.textContent = label;
  return badge;
}

function getFlagErrorBadgeText(status) {
  if (status === "not_found") {
    return "NOT FOUND";
  }
  if (status === "fetch_failed") {
    return "FETCH FAILED";
  }
  if (status === "idle") {
    return "NOT LOADED";
  }
  if (status === "loading") {
    return "LOADING";
  }
  return "FETCH FAILED";
}

function createIterationBadge(label, tooltip) {
  const badge = document.createElement("span");
  badge.className = "value-badge";
  badge.style.fontSize = "12px";
  badge.style.marginLeft = "2px";
  badge.style.color = "#4338ca";
  badge.style.background = "#e0e7ff";
  badge.style.borderColor = "#a5b4fc";
  badge.textContent = label;
  if (tooltip) {
    badge.title = tooltip;
    badge.setAttribute("aria-label", tooltip);
  }
  return badge;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  helper.style.pointerEvents = "none";
  document.body.append(helper);
  helper.select();
  document.execCommand("copy");
  helper.remove();
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

export function updateAllLastFetchedLabels() {
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

function makeCopyIconButton(button, label) {
  makeIconButton(button, { label, iconSrc: "copy-icon.png", size: 13 });
}

function setDomainHeaderTriggerState(trigger, domain, isCollapsed) {
  const action = isCollapsed ? "Expand" : "Collapse";
  trigger.setAttribute("aria-label", `${action} ${domain}`);
  trigger.title = `${action} ${domain}`;
  trigger.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
}

export function setRefreshButtonLoadingState(button, isLoading) {
  button.disabled = isLoading;
  button.classList.toggle("is-loading", isLoading);
  const label = isLoading ? "Refreshing" : "Refresh";
  button.setAttribute("aria-label", label);
  button.title = label;
}

export function getFlagKey(flagInfo) {
  return `${flagInfo.domain}::${flagInfo.id}`;
}

function formatDomainFlagCount(count) {
  return `${count} flag${count === 1 ? "" : "s"}`;
}

function setDomainFlagCount(domain, count) {
  const ui = state.domainUiByDomain.get(domain);
  if (!ui || !(ui.domainCountBadge instanceof HTMLElement)) {
    return;
  }
  ui.domainCountBadge.textContent = formatDomainFlagCount(count);
}

export function updateDomainFlagCount(domain) {
  const ui = state.domainUiByDomain.get(domain);
  if (!ui || !(ui.domainFlagsList instanceof HTMLElement)) {
    return;
  }
  const count = ui.domainFlagsList.querySelectorAll("[data-flag-id]").length;
  setDomainFlagCount(domain, count);
}

function createTrackRow(domain, onTrackClick) {
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
    void onTrackClick(domain);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void onTrackClick(domain);
    }
  });

  row.append(input, button);
  return { row, input };
}

export function renderDomainSection(domain, callbacks) {
  const {
    onRemoveDomain,
    onRefreshDomain,
    onTrackClick,
    onReorderFlags,
    onToggleDomainCollapse,
    isDomainCollapsed
  } = callbacks;
  const fieldsList = getFieldsList();
  if (!fieldsList) {
    return;
  }

  const domainSection = document.createElement("li");
  domainSection.classList.add("domain-card");
  const domainHeaderRow = document.createElement("div");
  domainHeaderRow.className = "domain-header-row";
  domainHeaderRow.setAttribute("role", "button");
  domainHeaderRow.tabIndex = 0;

  const domainTitle = document.createElement("div");
  domainTitle.className = "value domain-title";
  domainTitle.textContent = domain;
  const domainCountBadge = document.createElement("span");
  domainCountBadge.className = "domain-count-badge";
  domainCountBadge.textContent = formatDomainFlagCount(0);

  const collapseIndicator = document.createElement("span");
  collapseIndicator.className = "domain-collapse-indicator";
  collapseIndicator.setAttribute("aria-hidden", "true");
  const collapseIndicatorIcon = document.createElement("img");
  collapseIndicatorIcon.className = "domain-collapse-indicator-icon";
  collapseIndicatorIcon.src = "domain-collapse-arrow-down.png";
  collapseIndicatorIcon.alt = "";
  collapseIndicator.append(collapseIndicatorIcon);

  domainHeaderRow.append(collapseIndicator, domainTitle, domainCountBadge);
  if (domain === state.highlightedDomain) {
    domainHeaderRow.append(createContextBadge("Current page"));
  }

  const removeDomainButton = document.createElement("button");
  removeDomainButton.className = "remove-domain-button";
  removeDomainButton.type = "button";
  makeDeleteIconButton(removeDomainButton, "Remove domain");
  removeDomainButton.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  removeDomainButton.addEventListener("click", () => {
    void onRemoveDomain(domain, domainSection);
  });

  const refreshButton = document.createElement("button");
  refreshButton.className = "refresh-domain-button";
  refreshButton.type = "button";
  makeRefreshIconButton(refreshButton, "Refresh");
  refreshButton.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  refreshButton.addEventListener("click", () => {
    void onRefreshDomain(domain);
  });

  domainHeaderRow.append(refreshButton, removeDomainButton);
  domainSection.append(domainHeaderRow);

  const { row: trackRow, input: trackInput } = createTrackRow(domain, onTrackClick);
  domainSection.append(trackRow);

  const domainFlagsList = document.createElement("ul");
  domainFlagsList.setAttribute("data-domain-flags", domain);
  domainFlagsList.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  domainFlagsList.addEventListener("drop", (event) => {
    event.preventDefault();
    const draggingBlock = domainFlagsList.querySelector(".flag-card-dragging");
    if (!draggingBlock) {
      return;
    }
    domainFlagsList.append(draggingBlock);
    clearFlagDropTargets();
    notifyFlagsReordered(domain, domainFlagsList, onReorderFlags);
  });
  domainSection.append(domainFlagsList);

  const setCollapsed = (isCollapsed) => {
    trackRow.toggleAttribute("hidden", isCollapsed);
    domainFlagsList.toggleAttribute("hidden", isCollapsed);
    domainSection.classList.toggle("domain-card-collapsed", isCollapsed);
    collapseIndicator.classList.toggle("is-collapsed", isCollapsed);
    setDomainHeaderTriggerState(domainHeaderRow, domain, isCollapsed);
    const ui = state.domainUiByDomain.get(domain);
    if (ui) {
      ui.isCollapsed = isCollapsed;
    }
  };

  const toggleCollapsedState = () => {
    const ui = state.domainUiByDomain.get(domain);
    if (!ui) {
      return;
    }
    const nextCollapsed = !ui.isCollapsed;
    ui.setCollapsed(nextCollapsed);
    if (typeof onToggleDomainCollapse === "function") {
      void onToggleDomainCollapse(domain, nextCollapsed);
    }
  };

  domainHeaderRow.addEventListener("click", toggleCollapsedState);
  domainHeaderRow.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    toggleCollapsedState();
  });

  const initialCollapsed =
    typeof isDomainCollapsed === "function" ? Boolean(isDomainCollapsed(domain)) : false;

  fieldsList.append(domainSection);
  state.domainUiByDomain.set(domain, {
    trackInput,
    trackRow,
    domainFlagsList,
    refreshButton,
    domainCountBadge,
    domainHeaderTrigger: domainHeaderRow,
    isCollapsed: false,
    setCollapsed
  });
  setCollapsed(initialCollapsed);
  updateDomainFlagCount(domain);
}

function getDomainFlagsList(domain) {
  const ui = state.domainUiByDomain.get(domain);
  return ui ? ui.domainFlagsList : null;
}

function clearFlagDropTargets() {
  const dropTargets = document.querySelectorAll(".flag-card-drop-target");
  for (const dropTarget of dropTargets) {
    dropTarget.classList.remove("flag-card-drop-target");
  }
}

function getOrderedFlagIds(domainFlagsList) {
  const idElements = domainFlagsList.querySelectorAll("[data-flag-id]");
  const ids = [];
  for (const idElement of idElements) {
    const rawId = idElement.getAttribute("data-flag-id");
    const id = Number.parseInt(rawId || "", 10);
    if (Number.isInteger(id) && id > 0) {
      ids.push(id);
    }
  }
  return ids;
}

function notifyFlagsReordered(domain, domainFlagsList, onReorderFlags) {
  if (typeof onReorderFlags !== "function") {
    return;
  }
  const orderedIds = getOrderedFlagIds(domainFlagsList);
  void onReorderFlags(domain, orderedIds);
}

export function renderFlagBlock(flagInfo, callbacks) {
  const { onRemoveFlag, onReorderFlags } = callbacks;
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
  block.setAttribute("data-flag-id", String(flagInfo.id));
  block.draggable = true;
  block.ondragstart = (event) => {
    block.classList.add("flag-card-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", flagKey);
    }
  };
  block.ondragend = () => {
    block.classList.remove("flag-card-dragging");
    clearFlagDropTargets();
  };
  block.ondragover = (event) => {
    const draggingBlock = domainFlagsList.querySelector(".flag-card-dragging");
    if (!draggingBlock || draggingBlock === block) {
      return;
    }
    event.preventDefault();
    block.classList.add("flag-card-drop-target");
    const midpoint = block.getBoundingClientRect().top + block.offsetHeight / 2;
    if (event.clientY < midpoint) {
      domainFlagsList.insertBefore(draggingBlock, block);
      return;
    }
    domainFlagsList.insertBefore(draggingBlock, block.nextElementSibling);
  };
  block.ondragleave = () => {
    block.classList.remove("flag-card-drop-target");
  };
  block.ondrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    block.classList.remove("flag-card-drop-target");
    notifyFlagsReordered(flagInfo.domain, domainFlagsList, onReorderFlags);
  };

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
  const iterationDisplayValue =
    flagInfo.status === "ok" ? normalizeText(sanitizeFieldValue(flagInfo.iteration).displayValue) : "";
  const shouldShowIterationBadge = iterationDisplayValue !== "" && iterationDisplayValue !== "1";
  title.textContent = `ID ${flagInfo.id}`;

  const status = flagInfo.status || "fetch_failed";
  const errorBadgeText = status === "ok" ? "" : getFlagErrorBadgeText(status);

  const actionsGroup = document.createElement("div");
  actionsGroup.className = "flag-actions";
  actionsGroup.append(title);
  const flagNameGroup = document.createElement("div");
  flagNameGroup.className = "flag-name-group";
  if (inlineFlagName) {
    flagNameGroup.append(createFlagNameBadge(inlineFlagName));
    const copyFlagNameButton = document.createElement("button");
    copyFlagNameButton.className = "copy-flag-name-button";
    copyFlagNameButton.type = "button";
    makeCopyIconButton(copyFlagNameButton, "Copy flag name");
    copyFlagNameButton.addEventListener("click", async () => {
      try {
        await copyTextToClipboard(inlineFlagName);
        copyFlagNameButton.title = "Copied";
        copyFlagNameButton.setAttribute("aria-label", "Copied");
      } catch {
        copyFlagNameButton.title = "Copy failed";
        copyFlagNameButton.setAttribute("aria-label", "Copy failed");
      }
      setTimeout(() => {
        copyFlagNameButton.title = "Copy flag name";
        copyFlagNameButton.setAttribute("aria-label", "Copy flag name");
      }, 1000);
    });
    flagNameGroup.append(copyFlagNameButton);
    if (shouldShowIterationBadge) {
      flagNameGroup.append(
        createIterationBadge(`v${iterationDisplayValue}`, `Iteration ${iterationDisplayValue}`)
      );
    }
  } else if (errorBadgeText) {
    flagNameGroup.append(createFlagErrorBadge(errorBadgeText));
  }
  if (flagNameGroup.childElementCount > 0) {
    titleRow.append(flagNameGroup);
  }
  if (flagKey === state.highlightedFlagKey) {
    titleRow.append(createContextBadge("Current page flag"));
  }

  const removeButton = document.createElement("button");
  removeButton.className = "remove-button";
  removeButton.type = "button";
  makeDeleteIconButton(removeButton, "Remove");
  removeButton.addEventListener("click", () => {
    void onRemoveFlag(flagInfo.domain, flagInfo.id, block);
  });
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
    subList.append(createPercentagesLine(flagInfo.percent, flagInfo.audiencePercent));
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
  updateDomainFlagCount(flagInfo.domain);
}
