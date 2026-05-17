import { MockTechBase, registerInstance } from './tech-base.js';

export class Gb28181Tech extends MockTechBase {
  constructor() {
    super('gb28181');
    registerInstance('gb28181', this);
  }
}

