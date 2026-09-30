package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Runner struct {
	Pool            *pgxpool.Pool
	PreferSimulated bool
	Timeout         time.Duration
}

type runState struct {
	taskID      string
	taskNumber  string
	prompt      string
	orderID     *string
	orderNumber string
	execID      string
	stepIndex   int
}

func (r *Runner) RunTask(ctx context.Context, taskID string) error {
	ctx, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()

	var st runState
	st.taskID = taskID
	var orderID *string
	err := r.Pool.QueryRow(ctx, `
		select t.id, t."taskNumber", t.prompt, t."orderId", coalesce(o."orderNumber", '')
		from "AgentTask" t
		left join "Order" o on o.id = t."orderId"
		where t.id = $1`, taskID).Scan(&st.taskID, &st.taskNumber, &st.prompt, &orderID, &st.orderNumber)
	if err != nil {
		return fmt.Errorf("load task: %w", err)
	}
	st.orderID = orderID

	_, _ = r.Pool.Exec(ctx, `
		update "AgentTask"
		set status = 'running', "startedAt" = coalesce("startedAt", now())
		where id = $1`, taskID)

	st.execID = newID()
	_, err = r.Pool.Exec(ctx, `
		insert into "AgentExecution"
			(id, "taskId", "agentName", "modelProvider", "modelName", "inputSummary", status, "createdAt")
		values ($1,$2,'Order Operations Agent','go-worker','go-simulated-v1',$3,'running',now())`,
		st.execID, taskID, truncate(st.prompt, 500))
	if err != nil {
		_ = r.failTask(ctx, &st, fmt.Sprintf("create execution: %v", err))
		return err
	}

	if err := r.addStep(ctx, &st, "lifecycle", "Investigation started", "Provider: Go worker (simulated tools)", "", ""); err != nil {
		_ = r.failTask(ctx, &st, err.Error())
		return err
	}

	if err := r.runSimulated(ctx, &st); err != nil {
		_ = r.failTask(ctx, &st, err.Error())
		return err
	}
	return nil
}

