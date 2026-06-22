import { useEffect, useState } from "react";
import { fetchJson, postApi } from "../../hooks/use-api";
import { useChatStore } from "../../store/chat";
import { SidebarCard } from "./SidebarCard";
import { cn } from "../../lib/utils";
import { Plus, Trash2 } from "lucide-react";

interface ChapterMeta {
  number: number;
  title: string;
  status: string;
  wordCount: number;
}

const STATUS_INDICATOR: Record<string, { symbol: string; color: string }> = {
  approved: { symbol: "✓", color: "text-emerald-500" },
  "ready-for-review": { symbol: "◆", color: "text-amber-500" },
  drafted: { symbol: "○", color: "text-muted-foreground" },
  "needs-revision": { symbol: "✕", color: "text-destructive" },
  imported: { symbol: "◇", color: "text-blue-500" },
};

interface ChaptersSectionProps {
  readonly bookId: string;
  readonly isZh: boolean;
}

export function ChaptersSection({ bookId, isZh }: ChaptersSectionProps) {
  const [chapters, setChapters] = useState<ReadonlyArray<ChapterMeta>>([]);
  const [creating, setCreating] = useState(false);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  const loadChapters = () => {
    fetchJson<{ chapters: ChapterMeta[] }>(`/books/${bookId}`)
      .then((data) => setChapters(data.chapters))
      .catch(() => setChapters([]));
  };

  useEffect(() => {
    loadChapters();
  }, [bookId, bookDataVersion]);

  const handleNewChapter = async () => {
    setCreating(true);
    try {
      const result = await postApi<{ chapterNumber: number }>(`/books/${bookId}/chapters/new`);
      loadChapters();
      useChatStore.getState().openChapterArtifact(result.chapterNumber);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create chapter");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteChapter = async (num: number) => {
    const confirmed = window.confirm(
      isZh
        ? `删除第 ${num} 章？此操作不可撤销。`
        : `Delete chapter ${num}? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await fetch(`/api/v1/books/${bookId}/chapters/${num}`, { method: "DELETE" });
      loadChapters();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <SidebarCard title={isZh ? "章节" : "Chapters"}>
      {chapters.length === 0 ? (
        <p className="text-[15px] leading-6 text-muted-foreground/50 italic">
          {isZh ? "暂无章节" : "No chapters"}
        </p>
      ) : (
        <ul className="space-y-1 max-h-52 overflow-y-auto overflow-x-hidden">
          {chapters.map((ch) => {
            const ind = STATUS_INDICATOR[ch.status] ?? { symbol: "○", color: "text-muted-foreground" };
            return (
              <li
                key={`${ch.number}-${ch.title ?? ""}`}
                onClick={() => useChatStore.getState().openChapterArtifact(ch.number)}
                className="group flex items-center gap-2 py-1 text-[15px] leading-6 text-muted-foreground cursor-pointer hover:text-foreground transition-colors rounded px-1 -mx-1 hover:bg-secondary/50"
              >
                <span className={cn("text-[13px] shrink-0", ind.color)}>{ind.symbol}</span>
                <span className="truncate flex-1">
                  {String(ch.number).padStart(2, "0")} {ch.title || (isZh ? `第${ch.number}章` : `Chapter ${ch.number}`)}
                </span>
                <span className="tabular-nums text-[13px] text-muted-foreground/50 shrink-0">
                  {(ch.wordCount ?? 0).toLocaleString()}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteChapter(ch.number);
                  }}
                  className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground/0 group-hover:text-muted-foreground/40 hover:!text-destructive transition-all shrink-0"
                  title={isZh ? "删除章节" : "Delete chapter"}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        onClick={handleNewChapter}
        disabled={creating}
        className="w-full flex items-center gap-2 px-2.5 py-2 mt-2 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-foreground text-sm disabled:opacity-50"
      >
        <Plus size={14} />
        {creating
          ? (isZh ? "创建中…" : "Creating…")
          : (isZh ? "新建章节" : "New Chapter")}
      </button>
    </SidebarCard>
  );
}
