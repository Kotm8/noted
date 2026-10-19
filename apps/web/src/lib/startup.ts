export function finishStartup() {
  window.dispatchEvent(new Event("noted:ready"));
  document.getElementById("noted-startup")?.remove();
}
