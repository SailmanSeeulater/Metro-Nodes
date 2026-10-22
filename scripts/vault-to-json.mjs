// Dev helper: turn vault folders into the NoteRecord JSON the harness renders.
// Usage: node scripts/vault-to-json.mjs [vaultDir ...]   (default: demo-vault)
import fs from "node:fs";
import path from "node:path";

const vaults = process.argv.slice(2);
if (!vaults.length) vaults.push("demo-vault");
const outDir = "harness/data";
fs.mkdirSync(outDir, { recursive: true });

function walk(dir, root, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name.startsWith(".")) continue;
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walk(full, root, out);
		else if (e.name.endsWith(".md")) out.push(path.relative(root, full).split(path.sep).join("/"));
	}
	return out;
}

function parseFrontmatter(text) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!m) return [{}, text];
	const props = {};
	let listKey = null;
	for (const line of m[1].split(/\r?\n/)) {
		const item = /^\s*-\s+(.*)$/.exec(line);
		if (item && listKey) {
			props[listKey].push(item[1].trim().replace(/^["']|["']$/g, ""));
			continue;
		}
		const kv = /^([\w-]+):\s*(.*)$/.exec(line);
		if (!kv) continue;
		const [, key, raw] = kv;
		if (raw === "") {
			props[key] = [];
			listKey = key;
		} else if (/^\[.*\]$/.test(raw)) {
			props[key] = raw.slice(1, -1).split(",").map((v) => v.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
			listKey = null;
		} else {
			props[key] = raw.replace(/^["']|["']$/g, "");
			listKey = null;
		}
	}
	return [props, text.slice(m[0].length)];
}

for (const vault of vaults) {
	const files = walk(vault, vault);
	const byKey = new Map();
	for (const f of files) {
		const noExt = f.slice(0, -3).toLowerCase();
		byKey.set(noExt, f);
		const base = noExt.split("/").pop();
		if (!byKey.has(base)) byKey.set(base, f);
	}
	const records = files.map((f) => {
		const text = fs.readFileSync(path.join(vault, f), "utf8");
		const stat = fs.statSync(path.join(vault, f));
		const [props, body] = parseFrontmatter(text);
		const clean = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
		const tags = new Set();
		const ft = props.tags ?? props.tag;
		for (const t of Array.isArray(ft) ? ft : ft ? String(ft).split(/[ ,]+/) : []) if (t) tags.add(t.replace(/^#/, ""));
		for (const m of clean.matchAll(/(?:^|\s)#([A-Za-z_][\w/-]*)/g)) tags.add(m[1]);
		const links = new Set();
		const unresolved = new Set();
		for (const m of clean.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
			const target = m[1].trim();
			const hit = byKey.get(target.toLowerCase().replace(/\.md$/, ""));
			if (hit) {
				if (hit !== f) links.add(hit);
			} else unresolved.add(target);
		}
		const slash = f.lastIndexOf("/");
		return {
			id: f,
			title: f.slice(slash + 1, -3),
			folder: slash < 0 ? "/" : f.slice(0, slash),
			tags: [...tags],
			props,
			ctime: stat.birthtimeMs,
			mtime: stat.mtimeMs,
			links: [...links],
			unresolved: [...unresolved],
		};
	});
	const name = path.basename(path.resolve(vault));
	fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(records, null, 1));
	console.log(`${name}: ${records.length} notes -> ${outDir}/${name}.json`);
}
const index = fs.readdirSync(outDir).filter((f) => f.endsWith(".json") && f !== "index.json");
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index.map((f) => f.slice(0, -5))));
