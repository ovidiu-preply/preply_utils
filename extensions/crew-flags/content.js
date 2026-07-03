const host = window.location.hostname;
const isCrewProd = host === "crew.preply.com";
const isCrewStage = /^crew\.stage\d+\.preply\.org$/i.test(host);

if (!isCrewProd && !isCrewStage) {
  // Match pattern must be broad for Chrome, so hard-gate here.
  window.__crewFlagsExtensionDisabled = true;
}

const FLAG_PAGE_PATH_RE = /^\/crew\/waffle\/(?:flag|flagexperiment)\/(\d+)\/change\/?$/u;
const TRACK_BUTTON_ID = "crew-flags-track-current-flag";

function parseCurrentFlagId() {
  const match = window.location.pathname.match(FLAG_PAGE_PATH_RE);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function setTrackButtonState(button, tracked) {
  button.dataset.tracked = tracked ? "true" : "false";
  button.title = tracked ? "Flag tracked" : "Track flag";
  button.ariaLabel = tracked ? "Flag tracked" : "Track flag";
  button.disabled = tracked;
  const icon = button.querySelector("img");
  if (icon instanceof HTMLImageElement) {
    icon.src = tracked
      ? chrome.runtime.getURL("icons/icon16.png")
      : chrome.runtime.getURL("track-icon.png");
  }
}

function createTrackButton() {
  const button = document.createElement("button");
  button.id = TRACK_BUTTON_ID;
  button.type = "button";
  button.style.marginInlineStart = "8px";
  button.style.padding = "0";
  button.style.border = "none";
  button.style.background = "transparent";
  button.style.cursor = "pointer";
  button.style.verticalAlign = "middle";

  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("track-icon.png");
  icon.alt = "";
  icon.width = 16;
  icon.height = 16;
  icon.style.display = "block";

  button.append(icon);
  return button;
}

async function insertTrackIconOnFlagPage() {
  if (!isCrewProd && !isCrewStage) {
    return;
  }

  const currentFlagId = parseCurrentFlagId();
  if (currentFlagId === null) {
    return;
  }

  const heading = document.querySelector("#content h2");
  if (!(heading instanceof HTMLElement)) {
    return;
  }
  if (heading.querySelector(`#${TRACK_BUTTON_ID}`)) {
    return;
  }

  const button = createTrackButton();
  heading.append(button);

  try {
    const sharedTracking = await import(chrome.runtime.getURL("shared-tracking.js"));
    const isTracked = await sharedTracking.isFlagTracked(host, currentFlagId);
    setTrackButtonState(button, isTracked);

    button.addEventListener("click", async () => {
      if (button.dataset.tracked === "true") {
        return;
      }

      button.disabled = true;
      try {
        await sharedTracking.ensureTrackedFlagWithCache(host, currentFlagId);
        setTrackButtonState(button, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error("[crew-flags] Failed to track flag from page:", message);
        setTrackButtonState(button, false);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[crew-flags] Failed to initialize page track button:", message);
    setTrackButtonState(button, false);
  }
}

void insertTrackIconOnFlagPage();
