export function describeDevice(agent: string | null) {
  const value = agent ?? "";
  const browser = /Noted Desktop\//.test(value) ? "Noted Desktop"
    : /Edg\//.test(value) ? "Edge"
    : /Firefox\/|FxiOS\//.test(value) ? "Firefox"
    : /Chrome\/|CriOS\//.test(value) ? "Chrome"
    : /Safari\//.test(value) ? "Safari" : "Unknown browser";
  const platform = /Android/.test(value) ? "Android"
    : /iPhone|iPad|iPod/.test(value) ? "iOS"
    : /Windows/i.test(value) ? "Windows"
    : /Macintosh|Mac OS X|macos/.test(value) ? "macOS"
    : /Linux/i.test(value) ? "Linux" : null;
  return { browser, platform, mobile: /Android|iPhone|iPad|iPod/.test(value) };
}
