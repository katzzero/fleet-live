import { Plugin } from "@opencode/plugin"
import { Fleet, type AgentConfig, type Snapshot } from "./rpc.js"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

type Host = { provider: string; label: string; baseUrl: string }
type HostState = {
  label: string
  provider: string
  ok: boolean
  models: { name: string; ctx: number }[]
}

const POLL = 2_000
const DEFAULT_TTL = 6 * 60 * 60 * 1000
const MAX_TTL = 7 * 24 * 60 * 60 * 1000
const SIZES: Record<string, string> = {
  "laguna-xs-2.1:mxfp8": "33,9B-A3B",
}

type Pref = { server: string; project: string; expires: number }
type Counts = { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
const PREFS_KEY = "prefs"
const zeroCounts = (): Counts => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 })
function addTokens(into: Counts, t: any) {
  into.input += Number(t?.input ?? 0)
  into.output += Number(t?.output ?? 0)
  into.reasoning += Number(t?.reasoning ?? 0)
  into.cacheRead += Number(t?.cache?.read ?? 0)
  into.cacheWrite += Number(t?.cache?.write ?? 0)
}

function parseTtl(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_TTL
  const text = String(raw).trim().toLowerCase()
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/)
  if (!match) return DEFAULT_TTL
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] ?? "s"] ?? 1000
  return Math.max(1000, Math.min(Math.round(Number(match[1]) * unit), MAX_TTL))
}

function remaining(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days) return `${days}d${hours ? `${hours}h` : ""}`
  if (hours) return `${hours}h${mins ? `${mins}m` : ""}`
  return `${mins}m`
}

function rows(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object" && "data" in value) {
    const data = (value as { data: unknown }).data
    return Array.isArray(data) ? data : []
  }
  return []
}

function descendants(root: string, all: { id: string; parent: string }[]): Set<string> {
  const children = new Map<string, string[]>()
  for (const s of all) {
    if (!s.parent) continue
    const list = children.get(s.parent) ?? []
    list.push(s.id)
    children.set(s.parent, list)
  }
  const out = new Set<string>()
  const queue = [...(children.get(root) ?? [])]
  while (queue.length) {
    const id = queue.shift()!
    if (out.has(id)) continue
    out.add(id)
    queue.push(...(children.get(id) ?? []))
  }
  return out
}

function paramsOf(tag: string): string {
  const quantRaw = tag.match(/qat-int4|mxfp8|nvfp4|int4|mlx/i)?.[0] ?? ""
  const quant = quantRaw.toLowerCase() === "qat-int4" ? "int4 QAT" : quantRaw
  let size = SIZES[tag] ?? ""
  if (!size) {
    const active = tag.match(/(\d+(?:[.,]\d+)?)b-a(\d+)b/i)
    const e = tag.match(/\be(\d)b\b/i)
    const total = tag.match(/(\d+(?:[.,]\d+)?)b/i)
    if (active) size = `${active[1]}B-A${active[2]}B`
    else if (e) size = `E${e[1]}B`
    else if (total) size = `${total[1]}B`
  }
  return `${size}${quant ? " " + quant : ""}`.trim() || "?"
}

