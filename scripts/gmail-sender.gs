/**
 * Trading Lenz onboarding email sender -- paste this into a Google Apps Script
 * project owned by tradinglenz@gmail.com (script.google.com -> New project).
 * The site posts { secret, to, subject, text } and this sends it from the
 * account's own Gmail. Setup: see src/lib/email/send.ts.
 *
 * The secret lives in Project Settings -> Script properties as SECRET, not
 * in this code, so the code can be shared safely.
 */
function doPost(e) {
  var reply = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };
  try {
    var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
    var body = JSON.parse(e.postData.contents);
    if (!secret || body.secret !== secret) return reply({ ok: false, error: "unauthorized" });
    if (!body.to || !body.subject || !body.text) return reply({ ok: false, error: "missing fields" });
    GmailApp.sendEmail(body.to, body.subject, body.text, { name: "Trading Lenz" });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/** Run this once from the editor to approve Gmail access and send yourself a test. */
function testSend() {
  var me = Session.getActiveUser().getEmail();
  GmailApp.sendEmail(me, "Trading Lenz sender works", "If you can read this, the onboarding sender is set up.", {
    name: "Trading Lenz",
  });
}
