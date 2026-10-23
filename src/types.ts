// Shared types. Nothing in here may import from "obsidian" so the layout and
// renderer can run in the standalone harness too.

/** One markdown note, flattened from Obsidian's metadata cache. */
export interface NoteRecord {
	/** Vault path, e.g. "Matcha Manager/Tea.md". Used as the station id. */
	id: string;
	title: string;
	folder: string;
	tags: string[];
	props: Record<string, unknown>;
	ctime: number;
	mtime: number;
	/** Paths of notes this note links to (resolved). */
	links: string[];
	/** Link texts that don't resolve to a file yet. */
	unresolved: string[];
}

export type MetroMode = "links" | "tags" | "folders" | "property";
export type StationOrder = "created" | "modified" | "name";
export type CrossLinks = "hover" | "always" | "never";

export interface MetroSettings {
	mode: MetroMode;
	/** Frontmatter key used when mode is "property". */
	propertyKey: string;
	/** Frontmatter key holding a created date; falls back to file ctime. */
	dateProperty: string;
	order: StationOrder;
	/** Only the first segment of nested tags (#a/b -> a). */
	topLevelTags: boolean;
	/** Folders mode: group by top-level folder instead of the note's own folder. */
	topLevelFolders: boolean;
	maxLines: number;
	includeUnsorted: boolean;
	showUnresolved: boolean;
	showOrphans: boolean;
	excludeFolders: string;
	/** Layout that never lets lines cross or share track (uses more space). */
	untangle: boolean;
	focusActive: boolean;
	focusDepth: number;
	crossLinks: CrossLinks;
	scaleByLinks: boolean;
	columnSpacing: number;
	laneSpacing: number;
	legendOpen: boolean;
	/** Custom line colours keyed by `${mode}:${lineName}`. */
	lineColors: Record<string, string>;
}

export const DEFAULT_SETTINGS: MetroSettings = {
	mode: "links",
	propertyKey: "project",
	dateProperty: "created",
	order: "created",
	topLevelTags: false,
	topLevelFolders: true,
	maxLines: 12,
	includeUnsorted: true,
	showUnresolved: true,
	showOrphans: true,
	excludeFolders: "",
	untangle: false,
	focusActive: false,
	focusDepth: 3,
	crossLinks: "hover",
	scaleByLinks: true,
	columnSpacing: 64,
	laneSpacing: 40,
	legendOpen: true,
	lineColors: {},
};

export interface Pt {
	x: number;
	y: number;
}

export type StationKind = "stop" | "interchange" | "terminal";

export interface Station {
	id: string;
	title: string;
	col: number;
	lane: number;
	x: number;
	/** Top of the station; equals yEnd except for capsule interchanges. */
	y: number;
	yEnd: number;
	/** Ids of every line that stops here. */
	lines: string[];
	kind: StationKind;
	/** Link target that has no file yet. */
	ghost: boolean;
	outLinks: number;
	inLinks: number;
}

export interface MetroLine {
	id: string;
	name: string;
	color: string;
	/** Station ids in travel order. */
	stations: string[];
	/** Routed polyline in map coordinates. */
	points: Pt[];
	lane: number;
	/** y of the line's home lane in map coordinates. */
	homeY: number;
	/** Short dead-end branch drawn in its parent's colour. */
	spur: boolean;
	parent?: string;
	/** Key for custom colours / legend grouping. */
	colorKey: string;
}

export interface MetroLayout {
	mode: MetroMode;
	stations: Station[];
	byId: Map<string, Station>;
	lines: MetroLine[];
	/** Every link between two drawn stations (source, target). */
	links: [string, string][];
	/** Links not already drawn as a track segment. */
	crossLinks: [string, string][];
	/** Draw each line's name before its first station. */
	showLineNames: boolean;
	bounds: { minX: number; minY: number; maxX: number; maxY: number };
	/** Notes left out because their line didn't make the cut. */
	hiddenCount: number;
}