export default Plugin.define({
  id: "fleet-live",
  async setup(ctx) {
    const targets = (rows(ctx.options.hosts) as Host[]).filter((h) => h && h.provider && h.baseUrl)
    const hostOf = new Map(targets.map((h) => [h.provider, h.label]))
    // prefs live in shared plugin storage so every setup() instance sees the same data
    const storage = (ctx as unknown as {
      storage: {
        get: (key: string) => Promise<Pref[] | undefined>
        set: (key: string, value: Pref[]) => Promise<void>
      }
    }).storage
    const prefs = new Map<string, Pref>()
    async function loadPrefs() {
      try {
        const saved = (await storage.get(PREFS_KEY)) ?? []
        prefs.clear()
        for (const p of saved) prefs.set(p.server, p)
      } catch {}
    }
    async function savePrefs() {
      try {
        await storage.set(PREFS_KEY, [...prefs.values()])
      } catch {}
    }
    const projectNames = new Map<string, string>()
    const rememberProject = (id: unknown, location: unknown) => {
      const key = String(id ?? "")
      if (!key || projectNames.has(key)) return
      const dir = String((location as { directory?: string })?.directory ?? "")
      const name = dir.split("/").filter(Boolean).pop() ?? ""
      projectNames.set(key, name || key.slice(0, 8))
    }
    rememberProject((ctx as any).location?.project?.id, (ctx as any).location?.project)

    function collectTokens(listed: any[]) {
      const total = zeroCounts()
      const byProject = new Map<string, Counts>()
      for (const s of listed) {
        addTokens(total, s?.tokens)
        rememberProject(s?.projectID, s?.location)
        const pid = String(s?.projectID ?? "")
        if (!pid) continue
        const c = byProject.get(pid) ?? zeroCounts()
        addTokens(c, s?.tokens)
        byProject.set(pid, c)
      }
      const projects = [...byProject]
        .map(([id, c]) => ({
          id,
          name: projectNames.get(id) ?? id.slice(0, 8),
          ...c,
        }))
        .sort((a, b) => b.input + b.output - (a.input + a.output) || b.output - a.output)
      return { total, projects }
    }

    let states: HostState[] = []
    let callerID = ""
    let allSessions: { id: string; parent: string }[] = []
    let snap: Snapshot = {
      updated: 0,
      agents: [],
      hosts: [],
      sessions: [],
      prefs: [],
      tokens: { total: zeroCounts(), projects: [] },
    }
    let fleetReg: Awaited<ReturnType<typeof ctx.rpc.register<typeof Fleet>>> | undefined

    const root = join(process.env.HOME ?? "", ".config", "opencode")
    const cfg = JSON.parse(readFileSync(join(root, "opencode.json"), "utf8"))
    const limits = new Map<string, number>()
    for (const [pid, prov] of Object.entries<any>(cfg.provider ?? {})) {
      for (const [mid, model] of Object.entries<any>(prov.models ?? {})) {
        limits.set(`${pid}/${mid}`, Number(model?.limit?.context ?? 0))
      }
    }

    const configs = new Map<string, AgentConfig>()
    const put = (id: string, ref: string) => {
      const slash = ref.indexOf("/")
      if (slash < 0) return
      const provider = ref.slice(0, slash)
      const model = ref.slice(slash + 1)
      configs.set(id, {
        id,
        provider,
        model,
        params: paramsOf(model),
        ctx: limits.get(`${provider}/${model}`) ?? 0,
        host: hostOf.get(provider) ?? "",
      })
    }

    for (const [id, agent] of Object.entries<any>(cfg.agent ?? {})) {
      const model = agent?.model
      if (typeof model === "string") put(id, model)
      else if (model?.providerID && model?.id) put(id, `${model.providerID}/${model.id}`)
    }
    for (const file of readdirSync(join(root, "agent"))) {
      if (!file.endsWith(".md")) continue
      const text = readFileSync(join(root, "agent", file), "utf8")
      const front = text.match(/^---\n([\s\S]*?)\n---/)
      const ref = front?.[1].match(/^model:\s*(\S+)/m)?.[1]
      if (ref) put(file.slice(0, -3), ref)
    }

    function activePrefs(now: number) {
      for (const [key, p] of prefs) if (p.expires <= now) prefs.delete(key)
      return [...prefs.values()].map((p) => ({
        server: p.server,
        project: p.project,
        ttl: remaining(p.expires - now),
      }))
    }

    function prefLine(now: number) {
      const items = activePrefs(now)
      if (!items.length) return ""
      return `\npreferências: ${items.map((p) => `${p.server}=${p.project}(${p.ttl})`).join(" | ")}`
    }

    function configText(filter?: string) {
      const all = [...configs.values()].filter((c) => !filter || c.id === filter || c.id.includes(filter))
      return (
        all
          .map((c) => {
            const head = `${c.id}: ${c.host || c.provider} ${c.model}`
            return `${head} [${c.params} ctx ${Math.round(c.ctx / 1024)}K]`
          })
          .join("\n") || "agente não encontrado"
      )
    }

    function render(s: Snapshot, agentID?: string) {
      const now = Date.now()
      const short = (id: string) => id.slice(-6)
      const agentLine = s.agents.map((a) => `${a.id}(${a.sessions.length})`).join(" ") || "nenhum"
      const serverLine =
        s.hosts
          .map((h) => {
            const resident = h.models.join(",") || "livre"
            const uses = h.sessions.map(short).join(",")
            return `${h.label}:${resident}${uses ? "<-" + uses : ""}${h.ok ? "" : "[offline]"}`
          })
          .join(" | ") || "nenhum"
      const cfg = agentID ? configs.get(agentID) : undefined
      const current = cfg
        ? `\nagente: ${cfg.id} ${cfg.host || cfg.provider}/${cfg.model} [${cfg.params} ctx ${Math.round(cfg.ctx / 1024)}K]`
        : ""
      const t = s.tokens.total
      const compact = (n: number) =>
        n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n)
      const tokLine = `\ntokens: novo ${compact(t.input)} visivel ${compact(t.output)} raciocinio ${compact(t.reasoning)} cache-lido ${compact(t.cacheRead)}` +
        (s.tokens.projects.length
          ? ` | ${s.tokens.projects.slice(0, 4).map((p) => `${p.name} ${compact(p.input + p.output)}`).join(" ")}`
          : "")
      return `<fleet-live>${current}\nagentes: ${agentLine}\nservidores: ${serverLine}${prefLine(now)}${tokLine}\n</fleet-live>`
    }

    async function refresh() {
      states = await Promise.all(
        targets.map(async (h) => {
          try {
            const res = await fetch(`${h.baseUrl}/api/ps`, { signal: AbortSignal.timeout(1500) })
            const body = (await res.json()) as { models?: { name: string; context_length: number }[] }
            return {
              label: h.label,
              provider: h.provider,
              ok: res.ok,
              models: (body.models ?? []).map((m) => ({ name: m.name, ctx: m.context_length })),
            }
          } catch {
            return { label: h.label, provider: h.provider, ok: false, models: [] }
          }
        }),
      )

      const now = Date.now()
      const listed = rows(await ctx.session.list({ limit: 100 }))
      allSessions = listed.map((s: any) => ({ id: String(s.id), parent: String(s.parentID ?? "") }))
      const sessions = listed
        .filter((s: any) => s?.time?.busy && s.time.busy >= (s.time.idle ?? 0))
        .map((s: any) => ({
          id: s.id as string,
          agent: String(s.agent ?? "?"),
          model: `${s.model?.providerID ?? "?"}/${s.model?.id ?? "?"}`,
          provider: String(s.model?.providerID ?? "?"),
          age: Math.round((now - s.time.busy) / 1000),
          parentID: String(s.parentID ?? ""),
        }))

      const agents = new Map<string, string[]>()
      const byProvider = new Map<string, string[]>()
      for (const s of sessions) {
        const a = agents.get(s.agent) ?? []
        a.push(s.id)
        agents.set(s.agent, a)
        const p = byProvider.get(s.provider) ?? []
        p.push(s.id)
        byProvider.set(s.provider, p)
      }

      snap = {
        updated: now,
        agents: [...agents].map(([id, ids]) => ({ id, sessions: ids })),
        hosts: states.map((h) => ({
          label: h.label,
          provider: h.provider,
          ok: h.ok,
          models: h.models.map((m) => `${m.name}@${m.ctx}`),
          sessions: byProvider.get(h.provider) ?? [],
        })),
        sessions,
        prefs: activePrefs(now),
        tokens: collectTokens(listed),
      }

      if (fleetReg) void fleetReg.events.emit("updated", { updated: now })
    }

    await loadPrefs()
    await refresh()
    const timer = setInterval(() => void refresh(), POLL)

    fleetReg = await ctx.rpc.register(Fleet, {
      agentConfig: async (input) => ({
        agents: [...configs.values()].filter(
          (c) => !(input as { agent?: string }).agent ||
            c.id === (input as { agent?: string }).agent ||
            c.id.includes((input as { agent?: string }).agent!),
        ),
      }),
      snapshot: async () => {
        await loadPrefs()
        return { ...snap, prefs: activePrefs(Date.now()) }
      },
    })

    const hookReg = await ctx.session.hook("context", (event) => {
      callerID = String((event as { sessionID?: string }).sessionID ?? "")
      event.system.push({ type: "text", text: render(snap, String(event.agent)) })
    })

    const toolReg = await ctx.tool.transform((editor) => {
      editor.add({
        name: "fleet_status",
        description: "Live state of agents in sessions and Ollama hosts with resident models.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { codemode: false },
        execute: async () => {
          await refresh()
          return { content: render(snap) }
        },
      })
      editor.add({
        name: "agent_config",
        description: "Model, weights and context configured for one agent (or all when omitted).",
        input: {
          type: "object",
          properties: { agent: { type: "string", description: "Agent ID or substring" } },
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input) => ({ content: configText((input as { agent?: string }).agent) }),
      })
      editor.add({
        name: "fleet_prefer",
        description:
          "Declare which project prefers one server, with optional TTL (default 6h). Omit project to clear. Advisory only; never blocks delegation.",
        input: {
          type: "object",
          properties: {
            server: { type: "string", description: "Server label (S1/S3/S4/S5) or provider id" },
            project: { type: "string", description: "Project name. Omit or leave empty to clear the preference" },
            ttl: { type: "string", description: "Lifetime: 30m, 6h, 1d or seconds. Default 6h, max 7d" },
          },
          required: ["server"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input) => {
          const value = input as { server?: string; project?: string; ttl?: string }
          const key = String(value.server ?? "").trim().toLowerCase()
          if (!key) return { content: "servidor obrigatório" }
          const label = hostOf.get(key) ?? targets.find((h) => h.label.toLowerCase() === key)?.label ?? key.toUpperCase()
          await loadPrefs()
          if (!String(value.project ?? "").trim()) {
            prefs.delete(label)
            await savePrefs()
            snap.prefs = activePrefs(Date.now())
            return { content: `preferência removida: ${label}` }
          }
          const ttl = parseTtl(value.ttl)
          prefs.set(label, { server: label, project: String(value.project).trim(), expires: Date.now() + ttl })
          await savePrefs()
          snap.prefs = activePrefs(Date.now())
          return { content: `preferência: ${label}=${prefs.get(label)!.project} expira em ${remaining(ttl)}` }
        },
      })
      editor.add({
        name: "fleet_interrupt",
        description:
          "Interrupt (stop) a running agent session by sessionID or agent ID. Accepts the 6-char ID shown in fleet_status. Only sessions descended from the caller can be interrupted — agents created by someone else are refused. Use only for a stuck or superseded run.",
        input: {
          type: "object",
          properties: {
            sessionID: { type: "string", description: "Full session ID or its last 6 characters" },
            agent: { type: "string", description: "Agent ID or substring; resolves to its active session" },
          },
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input) => {
          await refresh()
          const value = input as { sessionID?: string; agent?: string }
          const needle = String(value.sessionID ?? "").trim().toLowerCase()
          const agentNeedle = String(value.agent ?? "").trim().toLowerCase()
          if (!needle && !agentNeedle) return { content: "sessionID ou agent obrigatório" }
          let hits = snap.sessions.filter((s) => {
            if (needle) return s.id.toLowerCase() === needle || s.id.toLowerCase().endsWith(needle)
            return s.agent.toLowerCase() === agentNeedle || s.agent.toLowerCase().includes(agentNeedle)
          })
          if (!hits.length) return { content: "nenhuma sessão ativa encontrada" }
          if (!callerID) return { content: "recusado: sessão chamadora desconhecida" }
          const own = descendants(callerID, allSessions)
          hits = hits.filter((s) => own.has(s.id))
          if (!hits.length)
            return { content: "recusado: sessão não foi criada por quem chamou (não é descendente)" }
          if (hits.length > 1)
            return { content: `ambíguo: ${hits.map((s) => `${s.agent}:${s.id.slice(-6)}`).join(" ")}` }
          const target = hits[0]
          try {
            const interrupt = (ctx.session as unknown as {
              interrupt: (args: Record<string, unknown>) => Promise<unknown>
            }).interrupt.bind(ctx.session)
            let res: unknown
            let last: unknown
            for (const args of [
              { sessionID: target.id, resume: false },
              { path: { sessionID: target.id }, query: { resume: false } },
              { sessionID: target.id },
            ]) {
              try {
                res = await interrupt(args)
                break
              } catch (error) {
                last = error
              }
            }
            if (res === undefined) throw last ?? new Error("interrupt sem resposta")
            const interruptedFlag = (res as { interrupted?: boolean })?.interrupted ?? (res as { data?: { interrupted?: boolean } })?.data?.interrupted
            return {
              content: `interrompido: ${target.agent} ${target.id.slice(-6)}${interruptedFlag === false ? " (sem confirmação)" : ""}`,
            }
          } catch (error) {
            return { content: `falha ao interromper ${target.id.slice(-6)}: ${(error as Error)?.message ?? String(error)}` }
          }
        },
      })
    })

    return () => {
      clearInterval(timer)
      void hookReg.dispose()
      void toolReg.dispose()
      void fleetReg?.dispose()
    }
  },
})
