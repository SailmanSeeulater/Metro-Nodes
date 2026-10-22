import { App, getAllTags } from "obsidian";
import type { NoteRecord } from "./types";

/** Snapshot every markdown note's tags, frontmatter and links. */
export function collectRecords(app: App): NoteRecord[] {
	const files = app.vault.getMarkdownFiles();
	const md = new Set(files.map((f) => f.path));
	const resolved = app.metadataCache.resolvedLinks;
	const unresolved = app.metadataCache.unresolvedLinks;
	return files.map((f) => {
		const cache = app.metadataCache.getFileCache(f);
		const tags = cache ? (getAllTags(cache) ?? []) : [];
		return {
			id: f.path,
			title: f.basename,
			folder: f.parent?.path ?? "/",
			tags: [...new Set(tags.map((t) => t.replace(/^#/, "")))],
			props: (cache?.frontmatter ?? {}) as Record<string, unknown>,
			ctime: f.stat.ctime,
			mtime: f.stat.mtime,
			links: Object.keys(resolved[f.path] ?? {}).filter((p) => md.has(p)),
			unresolved: Object.keys(unresolved[f.path] ?? {}),
		};
	});
}
