import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The OCR pipeline uses native Node modules (PaddleOCR ONNX runtime, sharp,
  // Tesseract). Keep them external so Next doesn't try to bundle their native
  // binaries into the server build.
  serverExternalPackages: ["@gutenye/ocr-node", "onnxruntime-node", "sharp", "tesseract.js"],
  // The default "mobile" OCR models used to be read from
  // @gutenye/ocr-models/assets/*.onnx, resolved via that package's own
  // `import.meta.url`-based path logic. Both Next's own file tracer *and*
  // (confirmed by testing) Netlify's Next.js Runtime fail to include those
  // asset files in the deployed function even with outputFileTracingIncludes
  // set here, so every OCR request 502'd in production. Fixed at the source
  // instead: the mobile models are now committed to models/paddleocr-mobile/
  // and read via plain project-relative paths (see paddle.ts), matching the
  // server variant below, which was never affected by this problem.
  //
  // The OCR route statically fs.access()es the opt-in "server" model variant
  // (models/paddleocr-server/*.onnx, ~194MB combined, OCR_MODEL_VARIANT=server
  // -- off by default, see src/lib/ocr/engines/paddle.ts) to decide whether to
  // fall back to the bundled mobile model. Next's file tracer follows that
  // literal path regardless of the runtime env check and includes both
  // multi-hundred-MB files in the deployed function either way. Confirmed via
  // `next build` + inspecting the route's .nft.json trace: without this
  // exclude the OCR function traces to ~210MB, ~194MB of which is these two
  // unused-by-default files -- close enough to Netlify Functions' 250MB
  // (AWS Lambda) unzipped limit to risk failing deploys as OCR's other
  // dependencies grow. Remove this if the server variant is ever deployed
  // deliberately.
  // Next's file tracer resolves onnxruntime-node's platform-specific
  // template-literal require() (`../bin/napi-v6/${platform}/${arch}/...`) by
  // conservatively including every platform's .node binding it can find on
  // disk, not just the one the deployed Lambda (linux/x64) actually needs.
  // Same story for sharp's prebuilt binaries. None of these non-Linux
  // binaries are reachable at runtime in production; excluding them (plus
  // the eval harness's test fixture images, which have no business in a
  // production function bundle at all) trims dead weight from a bundle size
  // that's already tight against AWS Lambda's 50MB zipped limit (see
  // paddle.ts for the much bigger contributor to that budget).
  outputFileTracingExcludes: {
    "/api/ocr/parse": [
      "models/paddleocr-server/**",
      "node_modules/onnxruntime-node/bin/napi-v6/win32/**",
      "node_modules/onnxruntime-node/bin/napi-v6/darwin/**",
      // The tracer follows the .node addon's own ELF dependencies and pulls
      // in this 36MB sibling automatically -- excluded because paddle.ts
      // ships a gzip-compressed copy of the same file instead and
      // decompresses it at runtime (see that file for why: the raw file
      // alone is what pushed the deployed function's zipped size over AWS
      // Lambda's 50MB limit).
      "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1",
      "node_modules/@img/sharp-win32-x64/**",
      "node_modules/@img/sharp-darwin-*/**",
      "scripts/ocr-eval/fixtures/**",
      // @gutenye/ocr-models ships its own default ONNX weights (~16MB) via
      // this assets/ dir, unconditionally imported (see ocr-models include
      // below) but never actually read -- ocr-worker/onnx-worker.mjs always
      // passes its own `models` option, so @gutenye/ocr-node's `create()`
      // never touches these paths (see paddle.ts for why bundled defaults
      // aren't used).
      "node_modules/@gutenye/ocr-models/assets/**",
    ],
  },
};

export default nextConfig;
