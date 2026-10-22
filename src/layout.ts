// Turns notes into a metro map: which stations exist, which lines run
// through them, where everything sits on the grid and how tracks are routed.
// Pure functions only — no Obsidian, no DOM.

import type {
	MetroLayout,
	MetroLine,
	MetroMode,
	MetroSettings,
	NoteRecord,
	Pt,
	Station,
} from "./types";

export const PALETTE = [
	"#e5484d", // red
	"#3e8ef7", // blue
	"#30a46c", // green
	"#f5a524", // amber
	"#8e4ec6", // purple
	"#12a594", // teal
	"#e93d82", // pink
	"#f76b15", // orange
	"#5b5bd6", // indigo
	"#99d52a", // lime
	"#a18072", // brown
	"#00a2c7", // cyan
	"#d6409f", // plum
	"#978365", // bronze
];
export const ORPHAN_COLOR = "#8b8d98";
export const GHOST_PREFIX = "ghost:";

interface GNode {
	id: string;
	title: string;
	ghost: boolean;
	out: Set<string>;
	in: Set<string>;
	rec?: NoteRecord;
}
type Graph = Map<string, GNode>;

/** Line before routing/colouring. `stations` may start with a fork station owned by `parent`. */
interface RawLine {
	id: string;
	name: string;
	stations: string[];
	lane: number;
	spur: boolean;
	parent?: string;
	colorKey: string;
	fixedColor?: string;
}

interface Placement {
	col: Map<string, number>;
	lane: Map<string, number>;
	lines: RawLine[];
	hiddenCount: number;
}

export function buildLayout(
	records: NoteRecord[],
	s: MetroSettings,
	focusId: string | null = null,
): MetroLayout {
	const excluded = s.excludeFolders
		.split(",")
		.map((f) => f.trim().replace(/^\/+|\/+$/g, ""))
		.filter(Boolean);
	const recs = records.filter(
		(r) => !excluded.some((f) => r.id === f || r.id.startsWith(f + "/")),
	);
	const g = buildGraph(recs, s.mode === "links" && s.showUnresolved);
	const placement =
		s.mode === "links" ? placeLinkTree(g, s, focusId) : placeGroups(recs, s);
	return finish(s.mode, placement, g, s);
}

// ---------------------------------------------------------------------------
// Graph

function buildGraph(records: NoteRecord[], withGhosts: boolean): Graph {
	const g: Graph = new Map();
	for (const r of records) {
		g.set(r.id, { id: r.id, title: r.title, ghost: false, out: new Set(), in: new Set(), rec: r });
	}
	const link = (a: string, b: string) => {
		if (a === b) return;
		g.get(a)!.out.add(b);
		g.get(b)!.in.add(a);
	};
	for (const r of records) {
		for (const l of r.links) if (g.has(l)) link(r.id, l);
		if (!withGhosts) continue;
		for (const u of r.unresolved) {
			const text = u.split("#")[0].split("|")[0].trim();
			if (!text) continue;
			const id = GHOST_PREFIX + text.toLowerCase();
			if (!g.has(id)) {
				const title = text.split("/").pop() ?? text;
				g.set(id, { id, title, ghost: true, out: new Set(), in: new Set() });
			}
			link(r.id, id);
		}
	}
	return g;
}

// ---------------------------------------------------------------------------
// Links mode: spanning forest -> longest-path decomposition -> lanes

