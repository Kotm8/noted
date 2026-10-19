import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("renders an empty Markdown task marker as a working checkbox", () => {
    const onContentChange = vi.fn();
    render(<Markdown content="- [ ]" onContentChange={onContentChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Task" }));
    expect(onContentChange).toHaveBeenCalledWith("- [x]");
  });
  it("toggles the correct nested task without changing code or other text", () => {
    const content =
      "```md\n- [ ] example\n```\n\n- [ ] Pack charger\n  - [x] Cable\n\n1. [ ] Book train";
    const onContentChange = vi.fn();
    const { rerender } = render(
      <Markdown content={content} onContentChange={onContentChange} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Pack charger" }));
    expect(onContentChange).toHaveBeenLastCalledWith(
      content.replace("- [ ] Pack", "- [x] Pack"),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Cable" }));
    expect(onContentChange).toHaveBeenLastCalledWith(
      content.replace("- [x] Cable", "- [ ] Cable"),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Book train" }));
    expect(onContentChange).toHaveBeenLastCalledWith(
      content.replace("1. [ ] Book", "1. [x] Book"),
    );
    rerender(
      <Markdown content={content} onContentChange={onContentChange} pending />,
    );
    expect(screen.getByRole("checkbox", { name: "Cable" })).toBeDisabled();
  });
  it("renders formatting, code, tables, and Russian text", () => {
    const content =
      "**Привет**\n\n```python\nprint('hello')\n```\n\n| Name | Value |\n| --- | --- |\n| note | 1 |";
    const { container } = render(<Markdown content={content} />);
    expect(screen.getByText("Привет").tagName).toBe("STRONG");
    expect(container.querySelector("code.language-python")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy code" }),
    ).toBeInTheDocument();
  });

  it("does not render raw scripts, event handlers, or unsafe links", () => {
    const { container } = render(
      <Markdown
        content={
          "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))"
        }
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("does not load remote images before the user requests them", () => {
    const { container } = render(
      <Markdown content="![example](https://external.example/tracker.png)" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("[Image: example]")).toBeInTheDocument();
  });
});
