import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlayStartTool,
  createPlayStepTool,
} from "../agent/agent-tools.js";
import { PlayStore } from "../play/play-store.js";
import type { PlayStepResult } from "../play/play-runner.js";

const STEP_RESULT: PlayStepResult = {
  sceneText: "你翻开账本，发现最后一页夹着一张旧船票。",
  suggestedActions: ["藏起船票", "追问送账本的人"],
  action: {
    actionKind: "look",
    intent: "查看账本",
    manner: "",
    risk: "",
    ambiguity: "",
    secondaryActions: [],
  },
  mutation: {
    eventId: "evt-1",
    turn: 1,
    actionKind: "look",
    summary: "玩家发现旧船票。",
    entities: { upsert: [] },
    edges: { upsert: [], expire: [] },
    stateSlots: { upsert: [] },
    evidence: { transitions: [] },
    blocked: false,
    blockedReason: "",
    notes: [],
  },
};

function pipelineStub() {
  return { createAgentContext: vi.fn(() => ({})) } as any;
}

describe("agent play tools", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-agent-play-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("binds the new play world to the chat session and persists the opening scene", async () => {
    const sessionId = "1700000000000-aaaa01";
    const tool = createPlayStartTool(root, sessionId);
    const result = await tool.execute("tc-start", {
      title: "雨夜茶馆",
      premise: "玩家扮演欠债茶馆老板，雨夜有人带着账本上门。",
      mode: "open",
      initialScene: "雨一直下，柜台上的账本被敲了三下。",
      suggestedActions: ["查看账本", "问来人是谁"],
    });

    // worldId is the sessionId — the world is bound 1:1 to this chat session.
    expect(result.details).toMatchObject({
      kind: "play_world_started",
      worldId: sessionId,
      runId: "main",
      title: "雨夜茶馆",
      sceneText: "雨一直下，柜台上的账本被敲了三下。",
    });

    const store = new PlayStore(root);
    await expect(store.loadWorld(sessionId)).resolves.toMatchObject({
      title: "雨夜茶馆",
      mode: "open",
    });
    await expect(store.readTranscript(sessionId, "main")).resolves.toMatchObject([
      { role: "assistant", content: "雨一直下，柜台上的账本被敲了三下。" },
    ]);
    await expect(store.readProjection(sessionId, "main", "projections/scene.md"))
      .resolves.toContain("雨一直下");
  });

  it("advances the play world bound to the session", async () => {
    const sessionId = "1700000000000-bbbb02";
    const store = new PlayStore(root);
    await store.createWorld({
      id: sessionId,
      title: "雨夜茶馆",
      premise: "玩家扮演茶馆老板。",
      mode: "open",
    });
    await store.ensureRun(sessionId, "main");
    await store.writeProjection(sessionId, "main", "projections/scene.md", "柜台上有一本潮湿账本。\n");

    const runnerFactory = vi.fn(() => ({ step: vi.fn(async () => STEP_RESULT) }));
    const tool = createPlayStepTool(pipelineStub(), root, sessionId, { runnerFactory });

    const result = await tool.execute("tc-step", {
      input: "我翻开账本看最后一页",
    });

    expect(runnerFactory).toHaveBeenCalledWith(expect.objectContaining({
      worldId: sessionId,
      runId: "main",
    }));
    expect(result.details).toMatchObject({
      kind: "play_turn_advanced",
      worldId: sessionId,
      runId: "main",
      sceneText: "你翻开账本，发现最后一页夹着一张旧船票。",
    });
  });

  it("uses the player-chosen playMode for the world, overriding the tool param", async () => {
    const sessionId = "1700000000000-cccc03";
    const tool = createPlayStartTool(root, sessionId, "guided");
    await tool.execute("tc-mode", { title: "选项局", initialScene: "开场。" });
    const store = new PlayStore(root);
    await expect(store.loadWorld(sessionId)).resolves.toMatchObject({ mode: "guided" });
  });

  it("advances each session's own world, not the most recently created one", async () => {
    // Regression: play_step used to pick the globally newest world, so two
    // concurrent play sessions would advance each other's world. The world is
    // now bound to the session id, so session A always advances A's world even
    // when session B's world was created later.
    const sessionA = "1700000000000-aaaaaa";
    const sessionB = "1700000000001-bbbbbb";

    await createPlayStartTool(root, sessionA).execute("tc-a", {
      title: "世界A",
      initialScene: "A 的开场。",
    });
    // World B is created AFTER A, so it is the most-recently-updated world.
    await createPlayStartTool(root, sessionB).execute("tc-b", {
      title: "世界B",
      initialScene: "B 的开场。",
    });

    const runnerFactory = vi.fn(() => ({ step: vi.fn(async () => STEP_RESULT) }));
    const tool = createPlayStepTool(pipelineStub(), root, sessionA, { runnerFactory });
    const result = await tool.execute("tc-step-a", { input: "我在 A 世界行动" });

    expect(runnerFactory).toHaveBeenCalledWith(expect.objectContaining({
      worldId: sessionA,
    }));
    expect(result.details).toMatchObject({
      kind: "play_turn_advanced",
      worldId: sessionA,
    });
  });
});
