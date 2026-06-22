import {
	ChevronDown,
	Lock,
	Pencil,
	Settings,
	ShieldCheck,
	Trash2,
	Unlock,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "../../hooks/use-api";
import { type RoleRef, roleFromPath } from "../../lib/truth-display";
import { cn } from "../../lib/utils";
import { useChatStore } from "../../store/chat";
import { SidebarCard } from "./SidebarCard";

interface RoleLockEntry {
	path: string;
	locked: boolean;
}
interface RoleLockConfig {
	preventAdd: boolean;
	preventDelete: boolean;
	lockedRoles: RoleLockEntry[];
}

interface CharacterInfo {
	name: string;
	fields: Record<string, string>;
}

function parseCharacterMatrix(md: string): CharacterInfo[] {
	const characters: CharacterInfo[] = [];
	// Split by ## headings (level 2 only)
	const sections = md.split(/^## /m).slice(1);
	for (const section of sections) {
		const lines = section.split("\n");
		const name = lines[0].trim();
		if (!name) continue;
		const fields: Record<string, string> = {};
		for (let i = 1; i < lines.length; i++) {
			const match = lines[i].match(/^-\s+\*\*(.+?)\*\*:\s*(.+)/);
			if (match) {
				fields[match[1]] = match[2].trim();
			}
		}
		characters.push({ name, fields });
	}
	return characters;
}

const ROLE_COLORS: Record<string, string> = {
	主角: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
	反派: "bg-red-500/15 text-red-600 dark:text-red-400",
	盟友: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
	配角: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
	提及: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
	protagonist: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
	antagonist: "bg-red-500/15 text-red-600 dark:text-red-400",
	ally: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
	minor: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
	mentioned: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

function getRoleColor(role: string): string {
	const lower = role.toLowerCase().trim();
	for (const [key, color] of Object.entries(ROLE_COLORS)) {
		if (lower.includes(key)) return color;
	}
	return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400";
}

const TIER_BADGE: Record<RoleRef["tier"], { label: string; color: string }> = {
	major: {
		label: "主要",
		color: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
	},
	minor: {
		label: "次要",
		color: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
	},
};

// Phase 5 layout: one file per character under roles/. Each entry opens the
// full (humanized) character sheet — no raw matrix parsing needed.
function RoleEntry({ role }: { readonly role: RoleRef }) {
	const openArtifact = useChatStore((s) => s.openArtifact);
	const badge = TIER_BADGE[role.tier];
	return (
		<button
			onClick={() => openArtifact(role.path)}
			className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
		>
			<Users size={16} className="shrink-0 text-muted-foreground/60" />
			<span className="text-[15px] leading-6 font-medium text-foreground font-['SimSun','Songti_SC','STSong',serif] flex-1 truncate">
				{role.name}
			</span>
			<span
				className={cn(
					"text-[12px] px-1.5 py-0.5 rounded-full shrink-0",
					badge.color,
				)}
			>
				{badge.label}
			</span>
		</button>
	);
}

function CharacterCard({ char }: { readonly char: CharacterInfo }) {
	const [expanded, setExpanded] = useState(false);
	const role = char.fields["定位"] ?? char.fields["Role"] ?? "";
	const tags = char.fields["标签"] ?? char.fields["Tags"] ?? "";
	const current = char.fields["当前"] ?? char.fields["Current"] ?? "";

	return (
		<div className="rounded-lg bg-secondary/30 overflow-hidden">
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
			>
				<Users size={16} className="shrink-0 text-muted-foreground/60" />
				<span className="text-[15px] leading-6 font-medium text-foreground font-['SimSun','Songti_SC','STSong',serif] flex-1 truncate">
					{char.name}
				</span>
				{role && (
					<span
						className={cn(
							"text-[12px] px-1.5 py-0.5 rounded-full shrink-0",
							getRoleColor(role),
						)}
					>
						{role.split("/")[0].trim()}
					</span>
				)}
				<ChevronDown
					size={14}
					className={cn(
						"text-muted-foreground/50 transition-transform shrink-0",
						expanded && "rotate-180",
					)}
				/>
			</button>
			{expanded && (
				<div className="px-2.5 pb-2.5 space-y-1">
					{tags && (
						<p className="text-[14px] leading-6 text-muted-foreground">
							<span className="text-muted-foreground/60">标签</span> {tags}
						</p>
					)}
					{current && (
						<p className="text-[14px] leading-6 text-muted-foreground">
							<span className="text-muted-foreground/60">当前</span> {current}
						</p>
					)}
					{Object.entries(char.fields)
						.filter(
							([k]) =>
								!["定位", "Role", "标签", "Tags", "当前", "Current"].includes(
									k,
								),
						)
						.map(([key, val]) => (
							<p
								key={key}
								className="text-[14px] leading-6 text-muted-foreground"
							>
								<span className="text-muted-foreground/60">{key}</span> {val}
							</p>
						))}
				</div>
			)}
		</div>
	);
}

// ---- Role Management Modal ----

function RoleManageModal({
	bookId,
	onClose,
}: {
	readonly bookId: string;
	readonly onClose: () => void;
}) {
	const openArtifact = useChatStore((s) => s.openArtifact);
	const [roles, setRoles] = useState<ReadonlyArray<RoleRef>>([]);
	const [legacyChars, setLegacyChars] = useState<CharacterInfo[]>([]);
	const [roleLock, setRoleLock] = useState<RoleLockConfig>({
		preventAdd: false,
		preventDelete: false,
		lockedRoles: [],
	});
	const [bookRulesRaw, setBookRulesRaw] = useState<string>("");
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

	// Load roles and lock config
	useEffect(() => {
		let cancelled = false;
		fetchJson<{ files: ReadonlyArray<{ name: string }> }>(
			`/books/${bookId}/truth`,
		)
			.then(async (data) => {
				if (cancelled) return;
				const refs = data.files
					.map((f) => roleFromPath(f.name))
					.filter((r): r is RoleRef => r !== null)
					.sort((a, b) =>
						a.tier === b.tier
							? a.name.localeCompare(b.name)
							: a.tier === "major"
								? -1
								: 1,
					);
				if (refs.length > 0) {
					setRoles(refs);
					return;
				}
				const matrix = await fetchJson<{ content: string | null }>(
					`/books/${bookId}/truth/character_matrix.md`,
				).catch(() => ({ content: null }));
				if (!cancelled && matrix.content) {
					setLegacyChars(parseCharacterMatrix(matrix.content));
				}
			})
			.catch(() => {
				if (!cancelled) setRoles([]);
			});

		fetchJson<{
			content: string | null;
			frontmatter?: Record<string, unknown>;
		}>(`/books/${bookId}/truth/book_rules.md`)
			.then((data) => {
				if (data.content) {
					setBookRulesRaw(data.content);
					if (data.frontmatter?.roleLock)
						setRoleLock(data.frontmatter.roleLock as RoleLockConfig);
				}
			})
			.catch(() => {});

		return () => { cancelled = true; };
	}, [bookId]);

	const saveRoleLock = useCallback(
		async (newLock: RoleLockConfig) => {
			let updated = bookRulesRaw;
			const yaml = `roleLock:\n  preventAdd: ${newLock.preventAdd}\n  preventDelete: ${newLock.preventDelete}\n  lockedRoles:${newLock.lockedRoles.length === 0 ? " []" : ""}\n${newLock.lockedRoles.map((r) => `    - path: "${r.path}"\n      locked: ${r.locked}`).join("\n")}`;
			const fm = updated.match(/^(---\s*\n)([\s\S]*?)\n(---\s*\n?)([\s\S]*)$/);
			if (fm) {
				const existing = fm[2].match(/roleLock:[\s\S]*?(?=\n\w|\n---|\n$)/);
				updated = existing
					? `${fm[1]}${fm[2].replace(existing[0], yaml)}\n${fm[3]}${fm[4]}`
					: `${fm[1]}${fm[2]}\n${yaml}\n${fm[3]}${fm[4]}`;
			} else {
				updated = `---\n${yaml}\n---\n${updated}`;
			}
			try {
				await fetchJson(`/books/${bookId}/truth/book_rules.md`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ content: updated }),
				});
				setBookRulesRaw(updated);
				setRoleLock(newLock);
			} catch (e) {
				alert(e instanceof Error ? e.message : "保存失败");
			}
		},
		[bookId, bookRulesRaw],
	);

	const isLocked = (path: string) =>
		roleLock.lockedRoles.find((r) => r.path === path)?.locked ?? false;

	// Unified per-role lock setter: the single code path used by the per-row
	// toggle, "全部锁定", and "全部解锁". Unlocking a path that isn't tracked
	// is a no-op (no need to remember unlocked roles).
	const setRoleLock = useCallback(
		async (path: string, locked: boolean) => {
			const existing = roleLock.lockedRoles.find((r) => r.path === path);
			let newRoles: ReadonlyArray<RoleLockEntry>;
			if (existing) {
				if (existing.locked === locked) return;
				newRoles = roleLock.lockedRoles.map((r) =>
					r.path === path ? { ...r, locked } : r,
				);
			} else if (locked) {
				newRoles = [...roleLock.lockedRoles, { path, locked: true }];
			} else {
				return;
			}
			await saveRoleLock({ ...roleLock, lockedRoles: newRoles });
		},
		[roleLock, saveRoleLock],
	);

	const toggleLock = async (path: string) =>
		setRoleLock(path, !isLocked(path));

	const lockAll = async () => {
		// Sequence: each setRoleLock updates `roleLock` so the next call sees
		// the latest state. Promise.all would race and the last write would
		// clobber earlier ones.
		for (const role of roles) {
			await setRoleLock(role.path, true);
		}
	};

	const unlockAll = async () => {
		const tracked = new Set(roleLock.lockedRoles.map((r) => r.path));
		// Cover any path the user might have just unlocked via per-row toggle
		// even if it isn't in `roles` anymore (e.g. character file moved).
		for (const role of roles) tracked.add(role.path);
		for (const path of tracked) {
			await setRoleLock(path, false);
		}
	};

	const deleteRole = async (path: string) => {
		setConfirmDelete(null);
		try {
			const res = await fetch(
				`/api/v1/books/${bookId}/truth/${encodeURIComponent(path)}`,
				{ method: "DELETE" },
			);
			if (!res.ok) {
				const j = await res.json().catch(() => ({}));
				throw new Error((j as { error?: string }).error ?? `${res.status}`);
			}
			onClose(); // Close modal to refresh list
		} catch (e) {
			alert(e instanceof Error ? e.message : "删除失败");
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
			onClick={onClose}
		>
			<div
				className="bg-card border border-border rounded-xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-border">
					<h2 className="font-medium text-foreground">角色管理</h2>
					<button
						onClick={onClose}
						className="text-muted-foreground hover:text-foreground transition-colors"
					>
						✕
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-4 space-y-4">
					{/* Global toggles */}
					<div className="space-y-2">
						<button
							onClick={() =>
								saveRoleLock({ ...roleLock, preventAdd: !roleLock.preventAdd })
							}
							className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
						>
							<ShieldCheck
								size={16}
								className={
									roleLock.preventAdd
										? "text-amber-500"
										: "text-muted-foreground/40"
								}
							/>
							<span
								className={
									roleLock.preventAdd
										? "text-foreground font-medium"
										: "text-muted-foreground"
								}
							>
								禁止新增角色
							</span>
							<span className="ml-auto text-xs text-muted-foreground/60">
								{roleLock.preventAdd ? "已开启" : "已关闭"}
							</span>
						</button>
						<button
							onClick={() =>
								saveRoleLock({
									...roleLock,
									preventDelete: !roleLock.preventDelete,
								})
							}
							className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
						>
							<ShieldCheck
								size={16}
								className={
									roleLock.preventDelete
										? "text-amber-500"
										: "text-muted-foreground/40"
								}
							/>
							<span
								className={
									roleLock.preventDelete
										? "text-foreground font-medium"
										: "text-muted-foreground"
								}
							>
								禁止删除角色
							</span>
							<span className="ml-auto text-xs text-muted-foreground/60">
								{roleLock.preventDelete ? "已开启" : "已关闭"}
							</span>
						</button>
					</div>

					{/* Bulk actions */}
					<div className="flex gap-2">
						<button
							onClick={lockAll}
							disabled={roles.length === 0}
							className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<Lock size={12} /> 全部锁定
						</button>
						<button
							onClick={unlockAll}
							disabled={
								roleLock.lockedRoles.length === 0 &&
								roles.length === 0
							}
							className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<Unlock size={12} /> 全部解锁
						</button>
					</div>

					{/* Role list */}
					<div className="space-y-1.5">
						{roles.map((role) => {
							const locked = isLocked(role.path);
							const badge = TIER_BADGE[role.tier];
							return (
								<div
									key={role.path}
									className={cn(
										"flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/20",
										locked && "opacity-60",
									)}
								>
									<Users
										size={14}
										className="shrink-0 text-muted-foreground/60"
									/>
									<span className="text-sm font-medium text-foreground truncate flex-1">
										{role.name}
									</span>
									<span
										className={cn(
											"text-[11px] px-1.5 py-0.5 rounded-full shrink-0",
											badge.color,
										)}
									>
										{badge.label}
									</span>

									{/* Lock toggle */}
									<button
										onClick={() => toggleLock(role.path)}
										className={cn(
											"p-1 rounded transition-colors",
											locked
												? "text-amber-500 hover:bg-amber-500/10"
												: "text-muted-foreground/40 hover:text-amber-500 hover:bg-amber-500/10",
										)}
										title={locked ? "解锁" : "锁定"}
									>
										{locked ? <Lock size={14} /> : <Unlock size={14} />}
									</button>

									{/* Edit */}
									<button
										onClick={() => {
											openArtifact(role.path);
											onClose();
										}}
										className="p-1 rounded text-muted-foreground/40 hover:text-foreground hover:bg-secondary/50 transition-colors"
										title="编辑"
									>
										<Pencil size={14} />
									</button>

									{/* Delete */}
									<button
										onClick={() => {
											if (!locked) setConfirmDelete(role.path);
										}}
										disabled={locked}
										className={cn(
											"p-1 rounded transition-colors",
											locked
												? "text-muted-foreground/20 cursor-not-allowed"
												: "text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10",
										)}
										title={locked ? "已锁定" : "删除"}
									>
										<Trash2 size={14} />
									</button>
								</div>
							);
						})}
						{roles.length === 0 &&
							legacyChars.map((char) => (
								<div
									key={char.name}
									className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/20"
								>
									<Users
										size={14}
										className="shrink-0 text-muted-foreground/60"
									/>
									<span className="text-sm font-medium text-foreground truncate flex-1">
										{char.name}
									</span>
									<button
										onClick={() => {
											openArtifact("character_matrix.md");
											onClose();
										}}
										className="p-1 rounded text-muted-foreground/40 hover:text-foreground hover:bg-secondary/50 transition-colors"
										title="编辑"
									>
										<Pencil size={14} />
									</button>
								</div>
							))}
					</div>
				</div>

				{/* Delete confirmation */}
				{confirmDelete && (
					<div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl">
						<div className="bg-card border border-border rounded-xl p-5 max-w-xs space-y-3 shadow-2xl">
							<h3 className="font-medium text-foreground">删除角色？</h3>
							<p className="text-sm text-muted-foreground">
								将删除 {confirmDelete.split("/").pop()?.replace(".md", "")}
								，此操作不可撤销。
							</p>
							<div className="flex justify-end gap-2">
								<button
									onClick={() => setConfirmDelete(null)}
									className="px-3 py-1.5 text-sm rounded-lg bg-secondary text-muted-foreground hover:text-foreground"
								>
									取消
								</button>
								<button
									onClick={() => deleteRole(confirmDelete)}
									className="px-3 py-1.5 text-sm rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
								>
									删除
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

// ---- Main Section ----

interface CharacterSectionProps {
	readonly bookId: string;
}

export function CharacterSection({ bookId }: CharacterSectionProps) {
	const [roles, setRoles] = useState<ReadonlyArray<RoleRef>>([]);
	const [legacyChars, setLegacyChars] = useState<CharacterInfo[]>([]);
	const [showManage, setShowManage] = useState(false);
	const bookDataVersion = useChatStore((s) => s.bookDataVersion);

	useEffect(() => {
		let cancelled = false;
		setRoles([]);
		setLegacyChars([]);

		fetchJson<{ files: ReadonlyArray<{ name: string }> }>(
			`/books/${bookId}/truth`,
		)
			.then(async (data) => {
				if (cancelled) return;
				const roleRefs = data.files
					.map((f) => roleFromPath(f.name))
					.filter((r): r is RoleRef => r !== null)
					.sort((a, b) =>
						a.tier === b.tier
							? a.name.localeCompare(b.name)
							: a.tier === "major"
								? -1
								: 1,
					);

				if (roleRefs.length > 0) {
					setRoles(roleRefs);
					return;
				}

				const matrix = await fetchJson<{ content: string | null }>(
					`/books/${bookId}/truth/character_matrix.md`,
				).catch(() => ({ content: null }));
				if (!cancelled && matrix.content) {
					setLegacyChars(parseCharacterMatrix(matrix.content));
				}
			})
			.catch(() => {
				if (!cancelled) {
					setRoles([]);
					setLegacyChars([]);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [bookId, bookDataVersion]);

	return (
		<>
			<SidebarCard title="角色">
				<div className="space-y-1.5">
					{/* Manage button - always first */}
					<button
						onClick={() => setShowManage(true)}
						className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-secondary/20 hover:bg-secondary/40 transition-colors text-left text-muted-foreground hover:text-foreground"
					>
						<Settings size={16} className="shrink-0" />
						<span className="text-[15px] leading-6 font-['SimSun','Songti_SC','STSong',serif]">
							角色管理
						</span>
					</button>

					{roles.length > 0
						? roles.map((role) => <RoleEntry key={role.path} role={role} />)
						: legacyChars.map((char) => (
								<CharacterCard key={char.name} char={char} />
							))}
				</div>
			</SidebarCard>

			{showManage && (
				<RoleManageModal bookId={bookId} onClose={() => setShowManage(false)} />
			)}
		</>
	);
}
