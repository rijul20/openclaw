import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createSandboxWrapper } from "../src/sandbox.js";

// UC5, UC6: Sandbox isolation
describe("sandbox isolation", () => {
  it("macOS sandbox profile restricts writes to workspace only", () => {
    if (process.platform !== "darwin") {
      return;
    }

    const workspace = "/tmp/test-workspace-isolation-" + Date.now();
    createSandboxWrapper(workspace, "/usr/bin/echo");

    // Find the .sb profile by hash
    const hash = createHash("sha256").update(workspace).digest("hex").slice(0, 12);
    const sandboxDir = join(homedir(), ".rclaw", "sandbox");
    const sbFile = `${hash}.sb`;
    const profile = readFileSync(join(sandboxDir, sbFile), "utf-8");

    expect(profile).toContain("(deny file-write*)");
    expect(profile).toContain(`(subpath "${workspace}")`);
  });

  // UC7: Cross-user workspace paths are different
  it("different workspaces get different sandbox wrappers", () => {
    const wrapper1 = createSandboxWrapper("/tmp/user-alice-" + Date.now(), "/usr/bin/echo");
    const wrapper2 = createSandboxWrapper("/tmp/user-bob-" + Date.now(), "/usr/bin/echo");
    expect(wrapper1).not.toBe(wrapper2);
  });

  // UC16, UC17: Contact sessions get tighter tool restrictions
  it("contact sandbox has different hash from owner sandbox", () => {
    const ts = Date.now();
    const ownerWrapper = createSandboxWrapper(`/tmp/owner-workspace-${ts}`, "/usr/bin/echo");
    const contactWrapper = createSandboxWrapper(
      `/tmp/owner-workspace-${ts}/contacts/1234`,
      "/usr/bin/echo",
    );
    expect(ownerWrapper).not.toBe(contactWrapper);
  });

  // UC18: Wrapper scripts are executable
  it("wrapper scripts have execute permission", () => {
    const wrapper = createSandboxWrapper("/tmp/test-exec-perm-" + Date.now(), "/usr/bin/echo");
    const stats = statSync(wrapper);
    expect(stats.mode & 0o100).toBeTruthy();
  });
});
