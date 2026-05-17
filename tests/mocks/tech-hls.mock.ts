import { MockTechBase, registerInstance } from './tech-base.js';

export class HLSTech extends MockTechBase {
  constructor() {
    super('hls');
    registerInstance('hls', this);
  }
}

