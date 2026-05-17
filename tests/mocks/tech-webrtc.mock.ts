import { MockTechBase, registerInstance } from './tech-base.js';

export class WebRTCTech extends MockTechBase {
  constructor() {
    super('webrtc');
    registerInstance('webrtc', this);
  }
}

