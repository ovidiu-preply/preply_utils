const ROOT_MENU_ID = "bring-session-from-root";
const COPY_CURRENT_SESSION_MENU_ID = "copy-current-tab-session-id";
const SESSION_COOKIE_NAME = "sessionid";
const LOG_PREFIX = "[SessionCopier]";

let menuBuildChain = Promise.resolve();

function normalizeHost(hostname) {
  return hostname.toLowerCase().trim();
}

function isEligibleHost(hostname) {
  const host = normalizeHost(hostname);
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "preply.com" ||
    host.endsWith(".preply.com") ||
    host === "preply.org" ||
    host.endsWith(".preply.org")
  );
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch (_error) {
    return null;
  }
}

function isSupportedTabUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  return isEligibleHost(parsed.hostname);
}

function toDisplayTitle(tab) {
  const parsed = parseUrl(tab.url ?? "");
  const host = parsed?.hostname ?? "unknown-host";
  const title = (tab.title || tab.url || "Untitled tab").replace(/\s+/g, " ").trim();
  const cappedTitle = title.length > 80 ? `${title.slice(0, 77)}...` : title;
  return `${cappedTitle} - ${host}`;
}

function domainFromCookie(cookieDomain) {
  return cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
}

function isCookieDomainCompatible(cookieDomain, targetHost) {
  const normalizedDomain = normalizeHost(domainFromCookie(cookieDomain));
  const normalizedTarget = normalizeHost(targetHost);
  return (
    normalizedTarget === normalizedDomain ||
    normalizedTarget.endsWith(`.${normalizedDomain}`)
  );
}

async function ensureRootMenu() {
  await chrome.contextMenus.removeAll();
  await chrome.contextMenus.create({
    id: ROOT_MENU_ID,
    title: "Bring session id from",
    contexts: ["page"],
    visible: false
  });
  await chrome.contextMenus.create({
    id: COPY_CURRENT_SESSION_MENU_ID,
    title: "Copy current tab session id",
    contexts: ["page"],
    visible: false
  });
}

async function rebuildSourceMenus(currentTab) {
  await ensureRootMenu();

  const isCurrentTabSupported =
    !!currentTab.id && !!currentTab.url && isSupportedTabUrl(currentTab.url);

  await chrome.contextMenus.update(COPY_CURRENT_SESSION_MENU_ID, {
    visible: isCurrentTabSupported,
    enabled: isCurrentTabSupported
  });

  if (!isCurrentTabSupported) {
    return;
  }

  const allTabs = await chrome.tabs.query({});
  const eligibleSourceTabs = allTabs.filter((tab) => {
    if (!tab.id || tab.id === currentTab.id || !tab.url) {
      return false;
    }
    return isSupportedTabUrl(tab.url);
  });

  await chrome.contextMenus.update(ROOT_MENU_ID, { visible: true, enabled: eligibleSourceTabs.length > 0 });

  for (const tab of eligibleSourceTabs) {
    const menuId = `source-tab-${tab.id}`;
    await chrome.contextMenus.create({
      id: menuId,
      parentId: ROOT_MENU_ID,
      title: toDisplayTitle(tab),
      contexts: ["page"]
    });
  }

}

function scheduleMenuRefreshForTab(tabLike) {
  menuBuildChain = menuBuildChain
    .then(() => rebuildSourceMenus(tabLike))
    .catch((error) => {
      console.error("Failed to rebuild source tab menu", error);
    });
  return menuBuildChain;
}

async function refreshMenusForActiveTab() {
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = activeTabs[0] ?? {};
  await scheduleMenuRefreshForTab(activeTab);
}

async function getTabOrNull(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (_error) {
    return null;
  }
}

async function getSessionCookieForSourceUrl(sourceUrl) {
  const directCookie = await chrome.cookies.get({
    url: sourceUrl,
    name: SESSION_COOKIE_NAME
  });
  if (directCookie) {
    return directCookie;
  }

  const sourceParsedUrl = parseUrl(sourceUrl);
  if (!sourceParsedUrl) {
    return null;
  }

  const allByName = await chrome.cookies.getAll({ name: SESSION_COOKIE_NAME });
  const sourceHost = normalizeHost(sourceParsedUrl.hostname);
  const anyForHost = allByName.find(
    (cookie) => cookie.domain && isCookieDomainCompatible(cookie.domain, sourceHost)
  );
  return anyForHost ?? allByName[0] ?? null;
}

