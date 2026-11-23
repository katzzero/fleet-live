# fleet-live

Live fleet-status plugin for [OpenCode](https://opencode.ai): shows running agents and resident Ollama models across servers (S1/S3/S4/S5), with a desktop GUI, TUI, RPC, and supervisor tooling.

## Features

- `<fleet-live>` context block injected into the supervisor prompt.
- `fleet_status` — live agents, sessions and resident models per host.
- `agent_config` — resolved model/provider/context per agent.
- `fleet_prefer` — declare advisory server↔project affinity with TTL (6h default).
- `fleet_interrupt` — interrupt a stuck run, restricted to sessions descended from the caller.
- GUI: bottom bar (`FROTA`), side panel, and `/frota` command.

## Layout

- `index.ts` — server plugin, tools and context hook.
- `rpc.ts` — `Fleet` RPC contract (snapshot, agentConfig, `updated` event).
- `gui.tsx` / `gui.css` — desktop GUI (Solid + `@opencode/plugin/gui`).
- `tui.tsx` — terminal UI.
- `dist/gui-experimental.cjs` — prebuilt GUI bundle (also copied to repo root).

## Build

```sh
npm install
npm run build
```

Hosts are declared in OpenCode's `opencode.json` under the plugin `options.hosts`.

## License

MIT
