/**
 * spawn-agent.ts — Shared utility for spawning Pi subagent processes
 *
 * Extracts the common process-spawning boilerplate used across
 * agent-team.ts, agent-chain.ts, pi-pi.ts, and subagent-widget.ts
 * into a single configurable function with event callbacks.
 */

import { spawn } from "child_process";

// ── Interfaces ────────────────────────────────────────────────────────────────

/** Optional callbacks fired during agent execution. */
export interface SpawnPiAgentCallbacks {
	/** Called for each text_delta received inside a message_update event. */
	onTextDelta?: (delta: string, fullText: string) => void;
	/** Called when a tool_execution_start event is received. */
	onToolExecutionStart?: (event: unknown) => void;
	/** Called when a message_end event is received. */
	onMessageEnd?: (event: unknown) => void;
	/** Called when an agent_end event is received. */
	onAgentEnd?: (event: unknown) => void;
	/** Called every second with elapsed milliseconds since spawn. */
	onTick?: (elapsed: number) => void;
	/** Called when the process writes to stderr. */
	onStderr?: (chunk: string) => void;
}

/** Result returned when the spawned agent process finishes. */
export interface SpawnPiAgentResult {
	/** Full concatenated text output from all text_delta events. */
	output: string;
	/** Process exit code (defaults to 1 on error). */
	exitCode: number;
	/** Elapsed milliseconds from spawn to close. */
	elapsed: number;
}

/** Handle returned by spawnPiAgent — allows awaiting completion or killing. */
export interface SpawnPiAgentHandle {
	/** Resolves with SpawnPiAgentResult when the process exits. */
	promise: Promise<SpawnPiAgentResult>;
	/** Sends SIGTERM to the spawned process. */
	kill: () => void;
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Spawn a Pi subagent process with JSON-line output and optional event callbacks.
 *
 * Callers are responsible for building the full args array (including --mode json,
 * --model, --session, --tools, --no-extensions, and the prompt).
 *
 * @param args      Pre-built args array passed directly to the 'pi' process.
 * @param callbacks Optional callbacks for streaming events and tick updates.
 * @returns         { promise, kill } — promise resolves with { output, exitCode, elapsed }.
 *
 * @example
 * const { promise, kill } = spawnPiAgent(
 *   ["--mode", "json", "-p", "--no-extensions", "--model", model, prompt],
 *   { onTextDelta: (_, full) => console.log(full) },
 * );
 * const result = await promise;
 */
export function spawnPiAgent(
	args: string[],
	callbacks?: SpawnPiAgentCallbacks,
): SpawnPiAgentHandle {
	const proc = spawn("pi", args, {
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});

	const textChunks: string[] = [];
	const startTime = Date.now();

	const timer = setInterval(() => {
		callbacks?.onTick?.(Date.now() - startTime);
	}, 1000);

	// ── Line processor ───────────────────────────────────────────────────────

	function processLine(line: string): void {
		if (!line.trim()) return;
		try {
			const event = JSON.parse(line) as Record<string, unknown>;
			if (event.type === "message_update") {
				const delta = event.assistantMessageEvent as Record<string, unknown> | undefined;
				if (delta?.type === "text_delta") {
					const text = (delta.delta as string) || "";
					textChunks.push(text);
					callbacks?.onTextDelta?.(text, textChunks.join(""));
				}
			} else if (event.type === "tool_execution_start") {
				callbacks?.onToolExecutionStart?.(event);
			} else if (event.type === "message_end") {
				callbacks?.onMessageEnd?.(event);
			} else if (event.type === "agent_end") {
				callbacks?.onAgentEnd?.(event);
			}
		} catch {
			// Ignore non-JSON lines (e.g. startup banners)
		}
	}

	// ── stdout — buffer + split + pop pattern ────────────────────────────────

	let buffer = "";

	proc.stdout!.setEncoding("utf-8");
	proc.stdout!.on("data", (chunk: string) => {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";
		for (const line of lines) processLine(line);
	});

	// ── stderr ───────────────────────────────────────────────────────────────

	proc.stderr!.setEncoding("utf-8");
	proc.stderr!.on("data", (chunk: string) => {
		callbacks?.onStderr?.(chunk);
	});

	// ── Promise — resolves on close or error ─────────────────────────────────

	const promise = new Promise<SpawnPiAgentResult>((resolve) => {
		proc.on("close", (code) => {
			// Flush any buffered partial line
			if (buffer.trim()) processLine(buffer);
			clearInterval(timer);
			resolve({
				output: textChunks.join(""),
				exitCode: code ?? 1,
				elapsed: Date.now() - startTime,
			});
		});

		proc.on("error", (err) => {
			clearInterval(timer);
			resolve({
				output: `Error spawning agent: ${err.message}`,
				exitCode: 1,
				elapsed: Date.now() - startTime,
			});
		});
	});

	return {
		promise,
		kill: () => proc.kill(),
	};
}
