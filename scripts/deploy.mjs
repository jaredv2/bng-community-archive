// Publishes the built site to the gh-pages branch without GitHub Actions.
// Use this when Actions is unavailable, or for a quick manual update.
//
// Runs in a throwaway worktree, so your current branch and files are never
// touched. The branch holds built output only, which does include the
// publishable key. That key is public by design and readable in the browser
// anyway. A service role key is never part of a build, so it cannot land here.
import { cp, rm, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const dist = path.resolve("dist");
const branch = process.env.DEPLOY_BRANCH || "gh-pages";
// Which remote to read the push url from. The worktree always has exactly one
// remote, named "origin", so the push below always goes to that name.
const sourceRemote = process.env.DEPLOY_ORIGIN || "origin";
const work = path.join(tmpdir(), `archive-deploy-${process.pid}`);

const git = (args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error(`git ${args.join(" ")} failed:\n${output}`)),
    );
  });

const attempt = async (args, cwd) => {
  try {
    return await git(args, cwd);
  } catch {
    return null;
  }
};

try {
  await stat(path.join(dist, "index.html"));
} catch {
  throw new Error("dist/ has no index.html. Run npm run build first.");
}

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });

try {
  const remoteUrl = (await git(["remote", "get-url", sourceRemote], process.cwd())).trim();

  await git(["init", "-q", work], work).catch(() => {});
  await git(["remote", "add", "origin", remoteUrl], work);

  // A missing remote branch is normal on the first deploy.
  await attempt(["fetch", "origin", branch, "--depth", "1"], work);
  const exists = Boolean(await attempt(["rev-parse", "--verify", "FETCH_HEAD"], work));
  await git(
    exists ? ["checkout", "-B", branch, "FETCH_HEAD"] : ["checkout", "-B", branch],
    work,
  );

  // Clear whatever the branch had, then drop the new build in.
  await attempt(["rm", "-rq", "--cached", "."], work);
  await attempt(["rm", "-rf", "*", ".nojekyll", ".git"], work);
  for (const entry of await readdir(dist)) {
    await cp(path.join(dist, entry), path.join(work, entry), { recursive: true });
  }
  // Keeps GitHub's 404 page from being swallowed by Pages.
  await writeFile(path.join(work, ".nojekyll"), "");

  await git(["add", "-A", "--force"], work);
  const changed = (await git(["status", "--porcelain"], work)).trim();
  if (!changed) {
    console.log("\n  Nothing changed, the branch is already up to date.\n");
  } else {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    await git(["commit", "-q", "-m", `Deploy ${stamp}`], work);
    await git(["push", "origin", `HEAD:${branch}`], work);
    console.log(`\n  Pushed ${branch}.`);
  }
  console.log(`  Set Pages source to "${branch}" / root if it is not already.`);
  console.log(`  Then open https://<user>.github.io/<repo>/\n`);
} finally {
  await rm(work, { recursive: true, force: true });
}
