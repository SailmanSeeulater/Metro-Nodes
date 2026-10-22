// The whole metro view: toolbar, map, legend and status bar. Talks to its
// environment (Obsidian or the harness) only through MetroHost.

import { buildLayout } from "./layout";
import { MetroRenderer } from "./renderer";
import type { MetroLayout, MetroMode, MetroSettings, NoteRecord } from "./types";

export interface MetroHost {
	settings: MetroSettings;
	saveSettings(): void;
	getRecords(): NoteRecord[];
	getActiveId(): string | null;
	open(id: string, ghost: boolean, title: string, ev: MouseEvent): void;
	hoverPreview?(id: string, ev: MouseEvent, target: Element): void;
	setIcon?(el: HTMLElement, icon: string): void;
}

const MODES: { mode: MetroMode; label: string; hint: string }[] = [
	{ mode: "links", label: "Links", hint: "Lines follow your links, like branches of a tree" },
	{ mode: "tags", label: "Tags", hint: "One line per tag, stations in creation order" },
	{ mode: "folders", label: "Folders", hint: "One line per folder, stations in creation order" },
	{ mode: "property", label: "Property", hint: "One line per value of a frontmatter property" },
];

function div(cls: string, parent?: HTMLElement): HTMLDivElement {
	const d = document.createElement("div");
	d.className = cls;
	parent?.appendChild(d);
	return d;
}

export class MetroApp {
	readonly el: HTMLDivElement;
	private renderer: MetroRenderer;
	private layout: MetroLayout | null = null;
	private modeButtons = new Map<MetroMode, HTMLButtonElement>();
	private focusBtn!: HTMLButtonElement;
	private depthSel!: HTMLSelectElement;
	private searchInput!: HTMLInputElement;
	private searchCount!: HTMLSpanElement;
	private legend!: HTMLDivElement;
	private legendList!: HTMLDivElement;
	private legendCount!: HTMLSpanElement;
	private status!: HTMLDivElement;
	private empty!: HTMLDivElement;
	private matches: string[] = [];
	private matchIdx = -1;
	private isolated: string | null = null;
	private lastFocusId: string | null = null;

	constructor(parent: HTMLElement, private host: MetroHost) {
		this.el = div("metro-nodes", parent);
		const s = host.settings;
		this.renderer = new MetroRenderer(
			this.el,
			{
				open: (id, ev) => {
					const st = this.layout?.byId.get(id);
					if (st) host.open(id, st.ghost, st.title, ev);
				},
				hover: (id, ev, target) => {
					const st = this.layout?.byId.get(id);
					if (st && !st.ghost) host.hoverPreview?.(id, ev, target);
				},
				labelsChanged: () => this.updateStatus(),
			},
			{ crossLinks: s.crossLinks, scaleByLinks: s.scaleByLinks },
		);
		this.buildToolbar();
		this.buildLegend();
		this.status = div("mn-status mn-panel", this.el);
		this.empty = div("mn-empty", this.el);
	}

	destroy() {
		this.renderer.destroy();
		this.el.remove();
	}

	private icon(el: HTMLElement, name: string, fallback: string) {
		if (this.host.setIcon) this.host.setIcon(el, name);
		else el.textContent = fallback;
	}

	private button(parent: HTMLElement, cls: string, title: string, icon: string, fallback: string, onClick: () => void) {
		const b = document.createElement("button");
		b.className = `mn-btn ${cls}`;
		b.setAttribute("aria-label", title);
		b.title = title;
		this.icon(b, icon, fallback);
		b.addEventListener("click", onClick);
		parent.appendChild(b);
		return b;
	}

