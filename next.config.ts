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
  outputFileTracingExcludes: {
    "/api/ocr/parse": ["models/paddleocr-server/**"],
  },
  // onnxruntime-node's addon loads its own libonnxruntime.so.1 via the OS
  // dynamic linker (dlopen from inside the compiled .node binding), not a JS
  // require() -- so Next's file tracer (and Netlify's Next.js Runtime, which
  // packages functions from the same trace output) never discovers it as a
  // dependency and silently drops it from the deployed function. The .node
  // binding itself does get traced (its require() path is a template literal
  // that resolves to a static path at build time on Linux x64), but that
  // binding fails at runtime with "libonnxruntime.so.1: cannot open shared
  // object file" without its sibling .so. Confirmed via Netlify function logs
  // on tradinglenz.netlify.app. Force-include the whole platform dir so both
  // files travel together.
  outputFileTracingIncludes: {
    "/api/ocr/parse": ["node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**"],
  },
};

export default nextConfig;
