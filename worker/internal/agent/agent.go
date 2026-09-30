package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/ManishPolepaka/StickerMuleAgent/worker/internal/notify"
	"github.com/ManishPolepaka/StickerMuleAgent/worker/internal/openai"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const systemPrompt = `You are the Order Operations Agent for CommerceOps AI, a DEMO e-commerce operations platform.
All business data and carrier/production/email integrations are simulated demo systems — never claim they are real Sticker Mule systems.

Your job:
1. Investigate delayed or problematic orders using tools only.
2. Never invent order information, delivery dates, refunds, discounts, or action success.
3. If evidence is insufficient, say so and escalate.
4. AUTO-ALLOWED (do these yourself — do NOT call request_human_approval):
   - Read order / production / shipping / customer history
   - Draft AND send status/update emails via send_customer_email (simulated)
   - Create support tickets
   - Escalate for more evidence
   - Record investigation outcomes
5. RESTRICTED (MUST use request_human_approval — never execute yourself):
   - Refunds, credits, discounts, cancellations, shipping-address changes, compensation promises
6. For normal delivery/status inquiries: investigate → send_customer_email with a verified update → record_agent_outcome with finalTaskStatus "resolved" and approvalRequired false.
7. Customer copy rules: write findings and emails in plain language. Never put snake_case codes (not_shipped, in_production) or ISO timestamps in customer emails.
8. SPEED: When tools are independent, call several in ONE turn. Prefer the shortest path: investigate → send_customer_email → record_agent_outcome.
9. Prefer verified tool results. Always call record_agent_outcome before finishing.
10. ISSUE-TYPE PIPELINES (follow the order's issueType / customer notes, not just the user prompt):
   - cancel_request → investigate → create_support_ticket → optional "under review" status email → request_human_approval(cancel_order) → awaiting_approval
   - refund_request → investigate → create_support_ticket → request_human_approval(issue_refund) → awaiting_approval
   - incorrect_address → investigate → create_support_ticket → request_human_approval(change_shipping_address) → awaiting_approval
   - production_delay / missing_tracking / stale_tracking / delivery_status_inquiry → investigate → send_customer_email (direct customer answer) → record_agent_outcome(resolved)
   - delivered_not_received → investigate → create_support_ticket → careful status email (no refund) → escalate_task
   Restricted cases ALWAYS open an internal support ticket for the human reviewer.
   Status cases: answer the customer directly after verified analysis — no approval needed.
   Never resolve a cancel/refund/address/credit/discount/compensation case without request_human_approval.
   Never ask the customer to "choose" cancel vs wait as a substitute for approval.
11. CRITICAL: Your FINAL assistant message (after tools) must be ONLY a single raw JSON object — no markdown, no headings, no bullet lists, no code fences. Exact shape:
{
  "problemIdentified": string,
  "evidenceCollected": string[],
  "investigationSummary": string,
  "rootCause": string|null,
  "proposedOrCompletedAction": string,
  "approvalRequired": boolean,
  "customerResponse": string|null,
  "remainingRisks": string[],
  "finalTaskStatus": "resolved"|"awaiting_approval"|"escalated"|"failed"|"needs_human"
}`

type Runner struct {
	Pool            *pgxpool.Pool
	OpenAIKey       string
	OpenAIModel     string
	PreferSimulated bool
	Timeout         time.Duration
}

type runState struct {
	taskID        string
	taskNumber    string
	prompt        string
	issueType     string
	customerNotes string
	orderID       *string
	orderNumber   string
	execID        string
	stepIndex     int
	promptTok     int
	compTok       int
	started       time.Time
}

