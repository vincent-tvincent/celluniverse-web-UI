import type { Preview } from "@storybook/react-vite";
import "../src/theme/tokens.css";
import "../src/styles.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="storybook-canvas">
        <Story />
      </div>
    ),
  ],
};

export default preview;
