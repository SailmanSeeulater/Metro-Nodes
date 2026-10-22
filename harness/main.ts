// Browser test page: renders MetroApp from JSON exported by scripts/vault-to-json.mjs.
import { MetroApp } from "../src/app";
import { DEFAULT_SETTINGS, type MetroSettings, type NoteRecord } from "../src/types";

const KEY = "metro-nodes-harness";
let settings: MetroSettings = { ...DEFAULT_SETTINGS };
try {
	settings = { ...settings, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
} catch {
	/* ignore */
}

async function main() {
	const names: string[] = await (await fetch("data/index.json")).json();
	const pick = document.getElementById("dataset") as HTMLSelectElement;
	const theme = document.getElementById("theme") as HTMLButtonElement;
	for (const n of names) pick.add(new Option(n, n));
	const params = new URLSearchParams(location.search);
	pick.value = params.get("data") ?? names[0];

	let records: NoteRecord[] = [];
	let active: string | null = null;
	const app = new MetroApp(document.getElementById("stage")!, {
		settings,
		saveSettings: () => localStorage.setItem(KEY, JSON.stringify(settings)),
		getRecords: () => records,
		getActiveId: () => active,
		open: (id, ghost, title) => {
			console.log("open", { id, ghost, title });
			if (!ghost) {
				active = id;
				app.onActiveChange();
			}
		},
	});
	(window as unknown as { metro: MetroApp }).metro = app;

	const load = async () => {
		records = await (await fetch(`data/${pick.value}.json`)).json();
		active = records[0]?.id ?? null;
		app.refresh(false);
	};
	pick.addEventListener("change", () => {
		history.replaceState(null, "", `?data=${pick.value}`);
		void load();
	});
	theme.addEventListener("click", () => document.body.classList.toggle("theme-light"));
	await load();
}
void main();
