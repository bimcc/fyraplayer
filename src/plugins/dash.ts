import { DASHTech, type DashTechOptions } from '../techs/tech-dash.js';
import type { PluginCtor } from '../types.js';

export interface DashTechPluginOptions extends DashTechOptions {
  /** Replace an app-registered DASH Tech if one already exists. Defaults to true. */
  replace?: boolean;
  /**
   * Add DASH to the player tech order if it is missing.
   * Defaults to append because DASH is an optional heavy dependency.
   */
  techOrder?: 'prepend' | 'append' | false;
}

export function createDashTechPlugin(options: DashTechPluginOptions = {}): PluginCtor {
  return ({ techs }) => {
    const handle = techs.register('dash', new DASHTech(options), {
      replace: options.replace ?? true,
      techOrder: options.techOrder ?? 'append'
    });
    return {
      destroy: () => handle.unregister()
    };
  };
}
