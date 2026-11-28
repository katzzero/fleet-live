# fleet-live

A live fleet-status plugin for [OpenCode](https://opencode.ai). It gives the agent a real-time view of which sessions are running and which models are resident on each configured host, across a multi-machine setup. Ships as one package with four faces: a server plugin, an injectable context block, a terminal UI, a desktop GUI, and an RPC contract shared by all of them.

The core idea: an orchestrator should choose *where* to delegate based on what is actually free right now, not on a stale static config. `fleet-live` samples each host's `/api/ps` and the local session list every couple of seconds and surfaces the result to the model, the terminal, and the desktop.

## Features

- **Live context block** — a `<fleet-live>` block is injected into the agent's system prompt with active agents, per-host resident models, session IDs, and token totals.
- **Token accounting** — aggregate tokens across all sessions with a grand total and a per-project breakdown (project names derived from each session's `location.directory`). Labels match the engine's semantics: `novo` = non-cached input, `visível` = output excluding reasoning, `raciocínio` = reasoning, `cache lido` = prompt-cache reads (reused prefix, not new consumption).
- **`fleet_status`** — on-demand snapshot of agents in session and resident models per server.
- **`agent_config`** — resolved model, quantization and context limit for one agent (or all).
- **`fleet_prefer`** — declare an advisory server↔project affinity with a TTL; never blocks delegation.
- **`fleet_interrupt`** — interrupt a stuck or superseded run by session ID or agent name. Restricted to sessions descended from the caller, so an agent can never kill work started by someone else.
- **Desktop GUI** — a compact bottom bar (`FROTA`) with a token pill, a side panel with per-project token bars, and a `/frota` command.
- **Terminal UI** — a footer indicator, a `fleet-status` slash command, and a panel with token totals.
- **RPC** — a shared `Fleet` contract (`snapshot`, `agentConfig`, `updated` event) consumed by both UIs.

All preference state is in-memory: it expires on its own and is wiped on restart. Nothing is written to config.

## Install

Add the plugin to your `opencode.json`, pointing `package` at this directory:

```jsonc
{
  "plugins": [
    {
      "package": "fleet-live",
      "options": {
        "hosts": [
          { "label": "<label-a>", "provider": "<provider-a>", "baseUrl": "http://<host-a>:11434" },
          { "label": "<label-b>", "provider": "<provider-b>", "baseUrl": "http://<host-b>:11434" },
          { "label": "<label-c>", "provider": "<provider-c>", "baseUrl": "http://<host-c>:11434" }
        ]
      }
    }
  ]
}
```

Each entry maps an OpenCode provider id to a friendly label and the base URL of its configured server. `labels` and `providers` are entirely yours; the plugin only uses them to group and display data. OpenCode must already define those providers and their models — the plugin reads model/context limits from the same file.

Restart OpenCode after changing the plugin list or its `options`.

## Tools

| Tool | Purpose |
| --- | --- |
| `fleet_status` | Live agents and resident models per host. |
| `agent_config { agent? }` | Model, quantization and context for an agent; omit `agent` for all. |
| `fleet_prefer { server, project?, ttl?, clear? }` | Advisory affinity. TTL accepts `30m`, `6h`, `1d` or seconds; defaults to `6h`, max `7d`. One project per server: locked until TTL expires or the owner clears it with `clear: true` and the same project. |
| `fleet_server { server, enabled? }` | Enable or disable a server. Disabled providers are removed from the picker and delegation to their agents is refused. Persists across restarts. Omit `enabled` to report status. The desktop panel has an `on/off` toggle per server. |
| `fleet_interrupt { sessionID?, agent? }` | Stop a running session by full/6-char ID or agent name. Only descendants of the caller are eligible. |

`fleet_interrupt` fails closed: if the calling session cannot be identified, or the target was created by another session, it refuses. This prevents an agent from cancelling work it did not start.

`fleet_prefer` fails closed too: a server already claimed by another project cannot be taken over, renewed or cleared by that project. Only the owner can renew it, or remove it with `clear: true` and the same project. An expired claim becomes free again.

`fleet_server` is a hard restriction, not advisory: disabling a provider removes its models and rejects `task` delegation to agents bound to it. It takes effect without an OpenCode restart. It does not unload models from the host and does not interrupt work already in flight — only new allocations are blocked. Other clients of the same host are unaffected. The panel toggle writes the same persistent state as the tool.

## UI

- **Desktop** — a `FROTA` bar pinned to the bottom of the window; click it (or run `/frota`) to open the side panel. The panel shows an `on/off` toggle next to each server label.
- **Terminal** — a `LIVE …` footer indicator plus a `fleet-status` slash command and panel.

Both UIs poll the RPC snapshot on an interval and also refresh on the `updated` event pushed by the server.

## Architecture

```
index.ts          server plugin: host/session sampling, tools, context hook
rpc.ts            Fleet RPC contract (snapshot, agentConfig, setServer, updated)
gui.tsx/gui.css   desktop GUI (Solid + @opencode/plugin/gui)
tui.tsx           terminal UI (Solid + @opencode/plugin/tui)
vite.config.ts    build preset; emits dist/gui-experimental.cjs
```

The server reads the OpenCode config to resolve per-agent model references (both inline agent definitions and `agent/*.md` frontmatter), matches providers to host labels, and keeps a 2-second polling loop. Token totals are computed from each session's `tokens` field and grouped by `projectID`; project names come from the session's `location.directory`, so no authenticated HTTP call is needed. The GUI bundle is prebuilt and committed, so a plain clone works without a build step.

## Build

```sh
npm install
npm run build     # rebuilds dist/gui-experimental.cjs
npm run typecheck
```

## Notes

- The plugin reads local OpenCode config and queries each configured host over HTTP; it never writes outside its own memory.
- Host reachability is sampled with a short timeout; an unreachable host is shown as `offline` rather than raising.
- Requires OpenCode 2.3.2 or compatible for the GUI/TUI plugin APIs.

## License

MIT
