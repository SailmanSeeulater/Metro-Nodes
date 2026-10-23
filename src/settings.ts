import { App, PluginSettingTab, Setting } from "obsidian";
import type MetroNodesPlugin from "./main";
import type { CrossLinks, MetroMode, StationOrder } from "./types";

export class MetroSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: MetroNodesPlugin) {
		super(app, plugin);
	}

	display() {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = async (rebuild = true) => {
			await this.plugin.saveSettings();
			if (rebuild) this.plugin.refreshViews();
		};
		containerEl.empty();

		new Setting(containerEl).setName("Map").setHeading();
		new Setting(containerEl)
			.setName("Lines are built from")
			.setDesc("Links follows your note links like branches. Tags, folders and property draw one line per group, ordered by date.")
			.addDropdown((d) =>
				d
					.addOptions({ links: "Links", tags: "Tags", folders: "Folders", property: "Frontmatter property" })
					.setValue(s.mode)
					.onChange(async (v) => {
						s.mode = v as MetroMode;
						await save();
					}),
			);
		new Setting(containerEl)
			.setName("Untangle lines")
			.setDesc("Give every line its own lane so lines never cross or share track. Takes more vertical room. Also on the map toolbar.")
			.addToggle((t) =>
				t.setValue(s.untangle).onChange(async (v) => {
					s.untangle = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc("Comma-separated folder paths left off the map, e.g. Templates, Archive.")
			.addText((t) =>
				t.setPlaceholder("Templates, Archive").setValue(s.excludeFolders).onChange(async (v) => {
					s.excludeFolders = v;
					await save();
				}),
			);

		new Setting(containerEl).setName("Links mode").setHeading();
		new Setting(containerEl)
			.setName("Show unresolved links")
			.setDesc("Links to notes that don't exist yet become dashed “planned” stations. Click one to create the note.")
			.addToggle((t) =>
				t.setValue(s.showUnresolved).onChange(async (v) => {
					s.showUnresolved = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Show unlinked notes")
			.setDesc("Put notes without any links on a grey “Unlinked” line.")
			.addToggle((t) =>
				t.setValue(s.showOrphans).onChange(async (v) => {
					s.showOrphans = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Cross links")
			.setDesc("Links that don't fit on a line are drawn as dashed transfers.")
			.addDropdown((d) =>
				d
					.addOptions({ hover: "On hover", always: "Always", never: "Never" })
					.setValue(s.crossLinks)
					.onChange(async (v) => {
						s.crossLinks = v as CrossLinks;
						await save();
					}),
			);

		new Setting(containerEl).setName("Tags, folders and property modes").setHeading();
		new Setting(containerEl)
			.setName("Station order")
			.addDropdown((d) =>
				d
					.addOptions({ created: "Created date", modified: "Modified date", name: "Name" })
					.setValue(s.order)
					.onChange(async (v) => {
						s.order = v as StationOrder;
						await save();
					}),
			);
		new Setting(containerEl)
			.setName("Created date property")
			.setDesc("Frontmatter key with the note's date. Falls back to the file's creation time.")
			.addText((t) =>
				t.setPlaceholder("created").setValue(s.dateProperty).onChange(async (v) => {
					s.dateProperty = v.trim();
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Property key")
			.setDesc("Used by property mode: one line per value, e.g. project or status.")
			.addText((t) =>
				t.setPlaceholder("project").setValue(s.propertyKey).onChange(async (v) => {
					s.propertyKey = v.trim();
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Maximum lines")
			.setDesc("The biggest groups get lines; the rest go to “Unsorted”.")
			.addSlider((sl) =>
				sl.setLimits(2, 24, 1).setValue(s.maxLines).setDynamicTooltip().onChange(async (v) => {
					s.maxLines = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Unsorted line")
			.setDesc("Show notes outside the top groups on a grey line instead of hiding them.")
			.addToggle((t) =>
				t.setValue(s.includeUnsorted).onChange(async (v) => {
					s.includeUnsorted = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Top-level tags only")
			.setDesc("Treat #project/alpha as #project.")
			.addToggle((t) =>
				t.setValue(s.topLevelTags).onChange(async (v) => {
					s.topLevelTags = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Top-level folders only")
			.setDesc("Group by the first folder in the path instead of the note's own folder.")
			.addToggle((t) =>
				t.setValue(s.topLevelFolders).onChange(async (v) => {
					s.topLevelFolders = v;
					await save();
				}),
			);

		new Setting(containerEl).setName("Appearance").setHeading();
		new Setting(containerEl)
			.setName("Size stations by links")
			.addToggle((t) =>
				t.setValue(s.scaleByLinks).onChange(async (v) => {
					s.scaleByLinks = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Station spacing")
			.addSlider((sl) =>
				sl.setLimits(40, 140, 4).setValue(s.columnSpacing).setDynamicTooltip().onChange(async (v) => {
					s.columnSpacing = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Line spacing")
			.addSlider((sl) =>
				sl.setLimits(24, 90, 2).setValue(s.laneSpacing).setDynamicTooltip().onChange(async (v) => {
					s.laneSpacing = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName("Reset line colours")
			.setDesc("Forget colours picked in the legend.")
			.addButton((b) =>
				b.setButtonText("Reset").onClick(async () => {
					s.lineColors = {};
					await save();
				}),
			);
	}
}