func (r *Runner) runSimulated(ctx context.Context, st *runState) error {
	if st.orderNumber == "" {
		return r.failTask(ctx, st, "No order linked to this task")
	}

	order, err := r.getOrder(ctx, st.orderNumber)
	if err != nil {
		return err
	}
	if err := r.addStep(ctx, st, "tool_result", "Retrieved order details",
		fmt.Sprintf("Found order %s. Status: %s; shipping: %s.", order.OrderNumber, order.OrderStatus, order.ShippingStatus),
		"get_order_details", mustJSON(order)); err != nil {
		return err
	}

	prod, err := r.getProduction(ctx, order.ID)
	if err != nil {
		return err
	}
	detail := fmt.Sprintf("Production stage: %s.", prod.Stage)
	if prod.DelayReported {
		detail = fmt.Sprintf("Production is delayed — %s. Stage: %s.", coalesce(prod.DelayReason, "delay reported"), prod.Stage)
	}
	if err := r.addStep(ctx, st, "tool_result", "Checked production status", detail, "get_production_status", mustJSON(prod)); err != nil {
		return err
	}

	ship, err := r.getShipment(ctx, order.ID, order.TrackingNumber)
	if err != nil {
		return err
	}
	shipDetail := fmt.Sprintf("Shipment status: %s.", ship.Status)
	if ship.TrackingNumber == "" {
		shipDetail = "No tracking number on this order yet."
	}
	if err := r.addStep(ctx, st, "tool_result", "Checked shipment tracking", shipDetail, "track_shipment", mustJSON(ship)); err != nil {
		return err
	}

	cust, err := r.getCustomer(ctx, order.CustomerID)
	if err != nil {
		return err
	}
	if err := r.addStep(ctx, st, "tool_result", "Reviewed customer history",
		fmt.Sprintf("Customer %s · %d recent orders.", cust.Name, cust.RecentOrderCount),
		"get_customer_history", mustJSON(cust)); err != nil {
		return err
	}

	lower := strings.ToLower(st.prompt)
	wantsRefund := strings.Contains(lower, "refund") || strings.Contains(lower, "credit")
	wantsCancel := strings.Contains(lower, "cancel")
	wantsAddress := strings.Contains(lower, "address")

	if wantsRefund || wantsCancel || wantsAddress {
		action := "issue_refund"
		if wantsCancel {
			action = "cancel_order"
		} else if wantsAddress {
			action = "change_shipping_address"
		}
		approvalID := newID()
		_, err = r.Pool.Exec(ctx, `
			insert into "HumanApproval"
				(id, "taskId", "proposedAction", reason, "evidenceJson", status, "idempotencyKey", "createdAt", "updatedAt")
			values ($1,$2,$3,$4,$5,'pending',$6,now(),now())`,
			approvalID, st.taskID, action,
			fmt.Sprintf("Customer or operator requested %s, which requires human approval.", strings.ReplaceAll(action, "_", " ")),
			mustJSON(map[string]any{"orderNumber": order.OrderNumber, "source": "go_worker"}),
			fmt.Sprintf("%s:%s", st.taskID, action),
		)
		if err != nil {
			return err
		}
		_, _ = r.Pool.Exec(ctx, `
			update "AgentTask"
			set status = 'awaiting_approval',
			    "requiresHumanApproval" = true,
			    "selectedAction" = $2,
			    "investigationSummary" = $3,
			    "completedAt" = null
			where id = $1`, st.taskID, action, "Investigation complete. Restricted action awaiting human approval.")
		_ = r.addStep(ctx, st, "tool_result", "Requested human approval",
			fmt.Sprintf("Paused for approval: %s", action), "request_human_approval", "")
		_ = r.finishExecution(ctx, st, "awaiting_approval")
		return nil
	}

	// Status path: ticket + simulated email + resolve
	findings := []string{"We reviewed your order using available order and shipping records."}
	if prod.DelayReported {
		findings = []string{
			"Your order is still in production",
			"Production is delayed due to a material shortage",
			"The order has not shipped yet",
		}
	} else if order.TrackingNumber == nil || *order.TrackingNumber == "" {
		findings = []string{
			"Your order has not shipped yet",
			"Tracking is not available yet",
		}
	}

	ticketID := newID()
	category := "delivery_status_inquiry"
	if prod.DelayReported {
		category = "production_delay"
	}
	_, err = r.Pool.Exec(ctx, `
		insert into "SupportTicket"
			(id, "orderId", "customerId", category, description, priority, status, "createdBy", "createdAt", "updatedAt")
		values ($1,$2,$3,$4,$5,'medium','open','order_operations_agent',now(),now())`,
		ticketID, order.ID, order.CustomerID, category,
		fmt.Sprintf("Automated investigation finding for %s", order.OrderNumber))
	if err != nil {
		return err
	}
	_ = r.addStep(ctx, st, "tool_result", "Created support ticket",
		fmt.Sprintf("Opened internal ticket (%s).", category), "create_support_ticket",
		mustJSON(map[string]any{"ticketId": ticketID, "category": category}))

	emailID := newID()
	subject := fmt.Sprintf("Update on your order %s", order.OrderNumber)
	body := buildEmail(cust.Name, order.OrderNumber, findings)
	_, err = r.Pool.Exec(ctx, `
		insert into "SimulatedEmail"
			(id, "taskId", "orderId", "toEmail", subject, body, status, provider, "createdAt")
		values ($1,$2,$3,$4,$5,$6,'simulated_sent','go_worker_simulated',now())`,
		emailID, st.taskID, order.ID, cust.Email, "[SIMULATED] "+subject, body)
	if err != nil {
		return err
	}
	_ = r.addStep(ctx, st, "tool_result", "Sent simulated customer email",
		"Status email stored as simulated send.", "send_customer_email",
		mustJSON(map[string]any{"emailId": emailID}))

	final := map[string]any{
		"problemIdentified":          pickProblem(prod, order),
		"evidenceCollected":          []string{"Order details retrieved", "Production checked", "Shipment checked", "Simulated status email sent"},
		"investigationSummary":       "Go worker completed a tool-using investigation using verified database evidence.",
		"rootCause":                  prod.DelayReason,
		"proposedOrCompletedAction":  "Sent simulated customer status email and created support ticket where applicable",
		"approvalRequired":           false,
		"customerResponse":           "Simulated status email sent from verified findings",
		"remainingRisks":             []string{},
		"finalTaskStatus":            "resolved",
	}
	finalJSON := mustJSON(final)
	_, err = r.Pool.Exec(ctx, `
		update "AgentTask"
		set status = 'resolved',
		    "investigationSummary" = $2,
		    "reasoningSummary" = $3,
		    "finalResultJson" = $4,
		    "actionResult" = $5,
		    "completedAt" = now(),
		    "requiresHumanApproval" = false
		where id = $1`,
		st.taskID,
		final["investigationSummary"],
		final["problemIdentified"],
		finalJSON,
		final["proposedOrCompletedAction"])
	if err != nil {
		return err
	}
	_ = r.finishExecution(ctx, st, "completed")
	_ = r.addStep(ctx, st, "lifecycle", "Investigation completed", "Task resolved by Go worker.", "record_agent_outcome", finalJSON)
	return nil
}

