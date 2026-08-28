export interface AppContext {
  port: number
}

export type Env = { Variables: { ctx: AppContext } }
