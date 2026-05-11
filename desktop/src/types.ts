export type Analysis = {
  duration_seconds?: number;
  integrated_lufs?: number;
  true_peak_dbfs?: number;
  loudness_range_lu_proxy?: number;
  spectral_centroid_hz?: number;
  stereo_width?: number;
  transient_density?: number;
};

export type Track = {
  id: string;
  path: string;
  title: string;
  artist: string;
  isrc: string;
  character: string;
  preset: string;
  analysis?: Analysis;
  waveform?: number[];
  masteredPath?: string;
};

export type TransitionArtifact = {
  between: [number, number];
  output: string;
  style: string;
  duration_seconds: number;
  rationale?: string;
};

export type RenderManifest = {
  track_count: number;
  interlude_count: number;
  album_sequence?: string | null;
  cue_sheet?: string | null;
  outputs?: {
    manifest?: string;
    masters_dir?: string;
    interludes_dir?: string;
    album_sequence?: string | null;
  };
  sequence?: Array<Record<string, unknown>>;
  warnings?: string[];
  dashboard?: string;
};

export type CliResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type Settings = {
  albumTitle: string;
  artist: string;
  albumArtist: string;
  genre: string;
  year: string;
  upc: string;
  outputDir: string;
  referenceTrack: string;
  preset: string;
  arc: string;
  arcIntensity: number;
  deliveryProfile: string;
  targetLufs: string;
  ceilingDbfs: string;
  sampleRate: number;
  bitDepth: number;
  outputFormat: string;
  codecPreview: boolean;
  transitionStyle: string;
  transitionDuration: number;
  tweakLufs: number;
  brightness: number;
  bass: number;
  presence: number;
  air: number;
  warmth: number;
  compression: number;
  limiter: number;
  width: number;
};
