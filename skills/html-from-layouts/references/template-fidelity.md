# Template fidelity and onboarding

This skill supplies a generator, browser runtime and the unbranded Clean Blue
theme. It does not bundle PPTX/POTX files, logos or fonts. Custom themes belong in
the presentation project, either extracted from the user's template or authored
for the requested design.

## Bundled Clean Blue theme

[Clean Blue](../assets/themes/clean-blue/theme.json) is a complete 960 × 540 theme
with six layouts: cover, alternate cover, left-aligned content, centered-title
content, section divider and two columns. It retains the original layout geometry,
spacing, blue title treatment, cover rule and dynamic page numbers. Institutional
and personal logos, footer affiliation text and identifying metadata are removed;
the only background artwork is a blue rule. The two cover layouts intentionally
retain their original, identical geometry.

Render [the sample outline](../examples/clean-blue.md) with installed Liberation
Sans, Noto Sans CJK SC and DejaVu Sans Mono regular/bold faces:

```bash
python3 "$SKILL/scripts/generate.py" "$SKILL/examples/clean-blue.md" \
  --theme "$SKILL/assets/themes/clean-blue/theme.json" --local-fonts \
  -o presentation.html
```

These named fonts match the accompanying local-face mappings. No font binaries or
absolute source paths are included. For a portable deck, supply `--font-config`
with your approved font files instead of `--local-fonts`, using the format below.
The user's template fonts and explicit choices take precedence. Make customizations
in a project copy of the theme so skill updates do not overwrite them.

## Units and styles

The theme's `width`, `height`, boxes, font sizes and spacing use design units of
1/72 inch. One source unit becomes one CSS design px. Viewports scale the whole
canvas. Printing uses the theme's dimensions in points and scales design px by
4/3 to retain physical dimensions. Do not convert only fonts or only placeholders.

Title and body typography comes from each placeholder's styles. Code and tables
also use the generic runtime treatments in `assets/deck.css`: code is 20/24
(explicit `--compact-code`: 16/19); tables are 20/24. Review these treatments
against the user's design before claiming fidelity.

## Fonts

Provide real regular and bold mappings for both `DeckLatin` and `DeckCJK`.
`DeckMono` is optional; without it code uses the viewing machine's monospace
fallback. Embed approved faces for portable offline decks, including `DeckMono`
when code typography must be stable across machines.

`--font-config custom-theme/fonts.json` reads a JSON array, with paths resolved
relative to that file:

```json
[
  {"family":"DeckLatin","weight":400,"path":"fonts/latin-regular.woff2"},
  {"family":"DeckLatin","weight":700,"path":"fonts/latin-bold.woff2"},
  {"family":"DeckCJK","weight":400,"path":"fonts/cjk-regular.woff2"},
  {"family":"DeckCJK","weight":700,"path":"fonts/cjk-bold.woff2"}
]
```

Use files the user is permitted to embed. TTF, TTC, OTF, WOFF and WOFF2 inputs are
supported; TTC mappings can include an `index`. Fonttools produces WOFF subsets
for the outline and embeds them in HTML. The manifest records source/subset
hashes, source filenames, versions and collection indices. Regular/bold
Latin/CJK coverage is checked before writing the deck. Decorative AI stars use
vectors. No font file or machine-specific path belongs in this skill bundle.

Alternatively, set the theme's `font_config` to a path relative to `theme.json`.
For an explicitly local-font deck, fill `font_faces` instead, with entries such
as `{"family":"DeckLatin","weight":400,"local":["Exact Regular Face Name"]}`
and equivalent bold/CJK mappings. `--local-fonts` bypasses the theme's
`font_config` and uses those mappings. Browser probes check named faces and
synthetic bold is disabled, but local names do not prove binary identity or full
glyph coverage. Such a deck requires these fonts on each viewing machine.

## Custom templates

1. Extract the user's PPTX/POTX into a new directory:

   ```bash
   python3 "$SKILL/scripts/profile.py" custom.pptx -o custom-theme/
   ```

   This creates `theme.json`, `background.pptx` and `specimen.pptx` from the
   supplied file. The extractor handles basic title/body/subtitle placeholders
   and the first master theme, not arbitrary PPT conversion. Review multiple
   masters, object placeholders and style overrides explicitly.

2. Review every placeholder, role, coordinate, style and font. Fill `aliases`
   using actual layout names. Automatic selection uses `cover` for a title-only
   slide, `content` for one content group and `two-columns` for multiple groups.
   Provide the aliases needed by the outline, or use explicit `[HINT: layout]`
   with a unique real layout name. Exactly one title region is required; slides
   with content need exactly as many body/subtitle regions as content groups.

3. Export `background.pptx` using PowerPoint or another compatible renderer to
   PDF, retaining layout order and physical page dimensions. Export
   `specimen.pptx` separately as the typography reference. Rendering is an
   external step; the Python helpers do not export PPTX to PDF. Complex artwork
   needs a real rendered background, a reviewed reconstruction or an explicit
   limitation. Do not silently omit it.

4. Convert the background and supply reviewed font mappings:

   ```bash
   python3 "$SKILL/scripts/prepare_theme.py" custom-theme/theme.json \
     --background-pdf custom-theme/background.pdf
   python3 "$SKILL/scripts/generate.py" slides.md -o presentation.html \
     --theme custom-theme/theme.json --font-config custom-theme/fonts.json
   ```

   PDF page count and dimensions must match the layouts. Conversion writes SVGs
   and a `backgrounds` mapping; existing SVGs are protected. All background paths
   resolve relative to `theme.json`. Each layout used by the outline needs a
   background, including an explicitly supplied blank background for a plain
   design. The resulting HTML embeds these assets and font subsets.

5. Preview matching-content/pagination specimens for each used layout and compare
   with the source renderer's PDF. Record calibration changes and references.
   Apply approved geometry changes in a project copy of the theme, preserve
   title/footer clearance and recheck affected pages. Parameter matching,
   browser checks and visual parity are separate conclusions.

## Theme contract

An authored theme uses the same JSON structure as `profile.py` output:

- `width`, `height`: positive canvas dimensions in design units.
- `layouts`: objects with unique `index`, `name` and `placeholders`.
- Each placeholder: `id`, `role` (`title`, `body`, `subtitle`), `box`
  (`[x,y,width,height]`), optional `margins` (`[left,top,right,bottom]`),
  optional `anchor` (`t`, `ctr`, `b`) and a nonempty `styles` array.
- Styles: `size`, `bold`, `color` (six hex digits without `#`), `align`
  (`l`, `ctr`, `r`, `just`), `leading` (line-height multiplier), `before`,
  `after`, `margin_left`, `indent`, `bullet`; array position selects nesting level.
- `aliases`: semantic alias to actual layout name; explicit hints also accept
  actual layout names.
- `backgrounds`: stringified layout index to local image/SVG path.
- `font_config`: optional relative font configuration filename; alternatively
  `font_faces` provides reviewed installed-face mappings.
- `page_number`: optional placeholder object for dynamic slide numbering.

Never infer that this schema or its CSS classes are a universal HTML PPT standard.
It is the generator's contract with its own runtime and Slide Studio.
