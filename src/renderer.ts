// SVG drawing, pan/zoom, label collision and hover highlighting for a
// MetroLayout. Plain DOM — usable inside Obsidian and in the harness.

import type { CrossLinks, MetroLayout, MetroLine, Pt, Station } from "./types";

const NS = "http://www.w3.org/2000/svg";
const LABEL_PX = 12;
const MIN_ZOOM = 0.06;
const MAX_ZOOM = 4;

export interface RendererEvents {
	open(id: string, ev: MouseEvent): void;
	hover?(id: string, ev: MouseEvent, el: Element): void;
	/** Fired after labels are re-placed, with how many had to be hidden. */
	labelsChanged?(hidden: number): void;
}

export interface RendererOptions {
	crossLinks: CrossLinks;
	scaleByLinks: boolean;
}

type LabelSide = "above" | "below" | "right" | "left" | "aboveR" | "belowR" | "aboveL" | "belowL" | "diag";
type Box = [number, number, number, number]; // x, y, w, h

function el<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number>,
	parent?: Element,
): SVGElementTagNameMap[K] {
	const node = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	parent?.appendChild(node);
	return node;
}

/** Polyline with softened corners, like a transit diagram. */
export function roundedPath(input: Pt[], radius = 14): string {
	const pts = input.filter((p, i) => i === 0 || p.x !== input[i - 1].x || p.y !== input[i - 1].y);
	if (pts.length < 2) return "";
	let d = `M${pts[0].x},${pts[0].y}`;
	for (let i = 1; i < pts.length - 1; i++) {
		const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
		const d1 = Math.hypot(b.x - a.x, b.y - a.y);
		const d2 = Math.hypot(c.x - b.x, c.y - b.y);
		const r = Math.min(radius, d1 / 2, d2 / 2);
		const p1 = { x: b.x - ((b.x - a.x) / d1) * r, y: b.y - ((b.y - a.y) / d1) * r };
		const p2 = { x: b.x + ((c.x - b.x) / d2) * r, y: b.y + ((c.y - b.y) / d2) * r };
		d += ` L${p1.x},${p1.y} Q${b.x},${b.y} ${p2.x},${p2.y}`;
	}
	const last = pts[pts.length - 1];
	return d + ` L${last.x},${last.y}`;
}

function curve(a: Station, b: Station): string {
	const mx = (a.x + b.x) / 2;
	const my = (a.y + b.y) / 2;
	const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
	const bend = Math.min(80, len * 0.25);
	const cx = mx - ((b.y - a.y) / len) * bend;
	const cy = my + ((b.x - a.x) / len) * bend;
	return `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`;
}

export class MetroRenderer {
	readonly root: HTMLDivElement;
	private svg: SVGSVGElement;
	private viewport: SVGGElement;
	private crossLayer: SVGGElement;
	private trackLayer: SVGGElement;
	private stationLayer: SVGGElement;
	private labelLayer: SVGGElement;
	private hoverLayer: SVGGElement;
	private tooltip: HTMLDivElement;

	private layout: MetroLayout | null = null;
	private lineById = new Map<string, MetroLine>();
	private stationEls = new Map<string, SVGGElement>();
	private labelEls = new Map<string, SVGTextElement>();
	private trackEls = new Map<string, SVGPathElement[]>();
	private radius = new Map<string, number>();
	private textWidth = new Map<string, number>();
	private neighbors = new Map<string, Set<string>>();

	private k = 1;
	private tx = 0;
	private ty = 0;
	private labelTimer: number | null = null;
	private lastLabelK = 0;
	private activeId: string | null = null;
	private hoverId: string | null = null;
	private isolatedKey: string | null = null;
	private matches: string[] = [];
	private pointers = new Map<number, { x: number; y: number }>();
	private drag: { x: number; y: number; moved: boolean; target: string | null } | null = null;
	private pinchDist = 0;
	private measureCtx: CanvasRenderingContext2D | null = null;
	private resizeObs: ResizeObserver;
	hiddenLabels = 0;

