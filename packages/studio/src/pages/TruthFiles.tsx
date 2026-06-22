import { fetchJson, useApi } from "../hooks/use-api";
import { useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Pencil, Save, X, Plus, Trash2 } from "lucide-react";

interface TruthFile {
  readonly name: string;
  readonly size: number;
  readonly preview: string;
  readonly legacy?: boolean;
  readonly readonly?: boolean;
  readonly readonlyReason?: string;
}

// Phase 5 hotfix: shim files are read-only — point users at the
// authoritative outline/* path so edits actually land where the runtime
// reads them.
export const SHIM_AUTHORITATIVE_PATH: Readonly<Record<string, string>> = {
  "story_bible.md": "outline/story_frame.md",
  "book_rules.md": "outline/story_frame.md",
};

/**
 * Phase hotfix 2: when the GET response carries `legacy: true`, the file is
 * a Phase 5 compat shim. The UI must hide the Edit button and surface a
 * warning pointing at the authoritative outline path. This helper centralizes
 * the rule so it's unit-testable without a DOM.
 */
export interface FilePresentation {
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly legacy: boolean;
  readonly authoritativePath: string | null;
  readonly readonly: boolean;
  readonly readonlyReason: string | null;
}

export function deriveFilePresentation(
  fileName: string | null,
  fileData: { content: string | null; legacy?: boolean; readonly?: boolean; readonlyReason?: string } | null | undefined,
): FilePresentation {
  const legacy = fileData?.legacy === true;
  const readonly = fileData?.readonly === true;
  const isRuntimeDiagnostic = fileData?.readonlyReason === "runtime-diagnostic";
  const authoritativePath = fileName ? SHIM_AUTHORITATIVE_PATH[fileName] ?? null : null;
  // Edit only makes sense when we actually have content.
  const canEdit = !!fileName && !!fileData && fileData.content != null;
  // Delete is allowed for everything except runtime diagnostics.
  const canDelete = !!fileName && !isRuntimeDiagnostic;
  return {
    canEdit,
    canDelete,
    legacy,
    authoritativePath,
    readonly,
    readonlyReason: readonly ? fileData?.readonlyReason ?? "readonly" : null,
  };
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

type NewFileLocation = "story" | "major" | "minor" | "outline";

export function TruthFiles({ bookId, nav, theme, t }: { bookId: string; nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, refetch: refetchList } = useApi<{ files: ReadonlyArray<TruthFile> }>(`/books/${bookId}/truth`);
  const [selected, setSelected] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // New file state
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileLocation, setNewFileLocation] = useState<NewFileLocation>("story");

  const { data: fileData, refetch: refetchFile } = useApi<{ file: string; content: string | null; legacy?: boolean; readonly?: boolean; readonlyReason?: string }>(
    selected ? `/books/${bookId}/truth/${selected}` : "",
  );

  const presentation = deriveFilePresentation(selected, fileData);
  const isLegacyShim = presentation.legacy;
  const isRuntimeDiagnostic = presentation.readonlyReason === "runtime-diagnostic";

  const startEdit = () => {
    setEditText(fileData?.content ?? "");
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    setSavingEdit(true);
    try {
      await fetchJson(`/books/${bookId}/truth/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editText }),
      });
      setEditMode(false);
      refetchFile();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (fileName: string) => {
    setConfirmDelete(null);
    try {
      const res = await fetch(`/api/v1/books/${bookId}/truth/${encodeURIComponent(fileName)}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `${res.status}`);
      }
      if (selected === fileName) {
        setSelected(null);
        setEditMode(false);
      }
      refetchList();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handleCreateFile = async () => {
    const name = newFileName.trim();
    if (!name) return;

    let filePath: string;
    if (newFileLocation === "major") {
      filePath = `roles/主要角色/${name}.md`;
    } else if (newFileLocation === "minor") {
      filePath = `roles/次要角色/${name}.md`;
    } else if (newFileLocation === "outline") {
      filePath = `outline/${name}.md`;
    } else {
      filePath = name.endsWith(".md") ? name : `${name}.md`;
    }

    try {
      await fetchJson(`/books/${bookId}/truth/${filePath}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `# ${name}\n\n` }),
      });
      setShowNewFile(false);
      setNewFileName("");
      setSelected(filePath);
      setEditMode(true);
      setEditText(`# ${name}\n\n`);
      refetchList();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create file");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("truth.title")}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="font-serif text-3xl">{t("truth.title")}</h1>
        <button
          onClick={() => setShowNewFile(!showNewFile)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ${c.btnSecondary}`}
        >
          <Plus size={14} />
          New File
        </button>
      </div>

      {/* New file form */}
      {showNewFile && (
        <div className="border border-primary/20 bg-primary/5 rounded-lg p-4 space-y-3">
          <div className="text-xs font-medium text-primary">
            Create new truth file
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="File name (e.g. new_character)"
              className="flex-1 px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateFile(); }}
            />
            <select
              value={newFileLocation}
              onChange={(e) => setNewFileLocation(e.target.value as NewFileLocation)}
              className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
            >
              <option value="major">主要角色</option>
              <option value="minor">次要角色</option>
              <option value="story">story/</option>
              <option value="outline">outline/</option>
            </select>
            <button
              onClick={handleCreateFile}
              disabled={!newFileName.trim()}
              className={`px-3 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}
            >
              Create
            </button>
            <button
              onClick={() => { setShowNewFile(false); setNewFileName(""); }}
              className="px-3 py-2 text-sm rounded-lg bg-secondary text-muted-foreground hover:text-foreground"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-[240px_1fr] gap-6">
        {/* File list */}
        <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
          {data?.files.map((f) => (
            <div
              key={f.name}
              className={`w-full text-left px-3 py-2.5 text-sm border-b border-border/40 transition-colors flex items-center gap-1 ${
                selected === f.name
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted/30 text-muted-foreground"
              }`}
            >
              <button
                onClick={() => { setSelected(f.name); setEditMode(false); }}
                className="flex-1 text-left truncate"
              >
                <div className="font-mono text-sm truncate">{f.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{f.size.toLocaleString()} {t("truth.chars")}</div>
              </button>
              {f.readonlyReason !== "runtime-diagnostic" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(f.name);
                  }}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground/30 hover:text-destructive transition-colors shrink-0"
                  title={t("common.delete")}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
          {(!data?.files || data.files.length === 0) && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">{t("truth.empty")}</div>
          )}
        </div>

        {/* Content viewer */}
        <div className={`border ${c.cardStatic} rounded-lg p-5 min-h-[400px] flex flex-col`}>
          {selected && fileData?.content != null ? (
            <>
              {isLegacyShim && (
                <div
                  data-testid="legacy-shim-warning"
                  className="mb-3 px-3 py-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs leading-relaxed"
                >
                  <div className="font-medium">兼容层 / Compat shim</div>
                  <div className="mt-1">
                    本文件已废弃，仅供外部读取。权威来源：
                    <code className="ml-1 px-1 py-0.5 rounded bg-background/40 font-mono">
                      {SHIM_AUTHORITATIVE_PATH[selected] ?? "outline/"}
                    </code>
                    <span className="ml-2">编辑会同步写入权威路径。</span>
                  </div>
                </div>
              )}
              {isRuntimeDiagnostic && (
                <div
                  data-testid="runtime-diagnostic-warning"
                  className="mb-3 px-3 py-2 rounded-md border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 text-xs leading-relaxed"
                >
                  <div className="font-medium">运行时诊断文件 / Runtime diagnostic</div>
                  <div className="mt-1">
                    这里展示本章写作时的上下文选择、保护层、可压缩层和预算 trace。它只用于追溯系统看了什么，不作为可编辑设定。
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end gap-2 mb-3">
                {editMode ? (
                  <>
                    <button
                      onClick={cancelEdit}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md ${c.btnSecondary}`}
                    >
                      <X size={14} />
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={savingEdit}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md ${c.btnPrimary} disabled:opacity-50`}
                    >
                      <Save size={14} />
                      {savingEdit ? t("truth.saving") : t("truth.save")}
                    </button>
                  </>
                ) : (
                  presentation.canEdit && (
                    <button
                      onClick={startEdit}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md ${c.btnSecondary}`}
                    >
                      <Pencil size={14} />
                      Edit
                    </button>
                  )
                )}
              </div>
              {editMode ? (
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className={`${c.input} flex-1 rounded-md p-3 text-sm font-mono leading-relaxed resize-none min-h-[360px]`}
                />
              ) : (
                <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono text-foreground/80">{fileData.content}</pre>
              )}
            </>
          ) : selected && fileData?.content === null ? (
            <div className="text-muted-foreground text-sm">{t("truth.notFound")}</div>
          ) : (
            <div className="text-muted-foreground/50 text-sm italic">{t("truth.selectFile")}</div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md space-y-4 shadow-2xl">
            <h3 className="font-medium text-foreground">
              {t("common.delete")} {confirmDelete}?
            </h3>
            <p className="text-sm text-muted-foreground">
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm rounded-lg bg-secondary text-muted-foreground hover:text-foreground"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="px-4 py-2 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
