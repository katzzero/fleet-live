import { Rpc } from "@opencode/plugin/rpc"

const session = {
  type: "object",
  properties: {
    id: { type: "string" },
    agent: { type: "string" },
    model: { type: "string" },
    provider: { type: "string" },
    age: { type: "number" },
    parentID: { type: "string" },
  },
  required: ["id", "agent", "model", "provider", "age", "parentID"],
  additionalProperties: false,
} as const

const agent = {
  type: "object",
  properties: {
    id: { type: "string" },
    sessions: { type: "array", items: { type: "string" } },
  },
  required: ["id", "sessions"],
  additionalProperties: false,
} as const

const cfg = {
  type: "object",
  properties: {
    id: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    params: { type: "string" },
    ctx: { type: "number" },
    host: { type: "string" },
  },
  required: ["id", "provider", "model", "params", "ctx", "host"],
  additionalProperties: false,
} as const

const pref = {
  type: "object",
  properties: {
    server: { type: "string" },
    project: { type: "string" },
    ttl: { type: "string" },
  },
  required: ["server", "project", "ttl"],
  additionalProperties: false,
} as const

const tokenCounts = {
  type: "object",
  properties: {
    input: { type: "number" },
    output: { type: "number" },
    reasoning: { type: "number" },
    cacheRead: { type: "number" },
    cacheWrite: { type: "number" },
  },
  required: ["input", "output", "reasoning", "cacheRead", "cacheWrite"],
  additionalProperties: false,
} as const

const projectTokens = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    input: { type: "number" },
    output: { type: "number" },
    reasoning: { type: "number" },
    cacheRead: { type: "number" },
    cacheWrite: { type: "number" },
  },
  required: ["id", "name", "input", "output", "reasoning", "cacheRead", "cacheWrite"],
  additionalProperties: false,
} as const

const tokens = {
  type: "object",
  properties: {
    total: tokenCounts,
    projects: { type: "array", items: projectTokens },
  },
  required: ["total", "projects"],
  additionalProperties: false,
} as const

const host = {
  type: "object",
  properties: {
    label: { type: "string" },
    provider: { type: "string" },
    ok: { type: "boolean" },
    models: { type: "array", items: { type: "string" } },
    sessions: { type: "array", items: { type: "string" } },
  },
  required: ["label", "provider", "ok", "models", "sessions"],
  additionalProperties: false,
} as const

export const Fleet = Rpc.define({
  id: "fleet-live",
  methods: {
    agentConfig: {
      input: {
        type: "object",
        properties: { agent: { type: "string" } },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { agents: { type: "array", items: cfg } },
        required: ["agents"],
        additionalProperties: false,
      },
    },
    snapshot: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: {
          updated: { type: "number" },
          agents: { type: "array", items: agent },
          hosts: { type: "array", items: host },
          sessions: { type: "array", items: session },
          prefs: { type: "array", items: pref },
          disabled: { type: "array", items: { type: "string" } },
          tokens: tokens,
        },
        required: ["updated", "agents", "hosts", "sessions", "prefs", "disabled", "tokens"],
        additionalProperties: false,
      },
    },
    setServer: {
      input: {
        type: "object",
        properties: {
          server: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["server", "enabled"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          label: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["ok", "label", "enabled"],
        additionalProperties: false,
      },
    },
  },
  events: {
    updated: {
      schema: {
        type: "object",
        properties: { updated: { type: "number" } },
        required: ["updated"],
        additionalProperties: false,
      },
    },
  },
})

export type Snapshot = {
  updated: number
  agents: { id: string; sessions: string[] }[]
  hosts: { label: string; provider: string; ok: boolean; models: string[]; sessions: string[] }[]
  sessions: { id: string; agent: string; model: string; provider: string; age: number; parentID: string }[]
  prefs: { server: string; project: string; ttl: string }[]
  disabled: string[]
  tokens: {
    total: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
    projects: {
      id: string
      name: string
      input: number
      output: number
      reasoning: number
      cacheRead: number
      cacheWrite: number
    }[]
  }
}


export type AgentConfig = {
  id: string
  provider: string
  model: string
  params: string
  ctx: number
  host: string
}
