// Original synthetic font: .notdef, space, and one triangular A glyph.
// No system fonts, personal slides, or downloaded assets are needed.
const font = 'd09GRgABAAAAAALYAAoAAAAAA6AAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAABZAAAAC4AAABgRQBENWNtYXAAAAGcAAAAMQAAADwAdABcZ2x5ZgAAAdgAAAAkAAAAMDG99vJoZWFkAAAA9AAAADYAAAA2WbeknGhoZWEAAAEsAAAAIAAAACQEsgJaaG10eAAAAZQAAAAIAAAACAJYAABsb2NhAAAB0AAAAAgAAAAIAAwAJG1heHAAAAFMAAAAFgAAACAABQAFbmFtZQAAAfwAAADJAAABcRn/IUhwb3N0AAACyAAAABAAAAAoAAgAJAABAAAAAQAAwYCSLF8PPPUAAQPoAAAAAHwlsIAAAAAAfCWwgABkAAAB9AK8AAAAAwACAAAAAAAAeJxjYGRgYFb4b8HAwBTBwMBwgnECA1AEBTACAEzLAxF4nGNgZGBgYAZCEM3AwMSABgABFAALAAB4nGNgZopgnMDAysDCQBgwInPsgQBIKTA4Miv8t2BgYFZgOIGmXoGBAQC9YAS7AAACWAAAAAAAAHicY2BgYGJgYGAGYhEgyQimWRg0gDQbkGYEyiowOP7/D+SD6f8P/x8EqwICAIwNCMoAAAAAAAAMAAwAGHicY2BkSGFgYPzCtIeBiYHBWFg45cQJpj1/XRhwiAMAB4sMzXicbY09CsJAEEZfTFT8QRBULLeysJB4AXs7MWJnEbKLBIOB/BxFb+S9nE0WRXCKmTffvGWBMU88bHkMm26rQ1+2ln3mTB0HLFk57jJi57jXOD5eMJBkxt5xhwkXxz5rbo4DQh6Ouyx4Oe5Z5xAnN6NPpqyO5lpncRFlqTZRVes0/96aULWpamNl87MpyjS/q+0m5EBMIp8aNCfpJRVHmVdqMrkVRDJTuRqhSlItW/733ddUP676sdXHP8sshKxzl3zLhvAN0q48WwAAAHicY2BiwA+YwVgFAAC4AC0=';
const fontSource = `url("data:font/woff;base64,${font}") format("woff")`;
const svg = (color, animation = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><style>@font-face{font-family:PackedTest;src:__DECK_FONT_0__}text{font:32px PackedTest}</style><rect width="120" height="60" fill="${color}"/>${animation}<text x="12" y="40">A</text><title>内嵌图</title></svg>`;
const assets = {
  vector: {type: 'image/svg+xml', text: svg('#09678f')},
  live: {type: 'image/svg+xml', text: svg('#09678f', '<animate attributeName="opacity" values="1;.5;1" dur="1s" repeatCount="indefinite"/>')},
  still: {type: 'image/svg+xml', text: svg('#77b7cd')},
  raster: {type: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='},
};
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const config = {width: 960, height: 540, font_faces: [{family: 'PackedTest', weight: 400}]};
export const replacement = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="15"><rect width="30" height="15" fill="red"/></svg>').toString('base64');
export const packedDeck = `<!doctype html><html><head><title>Packed image fixture</title><style>
@font-face{font-family:PackedTest;font-weight:400;src:${fontSource}}
.slide{display:none;position:absolute;width:960px;height:540px;background:white;overflow:hidden}
.slide.active{display:block}.para{font:24px PackedTest;margin:24px}.figure{width:240px;height:120px;margin:24px}.figure img{width:100%;height:100%;object-fit:contain}
</style></head><body>
<section class="slide" id="slide-1"><div class="para" data-role="title">A</div><figure class="figure"><img alt="内嵌矢量图" data-deck-asset="vector"></figure><figure class="figure"><img alt="PNG" data-deck-asset="raster"></figure></section>
<section class="slide" id="slide-2"><div class="para" data-role="title">A</div><figure class="figure"><img alt="动画" data-deck-asset="live" data-deck-still="still"></figure></section>
<section class="slide" id="slide-3"><div class="para" data-role="title">A</div><figure class="figure"><img alt="重复图片" data-deck-asset="vector"></figure><figure class="figure"><img alt="普通图片" src="${replacement}"></figure></section>
<script id="deck-config" type="application/json">${json(config)}</script><script id="deck-qa" type="application/json">{}</script>
<script id="deck-assets" type="application/json">${json({fonts: [{token: '__DECK_FONT_0__', family: 'PackedTest', weight: 400}], assets})}</script>
<script>window.__deckScriptExecuted = true;</script>
</body></html>`;
export const plainDeck = `<!doctype html><html><head><title>Ordinary image fixture</title><style>.slide{width:960px;height:540px}</style></head><body><section class="slide"><figure class="figure"><img alt="普通图片" src="${replacement}"></figure></section></body></html>`;
