/// <reference types="vite/client" />
import { Command, Panel, Plugin, Slot, Style } from "@opencode/plugin/gui"
import { Fleet, type Snapshot } from "./rpc"
import { For, Show, createSignal, onCleanup } from "solid-js"
import css from "./gui.css?inline"

type Host = Snapshot["hosts"][number]
type Agent = Snapshot["agents"][number]

const short = (id: string) => id.slice(-6)

const clock = (ts: number) => (ts ? new Date(ts).toLocaleTimeString() : "--:--:--")

const shortModel = (raw: string) => {
  const tag = raw.split("@")[0]!.split("/").pop()!
  const [name = "", variant = ""] = tag.split(":")
  const base = name.split(/[-._]/)[0]!.replace(/\d+$/, "").slice(0, 8) || "?"
  const size = variant.match(/^\d+(?:[.,]\d+)?b/i)?.[0] ?? variant.match(/^e\d+b/i)?.[0] ?? ""
  return size ? `${base}${/^e/i.test(size) ? " " : ""}${size}` : base
}

const tone = (h: Host) => (!h.ok ? "fl-off" : h.models.length ? "fl-on" : "fl-idle")

function HostCells(props: { hosts: Host[]; disabled?: string[]; onToggle?: (h: Host) => void; wrap?: boolean; limit?: number }) {
  const blocked = (h: Host) => (props.disabled ?? []).includes(h.provider)
  const state = (h: Host) => (blocked(h) ? "fl-blocked" : tone(h))
  const shown = () => (props.limit ? props.hosts.slice(0, props.limit) : props.hosts)
  const extra = () => Math.max(0, props.hosts.length - shown().length)
  return (
    <div class={`fl-hosts${props.wrap ? " fl-hosts-wrap" : ""}`}>
      <For each={shown()}>
        {(h) => (
          <div class="fl-host" title={`${h.label} · ${h.provider} · ${h.models.length} modelo(s) · ${h.sessions.length} sessão(ões)${blocked(h) ? " · DESABILITADO" : ""}`}>
            <div class="fl-host-top">
              <span class="fl-label">{h.label}</span>
              <span class={`fl-model ${state(h)}`}>{blocked(h) ? "desligado" : h.models.length ? shortModel(h.models[0]!) : h.ok ? "livre" : "offline"}</span>
              <Show when={props.onToggle !== undefined}>
                <button
                  type="button"
                  class={`fl-toggle ${blocked(h) ? "fl-toggle-off" : "fl-toggle-on"}`}
                  title={blocked(h) ? `Reativar ${h.label}` : `Desabilitar ${h.label}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onToggle?.(h)
                  }}
                >
                  {blocked(h) ? "off" : "on"}
                </button>
              </Show>
            </div>
            <span class={`fl-models ${state(h)}`} title={`${h.models.length} modelo(s) residente(s)`}>{h.models.length}</span>
          </div>
        )}
      </For>
      <Show when={extra() > 0}>
        <span
          class="fl-more"
          title={props.hosts.slice(props.limit).map((h) => `${h.label}: ${h.models.length} modelo(s)`).join(" · ")}
        >
          +{extra()}
        </span>
      </Show>
    </div>
  )
}

function AgentRows(props: { agents: Agent[] }) {
  return (
    <Show when={props.agents.length} fallback={<div class="fl-empty">nenhum agente ativo</div>}>
      <For each={props.agents}>
        {(a) => (
          <div class="fl-agent">
            <span class="fl-name" title={a.id}>
              {a.id}
            </span>
            <span class="fl-meta">{a.sessions.length} sess{String(a.sessions.length) === "1" ? "" : "ões"}</span>
          </div>
        )}
      </For>
    </Show>
  )
}

const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n)

type Tokens = Snapshot["tokens"]
type ProjectTokens = Tokens["projects"][number]

function TokenView(props: { tokens: Tokens }) {
  const t = () => props.tokens
  const max = () => Math.max(1, ...t().projects.map((p) => p.input + p.output))
  const width = (p: ProjectTokens) => `${Math.round(((p.input + p.output) / max()) * 100)}%`
  return (
    <Show
      when={t().projects.length}
      fallback={
        <div class="fl-empty">
          novo {compact(t().total.input)} · visível {compact(t().total.output)} · raciocínio {compact(t().total.reasoning)} · cache lido {compact(t().total.cacheRead)}
        </div>
      }
    >
      <div class="fl-tok-total">
        <span>geral</span>
        <span class="fl-meta">
          novo {compact(t().total.input)} · visível {compact(t().total.output)} · raciocínio {compact(t().total.reasoning)} · cache lido {compact(t().total.cacheRead)}
        </span>
      </div>
      <For each={t().projects}>
        {(p) => (
          <div class="fl-tok-row" title={`${p.id} · novo ${p.input.toLocaleString()} · visível ${p.output.toLocaleString()} · raciocínio ${p.reasoning.toLocaleString()} · cache lido ${p.cacheRead.toLocaleString()}`}>
            <div class="fl-tok-line">
              <span class="fl-tok-name">{p.name}</span>
              <span class="fl-meta">{compact(p.input + p.output)}</span>
            </div>
            <div class="fl-track">
              <div class="fl-fill fl-tok-fill" style={{ width: width(p) }} />
            </div>
          </div>
        )}
      </For>
    </Show>
  )
}

function PrefRows(props: { prefs: Snapshot["prefs"] }) {
  return (
    <Show when={props.prefs.length} fallback={<div class="fl-empty">nenhuma preferência declarada</div>}>
      <For each={props.prefs}>
        {(p) => (
          <div class="fl-pref">
            <span class="fl-pref-server">{p.server}</span>
            <span class="fl-pref-arrow">→</span>
            <span class="fl-pref-project">{p.project}</span>
            <span class="fl-meta">{p.ttl}</span>
          </div>
        )}
      </For>
    </Show>
  )
}

function FleetView(props: { snap: () => Snapshot | undefined; onToggle: (h: Host) => void }) {
  const s = () => props.snap()
  const active = () => s()?.hosts.filter((h) => h.ok && h.models.length).length ?? 0
  return (
    <div class="fl-view">
      <div class="fl-heading">
        <span>frota ao vivo</span>
        <span class="fl-meta">{clock(s()?.updated ?? 0)}</span>
      </div>

      <div class="fl-section">
        <div class="fl-heading">
          <span>servidores</span>
          <span class="fl-meta">
            {active()}/{s()?.hosts.length ?? 0} com modelo{(s()?.disabled.length ?? 0) ? ` · ${s()!.disabled.length} desligados` : ""}
          </span>
        </div>
        <HostCells hosts={s()?.hosts ?? []} disabled={s()?.disabled ?? []} onToggle={props.onToggle} wrap />
      </div>

      <div class="fl-section">
        <div class="fl-heading">
          <span>agentes em sessão</span>
          <span class="fl-meta">{s()?.agents.length ?? 0}</span>
        </div>
        <AgentRows agents={s()?.agents ?? []} />
      </div>

      <div class="fl-section">
        <div class="fl-heading">
          <span>tokens por projeto</span>
          <span class="fl-meta">{s()?.tokens.projects.length ?? 0}</span>
        </div>
        <TokenView tokens={s()?.tokens ?? { total: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, projects: [] }} />
      </div>

      <div class="fl-section">
        <div class="fl-heading">
          <span>preferências de projeto</span>
          <span class="fl-meta">{s()?.prefs.length ?? 0}</span>
        </div>
        <PrefRows prefs={s()?.prefs ?? []} />
      </div>

      <div class="fl-hint">atualização automática a cada 3 s · origem: /api/ps + sessões locais</div>
    </div>
  )
}

export default Plugin.define({
  setup(ctx) {
    ctx.add(Style, css)

    const [snap, setSnap] = createSignal<Snapshot | undefined>(undefined)
    const rpc = ctx.client.rpc(Fleet)
    let stopped = false

    const refresh = async () => {
      try {
        const value = (await rpc.snapshot({})) as Snapshot
        if (!stopped) setSnap(() => value)
      } catch {}
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 3_000)
    onCleanup(() => {
      stopped = true
      clearInterval(timer)
    })
    try {
      rpc.events.on("updated", () => void refresh())
    } catch {}

    const toggle = async (h: Host) => {
      try {
        const enabled = !(snap()?.disabled ?? []).includes(h.provider)
        await rpc.setServer({ server: h.provider, enabled })
        await refresh()
      } catch {}
    }

    const open = () => {
      const session = ctx.sessions.current() ?? ctx.sessions.list()[0]
      if (session) ctx.layout.open(`${ctx.id}:fleet`, session, { background: true })
    }

    ctx.add(Slot, {
      at: "window.bottom",
      render: () => (
        <div class="fl-bar" onClick={open} title="Clique para abrir o painel da frota">
          <span class="fl-title">FROTA</span>
          <HostCells hosts={snap()?.hosts ?? []} disabled={snap()?.disabled ?? []} limit={6} />
          <Show when={(snap()?.prefs.length ?? 0) > 0}>
            <span class="fl-prefbar">
              {snap()!.prefs.map((p) => `${p.server}=${p.project}`).join(" | ")}
            </span>
          </Show>
          <Show when={snap()?.tokens}>
            <span class="fl-tokbar" title="tokens: novo (não-cacheado) + visível — cache lido não incluído">
              {compact(snap()!.tokens.total.input + snap()!.tokens.total.output)}
            </span>
          </Show>
          <span class="fl-meta">{snap()?.agents.length ?? 0} ag</span>
          <span class="fl-clock">{clock(snap()?.updated ?? 0)}</span>
        </div>
      ),
    })

    ctx.add(Command, {
      id: "open",
      title: "Frota: status ao vivo",
      description: "Agentes em sessão e modelos residentes nos servidores configurados",
      keywords: "fleet agentes servidores modelos",
      section: "general",
      slash: { name: "frota" },
      run: open,
    })

    ctx.add(Panel, {
      id: "fleet",
      region: "side",
      wide: true,
      list: (input) =>
        input.open.includes("fleet")
          ? [
              {
                id: "fleet",
                title: "Frota",
                closable: "hover",
                fallback: true,
              },
            ]
          : [],
      render: () => <FleetView snap={snap} onToggle={toggle} />,
    })
  },
})
