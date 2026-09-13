import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "iife",
  globalName: "SMC",
  outfile: "dist/smc.umd.js",
  footer: { js: "if (typeof module !== 'undefined' && module.exports) { module.exports = SMC; } SMC = SMC.default ?? SMC;" },
});

await esbuild.build({
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "esm",
  outfile: "dist/smc.esm.js",
});

console.log("Built dist/smc.umd.js and dist/smc.esm.js");