	constructor(
		parent: HTMLElement,
		private events: RendererEvents,
		private opts: RendererOptions,
	) {
		this.root = document.createElement("div");
		this.root.className = "mn-canvas";
		parent.appendChild(this.root);
		this.svg = el("svg", { class: "mn-svg" }, this.root);
		this.viewport = el("g", { class: "mn-viewport" }, this.svg);
		this.crossLayer = el("g", { class: "mn-cross" }, this.viewport);
		this.trackLayer = el("g", { class: "mn-tracks" }, this.viewport);
		this.hoverLayer = el("g", { class: "mn-hover-links" }, this.viewport);
		this.stationLayer = el("g", { class: "mn-stations" }, this.viewport);
		this.labelLayer = el("g", { class: "mn-labels" }, this.viewport);
		this.tooltip = document.createElement("div");
		this.tooltip.className = "mn-tooltip";
		this.root.appendChild(this.tooltip);
		this.bindInput();
		let first = true;
		this.resizeObs = new ResizeObserver(() => {
			// The view may mount hidden (0×0); fit once it gets a real size.
			if (first && this.root.clientWidth > 0 && this.layout) {
				first = false;
				this.fit();
			}
		});
		this.resizeObs.observe(this.root);
	}

	destroy() {
		this.resizeObs.disconnect();
		if (this.labelTimer !== null) window.clearTimeout(this.labelTimer);
		this.root.remove();
	}

	setOptions(opts: RendererOptions) {
		this.opts = opts;
	}

	// -----------------------------------------------------------------------
	// Drawing

	setLayout(layout: MetroLayout, preserveView: boolean) {
		const hadLayout = this.layout !== null;
		this.layout = layout;
		this.lineById = new Map(layout.lines.map((l) => [l.id, l]));
		this.neighbors.clear();
		for (const [a, b] of layout.links) {
			if (!this.neighbors.has(a)) this.neighbors.set(a, new Set());
			if (!this.neighbors.has(b)) this.neighbors.set(b, new Set());
			this.neighbors.get(a)!.add(b);
			this.neighbors.get(b)!.add(a);
		}
		for (const layer of [this.crossLayer, this.trackLayer, this.hoverLayer, this.stationLayer, this.labelLayer]) {
			layer.replaceChildren();
		}
		this.stationEls.clear();
		this.labelEls.clear();
		this.trackEls.clear();
		this.radius.clear();
		this.hoverId = null;
		this.hideTooltip();

		if (this.opts.crossLinks === "always") {
			for (const [a, b] of layout.crossLinks) {
				el("path", { class: "mn-crosslink", d: curve(layout.byId.get(a)!, layout.byId.get(b)!) }, this.crossLayer);
			}
		}

		// Casings first so every track gets a thin gap where lines cross.
		for (const line of layout.lines) {
			const d = roundedPath(line.points);
			if (!d) continue;
			const casing = el("path", { class: "mn-casing", d }, this.trackLayer);
			const track = el("path", { class: "mn-track", d, stroke: line.color }, this.trackLayer);
			if (line.spur) track.classList.add("mn-spur");
			this.trackEls.set(line.id, [casing, track]);
		}

		for (const st of layout.stations) {
			const r = this.stationRadius(st);
			this.radius.set(st.id, r);
			const g = el("g", { class: `mn-station mn-${st.kind}`, "data-id": st.id }, this.stationLayer);
			if (st.ghost) g.classList.add("mn-ghost");
			const color = this.lineById.get(st.lines[0])?.color ?? "currentColor";
			g.style.setProperty("--mn-color", color);
			el("circle", { class: "mn-halo", cx: st.x, cy: st.y, r: r + 7 }, g);
			el("circle", { class: "mn-dot", cx: st.x, cy: st.y, r }, g);
			this.stationEls.set(st.id, g);

			const label = el("text", { class: "mn-label" }, this.labelLayer);
			if (st.ghost) label.classList.add("mn-ghost");
			label.textContent = st.title.length > 32 ? st.title.slice(0, 30) + "…" : st.title;
			this.labelEls.set(st.id, label);
		}

		if (layout.showLineNames) {
			for (const line of layout.lines) {
				const first = layout.byId.get(line.stations[0]);
				if (!first) continue;
				// Names sit in a shared left gutter, like row headers, with a
				// faint lead-in to where the line actually starts.
				const gutter = layout.bounds.minX - 22;
				const dy = Math.abs(first.y - line.homeY);
				if (first.x - gutter > 40 + dy) {
					const d = dy
						? `M${gutter + 8},${line.homeY} L${first.x - dy},${line.homeY} L${first.x},${first.y}`
						: `M${gutter + 8},${line.homeY} L${first.x - 12},${line.homeY}`;
					el("path", { class: "mn-leadin", d, stroke: line.color }, this.crossLayer);
				}
				const t = el(
					"text",
					{ class: "mn-line-name", x: gutter, y: line.homeY, dy: "0.35em", fill: line.color },
					this.labelLayer,
				);
				t.textContent = line.name;
			}
		}

		this.measureLabels();
		if (this.activeId) this.setActive(this.activeId);
		if (this.isolatedKey) this.isolate(this.isolatedKey);
		if (!preserveView || !hadLayout) this.fit();
		else this.applyTransform(true);
	}

