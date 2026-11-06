This directory contains the editor source snapshot used to build the Paseo plugin. It includes the HTML interface, editing logic, styles, and the workspace file implementation. The entry page has no embedded presentation, images, or fonts.

Run `npm run prepare:editor` from the repository root after editing these files. The build combines this source with `scripts/embedded.js` and `scripts/embedded.css`, then writes the two committed runtime modules. It does not read files outside this repository.

The original HTTP adapter is retained as part of the source snapshot. The plugin uses `server/runner_rpc.py` over standard input/output and does not start the HTTP server.
