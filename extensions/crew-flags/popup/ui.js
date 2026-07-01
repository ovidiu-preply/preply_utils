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
  const { onRemoveDomain, onRefreshDomain, onTrackClick } = callbacks;
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
  if (domain === state.highlightedDomain) {
    domainHeaderRow.append(createContextBadge("Current page"));
  }

  const removeDomainButton = document.createElement("button");
  removeDomainButton.className = "remove-domain-button";
  removeDomainButton.type = "button";
  makeDeleteIconButton(removeDomainButton, "Remove domain");
  removeDomainButton.addEventListener("click", () => {
    void onRemoveDomain(domain, domainSection);
  });

  const refreshButton = document.createElement("button");
  refreshButton.className = "refresh-domain-button";
  refreshButton.type = "button";
  makeRefreshIconButton(refreshButton, "Refresh");
  refreshButton.addEventListener("click", () => {
    void onRefreshDomain(domain);
  });

  domainHeaderRow.append(refreshButton, removeDomainButton);
  domainSection.append(domainHeaderRow);

  const { row: trackRow, input: trackInput } = createTrackRow(domain, onTrackClick);
  domainSection.append(trackRow);

  const domainFlagsList = document.createElement("ul");
  domainFlagsList.setAttribute("data-domain-flags", domain);
  domainSection.append(domainFlagsList);

  fieldsList.append(domainSection);
  state.domainUiByDomain.set(domain, { trackInput, domainFlagsList, refreshButton });
}

function getDomainFlagsList(domain) {
  const ui = state.domainUiByDomain.get(domain);
  return ui ? ui.domainFlagsList : null;
}

export function renderFlagBlock(flagInfo, callbacks) {
  const { onRemoveFlag } = callbacks;
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