function placeLinkTree(g: Graph, s: MetroSettings, focusId: string | null): Placement {
	const title = (id: string) => g.get(id)!.title;
	const byTitle = (a: string, b: string) => title(a).localeCompare(title(b));
	const children = new Map<string, string[]>();
	const visited = new Set<string>();
	const roots: string[] = [];

	const grow = (root: string, maxDepth: number, undirected: boolean) => {
		visited.add(root);
		roots.push(root);
		const queue: [string, number][] = [[root, 0]];
		for (let qi = 0; qi < queue.length; qi++) {
			const [id, depth] = queue[qi];
			if (depth >= maxDepth) continue;
			const n = g.get(id)!;
			const next = undirected ? [...n.out, ...n.in] : [...n.out];
			next.sort(byTitle);
			for (const m of next) {
				if (visited.has(m)) continue;
				visited.add(m);
				if (!children.has(id)) children.set(id, []);
				children.get(id)!.push(m);
				queue.push([m, depth + 1]);
			}
		}
	};

	const focused = s.focusActive && focusId !== null && g.has(focusId);
	if (focused) {
		grow(focusId!, Math.max(1, s.focusDepth), true);
	} else {
		const ids = [...g.keys()];
		const degreeDesc = (a: string, b: string) =>
			g.get(b)!.out.size - g.get(a)!.out.size || byTitle(a, b);
		// Index-like notes (nothing links to them) start the lines.
		const starts = ids.filter((id) => g.get(id)!.in.size === 0 && g.get(id)!.out.size > 0);
		for (const id of starts.sort(degreeDesc)) if (!visited.has(id)) grow(id, Infinity, false);
		// Whatever is left lives in cycles nobody enters from outside.
		const rest = ids.filter((id) => !visited.has(id) && g.get(id)!.out.size > 0);
		for (const id of rest.sort(degreeDesc)) if (!visited.has(id)) grow(id, Infinity, false);
	}

	const col = new Map<string, number>();
	const lane = new Map<string, number>();
	const lines: RawLine[] = [];

	interface Block { lines: RawLine[]; col: Map<string, number>; lane: Map<string, number>; w: number; h: number; minLane: number; size: number }
	const blocks: Block[] = roots.map((r) => placeTree(r, children, title, s));
	blocks.sort((a, b) => b.size - a.size);

	// Shelf-pack the trees: big ones first, small ones side by side.
	const rowLimit = Math.max(24, ...blocks.map((b) => b.w));
	let x = 0;
	let y = 0;
	let rowH = 0;
	for (const b of blocks) {
		if (x > 0 && x + b.w > rowLimit) {
			y += rowH + 2;
			x = 0;
			rowH = 0;
		}
		for (const [id, c] of b.col) col.set(id, c + x);
		for (const [id, l] of b.lane) lane.set(id, l - b.minLane + y);
		for (const line of b.lines) lines.push({ ...line, lane: line.lane - b.minLane + y });
		x += b.w + 3;
		rowH = Math.max(rowH, b.h);
	}
	let bottom = blocks.length ? y + rowH + 2 : 0;

	// Notes with no links at all get a grey "Unlinked" line (wrapped into rows).
	let hiddenCount = 0;
	const orphans = [...g.keys()].filter((id) => !visited.has(id)).sort(byTitle);
	if (orphans.length && !focused) {
		if (s.showOrphans) {
			for (let i = 0; i < orphans.length; i += rowLimit) {
				const chunk = orphans.slice(i, i + rowLimit);
				chunk.forEach((id, j) => {
					col.set(id, j);
					lane.set(id, bottom);
				});
				lines.push({
					id: `orphans-${i}`,
					name: "Unlinked",
					stations: chunk,
					lane: bottom,
					spur: false,
					colorKey: "links:Unlinked",
					fixedColor: ORPHAN_COLOR,
				});
				bottom += 1;
			}
		} else {
			hiddenCount = orphans.length;
		}
	}
	return { col, lane, lines, hiddenCount };
}