func (r *Runner) RunTask(ctx context.Context, taskID string) error {
	ctx, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()

	var st runState
	st.taskID = taskID
	st.started = time.Now()
	var orderID *string
	var taskIssue, orderIssue, notes string
	err := r.Pool.QueryRow(ctx, `
		select t.id, t."taskNumber", t.prompt, t."orderId",
		       coalesce(t."issueType", ''), coalesce(o."issueType", ''),
		       coalesce(o."orderNumber", ''), coalesce(o."customerNotes", '')
		from "AgentTask" t
		left join "Order" o on o.id = t."orderId"
		where t.id = $1`, taskID).Scan(
		&st.taskID, &st.taskNumber, &st.prompt, &orderID,
		&taskIssue, &orderIssue, &st.orderNumber, &notes)
	if err != nil {
		return fmt.Errorf("load task: %w", err)
	}
	st.orderID = orderID
	st.customerNotes = notes
	st.issueType = firstNonEmpty(taskIssue, orderIssue)

	_, _ = r.Pool.Exec(ctx, `
		update "AgentTask"
		set status = 'running', "startedAt" = coalesce("startedAt", now())
		where id = $1`, taskID)
	notify.TaskUpdated(st.taskID, st.taskNumber, "running")

	useOpenAI := !r.PreferSimulated && strings.TrimSpace(r.OpenAIKey) != ""
	provider := "openai"
	model := firstNonEmpty(r.OpenAIModel, "gpt-5-mini")
	if !useOpenAI {
		provider = "go-worker"
		model = "go-simulated-v1"
	}

	st.execID = newID()
	_, err = r.Pool.Exec(ctx, `
		insert into "AgentExecution"
			(id, "taskId", "agentName", "modelProvider", "modelName", "inputSummary", status, "createdAt")
		values ($1,$2,'Order Operations Agent',$3,$4,$5,'running',now())`,
		st.execID, taskID, provider, model, truncate(st.prompt, 500))
	if err != nil {
		_ = r.failTask(ctx, &st, fmt.Sprintf("create execution: %v", err))
		return err
	}

	detail := "Provider: OpenAI — Go worker fetches Supabase data via tools"
	if !useOpenAI {
		detail = "Provider: Go worker simulated fallback (no OPENAI_API_KEY)"
	}
	if err := r.addStep(ctx, &st, "lifecycle", "Investigation started", detail, "", ""); err != nil {
		_ = r.failTask(ctx, &st, err.Error())
		return err
	}

	if useOpenAI {
		if err := r.runOpenAI(ctx, &st); err != nil {
			log.Printf("openai path failed for %s: %v — falling back to simulated", st.taskNumber, err)
			_, _ = r.Pool.Exec(ctx, `
				update "AgentExecution"
				set "modelProvider" = 'openai-fallback', "modelName" = 'go-simulated-v1', "errorMessage" = $2
				where id = $1`, st.execID, truncate(err.Error(), 1500))
			_ = r.addStep(ctx, &st, "lifecycle", "Switched to simulated provider",
				fmt.Sprintf("OpenAI failed (%s); finishing with deterministic Supabase tool path.", truncate(err.Error(), 240)), "", "")
			if simErr := r.runSimulated(ctx, &st); simErr != nil {
				_ = r.failTask(ctx, &st, simErr.Error())
				return simErr
			}
			return nil
		}
		return nil
	}

	if err := r.runSimulated(ctx, &st); err != nil {
		_ = r.failTask(ctx, &st, err.Error())
		return err
	}
	return nil
}

func (r *Runner) runOpenAI(ctx context.Context, st *runState) error {
	client := openai.New(r.OpenAIKey, r.OpenAIModel)
	orderHint := ""
	if st.orderNumber != "" {
		orderHint = fmt.Sprintf("Related order: %s.", st.orderNumber)
	}
	messages := []openai.Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: fmt.Sprintf("%s\n\n%s\nInternal taskId for tools that need it: %s (you may pass \"CURRENT\" as taskId).",
			st.prompt, orderHint, st.taskID)},
	}

	tools := toolDefinitions()
	maxIter := 12
	paused := false
	var final map[string]any
	usedTools := []string{}

	for i := 0; i < maxIter; i++ {
		if ctx.Err() != nil {
			return fmt.Errorf("agent execution timed out")
		}
		log.Printf("[go-agent] %s iteration %d/%d model=%s", st.taskNumber, i+1, maxIter, client.Model)

		resp, err := client.Complete(ctx, messages, tools)
		if err != nil {
			return err
		}
		st.promptTok += resp.Usage.PromptTokens
		st.compTok += resp.Usage.CompletionTokens

		if len(resp.ToolCalls) > 0 {
			messages = append(messages, openai.Message{
				Role:      "assistant",
				Content:   resp.Content,
				ToolCalls: resp.ToolCalls,
			})
			for _, call := range resp.ToolCalls {
				usedTools = append(usedTools, call.Name)
				_ = r.addStep(ctx, st, "tool_call", titleForTool(call.Name),
					"Calling "+call.Name, call.Name, mustJSON(call.Arguments))

				result := r.executeTool(ctx, st, call.Name, call.Arguments)
				status := "completed"
				detail := summarizeToolResult(call.Name, result)
				if !result.OK {
					status = "error"
					detail = result.Error
				}
				_ = r.addStepFull(ctx, st, "tool_result", titleForTool(call.Name)+" — result",
					detail, call.Name, mustJSON(result), status)

				messages = append(messages, openai.Message{
					Role:       "tool",
					ToolCallID: call.ID,
					Content:    mustJSON(result),
				})

				if call.Name == "request_human_approval" && result.OK {
					if data, ok := result.Data.(map[string]any); ok {
						if pause, _ := data["pauseExecution"].(bool); pause {
							paused = true
						}
					}
				}
			}
			if paused {
				final = map[string]any{
					"problemIdentified":         "Restricted action requires approval",
					"evidenceCollected":         []string{"Approval request created"},
					"investigationSummary":      "Agent paused for human approval.",
					"rootCause":                 nil,
					"proposedOrCompletedAction": "Awaiting human approval",
					"approvalRequired":          true,
					"customerResponse":          nil,
					"remainingRisks":            []string{},
					"finalTaskStatus":           "awaiting_approval",
				}
				break
			}
			continue
		}

		// Final text response from the model
		messages = append(messages, openai.Message{Role: "assistant", Content: resp.Content})
		final = tryParseFinal(resp.Content)
		if final == nil {
			final = synthesizeFinal(usedTools, paused)
		}
		break
	}

	if final == nil {
		final = synthesizeFinal(usedTools, paused)
	}
	if paused {
		final["approvalRequired"] = true
		final["finalTaskStatus"] = "awaiting_approval"
	}

	var err error
	final, paused, err = r.enforcePipeline(ctx, st, usedTools, paused, final)
	if err != nil {
		return err
	}
	if paused {
		final["approvalRequired"] = true
		final["finalTaskStatus"] = "awaiting_approval"
	}

	return r.persistFinal(ctx, st, final)
}

