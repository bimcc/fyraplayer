import { MockTechBase, registerInstance } from './tech-base.js';

export class DASHTech extends MockTechBase {
  constructor() {
    super('dash');
    registerInstance('dash', this);
  }
}

