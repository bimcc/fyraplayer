import { MockTechBase, registerInstance } from './tech-base.js';

export class FMP4Tech extends MockTechBase {
  constructor() {
    super('fmp4');
    registerInstance('fmp4', this);
  }
}