	private buildToolbar() {
		const bar = div("mn-toolbar mn-panel", this.el);
		const brand = div("mn-brand", bar);
		const logo = document.createElement("span");
		logo.className = "mn-logo";
		this.icon(logo, "train-front", "Ⓜ");
		brand.append(logo, document.createTextNode("Metro"));

		const seg = div("mn-seg", bar);
		for (const m of MODES) {
			const b = document.createElement("button");
			b.className = "mn-seg-btn";
			b.textContent = m.label;
			b.title = m.hint;
			b.addEventListener("click", () => {
				if (this.host.settings.mode === m.mode) return;
				this.host.settings.mode = m.mode;
				this.host.saveSettings();
				this.isolated = null;
				this.renderer.isolate(null);
				this.refresh(false);
			});
			seg.appendChild(b);
			this.modeButtons.set(m.mode, b);
		}

		const focus = div("mn-focus", bar);
		this.focusBtn = this.button(focus, "mn-focus-btn", "Only show the neighbourhood of the active note", "locate-fixed", "◎", () => {
			this.host.settings.focusActive = !this.host.settings.focusActive;
			this.host.saveSettings();
			this.refresh(false);
		});
		this.depthSel = document.createElement("select");
		this.depthSel.className = "mn-depth dropdown";
		this.depthSel.title = "How many links away from the active note";
		for (let d = 1; d <= 6; d++) {
			const o = document.createElement("option");
			o.value = String(d);
			o.textContent = `${d} hop${d > 1 ? "s" : ""}`;
			this.depthSel.appendChild(o);
		}
		this.depthSel.addEventListener("change", () => {
			this.host.settings.focusDepth = Number(this.depthSel.value);
			this.host.saveSettings();
			this.refresh(false);
		});
		focus.appendChild(this.depthSel);

		const search = div("mn-search", bar);
		this.searchInput = document.createElement("input");
		this.searchInput.type = "search";
		this.searchInput.placeholder = "Find a station…";
		this.searchInput.addEventListener("input", () => this.runSearch());
		this.searchInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.nextMatch(e.shiftKey ? -1 : 1);
			} else if (e.key === "Escape") {
				this.searchInput.value = "";
				this.runSearch();
			}
		});
		this.searchCount = document.createElement("span");
		this.searchCount.className = "mn-search-count";
		search.append(this.searchInput, this.searchCount);

		const actions = div("mn-actions", bar);
		this.button(actions, "", "Fit map to view", "maximize", "⤢", () => this.renderer.fit());
		this.button(actions, "", "Locate the active note", "crosshair", "⌖", () => this.locateActive());
		this.button(actions, "", "Rebuild the map", "refresh-cw", "↻", () => this.refresh(true));
	}

	private buildLegend() {
		this.legend = div("mn-legend mn-panel", this.el);
		const head = div("mn-legend-head", this.legend);
		const title = document.createElement("span");
		title.textContent = "Lines";
		this.legendCount = document.createElement("span");
		this.legendCount.className = "mn-badge";
		const toggle = document.createElement("button");
		toggle.className = "mn-btn mn-legend-toggle";
		toggle.title = "Show / hide legend";
		this.icon(toggle, "panel-right", "☰");
		toggle.addEventListener("click", () => {
			this.host.settings.legendOpen = !this.host.settings.legendOpen;
			this.host.saveSettings();
			this.legend.classList.toggle("mn-collapsed", !this.host.settings.legendOpen);
		});
		head.append(title, this.legendCount, toggle);
		this.legendList = div("mn-legend-list", this.legend);

		const keys = div("mn-legend-keys", this.legend);
		const key = (cls: string, text: string) => {
			const row = div("mn-key", keys);
			const sym = div(`mn-key-sym ${cls}`, row);
			sym.appendChild(document.createElement("i"));
			row.appendChild(document.createTextNode(text));
		};
		key("mn-key-stop", "note");
		key("mn-key-interchange", "interchange");
		key("mn-key-terminal", "end of line");
		key("mn-key-ghost", "not created yet");
		this.legend.classList.toggle("mn-collapsed", !this.host.settings.legendOpen);
	}

	/** Rebuild the layout from fresh vault data. */
	refresh(preserveView = true) {
		const s = this.host.settings;
		this.renderer.setOptions({ crossLinks: s.crossLinks, scaleByLinks: s.scaleByLinks });
		const activeId = this.host.getActiveId();
		this.lastFocusId = activeId;
		this.layout = buildLayout(this.host.getRecords(), s, activeId);
		this.renderer.setLayout(this.layout, preserveView);
		this.renderer.setActive(activeId);
		if (this.isolated) this.renderer.isolate(this.isolated);
		if (this.searchInput.value) this.runSearch(false);
		this.syncControls();
		this.renderLegend();
		this.updateStatus();
		this.renderEmpty();
	}

	/** Active note changed in the workspace. */
	onActiveChange() {
		const id = this.host.getActiveId();
		if (this.host.settings.focusActive && this.host.settings.mode === "links") {
			if (id && id !== this.lastFocusId) this.refresh(false);
			return;
		}
		this.renderer.setActive(id);
	}

	locateActive() {
		const id = this.host.getActiveId();
		if (id) this.renderer.centerOn(id);
	}

	private syncControls() {
		const s = this.host.settings;
		for (const [mode, b] of this.modeButtons) b.classList.toggle("mn-on", mode === s.mode);
		const linkMode = s.mode === "links";
		this.focusBtn.parentElement!.classList.toggle("mn-off", !linkMode);
		this.focusBtn.classList.toggle("mn-on", s.focusActive);
		this.depthSel.value = String(s.focusDepth);
		this.depthSel.disabled = !s.focusActive;
	}

	private renderLegend() {
		const layout = this.layout!;
		this.legendList.replaceChildren();
		const groups = new Map<string, { name: string; color: string; count: number }>();
		for (const line of layout.lines) {
			if (line.spur) continue;
			const g = groups.get(line.colorKey) ?? { name: line.name, color: line.color, count: 0 };
			g.count += line.parent ? line.stations.length - 1 : line.stations.length;
			groups.set(line.colorKey, g);
		}
		this.legendCount.textContent = String(groups.size);
		for (const [key, g] of groups) {
			const row = div("mn-legend-row", this.legendList);
			if (key === this.isolated) row.classList.add("mn-on");
			const sw = document.createElement("label");
			sw.className = "mn-swatch mn-swatch-pick";
			sw.style.background = g.color;
			sw.title = "Change colour";
			const pick = document.createElement("input");
			pick.type = "color";
			pick.value = g.color;
			pick.addEventListener("change", () => {
				this.host.settings.lineColors[key] = pick.value;
				this.host.saveSettings();
				this.refresh(true);
			});
			sw.appendChild(pick);
			const name = document.createElement("span");
			name.className = "mn-legend-name";
			name.textContent = g.name;
			name.title = `${g.name} — click to highlight`;
			const count = document.createElement("span");
			count.className = "mn-legend-n";
			count.textContent = String(g.count);
			row.append(sw, name, count);
			row.addEventListener("click", (e) => {
				if ((e.target as HTMLElement).closest(".mn-swatch-pick")) return;
				this.isolated = this.isolated === key ? null : key;
				this.renderer.isolate(this.isolated);
				this.legendList.querySelectorAll(".mn-legend-row").forEach((r) => r.classList.remove("mn-on"));
				if (this.isolated) row.classList.add("mn-on");
			});
		}
	}

	private updateStatus() {
		const layout = this.layout;
		if (!layout) return;
		const notes = layout.stations.filter((s) => !s.ghost).length;
		const ghosts = layout.stations.length - notes;
		const lines = new Set(layout.lines.filter((l) => !l.spur).map((l) => l.colorKey)).size;
		const interchanges = layout.stations.filter((s) => s.kind === "interchange").length;
		const parts = [`${lines} lines`, `${notes} stations`];
		if (ghosts) parts.push(`${ghosts} planned`);
		parts.push(`${interchanges} interchanges`);
		if (layout.hiddenCount) parts.push(`${layout.hiddenCount} notes off-map`);
		const hidden = this.renderer.hiddenLabels;
		this.status.replaceChildren();
		this.status.appendChild(document.createTextNode(parts.join(" · ")));
		if (hidden) {
			const h = document.createElement("span");
			h.className = "mn-muted";
			h.textContent = ` · ${hidden} names hidden — hover, zoom or search`;
			this.status.appendChild(h);
		}
	}

	private renderEmpty() {
		const layout = this.layout!;
		const s = this.host.settings;
		this.empty.classList.toggle("mn-show", layout.stations.length === 0);
		if (layout.stations.length) return;
		const why: Record<MetroMode, string> = {
			links: s.focusActive ? "Open a note to see the lines around it." : "No notes to draw yet.",
			tags: "No tagged notes found. Add #tags or switch to Links.",
			folders: "No notes found in folders.",
			property: `No notes have a “${s.propertyKey}” property. Set the key in settings.`,
		};
		this.empty.textContent = why[s.mode];
	}

	private runSearch(jump = true) {
		this.matches = this.renderer.search(this.searchInput.value);
		this.matchIdx = -1;
		this.searchCount.textContent = this.searchInput.value ? String(this.matches.length) : "";
		if (jump && this.matches.length === 1) this.nextMatch(1);
	}

	private nextMatch(dir: number) {
		if (!this.matches.length) return;
		this.matchIdx = (this.matchIdx + dir + this.matches.length) % this.matches.length;
		this.renderer.centerOn(this.matches[this.matchIdx], 1.4);
		this.searchCount.textContent = `${this.matchIdx + 1}/${this.matches.length}`;
	}
}