async function getSessionCookieForTargetUrl(targetUrl) {
  const directCookie = await chrome.cookies.get({
    url: targetUrl,
    name: SESSION_COOKIE_NAME
  });
  if (directCookie) {
    return directCookie;
  }

  const targetParsedUrl = parseUrl(targetUrl);
  if (!targetParsedUrl) {
    return null;
  }

  const allByName = await chrome.cookies.getAll({ name: SESSION_COOKIE_NAME });
  const targetHost = normalizeHost(targetParsedUrl.hostname);
  const candidates = allByName.filter(
    (cookie) => cookie.domain && isCookieDomainCompatible(cookie.domain, targetHost)
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => (right.path?.length ?? 0) - (left.path?.length ?? 0));
  return candidates[0];
}

function sourceTabIdFromMenuItem(menuItemId) {
  const match = /^source-tab-(\d+)$/.exec(String(menuItemId));
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

async function resolveTargetTab(clickedTab) {
  if (clickedTab?.id) {
    return clickedTab;
  }

  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return activeTabs[0] ?? null;
}

async function copySessionCookie(sourceTab, targetTab) {
  if (!sourceTab.url || !targetTab.url) {
    return { ok: false, reason: "missing-tab-url" };
  }

  const sourceCookie = await getSessionCookieForSourceUrl(sourceTab.url);

  if (!sourceCookie) {
    console.warn(`${LOG_PREFIX} source cookie missing`, {
      sourceTabId: sourceTab.id,
      sourceUrl: sourceTab.url
    });
    return { ok: false, reason: "source-cookie-missing" };
  }

  const targetUrl = parseUrl(targetTab.url);
  if (!targetUrl) {
    console.warn(`${LOG_PREFIX} invalid target URL`, {
      targetTabId: targetTab.id,
      targetUrl: targetTab.url
    });
    return { ok: false, reason: "invalid-target-url" };
  }

  const targetCookie = await getSessionCookieForTargetUrl(targetTab.url);
  if (!targetCookie) {
    console.warn(`${LOG_PREFIX} target cookie missing`, {
      targetTabId: targetTab.id,
      targetUrl: targetTab.url
    });
    return { ok: false, reason: "target-cookie-missing" };
  }

  if (targetCookie.secure && targetUrl.protocol !== "https:") {
    console.warn(`${LOG_PREFIX} cannot overwrite secure cookie on non-https target`, {
      targetTabId: targetTab.id,
      targetUrl: targetTab.url
    });
    return { ok: false, reason: "target-cookie-secure-requires-https" };
  }

  const cookieHost = targetCookie.domain ? domainFromCookie(targetCookie.domain) : targetUrl.hostname;
  const cookieUrl = `${targetCookie.secure ? "https:" : targetUrl.protocol}//${cookieHost}${targetCookie.path || "/"}`;
  const setPayload = {
    url: cookieUrl,
    name: SESSION_COOKIE_NAME,
    value: sourceCookie.value,
    path: targetCookie.path || "/",
    secure: targetCookie.secure,
    httpOnly: targetCookie.httpOnly,
    sameSite: targetCookie.sameSite,
    storeId: targetCookie.storeId
  };
  if (!targetCookie.hostOnly) {
    setPayload.domain = targetCookie.domain;
  }
  if (targetCookie.expirationDate) {
    setPayload.expirationDate = targetCookie.expirationDate;
  }
  if (targetCookie.partitionKey) {
    setPayload.partitionKey = targetCookie.partitionKey;
  }

  const setResult = await chrome.cookies.set(setPayload);
  if (!setResult) {
    console.warn(`${LOG_PREFIX} cookie set failed`, {
      targetTabId: targetTab.id,
      targetUrl: targetTab.url
    });
    return { ok: false, reason: "cookie-set-failed" };
  }

  console.warn(`${LOG_PREFIX} cookie copied, reloading target`, {
    sourceTabId: sourceTab.id,
    targetTabId: targetTab.id,
    targetUrl: targetTab.url,
    cookieDomain: sourceCookie.domain || "host-only",
    cookiePath: sourceCookie.path || "/"
  });
  await chrome.tabs.reload(targetTab.id, { bypassCache: true });
  return { ok: true };
}

async function copyTextToClipboardOnTab(tabId, text) {
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (value) => {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (_error) {
        try {
          const textarea = document.createElement("textarea");
          textarea.value = value;
          textarea.style.position = "fixed";
          textarea.style.left = "-9999px";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          const copied = document.execCommand("copy");
          textarea.remove();
          return copied;
        } catch (_fallbackError) {
          return false;
        }
      }
    },
    args: [text]
  });

  return Boolean(injectionResults?.[0]?.result);
}

