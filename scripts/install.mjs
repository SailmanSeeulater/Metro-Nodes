// Copy the built plugin into a vault: node scripts/install.mjs /path/to/vault
import fs from "node:fs";
import path from "node:path";

const vault = process.argv[2];
if (!vault || !fs.existsSync(path.join(vault, ".obsidian"))) {
	console.error("Usage: npm run install-plugin -- /path/to/vault  (folder must contain .obsidian/)");
	process.exit(1);
}
const dest = path.join(vault, ".obsidian", "plugins", "metro-nodes");
fs.mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) {
	if (!fs.existsSync(f)) {
		console.error(`Missing ${f} — run npm run build first.`);
		process.exit(1);
	}
	fs.copyFileSync(f, path.join(dest, f));
}
console.log(`Installed to ${dest}`);
console.log("In Obsidian: Settings → Community plugins → turn on Metro Nodes (reload the app if it isn't listed).");
