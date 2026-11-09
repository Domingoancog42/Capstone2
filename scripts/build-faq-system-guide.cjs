/* Build documentation from reviewed workflows and static UI syntax, never from records,
   uploads, database dumps, environment files, local credentials or running user sessions. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parse } = require("@babel/parser");
const topics = require("./faq-topics.cjs");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "backend/data/system-guide.json");
const cache = new Map();
const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set(values.map(clean).filter((text) => text && text.length > 1 && text.length <= 600 && !/^https?:|data:|uploads\//i.test(text)))];

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "start", "end", "extra", "comments", "leadingComments", "trailingComments", "tokens"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}

function literal(node) {
  if (node?.type === "StringLiteral" || node?.type === "JSXText") return clean(node.value);
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return clean(node.quasis[0].value.cooked);
  if (node?.type === "JSXExpressionContainer") return literal(node.expression);
  return "";
}

function elementName(node) {
  const name = node?.openingElement?.name;
  return name?.name || name?.property?.name || "";
}

function elementText(node) {
  return clean((node.children || []).map((child) => child.type === "JSXElement" ? elementText(child) : literal(child)).filter(Boolean).join(" "));
}

function expand(source) {
  const absolute = path.resolve(root, source);
  if (!absolute.startsWith(root + path.sep) || /(?:^|[/\\])(?:node_modules|uploads|backups|vendor)(?:[/\\]|$)|\.local\.|\.env|\.sql$/i.test(source)) {
    throw new Error(`Disallowed documentation source: ${source}`);
  }
  if (!fs.existsSync(absolute)) throw new Error(`Documentation source is missing: ${source}`);
  if (fs.statSync(absolute).isDirectory()) {
    return fs.readdirSync(absolute, { recursive: true }).filter((name) => /\.(?:jsx|js)$/.test(name) && !/\.test\./.test(name))
      .map((name) => path.relative(root, path.join(absolute, name)).replace(/\\/g, "/")).sort();
  }
  return [source];
}

function sourceInfo(source) {
  if (cache.has(source)) return cache.get(source);
  const text = fs.readFileSync(path.join(root, source), "utf8");
  const facts = { headings: [], actions: [], fields: [], labels: [], descriptions: [], validation: [] };
  const navigation = [];
  if (/\.(jsx|js)$/.test(source)) {
    const ast = parse(text, { sourceType: "unambiguous", plugins: ["jsx"] });
    walk(ast, (node) => {
      if (node.type === "JSXElement") {
        const name = elementName(node);
        const value = elementText(node);
        if (/^(?:button|Button|PortalButton|ActionIconButton|ActionButton)$/.test(name)) facts.actions.push(value);
        if (/^h[1-6]$/.test(name)) facts.headings.push(value);
        if (name === "label") facts.fields.push(value);
      }
      if (node.type === "JSXAttribute") {
        const name = node.name?.name;
        const value = literal(node.value);
        if (name === "label") facts.fields.push(value);
        if (["title", "aria-label"].includes(name)) facts.labels.push(value);
        if (name === "description") facts.descriptions.push(value);
      }
      if (node.type === "ObjectProperty") {
        const key = node.key?.name || node.key?.value;
        if (["label", "title", "header"].includes(key)) facts.labels.push(literal(node.value));
        if (["description", "helper"].includes(key)) facts.descriptions.push(literal(node.value));
      }
      if (node.type === "ObjectExpression") {
        const props = Object.fromEntries(node.properties.filter((property) => property.type === "ObjectProperty").map((property) => [property.key?.name || property.key?.value, literal(property.value)]));
        if (props.path?.startsWith("/") && props.label) navigation.push({ key: props.key || "", label: props.label, path: props.path });
      }
      if (node.type === "CallExpression") {
        const callee = node.callee;
        if ((callee.type === "MemberExpression" && callee.object?.name === "toast" && callee.property?.name === "error") || /^set.*Error/.test(callee.name || "")) {
          facts.validation.push(literal(node.arguments[0]));
        }
      }
    });
  } else if (source.endsWith(".php") && !source.endsWith("settings.php")) {
    // Only user-facing, literal messages; do not include SQL, function bodies or log output.
    for (const match of text.matchAll(/(?:['"]message['"]\s*=>|throw new InvalidArgumentException\()\s*(['"])((?:\\.|(?!\1).)*?)\1/g)) {
      if (!/[${}]|SELECT |INSERT |UPDATE |DELETE /i.test(match[2])) facts.validation.push(match[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
    }
  }
  for (const key of Object.keys(facts)) facts[key] = unique(facts[key]);
  const result = { hash: crypto.createHash("sha256").update(text).digest("hex"), facts, navigation };
  cache.set(source, result);
  return result;
}

const entries = topics.map((topic) => {
  const sources = [...new Set(topic.sources.flatMap(expand))];
  const facts = { headings: [], actions: [], fields: [], labels: [], descriptions: [], validation: [] };
  const fingerprints = {};
  for (const source of sources) {
    const info = sourceInfo(source);
    fingerprints[source] = info.hash;
    if (topic.extract !== false && (!topic.factSources || topic.factSources.includes(source))) {
      for (const key of Object.keys(facts)) facts[key].push(...info.facts[key]);
    }
  }
  for (const key of Object.keys(facts)) facts[key] = unique(facts[key]);
  return {
    id: `system-${topic.id}`, module: topic.id, category: topic.category,
    question: topic.title, answer: topic.answer, keywords: unique([...topic.keywords, topic.title]),
    facts, sources, fingerprints,
  };
});

const roleFiles = {
  admin: "src/components/navigation/Sidebar.jsx", employee: "src/page/Employee/employeedashboard.jsx",
  hrhead: "src/page/HRHead/Hrheaddashboard.jsx", hrstaff: "src/page/HRStaff/Hrstaffdashboard.jsx",
  chief: "src/page/Chief/chiefdashboard.jsx", chiefadmin: "src/page/chiefadmin/chiefadmindashboard.jsx",
  planningofficer: "src/page/PlanningOfficer/planningofficerdashboard.jsx", cashier: "src/page/Cashier/cashierdashboard.jsx",
  regionaldirector: "src/page/Regionaldirector/RegionalDashboard.jsx",
};
const navigation = {};
for (const [role, source] of Object.entries(roleFiles)) {
  navigation[role] = [...new Map(sourceInfo(source).navigation.map((item) => [item.path, item])).values()];
}
navigation.chiefadmin = navigation.chief.filter((item) => !["employees", "payroll", "archivedPayroll"].includes(item.key))
  .map((item) => ({ ...item, path: item.path.replace(/^\/chief(?=\/|$)/, "/chiefadmin") }));

// Every settings screen and primary workspace must have a documented owner.
const covered = new Set(entries.flatMap((entry) => entry.sources));
const required = [
  ...expand("src/page/settings/"),
  ...expand("src/module/").filter((source) => /Workspace\.jsx$|module\/overtime\/Overtime\.jsx$|module\/Loan\/fileloan\.jsx$/.test(source)),
];
const missing = required.filter((source) => !covered.has(source));
if (missing.length) throw new Error(`Undocumented workspace/settings files:\n${missing.join("\n")}`);

const sourceHashes = Object.fromEntries([...cache.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([source, info]) => [source, info.hash]));
const guide = {
  version: 1,
  digest: crypto.createHash("sha256").update(JSON.stringify({ entries, navigation })).digest("hex"),
  moduleCount: entries.length, sourceCount: Object.keys(sourceHashes).length,
  entries, navigation, sourceHashes,
};
const json = JSON.stringify(guide, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (!fs.existsSync(output) || fs.readFileSync(output, "utf8") !== json) {
    throw new Error("The system guide is out of date. Run npm run faq:build.");
  }
  console.log(`System guide is current: ${guide.moduleCount} modules, ${guide.sourceCount} source files.`);
} else {
  fs.writeFileSync(output, json, "utf8");
  console.log(`Built system guide: ${guide.moduleCount} modules, ${guide.sourceCount} source files.`);
}
