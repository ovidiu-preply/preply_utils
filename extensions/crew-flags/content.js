const host = window.location.hostname;
const isCrewProd = host === "crew.preply.com";
const isCrewStage = /^crew\.stage\d+\.preply\.org$/i.test(host);

if (!isCrewProd && !isCrewStage) {
  // Match pattern must be broad for Chrome, so hard-gate here.
  window.__crewFlagsExtensionDisabled = true;
}
