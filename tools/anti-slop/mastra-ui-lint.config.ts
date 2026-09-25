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
  overrides: [
    {
      files: ["**/playground-ui/src/ds/**"],
      rules: {
        "mastra-ui/no-raw-h1": "off",
        "mastra-ui/no-font-mono": "off"
      }
    }
  ],
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
    "mastra-ui/no-font-mono": "error",
    "shadcn/no-arbitrary-values": "error",
    "shadcn/no-raw-colors": "error",
    "shadcn/no-restyle": [
      "error",
      {
        "allow": ["layout"],
        "contracts": [
          {
            "pattern": "^Txt$",
            "allow": ["layout", "truncate", "line-clamp-*", "break-*", "wrap-*", "whitespace-*", "text-pretty", "text-balance", "text-left", "text-center", "text-right", "tabular-nums", "hover:text-*", "group-hover:text-*", "text-foreground/*", "text-muted-foreground/*"]
          },
          { "pattern": "^Skeleton$", "allow": ["layout", "rounded-*"] }
        ],
        "message": {
          "color": "\"{{className}}\" restyles <{{component}}>. On <Txt>, set ink with tone=\"ink\" | \"muted\" | \"faint\"; on other components, use a variant: {{variants|none defined}}.",
          "typography": "\"{{className}}\" restyles <{{component}}>. Pick a Txt variant (text role) or a {{component}} variant: {{variants|none defined}}.",
          "spacing": "\"{{className}}\" changes <{{component}}> padding. Use a size ({{sizes|none defined}}); space around it with margin here or gap on the parent.",
          "default": "\"{{className}}\" restyles <{{component}}>, which comes from @mastra/playground-ui. Use a variant ({{variants|none defined}}), a different design-system component, or composed parts. If none fits, stop and propose the variant; never paint a surface on a wrapper around it."
        }
      }
    ]
  },
  overrides: [
    {
      files: ["**/playground-ui/src/ds/**"],
      rules: {
        "mastra-ui/no-raw-h1": "off",
        "mastra-ui/text-by-role": "off",
        "mastra-ui/no-locale-format-in-jsx": "off"
      }
    }
  ]
});
