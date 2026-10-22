import { Plugin, TFile, debounce } from "obsidian";
import { MetroSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type MetroSettings } from "./types";
import { MetroView, VIEW_TYPE_METRO } from "./view";

export default class MetroNodesPlugin extends Plugin {
	settings: MetroSettings = { ...DEFAULT_SETTINGS };
	/** Last markdown note focused, so the map keeps it while the map itself is focused. */
	lastActiveFile: string | null = null;

	async onload() {
		await this.loadSettings();
		this.registerView(VIEW_TYPE_METRO, (leaf) => new MetroView(leaf, this));
		this.registerHoverLinkSource(VIEW_TYPE_METRO, { display: "Metro map", defaultMod: true });

		this.addRibbonIcon("train-front", "Open metro map", () => void this.openView());
		this.addCommand({ id: "open", name: "Open metro map", callback: () => void this.openView() });
		this.addCommand({
			id: "locate-active",
			name: "Show current note on metro map",
			callback: async () => {
				const view = await this.openView();
				window.setTimeout(() => view?.locateActive(), 50);
			},
		});
		this.addSettingTab(new MetroSettingTab(this.app, this));

		this.lastActiveFile = this.app.workspace.getActiveFile()?.path ?? null;
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!(file instanceof TFile)) return;
				this.lastActiveFile = file.path;
				for (const v of this.views()) v.onActiveChange();
			}),
		);

		const refresh = debounce(() => this.refreshViews(), 700, true);
		this.registerEvent(this.app.metadataCache.on("resolved", refresh));
		this.registerEvent(this.app.metadataCache.on("changed", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
	}

	views(): MetroView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE_METRO)
			.map((l) => l.view)
			.filter((v): v is MetroView => v instanceof MetroView);
	}

	refreshViews() {
		for (const v of this.views()) v.refresh();
	}

	async openView(): Promise<MetroView | null> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_METRO)[0];
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_METRO, active: true });
		}
		await workspace.revealLeaf(leaf);
		return leaf.view instanceof MetroView ? leaf.view : null;
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<MetroSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...saved, lineColors: { ...(saved?.lineColors ?? {}) } };
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