function placeTree(
	root: string,
	children: Map<string, string[]>,
	title: (id: string) => string,
	s: MetroSettings,
) {
	// Post-order subtree sizes.
	const size = new Map<string, number>();
	const order: string[] = [];
	const stack = [root];
	while (stack.length) {
		const id = stack.pop()!;
		order.push(id);
		for (const c of children.get(id) ?? []) stack.push(c);
	}
	for (let i = order.length - 1; i >= 0; i--) {
		const id = order[i];
		let n = 1;
		for (const c of children.get(id) ?? []) n += size.get(c)!;
		size.set(id, n);
	}

	// Every hub note (a note with children) gets a line that runs through its
	// children. Children that are hubs themselves become interchanges where
	// their own line starts. Single-child chains stay on one line.
	const kids = (id: string) => {
		const ch = [...(children.get(id) ?? [])];
		// Leaves first, then hubs from small to big so the biggest subtree sits
		// at the end of the line and can carry straight on.
		return ch.sort(
			(a, b) =>
				size.get(a)! - size.get(b)! || title(a).localeCompare(title(b)),
		);
	};
	const lines: RawLine[] = [];
	const lineById = new Map<string, RawLine>();
	const queue: { hub: string; parent?: string }[] = [{ hub: root }];
	for (let qi = 0; qi < queue.length; qi++) {
		const { hub, parent } = queue[qi];
		const id = `line:${hub}`;
		const stations = [hub];
		let cur = hub;
		let ch = kids(cur);
		while (ch.length === 1 && (children.get(ch[0])?.length ?? 0) > 0) {
			cur = ch[0];
			stations.push(cur);
			ch = kids(cur);
		}
		for (const c of ch) {
			stations.push(c);
			if (children.get(c)?.length) queue.push({ hub: c, parent: id });
		}
		const line: RawLine = {
			id,
			name: title(cur),
			stations,
			lane: 0,
			spur: !!parent && stations.length === 2,
			parent,
			colorKey: `links:${title(cur)}`,
		};
		lines.push(line);
		lineById.set(id, line);
	}

	// Greedy lane assignment: a line that starts at the end of its parent
	// carries straight on; others take the nearest free lane beside their
	// interchange, preferring the side their parent already branched to.
	const col = new Map<string, number>();
	const lane = new Map<string, number>();
	const occupied = new Map<number, [number, number][]>();
	const isFree = (l: number, a: number, b: number) =>
		!(occupied.get(l) ?? []).some(([x, y]) => a <= y && b >= x);
	const take = (l: number, a: number, b: number) => {
		if (!occupied.has(l)) occupied.set(l, []);
		occupied.get(l)!.push([a, b]);
	};
	const side = new Map<string, number>();
	const lineLane = new Map<string, number>();

	const placeLine = (line: RawLine) => {
		if (!line.parent) {
			line.stations.forEach((id, i) => {
				col.set(id, i);
				lane.set(id, 0);
			});
			take(0, 0, line.stations.length - 1);
			lineLane.set(line.id, 0);
			return;
		}
		const parentLine = lineById.get(line.parent)!;
		const fork = line.stations[0];
		const forkCol = col.get(fork)!;
		const forkLane = lane.get(fork)!;
		const n = line.stations.length - 1;
		const pref = side.get(line.parent) ?? 1;
		const atEnd = parentLine.stations[parentLine.stations.length - 1] === fork;
		let chosen: { l: number; start: number; sgn: number } | null = null;
		for (let k = atEnd ? 0 : 1; !chosen; k++) {
			for (const sgn of k === 0 ? [pref] : [pref, -pref]) {
				const l = forkLane + sgn * k;
				const steps = Math.max(1, Math.ceil((k * s.laneSpacing) / s.columnSpacing));
				const start = forkCol + steps;
				if (k > 400 || isFree(l, k === 0 ? start : start - 1, start + n)) {
					chosen = { l, start, sgn };
					break;
				}
			}
		}
		line.stations.slice(1).forEach((id, i) => {
			col.set(id, chosen!.start + i);
			lane.set(id, chosen!.l);
		});
		take(chosen.l, chosen.start, chosen.start + n - 1);
		side.set(line.id, chosen.sgn);
		lineLane.set(line.id, chosen.l);
	};

	// Branches of one line are placed right-to-left: later forks hug the
	// parent, earlier ones wrap around them, so siblings nest instead of cross.
	const childLines = new Map<string, RawLine[]>();
	for (const l of lines) {
		if (!l.parent) continue;
		if (!childLines.has(l.parent)) childLines.set(l.parent, []);
		childLines.get(l.parent)!.push(l);
	}
	const visit = (line: RawLine) => {
		const ks = (childLines.get(line.id) ?? []).sort(
			(a, b) => col.get(b.stations[0])! - col.get(a.stations[0])!,
		);
		for (const k of ks) placeLine(k);
		for (const k of ks) visit(k);
	};
	placeLine(lines[0]);
	visit(lines[0]);
	for (const line of lines) line.lane = lineLane.get(line.id)!;

	let minLane = 0;
	let maxLane = 0;
	let maxCol = 0;
	for (const l of lane.values()) {
		minLane = Math.min(minLane, l);
		maxLane = Math.max(maxLane, l);
	}
	for (const c of col.values()) maxCol = Math.max(maxCol, c);
	return { lines, col, lane, w: maxCol + 1, h: maxLane - minLane + 1, minLane, size: order.length };
}

