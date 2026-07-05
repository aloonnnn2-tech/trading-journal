import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The OCR pipeline uses native Node modules (PaddleOCR ONNX runtime, sharp,
  // Tesseract). Keep them external so Next doesn't try to bundle their native
  // binaries into the server build.
  serverExternalPackages: ["@gutenye/ocr-node", "onnxruntime-node", "sharp", "tesseract.js"],
};

export default nextConfig;
