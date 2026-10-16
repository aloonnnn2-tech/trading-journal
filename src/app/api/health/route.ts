// Liveness: the app is up and answering. No database call, no version, no
// detail -- a monitor only needs "200 means alive". Readiness (can it reach
// the database?) is /api/health/ready.
export function GET() {
  return Response.json({ status: "ok" });
}
