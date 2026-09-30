/**
 * DecoderTab component - Wraps legacy GifDecoder for full functionality
 */

import React from 'react';
import GifDecoder from '../../features/decoder/GifDecoder';

const DecoderTab: React.FC = () => {
  return (
    <div className="flex flex-col h-full animate-fade-in">
      <GifDecoder />
    </div>
  );
};

export default DecoderTab;
