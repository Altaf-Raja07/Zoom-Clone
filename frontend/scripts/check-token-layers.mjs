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

/**
 * Blank out CSS comments, preserving line numbers.
 *
 * Replaced with spaces rather than removed so a reported line number still
 * points at the line a person has to edit — a guard rail that reports the wrong
 * line is a guard rail people learn to ignore.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

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

  // A colour literal in a component stylesheet's *values* is a colour the
  // component owns.
  //
  // Comments and property names are excluded, and both exclusions are
  // correctness fixes rather than loosening. Scanning whole lines reported
  // `white-space: nowrap` as a hardcoded white, and prose describing the stage
  // as "near-black" as a hardcoded black — neither is a value, and a guard rail
  // that cries wolf on those gets a `@media` workaround written around it
  // instead of being obeyed, which costs more than the rule ever protected.
  if (layer === 3) {
    for (const [index, line] of stripComments(source).split("\n").entries()) {
      // Everything after the first colon is the value side of a declaration.
      // A line with no colon cannot be one, so it is skipped rather than
      // searched — a selector is a name, never a colour.
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const value = line.slice(colon + 1);
      if (COLOUR_LITERAL.test(value)) {
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