type orderRow struct {
	ID               string
	OrderNumber      string
	OrderStatus      string
	ShippingStatus   string
	ProductionStatus string
	TrackingNumber   *string
	CustomerID       string
}

type prodRow struct {
	Stage         string
	DelayReported bool
	DelayReason   string
}

type shipRow struct {
	Status         string
	TrackingNumber string
}

type custRow struct {
	ID               string
	Name             string
	Email            string
	RecentOrderCount int
}

func (r *Runner) getOrder(ctx context.Context, orderNumber string) (orderRow, error) {
	var o orderRow
	err := r.Pool.QueryRow(ctx, `
		select id, "orderNumber", "orderStatus", "shippingStatus", "productionStatus", "trackingNumber", "customerId"
		from "Order" where "orderNumber" = $1 or id = $1 limit 1`, orderNumber).
		Scan(&o.ID, &o.OrderNumber, &o.OrderStatus, &o.ShippingStatus, &o.ProductionStatus, &o.TrackingNumber, &o.CustomerID)
	if err != nil {
		return o, fmt.Errorf("get order: %w", err)
	}
	return o, nil
}

func (r *Runner) getProduction(ctx context.Context, orderID string) (prodRow, error) {
	var p prodRow
	err := r.Pool.QueryRow(ctx, `
		select coalesce(stage, ''), coalesce("delayReported", false), coalesce("delayReason", '')
		from "ProductionRecord"
		where "orderId" = $1
		order by "updatedAt" desc
		limit 1`, orderID).Scan(&p.Stage, &p.DelayReported, &p.DelayReason)
	if err != nil {
		// Fall back to order production status
		var status string
		_ = r.Pool.QueryRow(ctx, `select "productionStatus" from "Order" where id = $1`, orderID).Scan(&status)
		p.Stage = status
		p.DelayReported = strings.Contains(strings.ToLower(status), "delay")
	}
	return p, nil
}

func (r *Runner) getShipment(ctx context.Context, orderID string, tracking *string) (shipRow, error) {
	var s shipRow
	if tracking != nil {
		s.TrackingNumber = *tracking
	}
	err := r.Pool.QueryRow(ctx, `
		select coalesce(status, ''), coalesce("trackingNumber", '')
		from "ShipmentEvent"
		where "orderId" = $1
		order by "eventAt" desc
		limit 1`, orderID).Scan(&s.Status, &s.TrackingNumber)
	if err != nil {
		var shipStatus string
		_ = r.Pool.QueryRow(ctx, `select "shippingStatus" from "Order" where id = $1`, orderID).Scan(&shipStatus)
		s.Status = shipStatus
	}
	return s, nil
}

func (r *Runner) getCustomer(ctx context.Context, customerID string) (custRow, error) {
	var c custRow
	err := r.Pool.QueryRow(ctx, `
		select c.id, c.name, c.email,
		       (select count(*) from "Order" o where o."customerId" = c.id)
		from "Customer" c
		where c.id = $1 or c."externalId" = $1
		limit 1`, customerID).Scan(&c.ID, &c.Name, &c.Email, &c.RecentOrderCount)
	if err != nil {
		return c, fmt.Errorf("get customer: %w", err)
	}
	return c, nil
}

func (r *Runner) addStep(ctx context.Context, st *runState, stepType, title, detail, toolName, resultJSON string) error {
	st.stepIndex++
	id := newID()
	_, err := r.Pool.Exec(ctx, `
		insert into "AgentStep"
			(id, "executionId", "stepIndex", "stepType", title, detail, "toolName", "toolResultJson", status, "createdAt")
		values ($1,$2,$3,$4,$5,$6,nullif($7,''),nullif($8,''),'completed',now())`,
		id, st.execID, st.stepIndex, stepType, title, detail, toolName, resultJSON)
	return err
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

func pickProblem(prod prodRow, order orderRow) string {
	if prod.DelayReported {
		return "Production delay"
	}
	if order.TrackingNumber == nil || *order.TrackingNumber == "" {
		return "Missing tracking"
	}
	return "Order operations investigation"
}

func buildEmail(name, orderNumber string, findings []string) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("Hi %s,\n\nThank you for checking in on order %s.\n\nHere is what we can confirm right now:\n", name, orderNumber))
	for _, f := range findings {
		b.WriteString("• " + f + "\n")
	}
	b.WriteString("\nWe are continuing to monitor this and will follow up if anything meaningful changes.\n\nThank you for your patience,\nCommerceOps Support\n")
	return b.String()
}
