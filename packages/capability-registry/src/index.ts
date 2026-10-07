export interface PropMeta {
  type: 'string' | 'boolean' | 'number' | 'enum' | 'object' | 'unknown';
  options?: string[];
  editable?: boolean;
}
export interface ComponentCapabilityMeta {
  identity: { name: string; package?: string };
  props: Record<string, PropMeta>;
  events: Record<string, { params?: string[] }>;
  slots: Record<string, {}>;
  blackBox?: boolean;
}

export interface CapabilityRegistry {
  register(meta: ComponentCapabilityMeta): void;
  resolve(name: string): ComponentCapabilityMeta | undefined;
  getAll(): ComponentCapabilityMeta[];
}

export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  private readonly entries = new Map<string, ComponentCapabilityMeta>();
  register(meta: ComponentCapabilityMeta): void { this.entries.set(meta.identity.name, meta); }
  resolve(name: string): ComponentCapabilityMeta | undefined { return this.entries.get(name); }
  getAll(): ComponentCapabilityMeta[] { return [...this.entries.values()]; }
}

export function createAntDesignVueRegistry(): CapabilityRegistry {
  const registry = new InMemoryCapabilityRegistry();
  registry.register({
    identity: { name: 'AButton', package: 'ant-design-vue' },
    props: {
      type: { type: 'enum', options: ['default', 'primary', 'dashed', 'text', 'link'] },
      size: { type: 'enum', options: ['large', 'middle', 'small'] },
      danger: { type: 'boolean' },
      disabled: { type: 'boolean' },
    },
    events: { click: { params: ['event'] } },
    slots: { default: {} },
  });
  registry.register({
    identity: { name: 'AInput', package: 'ant-design-vue' },
    props: { placeholder: { type: 'string' }, disabled: { type: 'boolean' }, allowClear: { type: 'boolean' } },
    events: { change: { params: ['event'] }, pressEnter: { params: ['event'] } },
    slots: {},
  });
  registry.register({
    identity: { name: 'ASelect', package: 'ant-design-vue' },
    props: { placeholder: { type: 'string' }, disabled: { type: 'boolean' }, mode: { type: 'enum', options: ['multiple', 'tags'] } },
    events: { change: { params: ['value', 'option'] } },
    slots: {},
  });
  registry.register({
    identity: { name: 'AForm', package: 'ant-design-vue' },
    props: { layout: { type: 'enum', options: ['horizontal', 'vertical', 'inline'] } },
    events: { finish: { params: ['values'] } },
    slots: { default: {} },
  });
  registry.register({
    identity: { name: 'ATable', package: 'ant-design-vue' },
    props: { loading: { type: 'boolean' }, bordered: { type: 'boolean' }, size: { type: 'enum', options: ['middle', 'small', 'default'] } },
    events: { change: { params: ['pagination', 'filters', 'sorter'] } },
    slots: { default: {}, bodyCell: {} },
  });
  registry.register({
    identity: { name: 'AModal', package: 'ant-design-vue' },
    props: { open: { type: 'boolean' }, title: { type: 'string' }, width: { type: 'number' } },
    events: { ok: { params: [] }, cancel: { params: [] } },
    slots: { default: {} },
  });
  registry.register({
    identity: { name: 'APagination', package: 'ant-design-vue' },
    props: { current: { type: 'number' }, pageSize: { type: 'number' }, total: { type: 'number' } },
    events: { change: { params: ['page', 'pageSize'] } },
    slots: {},
  });
  return registry;
}

