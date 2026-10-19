/**
 * Puts backed-up screenshots back into Supabase Storage: the files
 * scripts/backup-db.ts saved under <backup>/storage/<bucket>/.
 *
 * Run with:
 *   npm run restore:storage                      # dry run against newest backup
 *   npm run restore:storage -- --dir backups/... # dry run against a chosen one
 *   npm run restore:storage -- --apply           # actually upload
 *
 * **Never overwrites.** A file already in the bucket is left alone and
 * counted as present. Restoring is for files that are gone; it can't
 * replace a newer screenshot with an older copy.
 *
 * **Dry run by default**, as restore-db.ts, and for the same reason: this
 * writes with the service-role key, so it says out loud which project it is
 * about to write to before it does anything.
 *
 * Restore the database rows first (`npm run restore:db`): the trade_images
 * rows are what the app reads to find these files.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function newestBackupDir(): string | null {
  const root = path.join(process.cwd(), "backups");
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return dirs.length > 0 ? path.join(root, dirs[dirs.length - 1]) : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const dirIndex = argv.indexOf("--dir");
  const apply = argv.includes("--apply");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).");
    process.exit(2);
  }

  const dir = dirIndex !== -1 && argv[dirIndex + 1] ? path.resolve(argv[dirIndex + 1]) : newestBackupDir();
  const storageDir = dir ? path.join(dir, "storage") : null;
  if (!dir || !storageDir || !existsSync(storageDir)) {
    console.error(dir ? `No storage/ folder in ${dir} (backups before 2026-10-16 have none).` : "No backups found under ./backups.");
    process.exit(2);
  }

  console.log(`Backup: ${dir}`);
  console.log(`Target: ${url}`);
  console.log(apply ? "Mode:   APPLY (will upload missing files)\n" : "Mode:   dry run (no writes)\n");

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const manifests = readdirSync(storageDir).filter((name) => name.endsWith(".manifest.json"));
  let problems = 0;
  for (const name of manifests) {
    const manifest = JSON.parse(readFileSync(path.join(storageDir, name), "utf8")) as { bucket: string; files: string[]; failed: string[] };
    let uploaded = 0;
    let present = 0;
    let missingLocally = 0;
    for (const file of manifest.files) {
      if (manifest.failed.includes(file)) continue;
      const local = path.join(storageDir, manifest.bucket, ...file.split("/"));
      if (!existsSync(local)) {
        missingLocally += 1;
        continue;
      }
      if (!apply) {
        uploaded += 1;
        continue;
      }
      const { error } = await supabase.storage.from(manifest.bucket).upload(file, readFileSync(local), {
        upsert: false,
        contentType: CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      });
      if (!error) uploaded += 1;
      else if (/exists|duplicate/i.test(error.message)) present += 1;
      else {
        problems += 1;
        console.error(`  ${manifest.bucket}/${file}: ${error.message}`);
      }
    }
    console.log(
      apply
        ? `  ${manifest.bucket}: ${uploaded} uploaded, ${present} already there, ${missingLocally} missing from the backup folder`
        : `  ${manifest.bucket}: ${uploaded} file(s) would be uploaded where missing, ${missingLocally} missing from the backup folder`,
    );
    if (manifest.failed.length > 0) console.log(`  (${manifest.failed.length} file(s) could not be backed up that night)`);
  }

  if (!apply) console.log("\nRe-run with `npm run restore:storage -- --apply` to upload.");
  if (problems > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
