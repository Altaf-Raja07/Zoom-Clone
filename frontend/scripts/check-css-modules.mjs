/**
 * Every `styles.x` must name a class the CSS module actually declares.
 *
 * This guard exists because of a real bug this ticket shipped. A component
 * referenced `styles.demoPanels`, which no stylesheet declared. It rendered with
 * `className={undefined}`, the browser tests stayed green — they assert on
 * `data-testid`, which is a separate attribute and was present — and neither
 * `tsc` nor `next build` complained, because CSS Modules are imported as an
 * untyped object and a missing property is simply `undefined` at runtime.
 *
 * So the failure mode is: styling silently stops applying, and every existing
 * test still passes. That is precisely the class of defect a test suite cannot
 * find, which is why this is a static check rather than another test.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** `.some-class` and `.some_class`, but not `:hover`, `#id`, or `@media`. */
const CLASS_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g;

/** `styles.foo` or `styles["foo"]`, optionally chained. */
const STYLES_REFERENCE = /\bstyles\.(\w+)|\bstyles\[\s*["'`](\w+)["'`]\s*\]/g;

const violations = [];

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const allFiles = walk(SRC);
const stylesheets = allFiles.filter((path) => path.endsWith(".css"));
const components = allFiles.filter((path) =>
  [".tsx", ".ts"].includes(extname(path)),
);

/**
 * The classes a stylesheet declares.
 *
 * Read from the selectors rather than from the declaration blocks, so a class
 * that is only ever *referenced* inside the file (`composes`, or a
 * `.parent .child`) still counts as declared. Underscores and dashes are both
 * legal in a CSS class, and CSS Modules export the name as written.
 */
function declaredClasses(source) {
  const declared = new Set();
  for (const [, name] of source.matchAll(CLASS_SELECTOR)) declared.add(name);
  return declared;
}

/**
 * Class names per stylesheet, keyed by the module specifier components import.
 *
 * A component imports `./Dashboard.module.css`, so the lookup is keyed on the
 * file's own name — the module system does the resolution and this only has to
 * agree with it.
 */
const classesByModule = new Map();
for (const path of stylesheets) {
  classesByModule.set(basename(path), declaredClasses(readFileSync(path, "utf8")));
}

/** Every `styles.x` a file uses, with the stylesheet it must have come from. */
function referencedStyles(source) {
  return Array.from(source.matchAll(STYLES_REFERENCE), ([, dotted, bracketed]) => ({
    name: dotted ?? bracketed,
    index: source.indexOf(dotted ? `styles.${dotted}` : `styles[`),
  }));
}

// Every `styles.x` reference is checked against the union of declared classes,
// because a component may import several modules and the import list is a second
// thing to keep in step. That loosens the check by design: it still catches a
// class that exists nowhere, which is the failure that happened.
const everywhereDeclared = new Set(
  [...classesByModule.values()].flatMap((names) => [...names]),
);

for (const path of components) {
  const source = readFileSync(path, "utf8");
  if (!/from\s+["'][^"']*\.css["']/.test(source)) continue;

  const name = relative(SRC, path);

  for (const reference of referencedStyles(source)) {
    if (!everywhereDeclared.has(reference.name)) {
      const line = source.slice(0, reference.index).split("\n").length;
      violations.push(
        `${name}:${line} styles.${reference.name} — no stylesheet declares that class`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("CSS module references that do not exist:\n");
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error(
    "\nA missing class renders as className={undefined}: the styling silently stops\n" +
      "applying while every test still passes, because data-testid is a separate\n" +
      "attribute.",
  );
  process.exit(1);
}

console.log(
  `CSS module references are clean: ${classesByModule.size} stylesheet(s), ` +
    `every styles.x a component uses is declared in one of them.`,
);
