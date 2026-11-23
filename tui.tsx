import { Plugin } from "@opencode/plugin/tui"
import { Fleet, type Snapshot } from "./rpc.js"
import { For, Show, createSignal } from "solid-js"

const short = (id: string) => id.slice(-6)
const clock = (ts: number) => (ts ? new Date(ts).toLocaleTimeString() : "--:--:--")

export default Plugin.define({
  id: "fleet-live.tui",
  setup(context) {
    const [snap, setSnap] = createSignal<Snapshot | undefined>(undefined)

    const rpc = context.client.rpc(Fleet)
    let stopped = false

    async function refresh() {
      try {
        const value = (await rpc.snapshot({})) as Snapshot
        if (!stopped) setSnap(() => value)
      } catch {}
    }

    void refresh()
    const timer = setInterval(() => void refresh(), 5_000)
    let stopEvents: (() => void) | undefined
    try {
      stopEvents = rpc.events.on("updated", () => void refresh())
    } catch {}

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "fleet.status",
          title: "Fleet live status",
          group: "Fleet",
          palette: true,
          slash: { name: "fleet-status", aliases: ["fleet"] },
          run: () => {
            void refresh()
            context.ui.panel.open("fleet.panel")
          },
        },
      ],
    }))

    const indicator = () => (
      <Show when={snap()}>
        {(s) => (
          <text fg={context.theme.text.base}>
            LIVE {clock(s().updated)} A{s().agents.length} S{s().sessions.length}{" "}
            {s().hosts.map((h) => `${h.label}:${h.models.length || "-"}`).join(" ")}
          </text>
        )}
      </Show>
    )

    const unregisterHome = context.ui.slot({ append: "home.footer.status", render: indicator })
    const unregisterPrompt = context.ui.slot({ append: "prompt.footer.status", render: indicator })

    const unregisterPanel = context.ui.slot({
      append: "session.panel",
      render: (panel: any) => (
        <Show when={panel.name === "fleet.panel"}>
          <box flexDirection="column" gap={1} padding={1}>
            <text fg={context.theme.text.base}>FLEET LIVE — {clock(snap()?.updated ?? 0)}</text>

            <text fg={context.theme.text.base}>AGENTES EM USO</text>
            <Show when={(snap()?.agents.length ?? 0) > 0} fallback={<text>nenhum</text>}>
              <For each={snap()?.agents ?? []}>
                {(a) => (
                  <text fg={context.theme.text.base}>
                    {a.id}  sessões: {a.sessions.map(short).join(", ")}
                  </text>
                )}
              </For>
            </Show>

            <text fg={context.theme.text.base}>SESSÕES</text>
            <Show when={(snap()?.sessions.length ?? 0) > 0} fallback={<text>nenhum</text>}>
              <For each={snap()?.sessions ?? []}>
                {(s) => (
                  <text fg={context.theme.text.base}>
                    {short(s.id)}  {s.agent}  {s.model}  {s.age}s
                  </text>
                )}
              </For>
            </Show>

            <text fg={context.theme.text.base}>SERVIDORES</text>
            <For each={snap()?.hosts ?? []}>
              {(h) => (
                <text fg={context.theme.text.base}>
                  {h.label} {h.ok ? "" : "[offline]"} {h.models.join(",") || "livre"}
                  {h.sessions.length ? " <- " + h.sessions.map(short).join(",") : ""}
                </text>
              )}
            </For>

            <text fg={context.theme.text.base}>TOKENS</text>
            <text fg={context.theme.text.base}>
              geral  novo {snap()?.tokens.total.input ?? 0}  visivel {snap()?.tokens.total.output ?? 0}  raciocinio {snap()?.tokens.total.reasoning ?? 0}  cache-lido {snap()?.tokens.total.cacheRead ?? 0}
            </text>
            <For each={snap()?.tokens.projects ?? []}>
              {(p) => (
                <text fg={context.theme.text.base}>
                  {p.name}  novo {p.input}  visivel {p.output}  cache-lido {p.cacheRead}
                </text>
              )}
            </For>

            <Show when={(snap()?.prefs.length ?? 0) > 0}>
              <text fg={context.theme.text.base}>PREFERÊNCIAS</text>
              <For each={snap()?.prefs ?? []}>
                {(p) => (
                  <text fg={context.theme.text.base}>
                    {p.server} -&gt; {p.project}  {p.ttl}
                  </text>
                )}
              </For>
            </Show>
          </box>
        </Show>
      ),
    })

    return () => {
      stopped = true
      clearInterval(timer)
      stopEvents?.()
      unregisterHome()
      unregisterPrompt()
      unregisterPanel()
    }
  },
})
