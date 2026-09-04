import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function createDeployArchive({ sourceDir, archivePath }) {
  execFileSync(
    "tar",
    [
      "-czf",
      resolve(archivePath),
      "--exclude=._*",
      "--exclude=.DS_Store",
      "-C",
      resolve(sourceDir),
      ".",
    ],
    {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stdio: "inherit",
    },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sourceDir = ".", archivePath] = process.argv.slice(2);
  if (!archivePath) {
    throw new Error("Usage: node ops/create-deploy-archive.mjs <source-dir> <archive.tgz>");
  }
  createDeployArchive({ sourceDir, archivePath });
}
