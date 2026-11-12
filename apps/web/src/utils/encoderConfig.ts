import { DEFAULT_ENCODER_CONFIG } from '../constants';
import type { EncoderConfig } from '../types';

const isLegacyDefaultConfig = (config: Partial<EncoderConfig>): boolean =>
  config.fps === 10 &&
  config.packetSize === 800 &&
  config.ecc === 'MEDIUM' &&
  (config.targetSize === 150 || config.targetSize === 177) &&
  config.raptorqOverhead === 1.2;

/**
 * Upgrade the historical web defaults while retaining preferences unrelated
 * to that default profile (chunking and compression in particular).
 */
export function migrateLegacyEncoderDefaults(
  config: Partial<EncoderConfig>
): EncoderConfig {
  const completeConfig = { ...DEFAULT_ENCODER_CONFIG, ...config };

  if (!isLegacyDefaultConfig(config)) {
    return completeConfig;
  }

  return {
    ...completeConfig,
    fps: DEFAULT_ENCODER_CONFIG.fps,
    packetSize: DEFAULT_ENCODER_CONFIG.packetSize,
    ecc: DEFAULT_ENCODER_CONFIG.ecc,
    targetSize: DEFAULT_ENCODER_CONFIG.targetSize,
    raptorqOverhead: DEFAULT_ENCODER_CONFIG.raptorqOverhead,
  };
}
