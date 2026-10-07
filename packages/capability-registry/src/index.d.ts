export interface PropMeta {
    type: 'string' | 'boolean' | 'number' | 'enum' | 'object' | 'unknown';
    options?: string[];
    editable?: boolean;
}
export interface ComponentCapabilityMeta {
    identity: {
        name: string;
        package?: string;
    };
    props: Record<string, PropMeta>;
    events: Record<string, {
        params?: string[];
    }>;
    slots: Record<string, {}>;
    blackBox?: boolean;
}
export interface CapabilityRegistry {
    register(meta: ComponentCapabilityMeta): void;
    resolve(name: string): ComponentCapabilityMeta | undefined;
    getAll(): ComponentCapabilityMeta[];
}
export declare class InMemoryCapabilityRegistry implements CapabilityRegistry {
    private readonly entries;
    register(meta: ComponentCapabilityMeta): void;
    resolve(name: string): ComponentCapabilityMeta | undefined;
    getAll(): ComponentCapabilityMeta[];
}
export declare function createAntDesignVueRegistry(): CapabilityRegistry;
