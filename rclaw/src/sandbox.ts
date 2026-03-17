import { createHash } from "node:crypto";
import { writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SANDBOX_DIR = join(homedir(), ".rclaw", "sandbox");

/**
 * Create an OS-level sandbox wrapper script for a Claude Code session.
 * Returns the path to the wrapper script (use as pathToClaudeCodeExecutable).
 *
 * macOS: sandbox-exec with .sb profile restricting filesystem access.
 * Linux: bwrap (bubblewrap) restricting filesystem access.
 */
export function createSandboxWrapper(workspace: string, claudeBinary: string): string {
  mkdirSync(SANDBOX_DIR, { recursive: true });
  const hash = createHash("sha256").update(workspace).digest("hex").slice(0, 12);
  const platform = process.platform;

  if (platform === "darwin") {
    return createMacOSSandbox(hash, workspace, claudeBinary);
  } else if (platform === "linux") {
    return createLinuxSandbox(hash, workspace, claudeBinary);
  } else {
    // Fallback: no sandbox, just pass-through
    const wrapperPath = join(SANDBOX_DIR, `${hash}.sh`);
    writeFileSync(wrapperPath, `#!/bin/bash\nexec "${claudeBinary}" "$@"\n`);
    chmodSync(wrapperPath, 0o755);
    return wrapperPath;
  }
}

function createMacOSSandbox(hash: string, workspace: string, claudeBinary: string): string {
  const profilePath = join(SANDBOX_DIR, `${hash}.sb`);
  const wrapperPath = join(SANDBOX_DIR, `${hash}.sh`);

  // sandbox-exec profile: allow read everywhere, write only to workspace + tmp + rclaw dirs
  const profile = `(version 1)
(allow default)
(deny file-write*)
(allow file-write*
  (subpath "${workspace}")
  (subpath "/private/tmp")
  (subpath "/tmp")
  (subpath "${join(homedir(), ".rclaw")}")
  (subpath "${join(homedir(), ".claude")}")
  (subpath "/dev")
)
`;

  writeFileSync(profilePath, profile);
  writeFileSync(
    wrapperPath,
    `#!/bin/bash
exec sandbox-exec -f "${profilePath}" "${claudeBinary}" "$@"
`,
  );
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

function createLinuxSandbox(hash: string, workspace: string, claudeBinary: string): string {
  const wrapperPath = join(SANDBOX_DIR, `${hash}.sh`);
  const rclawDir = join(homedir(), ".rclaw");
  const claudeDir = join(homedir(), ".claude");

  // bwrap: read-only bind everything, writable bind only workspace + tmp + rclaw dirs
  writeFileSync(
    wrapperPath,
    `#!/bin/bash
exec bwrap \\
  --ro-bind / / \\
  --bind "${workspace}" "${workspace}" \\
  --bind /tmp /tmp \\
  --bind "${rclawDir}" "${rclawDir}" \\
  --bind "${claudeDir}" "${claudeDir}" \\
  --dev /dev \\
  --proc /proc \\
  --unshare-net \\
  "${claudeBinary}" "$@"
`,
  );
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}