async function copyCurrentTabSessionIdToClipboard(tab) {
  if (!tab.id || !tab.url || !isSupportedTabUrl(tab.url)) {
    return { ok: false, reason: "unsupported-or-missing-tab-url" };
  }

  const sourceCookie = await getSessionCookieForSourceUrl(tab.url);
  if (!sourceCookie?.value) {
    return { ok: false, reason: "source-cookie-missing" };
  }

  const copied = await copyTextToClipboardOnTab(tab.id, sourceCookie.value);
  if (!copied) {
    return { ok: false, reason: "clipboard-copy-failed" };
  }

  return { ok: true };
}

chrome.runtime.onInstalled.addListener(() => {
  ensureRootMenu()
    .then(() => refreshMenusForActiveTab())
    .catch((error) => {
      console.error("Failed to initialize root context menu", error);
    });
});

chrome.runtime.onStartup.addListener(() => {
  ensureRootMenu()
    .then(() => refreshMenusForActiveTab())
    .catch((error) => {
      console.error("Failed to initialize root context menu on startup", error);
    });
});

chrome.tabs.onActivated.addListener(() => {
  refreshMenusForActiveTab().catch((error) => {
    console.error("Failed to refresh menu on tab activation", error);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.status && !changeInfo.url && !changeInfo.title) {
    return;
  }
  if (!tab.active) {
    return;
  }

  scheduleMenuRefreshForTab(tab ?? {});
});

chrome.tabs.onRemoved.addListener(() => {
  refreshMenusForActiveTab().catch((error) => {
    console.error("Failed to refresh menu on tab removal", error);
  });
});

chrome.windows.onFocusChanged.addListener(() => {
  refreshMenusForActiveTab().catch((error) => {
    console.error("Failed to refresh menu on window focus change", error);
  });
});

chrome.contextMenus.onClicked.addListener((info, clickedTab) => {
  if (info.menuItemId === COPY_CURRENT_SESSION_MENU_ID) {
    resolveTargetTab(clickedTab)
      .then(async (maybeTargetTab) => {
        const targetTab = maybeTargetTab?.id ? await getTabOrNull(maybeTargetTab.id) : null;
        if (!targetTab) {
          console.warn("Cannot copy sessionid to clipboard: target tab closed.");
          return;
        }

        const result = await copyCurrentTabSessionIdToClipboard(targetTab);
        if (!result.ok) {
          console.warn(`Session id clipboard copy skipped: ${result.reason}`);
        } else {
          console.warn(`${LOG_PREFIX} copied session id to clipboard`, {
            targetTabId: targetTab.id
          });
        }
      })
      .catch((error) => {
        console.error("Failed to copy current tab session id", error);
      });
    return;
  }

  const sourceTabId = sourceTabIdFromMenuItem(info.menuItemId);
  if (!sourceTabId) {
    return;
  }

  console.warn(`${LOG_PREFIX} menu click`, {
    menuItemId: info.menuItemId,
    clickedTabId: clickedTab?.id ?? null
  });

  Promise.all([getTabOrNull(sourceTabId), resolveTargetTab(clickedTab)])
    .then(async ([sourceTab, maybeTargetTab]) => {
      const targetTab = maybeTargetTab?.id ? await getTabOrNull(maybeTargetTab.id) : null;
      if (!sourceTab || !targetTab) {
        console.warn("Cannot copy sessionid: source or target tab closed.");
        return;
      }

      const result = await copySessionCookie(sourceTab, targetTab);
      if (!result.ok) {
        console.warn(`Session copy skipped: ${result.reason}`);
      } else {
        console.warn(`${LOG_PREFIX} session copy success`, {
          sourceTabId: sourceTab.id,
          targetTabId: targetTab.id
        });
      }
    })
    .catch((error) => {
      console.error("Session copy failed", error);
    });
});
