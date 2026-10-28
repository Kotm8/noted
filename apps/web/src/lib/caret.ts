const MEASURED = [
  "box-sizing",
  "width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "line-height",
  "tab-size",
  "text-indent",
  "text-transform",
  "word-spacing",
];

/**
 * Textareas don't expose caret coordinates, so this lays the text before the
 * caret out in an identically styled hidden copy and measures where it ends.
 * The result is relative to the textarea's offset parent, just below the line.
 */
export function caretPosition(input: HTMLTextAreaElement, index: number) {
  const style = getComputedStyle(input);
  const mirror = document.createElement("div");
  for (const name of MEASURED)
    mirror.style.setProperty(name, style.getPropertyValue(name));
  Object.assign(mirror.style, {
    position: "absolute",
    top: "0",
    left: "0",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  mirror.textContent = input.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.append(marker);
  document.body.append(mirror);
  const position = {
    top:
      input.offsetTop +
      marker.offsetTop +
      marker.offsetHeight -
      input.scrollTop,
    left: input.offsetLeft + marker.offsetLeft,
  };
  mirror.remove();
  return position;
}
