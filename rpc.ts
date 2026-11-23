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
        },
        required: ["updated", "agents", "hosts", "sessions"],
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
}


export type AgentConfig = {
  id: string
  provider: string
  model: string
  params: string
  ctx: number
  host: string
}
