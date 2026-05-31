/// <reference types="vite/client" />

declare module "utif" {
  type Ifd = {
    width?: number;
    height?: number;
    t256?: number[];
    t257?: number[];
    data?: ArrayBuffer | Uint8Array;
    [key: string]: unknown;
  };

  const UTIF: {
    decode(buffer: ArrayBuffer): Ifd[];
    decodeImage(buffer: ArrayBuffer, ifd: Ifd): void;
    toRGBA8(ifd: Ifd): Uint8Array;
  };

  export default UTIF;
}
