import { execFile } from "node:child_process";
import { appendFile, lstat, mkdir, readFile, symlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export class FusionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FusionError";
  }
}

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export async function repoRoot(cwd: string): Promise<string> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    throw new FusionError(`not a git repository: ${cwd}\nRun fusion from inside a git repo (git init && git commit first).`);
  }
}

export async function headRevision(root: string): Promise<string> {
  try {
    return (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
  } catch {
    throw new FusionError("the repository has no commits yet; commit something first so Fusion has a base revision");
  }
}

export async function dirtyPaths(root: string): Promise<string[]> {
  const out = await git(root, ["status", "--porcelain", "--untracked-files=normal"]);
  return out.split("\n").filter((l) => l.trim() !== "" && !l.slice(3).startsWith(".fusion/"));
}

export async function ensureFusionExcluded(root: string): Promise<void> {
  const commonDir = (await git(root, ["rev-parse", "--git-common-dir"])).trim();
  const infoDir = join(isAbsolute(commonDir) ? commonDir : resolve(root, commonDir), "info");
  const excludeFile = join(infoDir, "exclude");
  await mkdir(infoDir, { recursive: true });
  const current = await readFile(excludeFile, "utf8").catch(() => "");
  if (current.split("\n").some((l) => l.trim() === "/.fusion/" || l.trim() === ".fusion/")) return;
  await appendFile(excludeFile, `${current === "" || current.endsWith("\n") ? "" : "\n"}# fusion run artifacts\n/.fusion/\n`);
}

export async function addWorktree(root: string, path: string, revision: string): Promise<void> {
  await git(root, ["worktree", "add", "--detach", path, revision]);
}

export async function removeWorktree(root: string, path: string): Promise<void> {
  await git(root, ["worktree", "remove", "--force", path]).catch(() => undefined);
  await git(root, ["worktree", "prune"]).catch(() => undefined);
}

/** Dependencies are rarely committed; borrow the user's node_modules read-through so `npm test` can run. */
export async function linkNodeModules(root: string, worktree: string): Promise<boolean> {
  const source = join(root, "node_modules");
  const target = join(worktree, "node_modules");
  const exists = async (p: string) => lstat(p).then(() => true, () => false);
  if (!(await exists(source)) || (await exists(target))) return false;
  await symlink(source, target, "dir");
  return true;
}

const EXCLUDE_LINKED = ":(exclude,top)node_modules";
/** New files here are agent-CLI session/hook state (e.g. .claude/tsc-cache), not task output. Edits to tracked files are kept. */
const TOOL_STATE_DIRS = [".claude/", ".codex/"];

export interface WorktreeDiff {
  patch: string;
  files: string[];
  stat: string;
  insertions: number;
  deletions: number;
  ignoredToolFiles: string[];
}

export async function worktreeDiff(worktree: string, base: string): Promise<WorktreeDiff> {
  await git(worktree, ["add", "-A", "--", ".", EXCLUDE_LINKED]);
  const added = (await git(worktree, ["diff", "--cached", "--name-only", "--diff-filter=A", base])).split("\n").filter(Boolean);
  const ignoredToolFiles = added.filter((f) => TOOL_STATE_DIRS.some((d) => f.startsWith(d)));
  if (ignoredToolFiles.length > 0) await git(worktree, ["rm", "--cached", "-q", "--", ...ignoredToolFiles]);
  const patch = await git(worktree, ["diff", "--cached", "--binary", base]);
  const files = (await git(worktree, ["diff", "--cached", "--name-only", base])).split("\n").filter(Boolean);
  const stat = (await git(worktree, ["diff", "--cached", "--stat", base])).trimEnd();
  const numstat = await git(worktree, ["diff", "--cached", "--numstat", base]);
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    const [add, del] = line.split("\t");
    insertions += Number(add) || 0;
    deletions += Number(del) || 0;
  }
  return { patch, files, stat, insertions, deletions, ignoredToolFiles };
}
