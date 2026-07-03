export function normalizeText(value) {
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

export function sanitizeTrackedIdsByDomain(rawMap) {
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

export function sanitizeCollapsedDomainsByDomain(rawMap) {
  const sanitized = {};
  if (!rawMap || typeof rawMap !== "object") {
    return sanitized;
  }

  for (const [domain, isCollapsed] of Object.entries(rawMap)) {
    if (typeof domain !== "string" || domain.trim() === "") {
      continue;
    }
    sanitized[domain] = Boolean(isCollapsed);
  }

  return sanitized;
}

export function sanitizeExperimentSetupByDomain(rawMap) {
  const sanitized = {};
  if (!rawMap || typeof rawMap !== "object") {
    return sanitized;
  }

  const normalizeSection = (rawSection, fallbackId) => {
    const legacyId = normalizeId(Number.parseInt(String(rawSection), 10));
    const section = rawSection && typeof rawSection === "object" ? rawSection : {};
    const parsedSectionId = normalizeId(Number.parseInt(String(section.id), 10)) ?? fallbackId;
    const normalizeFlagId = (value) => normalizeId(Number.parseInt(String(value), 10));
    const legacyExperimentId = legacyId !== null && (rawSection === legacyId || typeof rawSection === "number");
    return {
      id: parsedSectionId,
      experimentFlagId: normalizeFlagId(section.experimentFlagId) ?? (legacyExperimentId ? legacyId : null),
      rolloutFlagId: normalizeFlagId(section.rolloutFlagId),
      studentAFlagId: normalizeFlagId(section.studentAFlagId),
      studentBFlagId: normalizeFlagId(section.studentBFlagId),
      aaFlagId: normalizeFlagId(section.aaFlagId)
    };
  };

  for (const [domain, sections] of Object.entries(rawMap)) {
    if (typeof domain !== "string" || domain.trim() === "") {
      continue;
    }

    if (!Array.isArray(sections)) {
      sanitized[domain] = [];
      continue;
    }

    const normalizedSections = [];
    const seenSectionIds = new Set();
    for (const [index, section] of sections.entries()) {
      const fallbackId = index + 1;
      const normalizedSection = normalizeSection(section, fallbackId);
      if (seenSectionIds.has(normalizedSection.id)) {
        continue;
      }
      seenSectionIds.add(normalizedSection.id);
      normalizedSections.push(normalizedSection);
    }
    sanitized[domain] = normalizedSections;
  }

  return sanitized;
}

export function createFieldValue(displayValue, colorValue) {
  return {
    displayValue: typeof displayValue === "string" ? displayValue : "",
    colorValue: typeof colorValue === "string" ? colorValue : ""
  };
}

export function sanitizeFieldValue(rawValue) {
  if (typeof rawValue === "string") {
    return createFieldValue(rawValue, rawValue);
  }
  if (!rawValue || typeof rawValue !== "object") {
    return createFieldValue("", "");
  }
  return createFieldValue(rawValue.displayValue, rawValue.colorValue);
}

export function sanitizeFlagInfo(rawInfo) {
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

export function sanitizeFlagInfoByDomain(rawMap) {
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

export function extractByExactLabel(parsedDocument, labelText) {
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
