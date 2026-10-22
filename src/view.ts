import { ItemView, Keymap, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { MetroApp } from "./app";
import { collectRecords } from "./collect";
import type MetroNodesPlugin from "./main";

export const VIEW_TYPE_METRO = "metro-nodes-view";

export class MetroView extends ItemView {
	private metro: MetroApp | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: MetroNodesPlugin) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_METRO;
	}

	getDisplayText() {
		return "Metro map";
	}

	getIcon() {
		return "train-front";
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass("metro-nodes-view");
		const plugin = this.plugin;
		const app = this.app;
		this.metro = new MetroApp(this.contentEl, {
			settings: plugin.settings,
			saveSettings: () => void plugin.saveSettings(),
			getRecords: () => collectRecords(app),
			getActiveId: () => plugin.lastActiveFile,
			open: (id, ghost, title, ev) => {
				const newLeaf = Keymap.isModEvent(ev);
				if (ghost) {
					// Same as clicking an unresolved link: creates the note.
					void app.workspace.openLinkText(title, "", newLeaf);
					return;
				}
				const file = app.vault.getAbstractFileByPath(id);
				if (file instanceof TFile) void app.workspace.getLeaf(newLeaf).openFile(file);
			},
			hoverPreview: (id, ev, target) => {
				app.workspace.trigger("hover-link", {
					event: ev,
					source: VIEW_TYPE_METRO,
					hoverParent: this,
					targetEl: target,
					linktext: id,
				});
			},
			setIcon: (el, icon) => setIcon(el, icon),
		});
		this.metro.refresh(false);
	}

	async onClose() {
		this.metro?.destroy();
		this.metro = null;
	}

	refresh() {
		this.metro?.refresh(true);
	}

	onActiveChange() {
		this.metro?.onActiveChange();
	}

	locateActive() {
		this.metro?.locateActive();
	}
}