	private stationRadius(st: Station): number {
		const base = st.kind === "interchange" ? 7 : st.kind === "terminal" ? 6.5 : 5;
		if (!this.opts.scaleByLinks) return base;
		return base + Math.min(5, Math.sqrt(st.inLinks + st.outLinks) * 0.7);
	}

	private measureLabels() {
		if (!this.measureCtx) this.measureCtx = document.createElement("canvas").getContext("2d");
		const family = getComputedStyle(this.root).fontFamily || "sans-serif";
		const ctx = this.measureCtx;
		this.textWidth.clear();
		for (const [id, label] of this.labelEls) {
			let w = (label.textContent ?? "").length * 7;
			if (ctx) {
				ctx.font = `500 ${LABEL_PX}px ${family}`;
				w = ctx.measureText(label.textContent ?? "").width;
			}
			this.textWidth.set(id, w + 2);
		}
	}

	// -----------------------------------------------------------------------
	// Labels: constant on-screen size, greedy collision avoidance

	private scheduleLabels(immediate = false) {
		if (immediate) {
			this.placeLabels();
			return;
		}
		if (this.labelTimer !== null) return;
		this.labelTimer = window.setTimeout(() => {
			this.labelTimer = null;
			this.placeLabels();
		}, 90);
	}

	private placeLabels() {
		const layout = this.layout;
		if (!layout) return;
		this.lastLabelK = this.k;
		const f = LABEL_PX / this.k; // font size in map units
		const pad = 2 / this.k;
		const cell = 120 / this.k;
		const grid = new Map<string, Box[]>();
		const keys = (b: Box) => {
			const out: string[] = [];
			for (let gx = Math.floor(b[0] / cell); gx <= Math.floor((b[0] + b[2]) / cell); gx++)
				for (let gy = Math.floor(b[1] / cell); gy <= Math.floor((b[1] + b[3]) / cell); gy++) out.push(`${gx},${gy}`);
			return out;
		};
		const hits = (b: Box, skip: Box) =>
			keys(b).some((key) =>
				(grid.get(key) ?? []).some(
					(o) => o !== skip && b[0] < o[0] + o[2] && b[0] + b[2] > o[0] && b[1] < o[1] + o[3] && b[1] + b[3] > o[1],
				),
			);
		const add = (b: Box) => {
			for (const key of keys(b)) {
				if (!grid.has(key)) grid.set(key, []);
				grid.get(key)!.push(b);
			}
		};

		// Station dots are obstacles; labels may not cover them.
		const dotBoxes = new Map<string, Box>();
		for (const st of layout.stations) {
			const r = this.radius.get(st.id)! + pad;
			const b: Box = [st.x - r, st.y - r, 2 * r, 2 * r];
			dotBoxes.set(st.id, b);
			add(b);
		}
		this.labelLayer.setAttribute("font-size", String(f));

		const forced = new Set<string>(this.matches.slice(0, 60));
		if (this.activeId) forced.add(this.activeId);
		if (this.hoverId) {
			forced.add(this.hoverId);
			for (const n of this.neighbors.get(this.hoverId) ?? []) forced.add(n);
		}

		const lineEnds = new Map<string, "start" | "end">();
		for (const line of layout.lines) {
			if (!line.parent) lineEnds.set(line.stations[0], "start");
			lineEnds.set(line.stations[line.stations.length - 1], "end");
		}
		const rank = (st: Station) =>
			(forced.has(st.id) ? 1e6 : 0) +
			(st.kind === "interchange" ? 3000 : st.kind === "terminal" ? 2000 : 1000) +
			(st.ghost ? -800 : 0) +
			(st.inLinks + st.outLinks) * 10;
		const order = [...layout.stations].sort((a, b) => rank(b) - rank(a));

		let hidden = 0;
		for (const st of order) {
			const label = this.labelEls.get(st.id)!;
			const r = this.radius.get(st.id)!;
			const w = (this.textWidth.get(st.id) ?? 40) / this.k;
			const h = f * 1.25;
			const end = lineEnds.get(st.id);
			const sides: LabelSide[] =
				end === "end" ? ["right", "above", "below"] :
				end === "start" && !layout.showLineNames ? ["left", "above", "below"] :
				st.col % 2 === 0 ? ["above", "below"] : ["below", "above"];
			// Stations that matter get a few more spots to try.
			if (st.kind !== "stop" || forced.has(st.id)) {
				sides.push(...(["aboveR", "belowR", "aboveL", "belowL"] as LabelSide[]));
			}
			// Last resort for crowded lines: a 40° label like a printed metro map.
			sides.push("diag");
			const DIAG = (40 * Math.PI) / 180;
			const diagStart = { x: st.x + r * 0.75, y: st.y - r * 0.75 - pad };
			const boxesFor = (side: LabelSide): Box[] => {
				switch (side) {
					case "above": return [[st.x - w / 2, st.y - r - pad - h, w, h]];
					case "below": return [[st.x - w / 2, st.y + r + pad, w, h]];
					case "right": return [[st.x + r + 0.4 * f, st.y - h / 2, w, h]];
					case "left": return [[st.x - r - 0.4 * f - w, st.y - h / 2, w, h]];
					case "aboveR": return [[st.x - r, st.y - r - pad - h, w, h]];
					case "belowR": return [[st.x - r, st.y + r + pad, w, h]];
					case "aboveL": return [[st.x + r - w, st.y - r - pad - h, w, h]];
					case "belowL": return [[st.x + r - w, st.y + r + pad, w, h]];
					case "diag": {
						const n = Math.max(1, Math.ceil(w / (h * 0.9)));
						const side = h * 0.8;
						const out: Box[] = [];
						for (let i = 0; i < n; i++) {
							const t = ((i + 0.5) * w) / n;
							const cx = diagStart.x + Math.cos(DIAG) * t;
							const cy = diagStart.y - Math.sin(DIAG) * t;
							out.push([cx - side / 2, cy - side / 2, side, side]);
						}
						return out;
					}
				}
			};
			const own = dotBoxes.get(st.id)!;
			let placed: LabelSide | null = null;
			for (const side of sides) {
				if (!boxesFor(side).some((b) => hits(b, own))) {
					placed = side;
					break;
				}
			}
			if (!placed && forced.has(st.id)) placed = sides[0];
			if (!placed) {
				label.classList.add("mn-hidden");
				hidden++;
				continue;
			}
			const boxes = boxesFor(placed);
			for (const b of boxes) add(b);
			label.classList.remove("mn-hidden");
			if (placed === "diag") {
				label.setAttribute("x", String(diagStart.x));
				label.setAttribute("y", String(diagStart.y + f * 0.35));
				label.setAttribute("text-anchor", "start");
				label.setAttribute("transform", `rotate(-40 ${diagStart.x} ${diagStart.y})`);
			} else {
				const b = boxes[0];
				label.setAttribute("x", String(b[0] + w / 2));
				label.setAttribute("y", String(b[1] + h * 0.78));
				label.setAttribute("text-anchor", "middle");
				label.removeAttribute("transform");
			}
		}
		this.hiddenLabels = hidden;
		this.events.labelsChanged?.(hidden);
	}

