import { useEffect, useRef, useState } from "react";
import { fetchJson, invalidateApiPaths, useApi, postApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useI18n } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { waitForStudioBookReady } from "../lib/book-ready";
import type { SSEMessage } from "../hooks/use-sse";
import {
  FileInput, BookCopy, Feather, BookMarked, Wand2,
  Upload, X, ChevronDown, ChevronUp, GripVertical,
  Plus, BookPlus, Loader2,
} from "lucide-react";

interface BookSummary {
  readonly id: string;
  readonly title: string;
}

interface Nav { toDashboard: () => void; toBook: (bookId: string) => void }

type Tab = "chapters" | "canon" | "fanfic" | "spinoff" | "imitation";

interface ChapterEntry {
  id: string;
  name: string;
  content: string;
  wordCount: number;
  expanded: boolean;
}

function countWords(text: string): number {
  const stripped = text.trim();
  if (!stripped) return 0;
  if (/[㐀-鿿]/.test(stripped)) {
    return stripped.replace(/\s/g, "").length;
  }
  return stripped.split(/\s+/).filter(Boolean).length;
}

function stripExt(filename: string): string {
  return filename.replace(/\.(md|txt)$/i, "").replace(/^\d+[_\-\s]*/, "");
}

let entryIdCounter = 0;
function newEntryId(): string {
  return `ch-${++entryIdCounter}-${Date.now().toString(36)}`;
}

interface ImportTask {
  id: string;
  bookId: string;
  bookTitle: string;
  step: string;
  current?: number;
  total?: number;
  status: "running" | "done" | "error";
  error?: string;
}

