/**
 * OpenClaw query handler
 * Uses gateway WebSocket for speed, falls back to CLI
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { GLASSES_PROMPT, COMMAND_TIMEOUT_MS } from '../config';
import { OpenClawResponse } from '../types';
import { getGatewayClient } from './gateway-client';

const execAsync = promisify(exec);

// Enable gateway by default (set to false to use CLI only)
let useGateway = true;

/**
 * Query OpenClaw AI and get a response
 * Uses WebSocket gateway for speed, falls back to CLI if unavailable
 */
export async function queryOpenClaw(message: string, sessionId: string): Promise<string> {
    const fullMessage = `${GLASSES_PROMPT} ${message}`;

    // Try fast gateway first
    if (useGateway) {
        try {
            const startTime = Date.now();
            const client = getGatewayClient(`glasses-${sessionId}`);
            const response = await client.sendMessage(fullMessage, COMMAND_TIMEOUT_MS);
            console.log(`[OpenClaw] Gateway response in ${Date.now() - startTime}ms`);
            return response;
        } catch (error) {
            console.log('[OpenClaw] Gateway failed, falling back to CLI:', error);
            // Don't disable gateway permanently, just use CLI for this request
        }
    }

    // Fallback to CLI
    return queryOpenClawCLI(fullMessage, sessionId);
}

/**
 * Query OpenClaw via CLI (slower but more reliable)
 */
async function queryOpenClawCLI(fullMessage: string, sessionId: string): Promise<string> {
    const escapedMessage = fullMessage.replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/`/g, '\\`');

    try {
        const startTime = Date.now();
        const { stdout, stderr } = await execAsync(
            `openclaw agent --json --session-id "glasses-${sessionId}" -m "${escapedMessage}" 2>&1`,
            { timeout: COMMAND_TIMEOUT_MS }
        );

        const output = stdout + stderr;
        console.log(`[OpenClaw] CLI response in ${Date.now() - startTime}ms`);

        // Try to extract JSON from output
        const jsonMatch = output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const jsonResponse: OpenClawResponse = JSON.parse(jsonMatch[0]);
                if (jsonResponse.status === 'ok' && jsonResponse.result?.payloads?.[0]?.text) {
                    return jsonResponse.result.payloads[0].text;
                }
            } catch {
                // JSON parsing failed, fall through to raw parsing
            }
        }

        // Fallback: clean raw output
        return cleanRawOutput(output);
    } catch (error: any) {
        if (error.stdout) {
            return cleanRawOutput(error.stdout);
        }
        throw error;
    }
}

/**
 * Clean raw CLI output by removing ANSI codes, warnings, etc.
 */
function cleanRawOutput(output: string): string {
    let response = output;
    response = response.replace(/\x1b\[[0-9;]*m/g, '');           // ANSI codes
    response = response.replace(/^.*DEP[0-9]+.*$/gm, '');         // Deprecation codes
    response = response.replace(/^.*DeprecationWarning.*$/gm, ''); // Deprecation warnings
    response = response.replace(/^.*punycode.*$/gmi, '');          // Punycode warnings
    response = response.replace(/^\(node:[0-9]+\).*$/gm, '');     // Node warnings
    response = response.replace(/^.*\(use.*node.*--trace.*$/gmi, ''); // Trace hints
    response = response.replace(/^.*OpenClaw.*$/gmi, '');          // OpenClaw banner
    response = response.replace(/^.*🦞.*$/gm, '');                 // Lobster emoji lines
    response = response.replace(/^\s*$/gm, '').trim();

    const lines = response.split('\n').filter(l => l.trim() && l.length > 2);
    return lines.length > 0 ? lines[lines.length - 1] : 'No response';
}
