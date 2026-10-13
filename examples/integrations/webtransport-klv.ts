import type { PluginCtor } from '../../src/types.js';
import { createWebTransportTechPlugin, transportTimestampToPts90k, type WebTransportHandle, type WebTransportTechOptions } from '../../src/plugins/webtransport.js';
import { createFyraKlvPlugin, type FyraKlvHandle, type KlvService } from './fyraklv.js';

/** Application-owned pairing; fyraklv supplies the parser and bounded state buffer. */
export function createWebTransportKlvIntegration<State>(options: {
  createService: () => KlvService<State>;
  transport?: Omit<WebTransportTechOptions,'onHandle'>;
  onError?: (error:unknown) => void;
}): {plugins:PluginCtor[]; getState():State | null} {
  let clock:WebTransportHandle | undefined;
  let klv:FyraKlvHandle<State> | undefined;
  const plugins = [createWebTransportTechPlugin({...options.transport,onHandle:handle => {clock=handle;}}),
    createFyraKlvPlugin({
      createService:options.createService,
      // Use getStateAtPts below so large original timestamps do not round through seconds.
      mediaTimeToPts:() => null,
      onHandle:handle => {klv=handle;},onError:options.onError,
    })];
  return {plugins,getState:() => {
    const frame=clock?.getLatestFrame();
    return frame ? klv?.getStateAtPts(transportTimestampToPts90k(frame.timestamp)) ?? null : null;
  }};
}
