# Third-party notices

## Tab Out

Inner Garden is derived from Tab Out. Copyright (c) 2026 Zara Zhang. The upstream MIT license is retained in LICENSE and included in every installation ZIP. No upstream Git history or personal browser data is included.

## DM Sans and Newsreader

Unmodified font binaries are bundled from the official [Google Fonts repository](https://github.com/google/fonts). DM Sans: Copyright 2014 The DM Sans Project Authors. Newsreader: Copyright 2020 The Newsreader Project Authors. Both use the SIL Open Font License 1.1.

The full licenses ship as `fonts/DM-Sans-OFL.txt` and `fonts/Newsreader-OFL.txt` in the installation ZIP. Source commit, exact file URLs and SHA-256 hashes are recorded in `docs/font-assets.json` in the source repository. Chinese text falls back to available system fonts; no Chinese font binary is redistributed.

## Icons

The inherited UI contains Heroicons outline paths. Preserve the [Heroicons MIT notice](https://github.com/tailwindlabs/heroicons/blob/master/LICENSE) shipped as `licenses/Heroicons-MIT.txt`. The extension's existing app icons remain covered by the retained upstream source license. New domain monograms are generated locally by this project and do not download website trademarks or favicons.

## QR Code generator

The local QR encoder is Project Nayuki's [QR Code generator library](https://www.nayuki.io/page/qr-code-generator-library), used under the MIT license. The unmodified compiled JavaScript is bundled as `vendor/qrcodegen.js`; its copyright and permission notice ships as `licenses/QrCodeGen-MIT.txt`. Source URL and file hash are recorded in `docs/qr-assets.json`. No external QR service receives authorization numbers.

## Prompt material

All 13 copied built-in prompts were checked for supplied source and redistribution evidence. None has a verifiable redistribution permission in the supplied material; none is bundled in this public version. Review titles and body fingerprints are in `docs/prompt-review.json`. This does not remove or relicense user-owned existing notes, including notes imported from an earlier installation.
