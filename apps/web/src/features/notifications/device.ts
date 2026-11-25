export function createDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function notificationDevice() {
  let id = localStorage.getItem("noted.notification-device");
  if (!id) {
    id = createDeviceId();
    localStorage.setItem("noted.notification-device", id);
  }
  return {
    device_id: id,
    kind: /Android|iPhone|iPad/i.test(navigator.userAgent)
      ? "mobile"
      : "desktop",
  };
}
