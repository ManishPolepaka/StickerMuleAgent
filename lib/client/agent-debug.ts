/**
 * Browser console debug for agent/task flow.
 * Off by default (even on localhost) so it does not spam / slow the UI.
 * On:  localStorage.setItem('debugAgent','1'); location.reload()
 * Off: localStorage.setItem('debugAgent','0'); location.reload()
 */
export function isAgentDebugEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("debugAgent") === "1";
  } catch {
    return false;
  }
}

export function agentDebug(scope: string, message: string, data?: unknown) {
  if (!isAgentDebugEnabled()) return;
  const prefix = `[agent-debug:${scope}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

export function agentDebugWarn(scope: string, message: string, data?: unknown) {
  if (!isAgentDebugEnabled()) return;
  const prefix = `[agent-debug:${scope}]`;
  if (data !== undefined) {
    console.warn(prefix, message, data);
  } else {
    console.warn(prefix, message);
  }
}