export function ImportManager({ nav, theme, t, initialTab, sse }: {
  nav: Nav; theme: Theme; t: TFunction; initialTab?: Tab;
  sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean };
}) {
  const c = useColors(theme);
  const { lang } = useI18n();
  const { data: booksData } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const [tab, setTab] = useState<Tab>(initialTab ?? "chapters");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  // Import task queue — tracks concurrent imports
  const [tasks, setTasks] = useState<ImportTask[]>([]);

  // Chapters state
  const [chBookId, setChBookId] = useState("");
  const [chapters, setChapters] = useState<ChapterEntry[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New chapter modal
  const [showNewChapterModal, setShowNewChapterModal] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [newChapterContent, setNewChapterContent] = useState("");

  // Create new book state
  const [createNewBook, setCreateNewBook] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState("");
  const [newBookGenre, setNewBookGenre] = useState("");
  const [newBookPlatform, setNewBookPlatform] = useState("other");

  // Canon state
  const [canonTarget, setCanonTarget] = useState("");
  const [canonFrom, setCanonFrom] = useState("");

  // Fanfic state
  const [ffTitle, setFfTitle] = useState("");
  const [ffText, setFfText] = useState("");
  const [ffMode, setFfMode] = useState("canon");
  const [ffGenre, setFfGenre] = useState("other");
  const [ffLang, setFfLang] = useState(lang);

  // Spinoff state
  const [spTitle, setSpTitle] = useState("");
  const [spParent, setSpParent] = useState("");
  const [spDirection, setSpDirection] = useState("");

  // Imitation state
  const [imTitle, setImTitle] = useState("");
  const [imRef, setImRef] = useState("");
  const [imIdea, setImIdea] = useState("");
  const [imGenre, setImGenre] = useState("other");
  const [imLang, setImLang] = useState(lang);

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
      setStatus("");
    }
  }, [initialTab]);

  // Listen for import progress via SSE — scan all new messages, not just the last
  const lastProcessedIdx = useRef(0);
  useEffect(() => {
    const msgs = sse.messages;
    for (let i = lastProcessedIdx.current; i < msgs.length; i++) {
      const msg = msgs[i]!;
      const data = msg.data as { bookId?: string; step?: string; current?: number; total?: number; error?: string; count?: number } | null;
      const bookId = data?.bookId;
      if (!bookId) continue;

      if (msg.event === "import:progress" && data?.step) {
        setTasks((prev) =>
          prev.map((t) =>
            t.bookId === bookId && t.status === "running"
              ? { ...t, step: data.step!, current: data.current, total: data.total }
              : t,
          ),
        );
      }
      if (msg.event === "import:complete") {
        setTasks((prev) =>
          prev.map((t) =>
            t.bookId === bookId && t.status === "running"
              ? { ...t, status: "done" as const, step: "done", current: t.total, total: t.total }
              : t,
          ),
        );
      }
      if (msg.event === "import:error") {
        setTasks((prev) =>
          prev.map((t) =>
            t.bookId === bookId && t.status === "running"
              ? { ...t, status: "error" as const, error: data?.error }
              : t,
          ),
        );
      }
    }
    lastProcessedIdx.current = msgs.length;
  }, [sse.messages]);

  // --- File handling ---

  const handleFiles = async (files: FileList) => {
    const newEntries: ChapterEntry[] = [];
    for (const file of Array.from(files)) {
      const content = await file.text();
      newEntries.push({
        id: newEntryId(),
        name: stripExt(file.name),
        content,
        wordCount: countWords(content),
        expanded: false,
      });
    }
    newEntries.sort((a, b) => a.name.localeCompare(b.name));
    setChapters((prev) => [...prev, ...newEntries]);
  };

  const removeChapter = (id: string) => {
    setChapters((prev) => prev.filter((ch) => ch.id !== id));
  };

  const toggleExpand = (id: string) => {
    setChapters((prev) =>
      prev.map((ch) => (ch.id === id ? { ...ch, expanded: !ch.expanded } : ch)),
    );
  };

  const renameChapter = (id: string, newName: string) => {
    setChapters((prev) =>
      prev.map((ch) => (ch.id === id ? { ...ch, name: newName } : ch)),
    );
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setChapters((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(index, 0, moved);
      return next;
    });
    setDragIndex(index);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  const clearChapters = () => {
    setChapters([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // --- New chapter modal ---

  const handleAddNewChapter = () => {
    const title = newChapterTitle.trim() || (lang === "zh"
      ? `第${chapters.length + 1}章`
      : `Chapter ${chapters.length + 1}`);
    const content = newChapterContent.trim();
    if (!content) return;

    setChapters((prev) => [
      ...prev,
      {
        id: newEntryId(),
        name: title,
        content,
        wordCount: countWords(content),
        expanded: false,
      },
    ]);
    setNewChapterTitle("");
    setNewChapterContent("");
    setShowNewChapterModal(false);
  };

  // --- Task progress helpers ---

  function taskProgressLabel(task: ImportTask): string {
    const total = task.total ?? 0;
    switch (task.step) {
      case "foundation":
        return lang === "zh" ? `生成基础设定（${total} 章）…` : `Generating foundation (${total} ch)…`;
      case "style":
        return lang === "zh" ? "提取风格指纹…" : "Extracting style…";
      case "analyze":
        return lang === "zh"
          ? `分析第 ${task.current}/${total} 章…`
          : `Analyzing ${task.current}/${total}…`;
      case "done":
        return lang === "zh" ? "完成" : "Done";
      default:
        return task.step;
    }
  }

  // --- Import handler (non-blocking, adds task to queue) ---

  const handleImportChapters = async () => {
    const targetBookId = createNewBook ? null : chBookId;
    if (createNewBook && !newBookTitle.trim()) return;
    if (!createNewBook && !targetBookId) return;
    if (chapters.length === 0) return;

    setLoading(true);
    setStatus("");
    try {
      let bookId = targetBookId;
      const bookTitle = createNewBook ? newBookTitle.trim() : (booksData?.books.find((b) => b.id === targetBookId)?.title ?? "");

      // Step 1: Create new book if needed
      if (createNewBook) {
        setStatus(lang === "zh" ? "正在创建书籍…" : "Creating book…");
        const created = await fetchJson<{ bookId?: string }>("/books/create-bare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: newBookTitle.trim(),
            genre: newBookGenre.trim() || (lang === "zh" ? "其他" : "other"),
            platform: newBookPlatform,
            language: lang,
          }),
        });
        if (!created.bookId) throw new Error("Book creation failed");
        bookId = created.bookId;
      }

      if (!bookId) throw new Error("No book ID");

      // Add task to queue
      const taskId = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const newTask: ImportTask = {
        id: taskId,
        bookId,
        bookTitle,
        step: "starting",
        status: "running",
      };
      setTasks((prev) => [...prev, newTask]);

      // Clear form
      setStatus("");
      setChapters([]);
      setChBookId("");
      setCreateNewBook(false);
      setNewBookTitle("");
      setNewBookGenre("");

      // Step 2: Start import (fire-and-forget — SSE events track progress)
      void fetchJson<{ importedCount?: number }>(
        `/books/${bookId}/import/chapters`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chapters: chapters.map((ch) => ({ title: ch.name, content: ch.content })),
          }),
        },
      ).catch((e) => {
        // If the fetch itself fails (network error), mark task as error
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: "error" as const, error: String(e) } : t,
          ),
        );
      });

      invalidateApiPaths(["/api/v1/books"]);
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleImportCanon = async () => {
    if (!canonTarget || !canonFrom) return;
    setLoading(true);
    setStatus("");
    try {
      await postApi(`/books/${canonTarget}/import/canon`, { fromBookId: canonFrom });
      setStatus("Canon imported successfully!");
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleFanficInit = async () => {
    if (!ffTitle.trim() || !ffText.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await fetchJson<{ bookId?: string }>("/fanfic/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: ffTitle, sourceText: ffText, mode: ffMode,
          genre: ffGenre, language: ffLang,
        }),
      });
      if (data.bookId) {
        setStatus(`${t("import.creating")}: ${data.bookId}`);
        await waitForStudioBookReady(data.bookId);
        setStatus(`${t("import.fanficDone")}: ${data.bookId}`);
        invalidateApiPaths(["/api/v1/books", `/api/v1/books/${data.bookId}`]);
        nav.toBook(data.bookId);
      }
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleSpinoffInit = async () => {
    if (!spTitle.trim() || !spParent) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await postApi<{ bookId?: string }>("/spinoff/init", { title: spTitle, parentBookId: spParent, direction: spDirection || undefined });
      if (data.bookId) {
        setStatus(`${t("import.creating")}: ${data.bookId}`);
        await waitForStudioBookReady(data.bookId);
        setStatus(`${t("import.spinoffDone")}: ${data.bookId}`);
        invalidateApiPaths(["/api/v1/books", `/api/v1/books/${data.bookId}`]);
        nav.toBook(data.bookId);
      }
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const handleImitationInit = async () => {
    if (!imTitle.trim() || !imRef.trim() || !imIdea.trim()) return;
    setLoading(true);
    setStatus("");
    try {
      const data = await postApi<{ bookId?: string }>("/imitation/init", { title: imTitle, referenceText: imRef, storyIdea: imIdea, genre: imGenre, language: imLang });
      if (data.bookId) {
        setStatus(`${t("import.creating")}: ${data.bookId}`);
        await waitForStudioBookReady(data.bookId);
        setStatus(`${t("import.imitationDone")}: ${data.bookId}`);
        invalidateApiPaths(["/api/v1/books", `/api/v1/books/${data.bookId}`]);
        nav.toBook(data.bookId);
      }
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLoading(false);
  };

  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
  const canImport = createNewBook
    ? newBookTitle.trim() && chapters.length > 0
    : chBookId && chapters.length > 0;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "chapters", label: t("import.chapters"), icon: <FileInput size={14} /> },
    { id: "canon", label: t("import.canon"), icon: <BookCopy size={14} /> },
    { id: "fanfic", label: t("import.fanfic"), icon: <Feather size={14} /> },
    { id: "spinoff", label: t("import.spinoff"), icon: <BookMarked size={14} /> },
    { id: "imitation", label: t("import.imitation"), icon: <Wand2 size={14} /> },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("nav.import")}</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-3xl flex items-center gap-3">
          <FileInput size={28} className="text-primary" />
          {t("import.title")}
        </h1>

        {/* Import task queue */}
        {tasks.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all ${
                  task.status === "running"
                    ? "bg-primary/5 border-primary/20"
                    : task.status === "done"
                      ? "bg-emerald-500/10 border-emerald-500/20"
                      : "bg-destructive/10 border-destructive/20"
                }`}
              >
                {task.status === "running" && (
                  <Loader2 size={12} className="text-primary animate-spin shrink-0" />
                )}
                {task.status === "done" && (
                  <span className="text-emerald-600 shrink-0">✓</span>
                )}
                {task.status === "error" && (
                  <span className="text-destructive shrink-0">✗</span>
                )}
                <span className="font-medium text-foreground truncate max-w-[120px]" title={task.bookTitle}>
                  {task.bookTitle}
                </span>
                <span className="text-muted-foreground">
                  {task.status === "running"
                    ? taskProgressLabel(task)
                    : task.status === "done"
                      ? (lang === "zh" ? "完成" : "Done")
                      : (lang === "zh" ? "失败" : "Failed")}
                </span>
                {task.status === "running" && task.total && task.current != null && (
                  <span className="text-muted-foreground tabular-nums">
                    {task.current}/{task.total}
                  </span>
                )}
                {/* Dismiss completed/failed tasks */}
                {task.status !== "running" && (
                  <button
                    onClick={() => setTasks((prev) => prev.filter((t) => t.id !== task.id))}
                    className="ml-1 text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-secondary/30 rounded-lg p-1 w-fit">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => { setTab(tb.id); setStatus(""); }}
            className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${
              tab === tb.id ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tb.icon} {tb.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className={`border ${c.cardStatic} rounded-lg p-6 space-y-4`}>
        {tab === "chapters" && (
          <>
            {/* Target book selector */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                {lang === "zh" ? "目标书籍" : "Target Book"}
              </label>
              <select
                value={createNewBook ? "__new__" : chBookId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setCreateNewBook(true);
                    setChBookId("");
                  } else {
                    setCreateNewBook(false);
                    setChBookId(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
              >
                <option value="">{lang === "zh" ? "选择已有书籍…" : "Select existing book…"}</option>
                {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                <option value="__new__">＋ {lang === "zh" ? "创建新书" : "Create new book"}</option>
              </select>
            </div>

            {/* New book fields */}
            {createNewBook && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="text-xs font-medium text-primary flex items-center gap-1.5">
                  <BookPlus size={14} />
                  {lang === "zh" ? "新书信息" : "New Book Info"}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <input
                    type="text"
                    value={newBookTitle}
                    onChange={(e) => setNewBookTitle(e.target.value)}
                    placeholder={lang === "zh" ? "书名" : "Title"}
                    className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
                  />
                  <input
                    type="text"
                    value={newBookGenre}
                    onChange={(e) => setNewBookGenre(e.target.value)}
                    placeholder={lang === "zh" ? "题材" : "Genre"}
                    className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
                  />
                  <select
                    value={newBookPlatform}
                    onChange={(e) => setNewBookPlatform(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
                  >
                    <option value="other">{lang === "zh" ? "其他" : "Other"}</option>
                    <option value="tomato">番茄小说</option>
                    <option value="qidian">起点中文网</option>
                    <option value="feilu">飞卢</option>
                    <option value="royal-road">Royal Road</option>
                    <option value="kindle-unlimited">Kindle Unlimited</option>
                    <option value="scribble-hub">Scribble Hub</option>
                  </select>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowNewChapterModal(true)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg ${c.btnSecondary}`}
              >
                <Plus size={14} />
                {lang === "zh" ? "新建章节" : "New Chapter"}
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg ${c.btnSecondary}`}
              >
                <Upload size={14} />
                {lang === "zh" ? "上传文件" : "Upload Files"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".txt,.md"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {/* Drop zone */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
              }}
              className="border-2 border-dashed border-border/40 rounded-lg p-6 text-center hover:border-primary/40 transition-colors"
            >
              <Upload size={20} className="mx-auto text-muted-foreground/30 mb-1" />
              <p className="text-xs text-muted-foreground/50">
                {lang === "zh" ? "拖拽文件到此处" : "Drag files here"}
              </p>
            </div>

            {/* Chapter list */}
            {chapters.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {lang === "zh"
                      ? `已添加 ${chapters.length} 章（共 ${totalWords.toLocaleString()} 字）`
                      : `${chapters.length} chapter(s) (${totalWords.toLocaleString()} words)`}
                  </span>
                  <button onClick={clearChapters} className="text-destructive hover:underline">
                    {lang === "zh" ? "清空" : "Clear all"}
                  </button>
                </div>

                <div className="space-y-1">
                  {chapters.map((ch, index) => (
                    <div
                      key={ch.id}
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnd={handleDragEnd}
                      className={`rounded-lg border bg-card/50 transition-all ${
                        dragIndex === index ? "border-primary/40 shadow-sm" : "border-border/40"
                      }`}
                    >
                      <div className="flex items-center gap-2 px-3 py-2">
                        <GripVertical size={14} className="text-muted-foreground/30 cursor-grab shrink-0" />
                        <span className="text-xs text-muted-foreground/50 font-mono w-6 shrink-0">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <input
                          type="text"
                          value={ch.name}
                          onChange={(e) => renameChapter(ch.id, e.target.value)}
                          className="flex-1 text-sm bg-transparent border-none outline-none focus:ring-0 px-0"
                        />
                        <span className="text-xs text-muted-foreground/50 tabular-nums shrink-0">
                          {ch.wordCount.toLocaleString()} {lang === "zh" ? "字" : "w"}
                        </span>
                        <button
                          onClick={() => toggleExpand(ch.id)}
                          className="p-1 rounded hover:bg-secondary/50 text-muted-foreground/50 hover:text-foreground transition-colors"
                        >
                          {ch.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button
                          onClick={() => removeChapter(ch.id)}
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      {ch.expanded && (
                        <div className="px-3 pb-3 pt-0">
                          <div className="text-xs text-muted-foreground/70 bg-secondary/20 rounded p-3 max-h-48 overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap">
                            {ch.content.slice(0, 1000)}
                            {ch.content.length > 1000 && <span className="text-muted-foreground/40">…</span>}
                          </div>
                        </div>
                      )}

                      {!ch.expanded && ch.content.trim() && (
                        <div className="px-3 pb-2 pt-0">
                          <p className="text-xs text-muted-foreground/40 truncate">
                            {ch.content.split("\n").find((l) => l.trim())?.slice(0, 80)}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleImportChapters}
              disabled={loading || !canImport}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}
            >
              {loading
                ? (lang === "zh" ? "准备中…" : "Preparing…")
                : (lang === "zh" ? "开始导入" : "Start Import")}
            </button>
          </>
        )}

        {tab === "canon" && (
          <>
            <select value={canonFrom} onChange={(e) => setCanonFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
              <option value="">{t("import.selectSource")}</option>
              {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <select value={canonTarget} onChange={(e) => setCanonTarget(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
              <option value="">{t("import.selectDerivative")}</option>
              {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <button onClick={handleImportCanon} disabled={loading || !canonTarget || !canonFrom}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}>
              {loading ? t("import.importing") : t("import.canon")}
            </button>
          </>
        )}

        {tab === "fanfic" && (
          <>
            <input type="text" value={ffTitle} onChange={(e) => setFfTitle(e.target.value)}
              placeholder={t("import.fanficTitle")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
            />
            <div className="grid grid-cols-3 gap-3">
              <select value={ffMode} onChange={(e) => setFfMode(e.target.value)}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                <option value="canon">原著向</option>
                <option value="au">架空 AU</option>
                <option value="ooc">性格偏离 OOC</option>
                <option value="cp">配对 CP</option>
              </select>
              <select value={ffGenre} onChange={(e) => setFfGenre(e.target.value)}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                <option value="other">其他</option>
                <option value="xuanhuan">玄幻</option>
                <option value="urban">都市</option>
                <option value="xianxia">仙侠</option>
              </select>
              <select value={ffLang} onChange={(e) => setFfLang(e.target.value as "zh" | "en")}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <textarea value={ffText} onChange={(e) => setFfText(e.target.value)} rows={10}
              placeholder={t("import.pasteMaterial")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm resize-none font-mono"
            />
            <button onClick={handleFanficInit} disabled={loading || !ffTitle.trim() || !ffText.trim()}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}>
              {loading ? t("import.creating") : t("import.fanfic")}
            </button>
          </>
        )}

        {tab === "spinoff" && (
          <>
            <p className="text-xs text-muted-foreground">{t("import.spinoffHint")}</p>
            <input type="text" value={spTitle} onChange={(e) => setSpTitle(e.target.value)}
              placeholder={t("import.spinoffTitle")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
            />
            <select value={spParent} onChange={(e) => setSpParent(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
              <option value="">{t("import.selectParent")}</option>
              {booksData?.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <textarea value={spDirection} onChange={(e) => setSpDirection(e.target.value)} rows={5}
              placeholder={t("import.spinoffDirection")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm resize-none"
            />
            <button onClick={handleSpinoffInit} disabled={loading || !spTitle.trim() || !spParent}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}>
              {loading ? t("import.creating") : t("import.spinoff")}
            </button>
          </>
        )}

        {tab === "imitation" && (
          <>
            <p className="text-xs text-muted-foreground">{t("import.imitationHint")}</p>
            <input type="text" value={imTitle} onChange={(e) => setImTitle(e.target.value)}
              placeholder={t("import.imitationTitle")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
            />
            <div className="grid grid-cols-2 gap-3">
              <select value={imGenre} onChange={(e) => setImGenre(e.target.value)}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                <option value="other">其他</option>
                <option value="xuanhuan">玄幻</option>
                <option value="urban">都市</option>
                <option value="xianxia">仙侠</option>
              </select>
              <select value={imLang} onChange={(e) => setImLang(e.target.value as "zh" | "en")}
                className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm">
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <textarea value={imIdea} onChange={(e) => setImIdea(e.target.value)} rows={4}
              placeholder={t("import.imitationIdea")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm resize-none"
            />
            <textarea value={imRef} onChange={(e) => setImRef(e.target.value)} rows={8}
              placeholder={t("import.imitationRef")}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm resize-none font-mono"
            />
            <button onClick={handleImitationInit} disabled={loading || !imTitle.trim() || !imRef.trim() || !imIdea.trim()}
              className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}>
              {loading ? t("import.creating") : t("import.imitation")}
            </button>
          </>
        )}

        {status && (
          <div className={`text-sm px-3 py-2 rounded-lg ${status.startsWith("Error") ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600"}`}>
            {status}
          </div>
        )}
      </div>

      {/* New Chapter Modal */}
      {showNewChapterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-xl p-6 max-w-2xl w-full mx-4 space-y-4 shadow-2xl max-h-[80vh] flex flex-col">
            <h3 className="font-medium text-foreground">
              {lang === "zh" ? "新建章节" : "New Chapter"}
            </h3>
            <input
              type="text"
              value={newChapterTitle}
              onChange={(e) => setNewChapterTitle(e.target.value)}
              placeholder={lang === "zh" ? "章节标题（可选）" : "Chapter title (optional)"}
              className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-border text-sm"
            />
            <textarea
              value={newChapterContent}
              onChange={(e) => setNewChapterContent(e.target.value)}
              placeholder={lang === "zh" ? "粘贴章节内容…" : "Paste chapter content…"}
              className="flex-1 min-h-[300px] w-full px-3 py-3 rounded-lg bg-secondary/30 border border-border text-sm font-mono leading-relaxed resize-none"
              autoFocus
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">
                {newChapterContent.trim()
                  ? `${countWords(newChapterContent).toLocaleString()} ${lang === "zh" ? "字" : "words"}`
                  : ""}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowNewChapterModal(false); setNewChapterTitle(""); setNewChapterContent(""); }}
                  className="px-4 py-2 text-sm rounded-lg bg-secondary text-muted-foreground hover:text-foreground"
                >
                  {lang === "zh" ? "取消" : "Cancel"}
                </button>
                <button
                  onClick={handleAddNewChapter}
                  disabled={!newChapterContent.trim()}
                  className={`px-4 py-2 text-sm rounded-lg ${c.btnPrimary} disabled:opacity-30`}
                >
                  {lang === "zh" ? "添加" : "Add"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
