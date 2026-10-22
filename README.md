# Metro Nodes

An Obsidian plugin that draws your vault as a metro map. Notes are stations, links become colored lines, and notes where lines meet are interchanges.

## Modes

| Mode | How lines are built |
| --- | --- |
| **Links** (default) | Starts from notes nothing links to, such as an index or MOC note. Every hub note (a note that links onward) gets a line running through the notes it links to. A linked note that is itself a hub becomes an interchange where its own line starts. Chains of single links stay on one line, and one-stop dead ends are drawn in the parent line's color. Links to notes that don't exist yet appear as dashed "planned" stations; click one to create the note. Notes with no links go on a grey *Unlinked* line. |
| **Tags** | One line per tag, with stations in created-date order. A note with several tags is an interchange, and the lines bend over to meet at it. |
| **Folders** | One line per folder (top-level by default). |
| **Property** | One line per value of a frontmatter property (`project` by default). |

Created date comes from the `created` frontmatter property when present, otherwise from the file's creation time.

## Using it

- Open it with the train icon in the ribbon or **Open metro map** in the command palette. **Show current note on metro map** jumps to the note you're on.
- Drag to pan, and scroll or pinch to zoom. Double-click empty space to zoom in.
- Click a station to open the note; Ctrl/Cmd-click opens it in a new tab. Ctrl/Cmd-hover shows Obsidian's page preview.
- Hovering a station dims everything else and draws dashed arcs to every note it links to or from.
- **Legend:** click a line to highlight it. Click the color dot to recolor the line; the color is saved.
- **◎ Around note** (Links mode) shows only the notes within N hops of the active note, and follows you as you switch notes.
- **Search:** Enter goes to the next match, Shift+Enter to the previous one.
- When labels would overlap, some are hidden. Zoom in, hover or search to reveal them.

## Install locally

```bash
npm install
npm run build
npm run install-plugin -- "/path/to/your/vault"
```

Then in Obsidian, go to **Settings → Community plugins**, turn on community plugins if they're off, and enable **Metro Nodes**.

`demo-vault/` is a small sample vault with the plugin already installed. Open it with **Open folder as vault** to try both link and tag layouts.

## Development

```bash
npm run dev        # watch build -> ./main.js
```

To work against a live vault, symlink the repo into the vault's plugin folder. Then reload the plugin after each rebuild, using the Hot Reload plugin or by toggling it off and on:

```bash
ln -s "$(pwd)" "/path/to/vault/.obsidian/plugins/metro-nodes"
```

### Browser harness

The layout, renderer and UI don't depend on Obsidian, so they can run in a plain browser page:

```bash
node scripts/vault-to-json.mjs demo-vault "/path/to/vault"   # export notes to harness/data/
node esbuild.config.mjs harness
python3 -m http.server 5178                                   # open http://localhost:5178/harness/
```

### Layout

- `src/layout.ts`: notes → stations, lines, lanes and octilinear routes. Pure functions.
- `src/renderer.ts`: SVG, pan/zoom, label collision, hover highlighting.
- `src/app.ts`: toolbar, legend and status bar.
- `src/view.ts`, `src/main.ts`, `src/settings.ts`, `src/collect.ts`: Obsidian glue.