// ---------------------------------------------------------------------------
// Tags / folders / property mode: one line per group, stations in time order,
// notes in several groups become interchanges.

function groupKeys(r: NoteRecord, s: MetroSettings): string[] {
	if (s.mode === "tags") {
		const tags = r.tags.map((t) => t.replace(/^#/, "")).map((t) => (s.topLevelTags ? t.split("/")[0] : t));
		return [...new Set(tags.map((t) => "#" + t))];
	}
	if (s.mode === "folders") {
		if (!r.folder || r.folder === "/") return ["(vault root)"];
		return [s.topLevelFolders ? r.folder.split("/")[0] : r.folder];
	}
	const v = r.props[s.propertyKey];
	const vals = Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];
	return [
		...new Set(
			vals.map((x) => String(x).replace(/^\[\[|\]\]$/g, "").split("|")[0].trim()).filter(Boolean),
		),
	];
}

function noteTime(r: NoteRecord, s: MetroSettings): number {
	if (s.order === "modified") return r.mtime;
	const raw = s.dateProperty ? r.props[s.dateProperty] : undefined;
	if (raw !== undefined && raw !== null) {
		const t = Date.parse(String(raw));
		if (Number.isFinite(t)) return t;
	}
	return r.ctime;
}

function placeGroups(recs: NoteRecord[], s: MetroSettings): Placement {
	const keysById = new Map<string, string[]>();
	const counts = new Map<string, number>();
	for (const r of recs) {
		const ks = groupKeys(r, s);
		keysById.set(r.id, ks);
		for (const k of ks) counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	const top = [...counts.keys()]
		.sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b))
		.slice(0, Math.max(1, s.maxLines));
	const topSet = new Set(top);

	let hiddenCount = 0;
	const members = new Map<string, string[]>();
	for (const r of recs) {
		let ks = keysById.get(r.id)!.filter((k) => topSet.has(k));
		if (!ks.length) {
			if (!s.includeUnsorted) {
				hiddenCount++;
				continue;
			}
			ks = ["Unsorted"];
		}
		members.set(r.id, ks);
	}
	const lineKeys = top.filter((k) => [...members.values()].some((ks) => ks.includes(k)));
	if ([...members.values()].some((ks) => ks[0] === "Unsorted")) lineKeys.push("Unsorted");

	// Lane order: lines sharing many notes sit next to each other.
	const pair = new Map<string, number>();
	const pk = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);
	for (const ks of members.values())
		for (let i = 0; i < ks.length; i++)
			for (let j = i + 1; j < ks.length; j++) pair.set(pk(ks[i], ks[j]), (pair.get(pk(ks[i], ks[j])) ?? 0) + 1);
	const w = (a: string, b: string) => pair.get(pk(a, b)) ?? 0;
	const laneOrder: string[] = lineKeys.length ? [lineKeys[0]] : [];
	const remaining = new Set(lineKeys.slice(1));
	while (remaining.size) {
		let best = "";
		let bestScore = -1;
		for (const k of remaining) {
			const score = Math.max(w(k, laneOrder[0]), w(k, laneOrder[laneOrder.length - 1])) * 1000 +
				laneOrder.reduce((acc, o) => acc + w(k, o), 0);
			if (score > bestScore) {
				best = k;
				bestScore = score;
			}
		}
		remaining.delete(best);
		if (w(best, laneOrder[0]) > w(best, laneOrder[laneOrder.length - 1])) laneOrder.unshift(best);
		else laneOrder.push(best);
	}
	const home = new Map(laneOrder.map((k, i) => [k, i]));

	const byId = new Map(recs.map((r) => [r.id, r]));
	const ids = [...members.keys()];
	if (s.order === "name") ids.sort((a, b) => byId.get(a)!.title.localeCompare(byId.get(b)!.title));
	else ids.sort((a, b) => noteTime(byId.get(a)!, s) - noteTime(byId.get(b)!, s) || a.localeCompare(b));

	const ratio = s.laneSpacing / s.columnSpacing;
	const stepsFor = (from: number, to: number, h: number) => {
		const lanes = from !== h && to !== h ? Math.abs(from - h) + Math.abs(to - h) : Math.abs(to - from);
		return Math.max(1, Math.ceil(lanes * ratio));
	};

	const col = new Map<string, number>();
	const lane = new Map<string, number>();
	const lastCol = new Map<string, number>();
	const lastLane = new Map<string, number>(laneOrder.map((k) => [k, home.get(k)!]));
	const stations = new Map<string, string[]>(laneOrder.map((k) => [k, []]));

	for (const id of ids) {
		const ks = members.get(id)!;
		const lanes = ks.map((k) => home.get(k)!).sort((a, b) => a - b);
		const y = lanes[Math.floor((lanes.length - 1) / 2)];
		let req = 0;
		let maxSteps = 0;
		let lo = y;
		let hi = y;
		for (const k of ks) {
			const h = home.get(k)!;
			lo = Math.min(lo, h, lastLane.get(k)!);
			hi = Math.max(hi, h, lastLane.get(k)!);
			if (!lastCol.has(k)) continue;
			const steps = stepsFor(lastLane.get(k)!, y, h);
			maxSteps = Math.max(maxSteps, steps);
			req = Math.max(req, lastCol.get(k)! + steps);
		}
		// Lines whose lane the bends cross must stay clear of the diagonals.
		const crossed = laneOrder.filter((k) => !ks.includes(k) && home.get(k)! > lo && home.get(k)! < hi);
		for (const k of crossed) if (lastCol.has(k)) req = Math.max(req, lastCol.get(k)! + 1 + maxSteps);
		col.set(id, req);
		lane.set(id, y);
		for (const k of ks) {
			lastCol.set(k, req);
			lastLane.set(k, y);
			stations.get(k)!.push(id);
		}
		for (const k of crossed) lastCol.set(k, Math.max(lastCol.get(k) ?? -Infinity, req + maxSteps));
	}

	const lines: RawLine[] = laneOrder.map((k) => ({
		id: `group:${k}`,
		name: k,
		stations: stations.get(k)!,
		lane: home.get(k)!,
		spur: false,
		colorKey: `${s.mode}:${k}`,
		fixedColor: k === "Unsorted" ? ORPHAN_COLOR : undefined,
	}));
	return { col, lane, lines, hiddenCount };
}

