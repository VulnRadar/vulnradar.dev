/// <reference types="chrome" />
/// <reference types="firefox-webext-browser" />

declare module "*.html" {
  const src: string;
  export default src;
}
