// Metro resolves a font file import to an asset id that expo-font's useFonts accepts.
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
