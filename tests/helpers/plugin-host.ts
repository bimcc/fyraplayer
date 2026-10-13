import { EventBus } from '../../src/core/eventBus.js';
import type { PluginContext, PlayerAPI, Source } from '../../src/types.js';

export function pluginHost(video: HTMLVideoElement) {
  const bus = new EventBus();
  let source: Source = { type: 'file', url: 'a.mp4' };
  const player = {
    getVideoElement: () => video,
    getCurrentSource: () => source,
    on: bus.on.bind(bus), off: bus.off.bind(bus)
  } as unknown as PlayerAPI;
  return {
    context: { player, coreBus: bus } as unknown as PluginContext,
    bus,
    switchSource: () => { source = { type: 'file', url: 'b.mp4' }; bus.emit('sourcechange', { index: 1, source }); }
  };
}
