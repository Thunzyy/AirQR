import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Icon from "@web/components/ui/Icon";

describe("Icon", () => {
  it("renders the pause glyph used by playback controls", () => {
    const { container } = render(<Icon name="pause" />);

    const icon = container.querySelector('svg[data-icon="pause"]');

    expect(icon).toBeInTheDocument();
    expect(icon?.querySelectorAll("rect")).toHaveLength(2);
    expect(icon).not.toHaveTextContent("?");
  });
});