func (r *Runner) persistFinal(ctx context.Context, st *runState, final map[string]any) error {
	status, _ := final["finalTaskStatus"].(string)
	if status == "" {
		status = "resolved"
	}
	summary, _ := final["investigationSummary"].(string)
	if summary == "" {
		summary = "OpenAI investigation completed using Supabase evidence."
	}
	problem, _ := final["problemIdentified"].(string)
	action, _ := final["proposedOrCompletedAction"].(string)
	approval, _ := final["approvalRequired"].(bool)

	// Don't overwrite awaiting_approval / escalated already set by tools.
	var current string
	_ = r.Pool.QueryRow(ctx, `select status from "AgentTask" where id = $1`, st.taskID).Scan(&current)
	if current == "awaiting_approval" || current == "escalated" {
		status = current
		approval = true
	}

	_, err := r.Pool.Exec(ctx, `
		update "AgentTask"
		set status = $2,
		    "investigationSummary" = $3,
		    "reasoningSummary" = $4,
		    "finalResultJson" = $5,
		    "actionResult" = $6,
		    "requiresHumanApproval" = $7,
		    "completedAt" = case when $2 in ('awaiting_approval') then null else now() end
		where id = $1`,
		st.taskID, status, summary, problem, mustJSON(final), action, approval)
	if err != nil {
		return err
	}
	notify.TaskUpdated(st.taskID, st.taskNumber, status)

	dur := int(time.Since(st.started).Milliseconds())
	total := st.promptTok + st.compTok
	cost := estimateCost(firstNonEmpty(r.OpenAIModel, "gpt-5-mini"), st.promptTok, st.compTok)
	_, _ = r.Pool.Exec(ctx, `
		update "AgentExecution"
		set status = $2, "completedAt" = now(), "outputSummary" = $3,
		    "promptTokens" = $4, "completionTokens" = $5, "totalTokens" = $6,
		    "estimatedCostUsd" = $7, "durationMs" = $8
		where id = $1`,
		st.execID, mapExecStatus(status), truncate(summary, 500),
		st.promptTok, st.compTok, total, cost, dur)

	_ = r.addStep(ctx, st, "lifecycle", "Investigation completed",
		fmt.Sprintf("OpenAI finished with status %s.", status), "record_agent_outcome", mustJSON(final))
	return nil
}

func summarizeToolResult(name string, result toolResult) string {
	if !result.OK {
		return result.Error
	}
	data, _ := result.Data.(map[string]any)
	switch name {
	case "get_order_details":
		if order, ok := data["order"].(map[string]any); ok {
			return fmt.Sprintf("Found order %v. Status: %v; shipping: %v.",
				order["orderNumber"], order["orderStatus"], order["shippingStatus"])
		}
	case "get_production_status":
		if delay, _ := data["delayReported"].(bool); delay {
			return fmt.Sprintf("Production delayed — %v. Stage: %v.", data["delayReason"], data["currentStage"])
		}
		return fmt.Sprintf("Production stage: %v.", data["currentStage"])
	case "track_shipment":
		if data["trackingNumber"] == nil || data["trackingNumber"] == "" {
			return "No tracking number on this order yet."
		}
		return fmt.Sprintf("Shipment status: %v.", data["shipmentStatus"])
	case "get_customer_history":
		return fmt.Sprintf("Customer %v reviewed.", data["name"])
	case "send_customer_email":
		return "Status email stored as simulated send."
	case "create_support_ticket":
		return fmt.Sprintf("Opened internal ticket (%v).", data["category"])
	case "request_human_approval":
		return "Paused for human approval."
	case "record_agent_outcome":
		return fmt.Sprintf("Recorded outcome: %v.", data["finalStatus"])
	}
	return "Tool succeeded"
}