	// -----------------------------------------------------------------------
	// View transform

	private applyTransform(relabel = false) {
		this.viewport.setAttribute("transform", `translate(${this.tx},${this.ty}) scale(${this.k})`);
		this.labelLayer.setAttribute("font-size", String(LABEL_PX / this.k));
		this.root.classList.toggle("mn-far", this.k < 0.35);
		if (relabel || Math.abs(this.k - this.lastLabelK) / this.lastLabelK > 0.04) this.scheduleLabels(relabel);
	}

	fit() {
		const layout = this.layout;
		const w = this.root.clientWidth;
		const h = this.root.clientHeight;
		if (!layout || !w || !h) return;
		const b = layout.bounds;
		// Screen-space padding so end-of-line labels stay visible.
		const padX = Math.min(150, w * 0.15);
		const padY = 50;
		const bw = Math.max(1, b.maxX - b.minX);
		const bh = Math.max(1, b.maxY - b.minY);
		// Leave room for the floating panels on the right and top.
		const usableW = w > 700 ? w - 280 : w;
		const fitW = (usableW - 2 * padX) / bw;
		const fitH = (h - 60 - 2 * padY) / bh;
		this.k = Math.min(MAX_ZOOM * 0.5, Math.max(MIN_ZOOM, Math.min(fitW, fitH)));
		this.tx = usableW / 2 - ((b.minX + b.maxX) / 2) * this.k;
		if (this.k < 0.5 && fitH > fitW) {
			// Long, flat map: keep it readable and let the user pan sideways.
			this.k = Math.min(0.9, Math.max(0.5, fitH));
			this.tx = padX - b.minX * this.k;
		}
		this.ty = 30 + (h - 60) / 2 - ((b.minY + b.maxY) / 2) * this.k;
		this.applyTransform(true);
	}

