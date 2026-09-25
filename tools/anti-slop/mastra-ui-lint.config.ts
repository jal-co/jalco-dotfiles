import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: ["**/node_modules/**", "**/dist/**", "**/build/**"],
  jsPlugins: [{ name: "mastra-ui", specifier: "./src/mastra-ui/index.ts" }, "@shadcn/lint"],
  settings: {
    shadcn: {
      componentImports: ["^@mastra/playground-ui/(components|new)/"],
      note: "Mastra UI contract: design-system components take layout classes only."
    }
  },
  rules: {
    "mastra-ui/no-relative-time-formatters": "error",
    "mastra-ui/no-three-dot-ellipsis": "error",
    "mastra-ui/no-raw-h1": "error",
    "mastra-ui/no-status-badge": "error",
    "mastra-ui/couldnt-errors": "error",
    "mastra-ui/calm-voice": "error",
    "mastra-ui/text-by-role": "error",
    "mastra-ui/no-locale-format-in-jsx": "error",
    "mastra-ui/inline-code": "error",
    "mastra-ui/no-legacy-page-frame": "error",
    "mastra-ui/no-number-input": "error",
    "shadcn/no-arbitrary-values": "error",
    "shadcn/no-raw-colors": "error",
    "shadcn/no-restyle": [
      "error",
      {
        "allow": ["layout"],
        "contracts": [
          {
            "pattern": "^Txt$",
            "allow": ["layout", "truncate", "line-clamp-*", "break-*", "wrap-*", "whitespace-*", "text-pretty", "text-balance", "text-left", "text-center", "text-right", "tabular-nums", "uppercase"]
          },
          { "pattern": "^Skeleton$", "allow": ["layout", "rounded-*"] }
        ]
      }
    ]
  }
});
