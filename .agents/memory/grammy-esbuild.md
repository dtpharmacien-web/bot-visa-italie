---
name: grammy esbuild externalization
description: grammy Telegram bot library must be in esbuild external list due to platform.node file
---

grammy must be listed in esbuild `external` array in `build.mjs`. The file `grammy/out/types.node.js` dynamically requires `./platform.node` at runtime — esbuild cannot bundle this.

**Why:** telegraf v4 uses node-fetch@2 which is incompatible with Node.js 24 native AbortSignal. grammy uses native fetch and works correctly on Node.js 18+.

**How to apply:** Always keep `"grammy"` in the externals list in `build.mjs`. Same applies to `playwright-core`.
