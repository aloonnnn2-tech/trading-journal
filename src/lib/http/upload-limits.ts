// The one size limit for files sent to the server (screenshots, trade
// images, spreadsheets), shared by the upload buttons and the routes so the
// two can never disagree.
//
// Why 4 MB and not the 5 MB it used to be: Netlify buffers a function's
// request up to 6 MB, but a binary upload is Base64-encoded on the way in
// (about 30% larger), which Netlify's docs put at an effective 4.5 MB
// (https://docs.netlify.com/build/functions/configuration/, "Default
// values", checked 2026-10-16). A 4.6 MB screenshot passed this app's own
// check and was refused by the platform with a raw error. 4 MB leaves room
// for the multipart form around the file.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const MAX_UPLOAD_LABEL = "4 MB";

export const UPLOAD_TOO_LARGE = `File exceeds the ${MAX_UPLOAD_LABEL} limit. Crop it or save it as a JPEG and try again.`;
