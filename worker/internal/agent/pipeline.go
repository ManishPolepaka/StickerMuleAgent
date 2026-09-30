package agent

import (
	"context"
	"fmt"
	"strings"
)

type pipelineKind string

const (
	pipelineStatus   pipelineKind = "status_resolve"
	pipelineApproval pipelineKind = "require_approval"
	pipelineEscalate pipelineKind = "escalate_claim"
)

type pipelineDecision struct {
	Kind             pipelineKind
	RestrictedAction string
	Reason           string
	Label            string
}

func resolvePipeline(issueType, prompt, customerNotes, proposedAction string) pipelineDecision {
	issue := strings.ToLower(strings.TrimSpace(issueType))
	switch issue {
	case "cancel_request":
		return pipelineDecision{pipelineApproval, "cancel_order",
			"Order has an open cancellation request — must pause for human approval.", "Cancel request"}
	case "refund_request":
		return pipelineDecision{pipelineApproval, "issue_refund",
			"Order has a refund request — must pause for human approval.", "Refund request"}
	case "incorrect_address":
		return pipelineDecision{pipelineApproval, "change_shipping_address",
			"Address change / undeliverable address — must pause for human approval.", "Address change"}
	case "delivered_not_received":
		return pipelineDecision{pipelineEscalate, "",
			"Carrier shows delivered but customer disputes receipt — escalate (do not refund).", "Delivered not received"}
	case "production_delay", "missing_tracking", "stale_tracking", "delivery_status_inquiry":
		return pipelineDecision{pipelineStatus, "",
			"Status investigation — send verified status email and resolve.", issue}
	}

	blob := strings.ToLower(prompt + "\n" + customerNotes + "\n" + proposedAction)
	if action := detectRestrictedText(blob); action != "" {
		return pipelineDecision{pipelineApproval, action,
			fmt.Sprintf("Detected restricted intent (%s) — must pause for human approval.", strings.ReplaceAll(action, "_", " ")),
			strings.ReplaceAll(action, "_", " ")}
	}
	return pipelineDecision{pipelineStatus, "", "Standard status investigation.", "Status investigation"}
}

func detectRestrictedText(t string) string {
	switch {
	case strings.Contains(t, "refund") || strings.Contains(t, "money back") || strings.Contains(t, "charge back"):
		return "issue_refund"
	case strings.Contains(t, "store credit") || strings.Contains(t, "issue credit"):
		return "issue_credit"
	case strings.Contains(t, "discount"):
		return "issue_discount"
	case strings.Contains(t, "cancel"):
		return "cancel_order"
	case strings.Contains(t, "wrong address") || strings.Contains(t, "change address") ||
		strings.Contains(t, "incorrect address") || strings.Contains(t, "change_shipping"):
		return "change_shipping_address"
	case strings.Contains(t, "compensat") || strings.Contains(t, "goodwill"):
		return "promise_compensation"
	}
	return ""
}

func (r *Runner) enforcePipeline(ctx context.Context, st *runState, usedTools []string, paused bool, final map[string]any) (map[string]any, bool, error) {
	policy := resolvePipeline(st.issueType, st.prompt, st.customerNotes, strFromMap(final, "proposedOrCompletedAction"))
	hasApproval := paused || contains(usedTools, "request_human_approval")
	orderRef := st.orderNumber
	if orderRef == "" {
		orderRef = "UNKNOWN"
	}

	if policy.Kind == pipelineApproval && !contains(usedTools, "create_support_ticket") {
		_ = r.addStep(ctx, st, "decision", "Pipeline enforcement — open support ticket",
			"Restricted cases always create an internal ticket for human review.", "", "")
		ticket := r.toolCreateTicket(ctx, map[string]any{
			"orderId":       orderRef,
			"issueCategory": firstNonEmpty(st.issueType, policy.RestrictedAction, "restricted_action"),
			"description": fmt.Sprintf("%s Task %s. %s", policy.Reason, st.taskNumber,
				truncate(strFromMap(final, "investigationSummary"), 800)),
			"priority": "high",
		})
		_ = r.addStepFull(ctx, st, "tool_result", "Created support ticket — result",
			summarizeToolResult("create_support_ticket", ticket), "create_support_ticket", mustJSON(ticket),
			ternary(ticket.OK, "completed", "error"))
		usedTools = append(usedTools, "create_support_ticket")
	}

	if policy.Kind == pipelineApproval && !hasApproval {
		_ = r.addStep(ctx, st, "decision", "Pipeline enforcement — approval required", policy.Reason, "", "")
		result := r.toolRequestApproval(ctx, st, map[string]any{
			"proposedAction": policy.RestrictedAction,
			"reason":         policy.Reason,
			"relatedOrderId": orderRef,
			"supportingEvidence": []string{
				"pipeline_enforcement", policy.Label,
			},
		})
		_ = r.addStepFull(ctx, st, "tool_result", "Requested human approval — result",
			summarizeToolResult("request_human_approval", result), "request_human_approval", mustJSON(result),
			ternary(result.OK, "completed", "error"))
		if result.OK {
			final = map[string]any{
				"problemIdentified":         firstNonEmpty(strFromMap(final, "problemIdentified"), policy.Label),
				"evidenceCollected":         []string{"Order evidence reviewed", "Support ticket opened", "Restricted action gated by pipeline"},
				"investigationSummary":      firstNonEmpty(strFromMap(final, "investigationSummary"), "Investigation complete. Support ticket opened; restricted action awaiting human approval."),
				"rootCause":                 final["rootCause"],
				"proposedOrCompletedAction": "Opened support ticket and requested approval: " + policy.RestrictedAction,
				"approvalRequired":          true,
				"customerResponse":          final["customerResponse"],
				"remainingRisks":            []string{"Action not executed until approved"},
				"finalTaskStatus":           "awaiting_approval",
			}
			return final, true, nil
		}
	}

	if policy.Kind == pipelineEscalate && !contains(usedTools, "escalate_task") && !paused {
		if strFromMap(final, "finalTaskStatus") == "resolved" {
			_ = r.addStep(ctx, st, "decision", "Pipeline enforcement — escalate claim", policy.Reason, "", "")
			result := r.toolEscalate(ctx, st, map[string]any{
				"taskId":              "CURRENT",
				"escalationReason":    policy.Reason,
				"supportingEvidence":  []string{"pipeline_enforcement"},
				"recommendedNextStep": "Human review of delivered-not-received claim; do not auto-refund.",
			})
			_ = r.addStepFull(ctx, st, "tool_result", "Escalated task — result",
				summarizeToolResult("escalate_task", result), "escalate_task", mustJSON(result),
				ternary(result.OK, "completed", "error"))
			if result.OK {
				final["proposedOrCompletedAction"] = "Escalated delivered-not-received claim for human review"
				final["approvalRequired"] = true
				final["finalTaskStatus"] = "escalated"
			}
		}
	}
	return final, paused, nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func strFromMap(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func ternary(cond bool, a, b string) string {
	if cond {
		return a
	}
	return b
}
