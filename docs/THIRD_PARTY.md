# Third-party notices and compatibility baseline

This bundle implements its own collaborative data model, editing UI, persistence and format adapter. At the user's request its `editor` preview adapts Army_Editor layout and image-rendering behavior from the cited upstream snapshot; it is not the complete original application. Portions of the preview implementation are derived from that reference, and should not be described as wholly independent.

- Compatibility target: [Army_Editor](https://github.com/xgua126/Army_Editor), commit `e5bd0eb288afec143dc9bf202f1aa16ee6ff07d5`, application version 1.8.0. Public website by BiliBili@勘茶Kchs_ and DeepSeek. That repository did not expose a standard LICENSE at investigation time and its page asks that attribution not be removed and that it not be resold. Our independent adapter is not an upstream endorsement.
- [milsymbol](https://github.com/spatialillusions/milsymbol), version resolved in pnpm-lock.yaml: 3.0.5, MIT. Runtime dependency; provides military symbol drawing. Its own package includes its notices and license.
- [resvg-js](https://github.com/yisibl/resvg-js), version resolved in pnpm-lock.yaml: 2.6.2. Runtime dependency; native SVG-to-PNG rendering, license declarations ship in that package.
- [yaml](https://github.com/eemeli/yaml), version 2.9.1. Runtime frontmatter parser; its package retains its own license.
- DSH provides the Host services and browser React module; this bundle does not ship a second copy of React or import private DSH UI components.

Military symbology mappings here are small protocol adapters for the publicly readable format, not a copy of the upstream application's full symbol catalog. Images use host fonts; this demo does not redistribute fonts. The editor-style preview adapts upstream layout and display behavior but is not a screenshot or pixel-identical reproduction of Army_Editor. The upstream copyright notice identifies BiliBili@勘茶Kchs_ and DeepSeek and states verbatim: “请勿移除署名后二次分发或收费。” Its precise licensing scope is not stated. No standard license or separate redistribution permission was verified; local use is not a claim of such permission.
