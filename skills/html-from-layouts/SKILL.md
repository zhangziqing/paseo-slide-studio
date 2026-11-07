---
name: html-from-layouts
description: >-
  Create, revise, and validate offline HTML slide presentations matching a user's
  PowerPoint template geometry and typography. Use for HTML PPT, browser slides,
  Markdown-to-HTML decks, marked outline completion, and slide template migration.
  Use this for presentations rather than ordinary websites or editable PPTX/TeX output.
---

# HTML from template layouts

Create an editable, offline **single HTML file** with embedded CSS, JavaScript,
images and vector backgrounds from a reviewed user-supplied theme. The parsers,
browser runtime and helpers are bundled here. No PowerPoint template, branded
artwork, font binaries or machine-specific font paths are included. Embedded-font
decks need no CDN, server, source files or other skill when opened. Outlines,
provenance manifests and QA reports remain separate review artifacts.

Resolve `$SKILL` to this directory. Use `.venv/bin/python` if present, otherwise
Python 3.10+. Core generation/checking uses the standard library; language-tagged
code highlighting needs Pygments; font subsetting needs fonttools. Template extraction needs python-pptx;
PDF-to-vector backgrounds and PDF geometry verification need PyMuPDF. Install
`requirements.txt` in an isolated environment when needed. Preview uses real
Chrome/Chromium, discovered automatically or supplied with `--browser` /
`CHROME_BIN`. Do not depend on another skill's environment at runtime.

## Preserve content and template

Preserve original wording, explicit page boundaries, list nesting, numbering,
inline colors and formatting unless the user authorizes changes. Read
[references/template-fidelity.md](references/template-fidelity.md) for geometry,
font mappings and onboarding. Every generation requires an explicit `--theme`;
there is no fallback presentation template. Keep user-provided theme assets in
the presentation project, outside this skill.

- Retain the reviewed theme's canvas, placeholder geometry, title/body styles,
  insets and paragraph spacing. Do not infer a layout's role from its name or order.
- Mark AI-authored list items with compact black **✦** vector bullets and a small
  `✦ AI-gen` legend. Keep original user bullets and explicit numbers. An inline
  completion does not mark an entire user item AI-authored. Color is not provenance.
  Bold selected keywords/conclusions rather than whole paragraphs.
- Map real regular/bold Latin and CJK faces supplied by the user; disable synthetic bold.
  Record source/subset hashes, font versions and TTC indices in the manifest.
  Missing source fonts or detected glyph gaps fail. Explicit `--local-fonts`
  requires installed faces on each viewing machine and cannot establish binary identity.
- Code is selectable, syntax highlighted literal text in a padded `#F2F5F8`
  panel. Default 20/24; deliberate `--compact-code` uses 16/19 and is recorded.
  Tables use 20/24, about 1.45 row spacing, 6-unit horizontal padding and visible
  space above/below. Preserve these treatments on regeneration.
- Do not silently shrink type, split pages, flatten nesting or drop content to
  fix overflow. Viewport resizing scales the whole canvas, retaining internal
  type sizes. Rebalance authorized geometry before proposing content/page changes.

## Choose the work

- **Existing outline:** inspect protected content/hints; fill requested gaps,
  then generate. **Only fill gaps:** stop with the completed outline and manifest.
- **Brief:** use the user's theme, or author a theme for the requested design, then
  write an outline using its actual capacity, without filler pages.
  Research factual claims with authoritative sources; record citations and evidence
  limits in slide text, the outline or a separate source companion file.
- **Existing HTML:** regenerate from the outline for ordinary edits; edit emitted
  HTML/CSS for approved custom compositions. Preserve protected source and pages.
  Carry customizations into reusable source before regeneration. Recheck changed
  pages; prior QA becomes stale after edits.
- **New template:** follow the onboarding reference in a new project directory.
  Review extracted layouts and provide background and font mappings before generating.

## Complete marked gaps

Never overwrite the original outline. Inventory `[[...]]` outside literal code:

```bash
python3 "$SKILL/scripts/complete.py" slides.md --inventory
python3 "$SKILL/scripts/complete.py" slides.md \
  --replacements replacements.json -o slides.completed.md
```

The agent authors an ID-to-plain-replacement JSON object. The helper replaces only
marked spans, adds black spans/list-start ✦ marks, and writes `.completion.json`
with source hash/span provenance. Do not duplicate the marker in replacements.
Continuation lines need intended list syntax/indentation. Replacements cannot add
page separators. Explicit inline colors survive rendering. `--reuse old.completion.json`
reuses unique unchanged prompts; review factual currency and ambiguous/changed gaps.
`--color` / `--no-ai-marker` support requested style overrides.

## Generate and present

```bash
python3 "$SKILL/scripts/generate.py" slides.completed.md -o presentation.html \
  --theme custom-theme/theme.json --font-config custom-theme/fonts.json
```

The required theme describes layouts and backgrounds; the font configuration
provides approved embeddable faces. It can also be named by the theme's
`font_config` field. Optional `--compact-code` changes code sizing only.
`--local-fonts` uses the theme's installed-font mappings instead of its
`font_config`; document this portability limit when delivering such a deck.
Images resolve relative to the input outline; outputs relative to the current
directory. Use a distinct name/directory when requested for revisions. A generation
failure preserves previous HTML; do not deliver old output as a successful update.

Read [references/outline-and-browser.md](references/outline-and-browser.md) for
the supported dialect, controls and checks. `---` outside fences is the page
boundary; each page needs a heading. Hints use aliases or real layout names.
Columns use actual template regions. Missing assets, unknown hints, ragged tables,
unresolved gaps or insufficient placeholders fail with page numbers. Markdown raw
HTML and code stay literal, never executable.

The generated `.slide`, `.placeholder`, `.para`, `.figure`, `.code-panel` and
`.table-wrap` elements match Slide Studio's editable HTML structure. Open the
HTML in Slide Studio to edit it, or directly in a browser to present it. It
supports keyboard navigation, fullscreen, hash-addressed pages, overview and
printing. Add motion/autoplay only on request.
Author custom diagrams/formulas directly in HTML/SVG/MathML within approved geometry;
bundle any needed libraries locally and verify offline rather than assuming generic
Markdown support.

## Validate and visually review

```bash
python3 "$SKILL/scripts/preview.py" presentation.html -o preview/ --pdf
# Layout/resource checks without screenshots:
python3 "$SKILL/scripts/preview.py" presentation.html -o preview/ --check-only
```

Generation writes `.manifest.json` / `.report.json`. Preview waits for real fonts
and images, measures every page against template regions, records missing faces,
broken images and overflow, then captures pages. Optional PDF export with PyMuPDF
also verifies page count and physical dimensions. Browser measurement is separate
from visual review: **open every preview image** and inspect clipping, hierarchy,
glyphs, background artwork, baselines, tables and code. Check controls, deep links
and printing when relevant. Scripts never automatically pass visual review; report actual
inspection separately or record reviewed page IDs plus current HTML hash.

Report unavailable/failed checks honestly. Keep structural, browser-layout,
preview-export and visual-review results separate. Old PDFs/images may survive a
failed export; only report current successes listed in the current-hash report.
Template parameter matching does not establish pixel parity with PowerPoint/TeX.
Claim parity only after matching-content/pagination reference comparison.

Deliver links to HTML, editable outline, relevant PDF/preview, checks performed
and remaining fidelity limits. Slide Studio saves HTML edits; it does not write
them back into the Markdown outline or theme. Regeneration can overwrite those
edits. Hosting or conversion is a separate request.
