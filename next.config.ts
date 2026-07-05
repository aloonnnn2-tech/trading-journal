import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The OCR pipeline uses native Node modules (PaddleOCR ONNX runtime, sharp,
  // Tesseract). Keep them external so Next doesn't try to bundle their native
  // binaries into the server build.
  serverExternalPackages: ["@gutenye/ocr-node", "onnxruntime-node", "sharp", "tesseract.js"],
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
};

export default nextConfig;
