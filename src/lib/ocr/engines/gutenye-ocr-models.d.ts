// @gutenye/ocr-models ships no type declarations for its "./node" subpath
// export. It's just the bundled mobile model paths (see node_modules/@gutenye/ocr-models/node.js).
declare module "@gutenye/ocr-models/node" {
  const models: {
    detectionPath: string;
    recognitionPath: string;
    dictionaryPath: string;
  };
  export default models;
}
