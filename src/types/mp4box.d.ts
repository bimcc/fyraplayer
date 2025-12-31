declare module 'mp4box' {
  export interface MP4File {
    onReady: (info: MP4Info) => void;
    onSamples: (id: number, user: any, samples: MP4Sample[]) => void;
    onError: (error: Error) => void;
    appendBuffer(buffer: ArrayBuffer): number;
    start(): void;
    stop(): void;
    flush(): void;
    setExtractionOptions(trackId: number, user: any, options?: { nbSamples?: number }): void;
  }

  export interface MP4Info {
    duration: number;
    timescale: number;
    isFragmented: boolean;
    isProgressive: boolean;
    hasIOD: boolean;
    brands: string[];
    created: Date;
    modified: Date;
    tracks: MP4Track[];
  }

  export interface MP4Track {
    id: number;
    type: string;
    codec: string;
    language: string;
    created: Date;
    modified: Date;
    timescale: number;
    duration: number;
    bitrate: number;
    nb_samples: number;
    video?: {
      width: number;
      height: number;
    };
    audio?: {
      sample_rate: number;
      channel_count: number;
      sample_size: number;
    };
    avcC?: {
      nalUintLength: number;
    };
  }

  export interface MP4Sample {
    number: number;
    track_id: number;
    timescale: number;
    description_index: number;
    description: any;
    data: ArrayBuffer;
    size: number;
    alreadyRead: number;
    duration: number;
    cts: number;
    dts: number;
    is_sync: boolean;
    is_leading: number;
    depends_on: number;
    is_depended_on: number;
    has_redundancy: number;
    degradation_priority: number;
    offset: number;
  }

  export function createFile(): MP4File;
  
  const MP4Box: {
    createFile: typeof createFile;
  };
  
  export default MP4Box;
}
