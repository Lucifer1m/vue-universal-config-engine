import type { BuildAdapter, BuildAdapterContext } from '@hcbridge/build-adapter-core';
export declare class ViteBuildAdapter implements BuildAdapter {
    name: string;
    inspect(ctx: BuildAdapterContext): Promise<Record<string, unknown>>;
}
