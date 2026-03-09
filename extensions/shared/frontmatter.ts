/**
 * frontmatter.ts — Shared YAML frontmatter parser for agent definition files
 *
 * Extracted from the duplicated parseFrontmatter / parseAgentFile implementations
 * found in cross-agent.ts, system-select.ts, agent-team.ts, agent-chain.ts, pi-pi.ts.
 *
 * Exports:
 *   parseFrontmatter(raw)    → { fields, body }
 *   parseAgentFile(filePath) → BaseAgentDef | null
 *   BaseAgentDef             interface
 */

import { readFileSync } from "node:fs";

// ── Types ──────────────────────────────────────────────────────────────────

export interface BaseAgentDef {
	name: string;
	description: string;
	tools: string;
	systemPrompt: string;
	file: string;
}

// ── Frontmatter Parser ─────────────────────────────────────────────────────

/**
 * Parse YAML-style frontmatter from a raw file string.
 *
 * Accepts both `---\n` and `--- \n` (trailing spaces) delimiters via a
 * permissive regex so it handles every style found in the codebase.
 *
 * @param raw  Full file contents as a string.
 * @returns    { fields } key/value pairs from the frontmatter block,
 *             { body }   everything after the closing `---` delimiter.
 */
export function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
	const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
	if (!match) return { fields: {}, body: raw };

	const fields: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const idx = line.indexOf(":");
		if (idx > 0) {
			fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
		}
	}

	return { fields, body: match[2] };
}

// ── Agent File Parser ──────────────────────────────────────────────────────

/**
 * Read and parse an agent definition `.md` file from disk.
 *
 * Returns null when the file cannot be read, has no valid frontmatter, or
 * is missing the required `name` field.
 *
 * @param filePath  Absolute or relative path to the `.md` agent file.
 * @returns         A populated BaseAgentDef, or null on failure.
 */
export function parseAgentFile(filePath: string): BaseAgentDef | null {
	try {
		const raw = readFileSync(filePath, "utf-8");
		const { fields, body } = parseFrontmatter(raw);

		if (!fields.name) return null;

		return {
			name: fields.name,
			description: fields.description || "",
			tools: fields.tools || "read,grep,find,ls",
			systemPrompt: body.trim(),
			file: filePath,
		};
	} catch {
		return null;
	}
}
