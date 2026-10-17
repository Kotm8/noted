import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("renders formatting, code, tables, and Russian text", () => {
    const content =
      "**Привет**\n\n```python\nprint('hello')\n```\n\n| Name | Value |\n| --- | --- |\n| note | 1 |";
    const { container } = render(<Markdown content={content} />);
    expect(screen.getByText("Привет").tagName).toBe("STRONG");
    expect(container.querySelector("code.language-python")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
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
