export type BarcodeCornerPoint = {
  x: number;
  y: number;
};

export type BarcodeDetectionResult = {
  rawValue: string;
  cornerPoints?: BarcodeCornerPoint[];
};

export type BarcodeDetectorLike = {
  detect: (video: HTMLVideoElement) => Promise<BarcodeDetectionResult[]>;
};
