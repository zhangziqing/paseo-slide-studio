# Outline and browser contract

## Input

Each `---` segment outside backtick/tilde fences is one slide; headings do not
split pages. Every page needs a heading. Empty segments fail instead of silently
disappearing. An accidental empty final segment from a trailing separator may
be removed only in a separate render copy after confirming intent.

Supported: headings, nested unordered/explicit numbered lists (`1.` / `1)`),
`**bold**`, inline code, links, `{color:#RRGGBB}...{/color}`, legacy `{blue}`,
literal fenced code with optional Pygments language, pipe tables/escaped `\|`,
standalone local images, `[Column N: heading]` / `[Card N: heading]`,
`[HINT: alias-or-name]` and `**Layout: name**`. Aliases come from the supplied
theme. Automatic routing uses `cover`, `content` and `two-columns` when needed;
additional aliases are optional. There are no bundled layouts.

Columns start at 1, are consecutive and occupy the exact number of real body
regions. `[Column 1: ]` means an untitled column. Code/table/image blocks remain
in that column. Plain continuation lines are separate paragraphs, as in the
existing outline workflow; keep intended items on one source line. This is not
a general CommonMark renderer. Math extensions, merged tables, video/SmartArt
and legacy `**Visual:**` are not automatically supported; unsupported visual
markers fail. Author advanced HTML/SVG/MathML explicitly and recheck.

Fenced code `---`, `[[gap]]`, colors and `<script>` remain literal. Markdown HTML
is escaped. Links allow relative/http(s)/mailto URLs. Images are local PNG/JPEG/
SVG/GIF/WebP, contained without stretching and assigned remaining body height.
Cache remote images locally first; generation makes no network requests. Convert
PDF image pages first. Keep captions as explicit text. Fonts/libraries added to
a customized deck also need offline bundling.

Preserve user list numbers/nesting. AI list starts use stars; numbered items keep
numbers and a small star alongside. Inline completion provenance lives in the
completion manifest rather than changing whole-item authorship.

## Controls and runtime checks

Arrow keys, PageUp/PageDown, Space and Home/End navigate; F invokes fullscreen.
Buttons provide navigation, overview and fullscreen. `deck.html#3` opens page 3.
Focused links/buttons/forms retain normal keyboard behavior. Hidden pages leave
the accessibility tree; overview exposes all pages. Printing includes all pages
with controls hidden and physical template dimensions retained.

`window.deckReady` resolves to actual browser QA. `deck.show(n)` uses zero-based
indices; `deck.audit()` remeasures overflow. `#deck-qa` exposes JSON results after
readiness. A script never claims visual review from these measurements.

Preview runs bounded browser processes with temporary profiles, waits for fonts
and images, and measures all pages unscaled. Capture mode waits for image load
and measures on the next task because headless virtual time can outpace compositor
decoding and animation frames. It still checks failed loads and image dimensions.
It detects horizontal/vertical overflow, broken images and missing font faces.
It does not prove complete glyph coverage, every possible overlap or parity
across browsers. Open all screenshots and test relevant custom interactions.

Reports check current HTML hashes against manifests. Edits invalidate prior
results. A failed export records the error/current successes; preexisting PDFs
and images are not evidence of a successful current run. When browser launch
is sandbox-blocked, use the environment's normal escalation mechanism. If no
browser is available, deliver structurally checked HTML and disclose missing QA.

Optional PDF export with PyMuPDF checks page count and dimensions; absent PyMuPDF
means geometry verification is explicitly unavailable. Compare matching-content
PowerPoint/LaTeX reference PDFs at the same raster resolution for fidelity claims.

The helper follows [Chrome's Headless CLI](https://developer.chrome.com/docs/automation-and-testing/headless-cli)
and the [CSS Font Loading API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Font_Loading_API).
Named-face availability alone does not verify the font binary.
