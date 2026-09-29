/**
 * The three-layer token system, enforced.
 *
 * Layer 1 (`tokens.primitives.css`) holds raw values and is the only file
 * allowed to name them. Layer 2 (`tokens.semantic.css`) names roles and may
 * reference layer 1. Layer 3 (CSS Modules) may reference only layer 2.
 *
 * This script is the guard rail: the rule "no component references a raw
 * palette token or a hardcoded colour value" is easy to state and easy to break
 * by accident six weeks from now, so it is checked rather than trusted.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const PRIMITIVE_LAYER = "tokens.primitives.css";
const SEMANTIC_LAYER = "tokens.semantic.css";

/** A `--token: value` declaration. */
const TOKEN_DECLARATION = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
/** Any colour literal: hex, rgb/rgba/hsl, or a named CSS colour. */
const COLOUR_LITERAL =
  /(#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black|red|blue|green|grey|gray|orange|yellow|purple|pink|cyan|magenta)\b)/i;

/**
 * The rule, precisely: a component may not reference a raw *palette* token or
 * hardcode a colour value. Spacing, radius, typography and motion primitives
 * are fair game — they carry no visual-identity risk, and a semantic alias for
 * `--space-3` would be indirection without meaning. What must not happen is a
 * component naming a colour, because that is what makes the palette a
 * many-file change instead of a one-file change.
 */
const PALETTE_PREFIXES = ["--palette-"];

const violations = [];

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const cssModuleFiles = walk(SRC).filter(
  (path) => path.endsWith(".css") && !path.endsWith(PRIMITIVE_LAYER),
);

const primitiveTokens = new Set(
  Array.from(
    readFileSync(join(SRC, "styles", PRIMITIVE_LAYER), "utf8").matchAll(
      TOKEN_DECLARATION,
    ),
  ).map(([, name]) => name.trim()),
);

for (const path of cssModuleFiles) {
  const name = relative(SRC, path);
  const source = readFileSync(path, "utf8");
  const layer = name.includes(SEMANTIC_LAYER) ? 2 : 3;

  for (const [, token, value] of source.matchAll(TOKEN_DECLARATION)) {
    if (
      layer === 3 &&
      primitiveTokens.has(token.trim()) &&
      !value.includes("var(")
    ) {
      violations.push(`${name}: '${token.trim()}' shadows a primitive token.`);
    }
  }

  // A colour literal anywhere in a component stylesheet — in a token
  // declaration or in a plain property — is a colour the component owns.
  if (layer === 3) {
    for (const [index, line] of source.split("\n").entries()) {
      if (COLOUR_LITERAL.test(line)) {
        violations.push(
          `${name}:${index + 1} hardcodes a colour (${line.trim()}). Use a semantic token.`,
        );
      }
    }
  }

  if (layer === 3) {
    for (const token of primitiveTokens) {
      if (
        PALETTE_PREFIXES.some((prefix) => token.startsWith(prefix)) &&
        source.includes(`var(${token})`)
      ) {
        violations.push(
          `${name}: references the raw palette token '${token}'. Use a semantic token instead.`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Token layer violations:\n");
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error(
    "\nPrimitives live in src/styles/tokens.primitives.css; components use src/styles/tokens.semantic.css.",
  );
  process.exit(1);
}

console.log(
  `Token layers are clean: ${cssModuleFiles.length} stylesheet(s) checked, no hardcoded colours or raw palette references in components.`,
);
