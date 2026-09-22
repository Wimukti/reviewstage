declare module "*.svg" {
  const url: string;
  export default url;
}

// esbuild resolves these; tsc only needs to know they exist. TypeScript 7 raises TS2882 on a
// side-effect import with no declaration, which turned every stylesheet and font import in
// main.tsx into an error the moment the compiler was bumped.
declare module "*.css";
