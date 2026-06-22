import { describe, expect, it } from "vitest";
import {
  getRoleLock,
  isRoleLocked,
  parseBookRules,
  tryParseBookRulesFrontmatter,
  type BookRules,
} from "../models/book-rules.js";

const baseRules: BookRules = {
  version: "1.0",
  prohibitions: [],
  chapterTypesOverride: [],
  fatigueWordsOverride: [],
  additionalAuditDimensions: [],
  enableFullCastTracking: false,
  allowedDeviations: [],
};

describe("isRoleLocked", () => {
  it("returns false when no roleLock is configured", () => {
    expect(isRoleLocked(baseRules, "主要角色/张三.md")).toBe(false);
  });

  it("returns false when roleLock exists but the path is not tracked", () => {
    const rules: BookRules = {
      ...baseRules,
      roleLock: {
        preventAdd: false,
        preventDelete: false,
        lockedRoles: [{ path: "主要角色/张三.md", locked: true }],
      },
    };
    expect(isRoleLocked(rules, "主要角色/李四.md")).toBe(false);
  });

  it("returns true only for tracked entries whose locked flag is true", () => {
    const rules: BookRules = {
      ...baseRules,
      roleLock: {
        preventAdd: false,
        preventDelete: false,
        lockedRoles: [
          { path: "主要角色/张三.md", locked: true },
          { path: "主要角色/李四.md", locked: false },
        ],
      },
    };
    expect(isRoleLocked(rules, "主要角色/张三.md")).toBe(true);
    expect(isRoleLocked(rules, "主要角色/李四.md")).toBe(false);
  });

  it("matches by path suffix so legacy / absolute paths still resolve", () => {
    const rules: BookRules = {
      ...baseRules,
      roleLock: {
        preventAdd: false,
        preventDelete: false,
        lockedRoles: [{ path: "主要角色/张三.md", locked: true }],
      },
    };
    expect(isRoleLocked(rules, "story/主要角色/张三.md")).toBe(true);
  });
});

describe("getRoleLock", () => {
  it("returns the configured role lock when present", () => {
    const cfg = { preventAdd: true, preventDelete: true, lockedRoles: [] };
    const rules: BookRules = { ...baseRules, roleLock: cfg };
    expect(getRoleLock(rules)).toEqual(cfg);
  });

  it("returns a safe default when the role lock is absent", () => {
    expect(getRoleLock(baseRules)).toEqual({
      preventAdd: false,
      preventDelete: false,
      lockedRoles: [],
    });
  });
});

describe("parseBookRules / tryParseBookRulesFrontmatter with roleLock", () => {
  it("round-trips roleLock through YAML frontmatter", () => {
    const raw = `---
version: "1.0"
roleLock:
  preventAdd: true
  preventDelete: true
  lockedRoles:
    - path: "主要角色/张三.md"
      locked: true
    - path: "次要角色/王五.md"
      locked: false
---

# Body
`;
    const parsed = tryParseBookRulesFrontmatter(raw);
    expect(parsed).not.toBeNull();
    const roleLock = parsed?.rules.roleLock;
    expect(roleLock).toBeDefined();
    expect(roleLock?.preventAdd).toBe(true);
    expect(roleLock?.preventDelete).toBe(true);
    expect(roleLock?.lockedRoles).toEqual([
      { path: "主要角色/张三.md", locked: true },
      { path: "次要角色/王五.md", locked: false },
    ]);
    expect(isRoleLocked(parsed!.rules, "主要角色/张三.md")).toBe(true);
    expect(isRoleLocked(parsed!.rules, "次要角色/王五.md")).toBe(false);
  });

  it("applies the roleLock defaults when the frontmatter omits the block", () => {
    const raw = `---
version: "1.0"
prohibitions: []
---

# Body
`;
    const parsed = parseBookRules(raw);
    expect(parsed).not.toBeNull();
    expect(getRoleLock(parsed!.rules)).toEqual({
      preventAdd: false,
      preventDelete: false,
      lockedRoles: [],
    });
  });
});