func mapExecStatus(taskStatus string) string {
	switch taskStatus {
	case "awaiting_approval":
		return "awaiting_approval"
	case "failed":
		return "failed"
	case "escalated", "needs_human":
		return "completed"
	default:
		return "completed"
	}
}

func tryParseFinal(content string) map[string]any {
	if content == "" {
		return nil
	}
	s := strings.TrimSpace(content)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	s = strings.TrimSpace(s)
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start < 0 || end <= start {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(s[start:end+1]), &out); err != nil {
		return nil
	}
	return out
}

func synthesizeFinal(tools []string, paused bool) map[string]any {
	status := "resolved"
	if paused {
		status = "awaiting_approval"
	}
	return map[string]any{
		"problemIdentified":         "Order operations investigation",
		"evidenceCollected":         tools,
		"investigationSummary":      "OpenAI completed a tool-using investigation using verified Supabase evidence.",
		"rootCause":                 nil,
		"proposedOrCompletedAction": "Investigation completed via OpenAI + Go Supabase tools",
		"approvalRequired":          paused,
		"customerResponse":          nil,
		"remainingRisks":            []string{},
		"finalTaskStatus":           status,
	}
}

func estimateCost(model string, prompt, completion int) float64 {
	rates := map[string][2]float64{
		"gpt-5-mini":  {0.25, 2.0},
		"gpt-5-nano":  {0.05, 0.4},
		"gpt-4o-mini": {0.15, 0.6},
	}
	r, ok := rates[model]
	if !ok {
		r = rates["gpt-5-mini"]
	}
	return (float64(prompt)*r[0] + float64(completion)*r[1]) / 1_000_000
}

func (r *Runner) addStep(ctx context.Context, st *runState, stepType, title, detail, toolName, resultJSON string) error {
	return r.addStepFull(ctx, st, stepType, title, detail, toolName, resultJSON, "completed")
}

func (r *Runner) addStepFull(ctx context.Context, st *runState, stepType, title, detail, toolName, resultJSON, status string) error {
	st.stepIndex++
	id := newID()
	_, err := r.Pool.Exec(ctx, `
		insert into "AgentStep"
			(id, "executionId", "stepIndex", "stepType", title, detail, "toolName", "toolResultJson", status, "createdAt")
		values ($1,$2,$3,$4,$5,$6,nullif($7,''),nullif($8,''),$9,now())`,
		id, st.execID, st.stepIndex, stepType, title, detail, toolName, resultJSON, status)
	if err != nil {
		return err
	}
	notify.StepAdded(st.taskID, st.execID, map[string]any{
		"id":             id,
		"stepIndex":      st.stepIndex,
		"stepType":       stepType,
		"title":          title,
		"detail":         detail,
		"toolName":       nullIfEmpty(toolName),
		"toolResultJson": nullIfEmpty(resultJSON),
		"status":         status,
		"createdAt":      time.Now().UTC().Format(time.RFC3339Nano),
	})
	return nil
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func (r *Runner) finishExecution(ctx context.Context, st *runState, status string) error {
	_, err := r.Pool.Exec(ctx, `
		update "AgentExecution"
		set status = $2, "completedAt" = now()
		where id = $1`, st.execID, status)
	return err
}

func (r *Runner) failTask(ctx context.Context, st *runState, reason string) error {
	_, _ = r.Pool.Exec(ctx, `
		update "AgentTask"
		set status = 'failed', "actionResult" = $2, "completedAt" = now()
		where id = $1`, st.taskID, truncate(reason, 2000))
	_, _ = r.Pool.Exec(ctx, `
		update "AgentExecution"
		set status = 'failed', "errorMessage" = $2, "completedAt" = now()
		where id = $1`, st.execID, truncate(reason, 2000))
	_ = r.addStep(ctx, st, "error", "Agent error", reason, "", "")
	notify.TaskUpdated(st.taskID, st.taskNumber, "failed")
	return fmt.Errorf("%s", reason)
}

func newID() string {
	return "g" + strings.ReplaceAll(uuid.NewString(), "-", "")
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func coalesce(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
