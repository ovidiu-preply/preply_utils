const FLAG_IDS_BY_DOMAIN = {
  "crew.stage39.preply.org": [1, 2, 3],
  "crew.preply.com": [6, 7]
};

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

function renderDomainHeader(domain) {
  const fieldsList = getFieldsList();
  if (!fieldsList) {
    return;
  }

  const domainHeader = document.createElement("li");
  const domainTitle = document.createElement("div");
  domainTitle.className = "value";
  domainTitle.textContent = domain;
  domainTitle.style.marginTop = "10px";
  domainTitle.style.marginBottom = "8px";
  domainHeader.append(domainTitle);
  fieldsList.append(domainHeader);
}

function renderFlagBlock(flagInfo) {
  const fieldsList = getFieldsList();
  if (!fieldsList) {
    return;
  }

  const targetUrl = `https://${flagInfo.domain}/crew/waffle/flag/${flagInfo.id}/change/`;
  const flagKey = getFlagKey(flagInfo);
  const existingBlock = fieldsList.querySelector(`[data-flag-key="${flagKey}"]`);
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
    fieldsList.append(block);
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

  const domains = Object.keys(FLAG_IDS_BY_DOMAIN);
  if (domains.length === 0) {
    setError("No domains configured.");
    return;
  }

  let renderedAny = false;
  const fetchTasks = [];
  for (const domain of domains) {
    const ids = Array.isArray(FLAG_IDS_BY_DOMAIN[domain])
      ? FLAG_IDS_BY_DOMAIN[domain]
      : [];
    const validIds = ids.filter((id) => Number.isInteger(id) && id > 0);

    if (validIds.length === 0) {
      continue;
    }

    renderedAny = true;
    renderDomainHeader(domain);
    for (const id of validIds) {
      renderFlagBlock({ domain, id, status: "loading" });
    }
    for (const id of validIds) {
      const task = fetchFlagInfo(domain, id).then((flagInfo) => {
        renderFlagBlock(flagInfo);
      });
      fetchTasks.push(task);
    }
  }

  if (!renderedAny) {
    setError("No valid flag IDs configured.");
    return;
  }

  await Promise.all(fetchTasks);
}

void loadFlagInfo();
