export function textareaLineTop(
  input: HTMLTextAreaElement,
  offset: number,
): number {
  const computed = getComputedStyle(input);
  const mirror = document.createElement("div");
  for (const property of [
    "width",
    "font",
    "font-size",
    "font-family",
    "font-weight",
    "font-style",
    "letter-spacing",
    "line-height",
    "padding",
    "border",
    "box-sizing",
    "tab-size",
    "word-spacing",
    "text-indent",
    "text-transform",
  ]) {
    mirror.style.setProperty(property, computed.getPropertyValue(property));
  }
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    top: "0",
    left: "0",
  });
  mirror.textContent = input.value.slice(0, offset);
  const marker = document.createElement("span");
  marker.textContent = input.value.slice(offset, offset + 1) || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const top =
    marker.getBoundingClientRect().top -
    mirror.getBoundingClientRect().top -
    input.scrollTop;
  mirror.remove();
  return input.offsetTop + top;
}
