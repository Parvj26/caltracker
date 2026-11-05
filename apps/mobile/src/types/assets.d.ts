// Metro resolves a font file import to an asset id that expo-font's useFonts accepts.
declare module '*.ttf' {
  const asset: number;
  export default asset;
}

// Metro resolves an image import to an asset id that <Image source> accepts.
declare module '*.png' {
  const asset: number;
  export default asset;
}