	centerOn(id: string, minZoom = 1.1) {
		const st = this.layout?.byId.get(id);
		if (!st) return false;
		const w = this.root.clientWidth;
		const h = this.root.clientHeight;
		this.k = Math.max(this.k, minZoom);
		this.tx = (w > 700 ? w - 280 : w) / 2 - st.x * this.k;
		this.ty = h / 2 - st.y * this.k;
		this.viewport.classList.add("mn-animate");
		this.applyTransform(true);
		window.setTimeout(() => this.viewport.classList.remove("mn-animate"), 400);
		return true;
	}

	private zoomAt(factor: number, cx: number, cy: number) {
		const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.k * factor));
		this.tx = cx - ((cx - this.tx) * k) / this.k;
		this.ty = cy - ((cy - this.ty) * k) / this.k;
		this.k = k;
		this.applyTransform();
	}

	// -----------------------------------------------------------------------
	// Input

	private stationAt(target: EventTarget | null): string | null {
		const g = (target as Element | null)?.closest?.(".mn-station");
		return g?.getAttribute("data-id") ?? null;
	}

	private bindInput() {
		const svg = this.svg;
		svg.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				const rect = svg.getBoundingClientRect();
				if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
					this.tx -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
					this.applyTransform();
					return;
				}
				const speed = e.ctrlKey ? 0.01 : 0.0018;
				this.zoomAt(Math.exp(-e.deltaY * speed), e.clientX - rect.left, e.clientY - rect.top);
			},
			{ passive: false },
		);

		svg.addEventListener("pointerdown", (e) => {
			if (e.button !== 0 && e.pointerType === "mouse") return;
			this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			svg.setPointerCapture(e.pointerId);
			if (this.pointers.size === 1) {
				this.drag = { x: e.clientX, y: e.clientY, moved: false, target: this.stationAt(e.target) };
			} else if (this.pointers.size === 2) {
				const [a, b] = [...this.pointers.values()];
				this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
				if (this.drag) this.drag.moved = true;
			}
		});
		svg.addEventListener("pointermove", (e) => {
			const prev = this.pointers.get(e.pointerId);
			if (!prev) {
				this.onHoverMove(e);
				return;
			}
			this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (this.pointers.size === 2) {
				const [a, b] = [...this.pointers.values()];
				const dist = Math.hypot(a.x - b.x, a.y - b.y);
				const rect = svg.getBoundingClientRect();
				if (this.pinchDist > 0) this.zoomAt(dist / this.pinchDist, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
				this.pinchDist = dist;
				return;
			}
			if (!this.drag) return;
			if (!this.drag.moved && Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 4) {
				this.drag.moved = true;
				this.root.classList.add("mn-panning");
				this.unhover();
			}
			if (this.drag.moved) {
				this.tx += e.clientX - prev.x;
				this.ty += e.clientY - prev.y;
				this.applyTransform();
			}
		});
		const end = (e: PointerEvent) => {
			if (!this.pointers.has(e.pointerId)) return;
			this.pointers.delete(e.pointerId);
			if (this.pointers.size === 0) {
				const d = this.drag;
				this.drag = null;
				this.root.classList.remove("mn-panning");
				if (d && !d.moved && d.target && e.type === "pointerup") this.events.open(d.target, e);
			}
			if (this.pointers.size < 2) this.pinchDist = 0;
		};
		svg.addEventListener("pointerup", end);
		svg.addEventListener("pointercancel", end);
		svg.addEventListener("pointerleave", () => {
			if (!this.drag) this.unhover();
		});
		svg.addEventListener("dblclick", (e) => {
			if (this.stationAt(e.target)) return;
			const rect = svg.getBoundingClientRect();
			this.zoomAt(1.8, e.clientX - rect.left, e.clientY - rect.top);
		});
	}

	private onHoverMove(e: PointerEvent) {
		const id = this.stationAt(e.target);
		if (id !== this.hoverId) {
			if (id) this.hover(id, e);
			else this.unhover();
		}
		if (id) this.moveTooltip(e);
	}

	// -----------------------------------------------------------------------
	// Highlighting

	private hover(id: string, e: MouseEvent) {
		const layout = this.layout;
		const st = layout?.byId.get(id);
		if (!layout || !st) return;
		this.unhover(false);
		this.hoverId = id;
		this.root.classList.add("mn-focusing");
		const lit = new Set<string>([id, ...(this.neighbors.get(id) ?? [])]);
		for (const s of lit) this.stationEls.get(s)?.classList.add("mn-lit");
		for (const s of lit) this.labelEls.get(s)?.classList.add("mn-lit");
		this.stationEls.get(id)?.classList.add("mn-hovered");
		for (const lineId of st.lines) for (const p of this.trackEls.get(lineId) ?? []) p.classList.add("mn-lit");
		if (this.opts.crossLinks !== "never") {
			for (const [a, b] of layout.links) {
				if (a !== id && b !== id) continue;
				const path = el("path", { class: "mn-hoverlink", d: curve(layout.byId.get(a)!, layout.byId.get(b)!) }, this.hoverLayer);
				path.style.setProperty("--mn-color", this.lineById.get(st.lines[0])?.color ?? "currentColor");
			}
		}
		this.showTooltip(st);
		this.scheduleLabels(true);
		const target = this.stationEls.get(id);
		if (target) this.events.hover?.(id, e, target);
	}

	private unhover(relabel = true) {
		if (!this.hoverId) return;
		this.hoverId = null;
		this.root.classList.remove("mn-focusing");
		this.root.querySelectorAll(".mn-lit").forEach((n) => n.classList.remove("mn-lit"));
		this.root.querySelectorAll(".mn-hovered").forEach((n) => n.classList.remove("mn-hovered"));
		this.hoverLayer.replaceChildren();
		this.hideTooltip();
		if (this.isolatedKey) this.isolate(this.isolatedKey);
		if (relabel) this.scheduleLabels(true);
	}

	setActive(id: string | null) {
		if (this.activeId) this.stationEls.get(this.activeId)?.classList.remove("mn-active");
		this.activeId = id;
		if (id) this.stationEls.get(id)?.classList.add("mn-active");
	}

	/** Highlight every line sharing a colour key (legend click). null clears. */
	isolate(colorKey: string | null) {
		this.isolatedKey = colorKey;
		this.root.classList.toggle("mn-isolating", colorKey !== null);
		this.root.querySelectorAll(".mn-picked").forEach((n) => n.classList.remove("mn-picked"));
		if (!colorKey || !this.layout) return;
		for (const line of this.layout.lines) {
			const owner = line.spur && line.parent ? this.lineById.get(line.parent) : line;
			if (owner?.colorKey !== colorKey && line.colorKey !== colorKey) continue;
			for (const p of this.trackEls.get(line.id) ?? []) p.classList.add("mn-picked");
			for (const s of line.stations) {
				this.stationEls.get(s)?.classList.add("mn-picked");
				this.labelEls.get(s)?.classList.add("mn-picked");
			}
		}
	}

	/** Mark stations whose title matches; returns the matching ids. */
	search(query: string): string[] {
		this.root.querySelectorAll(".mn-match").forEach((n) => n.classList.remove("mn-match"));
		const q = query.trim().toLowerCase();
		this.matches = [];
		if (q && this.layout) {
			this.matches = this.layout.stations
				.filter((s) => s.title.toLowerCase().includes(q))
				.sort((a, b) => Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)) || a.x - b.x)
				.map((s) => s.id);
			for (const id of this.matches) {
				this.stationEls.get(id)?.classList.add("mn-match");
				this.labelEls.get(id)?.classList.add("mn-match");
			}
		}
		this.root.classList.toggle("mn-searching", q.length > 0);
		this.scheduleLabels(true);
		return this.matches;
	}

	// -----------------------------------------------------------------------
	// Tooltip

	private showTooltip(st: Station) {
		const t = this.tooltip;
		t.replaceChildren();
		const title = document.createElement("div");
		title.className = "mn-tt-title";
		title.textContent = st.title;
		t.appendChild(title);
		const seen = new Set<string>();
		for (const lineId of st.lines) {
			let line = this.lineById.get(lineId);
			if (line?.spur && line.parent) line = this.lineById.get(line.parent) ?? line;
			if (!line || seen.has(line.colorKey)) continue;
			seen.add(line.colorKey);
			const row = document.createElement("div");
			row.className = "mn-tt-line";
			const dot = document.createElement("span");
			dot.className = "mn-swatch";
			dot.style.background = line.color;
			row.append(dot, document.createTextNode(line.name));
			t.appendChild(row);
		}
		const meta = document.createElement("div");
		meta.className = "mn-tt-meta";
		meta.textContent = st.ghost
			? `Not created yet · linked from ${st.inLinks} · click to create`
			: `${st.outLinks} links out · ${st.inLinks} backlinks`;
		t.appendChild(meta);
		t.classList.add("mn-show");
	}

	private moveTooltip(e: MouseEvent) {
		const rect = this.root.getBoundingClientRect();
		const x = e.clientX - rect.left + 14;
		const y = e.clientY - rect.top + 14;
		const w = this.tooltip.offsetWidth;
		this.tooltip.style.left = `${Math.min(x, rect.width - w - 8)}px`;
		this.tooltip.style.top = `${Math.min(y, rect.height - this.tooltip.offsetHeight - 8)}px`;
	}

	private hideTooltip() {
		this.tooltip.classList.remove("mn-show");
	}
}
