import { MockTechBase, registerInstance } from './tech-base.js';

export class WSRawTech extends MockTechBase {
  constructor() {
    super('ws-raw');
    registerInstance('ws-raw', this);
  }
}