// ---------------------------------------------------------------------------
// Shared: coordinates, station kinds, track routing, colours

/** Octilinear route from a to b. Lines prefer to run on their home lane. */
export function route(a: Pt, b: Pt, home: number): Pt[] {
	const dx = b.x - a.x;
	const offA = Math.abs(a.y - home);
	const offB = Math.abs(b.y - home);
	if (offA > 0 && offB > 0 && offA + offB <= dx) {
		return [{ x: a.x + offA, y: home }, { x: b.x - offB, y: home }, b];
	}
	const ady = Math.abs(b.y - a.y);
	if (dx <= 0 || ady === 0 || ady >= dx) return [b];
	if (a.y !== home) return [{ x: a.x + ady, y: b.y }, b];
	return [{ x: b.x - ady, y: a.y }, b];
}

function finish(mode: MetroMode, p: Placement, g: Graph, s: MetroSettings): MetroLayout {
	const byId = new Map<string, Station>();
	for (const [id, c] of p.col) {
		const n = g.get(id);
		const l = p.lane.get(id)!;
		byId.set(id, {
			id,
			title: n?.title ?? id,
			col: c,
			lane: l,
			x: c * s.columnSpacing,
			y: l * s.laneSpacing,
			lines: [],
			kind: "stop",
			ghost: n?.ghost ?? false,
			outLinks: n?.out.size ?? 0,
			inLinks: n?.in.size ?? 0,
		});
	}

	let paletteIdx = 0;
	const colorOf = new Map<string, string>();
	const lines: MetroLine[] = [];
	for (const raw of p.lines) {
		if (!raw.stations.length) continue;
		let color: string;
		if (s.lineColors[raw.colorKey]) color = s.lineColors[raw.colorKey];
		else if (raw.spur && raw.parent && colorOf.has(raw.parent)) color = colorOf.get(raw.parent)!;
		else if (raw.fixedColor) color = raw.fixedColor;
		else color = PALETTE[paletteIdx++ % PALETTE.length];
		colorOf.set(raw.id, color);

		const home = raw.lane * s.laneSpacing;
		const pts: Pt[] = [];
		raw.stations.forEach((id, i) => {
			const st = byId.get(id)!;
			if (!st.lines.includes(raw.id)) st.lines.push(raw.id);
			if (i === 0) pts.push({ x: st.x, y: st.y });
			else pts.push(...route(pts[pts.length - 1], { x: st.x, y: st.y }, home));
		});
		lines.push({ ...raw, color, points: pts, homeY: home });
	}

	const ends = new Set<string>();
	for (const l of lines) {
		ends.add(l.stations[l.stations.length - 1]);
		if (!l.parent) ends.add(l.stations[0]);
	}
	for (const st of byId.values()) {
		if (st.lines.length > 1) st.kind = "interchange";
		else if (ends.has(st.id)) st.kind = "terminal";
	}

	const track = new Set<string>();
	for (const l of lines)
		for (let i = 1; i < l.stations.length; i++) {
			track.add(`${l.stations[i - 1]}\n${l.stations[i]}`);
			track.add(`${l.stations[i]}\n${l.stations[i - 1]}`);
		}
	const links: [string, string][] = [];
	const crossLinks: [string, string][] = [];
	for (const n of g.values()) {
		if (!byId.has(n.id)) continue;
		for (const t of n.out) {
			if (!byId.has(t)) continue;
			links.push([n.id, t]);
			if (!track.has(`${n.id}\n${t}`)) crossLinks.push([n.id, t]);
		}
	}

	const stations = [...byId.values()];
	const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	if (stations.length) {
		bounds.minX = Math.min(...stations.map((st) => st.x));
		bounds.maxX = Math.max(...stations.map((st) => st.x));
		bounds.minY = Math.min(...stations.map((st) => st.y));
		bounds.maxY = Math.max(...stations.map((st) => st.y));
	}
	return {
		mode,
		stations,
		byId,
		lines,
		links,
		crossLinks,
		showLineNames: mode !== "links",
		bounds,
		hiddenCount: p.hiddenCount,
	};
}
