import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiSources } from "./ai-feedback";

describe("AI source disclosure", () => {
  it("counts valid unique links and starts collapsed", () => {
    render(
      <AiSources
        sources={[
          { title: "First", url: "https://example.com/first" },
          { title: "Repeated", url: "https://example.com/first" },
          { title: "Second", url: "https://example.com/second" },
          { title: "Invalid", url: "javascript:alert(1)" },
        ]}
      />,
    );
    const summary = screen.getByText("2 sources");
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(screen.getAllByRole("link", { hidden: true })).toHaveLength(2);
  });
});
