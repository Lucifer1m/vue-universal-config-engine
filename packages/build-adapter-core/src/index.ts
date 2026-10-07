export interface BuildAdapterContext { projectRoot: string; entry?: string; }
export interface BuildAdapter { name: string; inspect(ctx: BuildAdapterContext): Promise<Record<string, unknown>>; }
