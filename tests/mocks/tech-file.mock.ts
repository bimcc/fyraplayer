import { MockTechBase, registerInstance } from './tech-base.js';

export class FileTech extends MockTechBase {
  constructor() {
    super('file');
    registerInstance('file', this);
  }
}

