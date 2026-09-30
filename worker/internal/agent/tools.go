package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/ManishPolepaka/StickerMuleAgent/worker/internal/notify"
	"github.com/ManishPolepaka/StickerMuleAgent/worker/internal/openai"
)

func toolDefinitions() []openai.ToolDef {
	obj := func(props map[string]any, required []string) map[string]any {
		if required == nil {
			required = []string{}
		}
		return map[string]any{
			"type":                 "object",
			"properties":           props,
			"required":             required,
			"additionalProperties": false,
		}
	}
	return []openai.ToolDef{
		{
			Name:        "get_order_details",
			Description: "Retrieve order details, customer details, production/shipping status, expected delivery, and tracking info by order number or internal id.",
			Parameters:  obj(map[string]any{"orderId": map[string]any{"type": "string", "description": "Order number (e.g. ORD-1005) or internal ID"}}, []string{"orderId"}),
		},
		{
			Name:        "get_production_status",
			Description: "Get production stage, estimated completion, and reported delays for an order from Supabase.",
			Parameters:  obj(map[string]any{"orderId": map[string]any{"type": "string"}}, []string{"orderId"}),
		},
		{
			Name:        "track_shipment",
			Description: "Track a shipment using tracking number or order ID from Supabase shipping records.",
			Parameters: obj(map[string]any{
				"trackingNumber": map[string]any{"type": "string"},
				"orderId":        map[string]any{"type": "string"},
			}, []string{}),
		},
		{
			Name:        "get_customer_history",
			Description: "Return previous orders, support interactions, and notes for a customer.",
			Parameters:  obj(map[string]any{"customerId": map[string]any{"type": "string"}}, []string{"customerId"}),
		},
		{
			Name:        "create_support_ticket",
			Description: "Create an internal support ticket in the application database.",
			Parameters: obj(map[string]any{
				"orderId":       map[string]any{"type": "string"},
				"issueCategory": map[string]any{"type": "string"},
				"description":   map[string]any{"type": "string"},
				"priority":      map[string]any{"type": "string", "enum": []string{"low", "medium", "high", "urgent"}},
			}, []string{"orderId", "issueCategory", "description"}),
		},
		{
			Name:        "draft_customer_email",
			Description: "Draft a professional customer email from verified findings. Plain language only.",
			Parameters: obj(map[string]any{
				"orderId":               map[string]any{"type": "string"},
				"verifiedFindings":      map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"intendedCommunication": map[string]any{"type": "string"},
			}, []string{"orderId", "verifiedFindings", "intendedCommunication"}),
		},
		{
			Name:        "send_customer_email",
			Description: "Send a verified customer status/update email via the simulated provider (auto-allowed). Does not send real SMTP mail.",
			Parameters: obj(map[string]any{
				"customerEmail":  map[string]any{"type": "string"},
				"subject":        map[string]any{"type": "string"},
				"message":        map[string]any{"type": "string"},
				"relatedOrderId": map[string]any{"type": "string"},
			}, []string{"customerEmail", "subject", "message", "relatedOrderId"}),
		},
		{
			Name:        "request_human_approval",
			Description: "Pause for human approval ONLY for restricted actions: refunds, credits, discounts, cancellations, shipping-address changes, or compensation.",
			Parameters: obj(map[string]any{
				"proposedAction":     map[string]any{"type": "string"},
				"reason":             map[string]any{"type": "string"},
				"relatedOrderId":     map[string]any{"type": "string"},
				"supportingEvidence": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			}, []string{"proposedAction", "reason", "relatedOrderId"}),
		},
		{
			Name:        "escalate_task",
			Description: "Mark the task as requiring human intervention and record the reason.",
			Parameters: obj(map[string]any{
				"taskId":              map[string]any{"type": "string"},
				"escalationReason":    map[string]any{"type": "string"},
				"supportingEvidence":  map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"recommendedNextStep": map[string]any{"type": "string"},
			}, []string{"taskId", "escalationReason", "recommendedNextStep"}),
		},
		{
			Name:        "record_agent_outcome",
			Description: "Persist the final investigation outcome for dashboards and evaluations.",
			Parameters: obj(map[string]any{
				"taskId":       map[string]any{"type": "string"},
				"finalStatus":  map[string]any{"type": "string", "enum": []string{"resolved", "awaiting_approval", "escalated", "failed", "needs_human"}},
				"actionsTaken": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"evidence":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"summary":      map[string]any{"type": "string"},
			}, []string{"taskId", "finalStatus", "summary"}),
		},
	}
}

type toolResult struct {
	OK    bool   `json:"ok"`
	Data  any    `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

func (r *Runner) executeTool(ctx context.Context, st *runState, name string, args map[string]any) toolResult {
	switch name {
	case "get_order_details":
		return r.toolGetOrder(ctx, strArg(args, "orderId"))
	case "get_production_status":
		return r.toolGetProduction(ctx, strArg(args, "orderId"))
	case "track_shipment":
		return r.toolTrackShipment(ctx, strArg(args, "orderId"), strArg(args, "trackingNumber"))
	case "get_customer_history":
		return r.toolGetCustomer(ctx, st, strArg(args, "customerId"))
	case "create_support_ticket":
		return r.toolCreateTicket(ctx, args)
	case "draft_customer_email":
		return r.toolDraftEmail(ctx, args)
	case "send_customer_email":
		return r.toolSendEmail(ctx, st, args)
	case "request_human_approval":
		return r.toolRequestApproval(ctx, st, args)
	case "escalate_task":
		return r.toolEscalate(ctx, st, args)
	case "record_agent_outcome":
		return r.toolRecordOutcome(ctx, st, args)
	default:
		return toolResult{OK: false, Error: "Unknown tool: " + name}
	}
}

func (r *Runner) toolGetOrder(ctx context.Context, orderID string) toolResult {
	if orderID == "" {
		return toolResult{OK: false, Error: "orderId is required"}
	}
	var (
		id, number, status, ship, prod, customerID, name, email string
		tracking, carrier, address, notes, issue                 *string
		orderDate, expected                                      *time.Time
		value                                                    *float64
		extID                                                    *string
		custNotes                                                *string
	)
	err := r.Pool.QueryRow(ctx, `
		select o.id, o."orderNumber", o."orderStatus", o."shippingStatus", o."productionStatus",
		       o."trackingNumber", o."shippingCarrier", o."shippingAddress", o."orderValue",
		       o."customerNotes", o."issueType", o."orderDate", o."expectedDeliveryDate", o."customerId",
		       c.name, c.email, c."externalId", c.notes
		from "Order" o
		join "Customer" c on c.id = o."customerId"
		where o."orderNumber" = $1 or o.id = $1
		limit 1`, orderID).Scan(
		&id, &number, &status, &ship, &prod,
		&tracking, &carrier, &address, &value,
		&notes, &issue, &orderDate, &expected, &customerID,
		&name, &email, &extID, &custNotes,
	)
	if err != nil {
		return toolResult{OK: false, Error: fmt.Sprintf("Order not found: %s", orderID)}
	}
	return toolResult{OK: true, Data: map[string]any{
		"order": map[string]any{
			"id": id, "orderNumber": number, "orderDate": orderDate, "expectedDeliveryDate": expected,
			"orderStatus": status, "productionStatus": prod, "shippingStatus": ship,
			"trackingNumber": tracking, "shippingCarrier": carrier, "shippingAddress": address,
			"orderValue": value, "customerNotes": notes, "issueType": issue,
		},
		"customer": map[string]any{
			"id": customerID, "externalId": extID, "name": name, "email": email, "notes": custNotes,
		},
		"source": "supabase",
	}}
}

func (r *Runner) toolGetProduction(ctx context.Context, orderID string) toolResult {
	order, err := r.resolveOrder(ctx, orderID)
	if err != nil {
		return toolResult{OK: false, Error: err.Error()}
	}
	var stage string
	var delayReported bool
	var delayReason, notes *string
	var started, eta *time.Time
	err = r.Pool.QueryRow(ctx, `
		select coalesce(stage, ''), coalesce("delayReported", false), "delayReason", notes, "startedAt", "estimatedCompletionAt"
		from "ProductionRecord"
		where "orderId" = $1
		order by "updatedAt" desc
		limit 1`, order.ID).Scan(&stage, &delayReported, &delayReason, &notes, &started, &eta)
	if err != nil {
		stage = order.ProductionStatus
		delayReported = strings.Contains(strings.ToLower(stage), "delay")
	}
	return toolResult{OK: true, Data: map[string]any{
		"orderNumber":             order.OrderNumber,
		"productionStatus":        order.ProductionStatus,
		"currentStage":            stage,
		"productionStartTime":     started,
		"estimatedCompletionTime": eta,
		"delayReported":           delayReported,
		"delayReason":             delayReason,
		"notes":                   notes,
		"integration":             "supabase",
	}}
}

func (r *Runner) toolTrackShipment(ctx context.Context, orderID, tracking string) toolResult {
	if orderID == "" && tracking == "" {
		return toolResult{OK: false, Error: "Provide trackingNumber or orderId"}
	}
	var (
		id, number, shipStatus string
		track, carrier         *string
		expected               *time.Time
	)
	q := `
		select id, "orderNumber", "shippingStatus", "trackingNumber", "shippingCarrier", "expectedDeliveryDate"
		from "Order" where `
	var arg string
	if orderID != "" {
		q += `"orderNumber" = $1 or id = $1 limit 1`
		arg = orderID
	} else {
		q += `"trackingNumber" = $1 limit 1`
		arg = tracking
	}
	err := r.Pool.QueryRow(ctx, q, arg).Scan(&id, &number, &shipStatus, &track, &carrier, &expected)
	if err != nil {
		return toolResult{OK: false, Error: "Shipment / order not found"}
	}
	if track == nil || *track == "" {
		return toolResult{OK: true, Data: map[string]any{
			"orderNumber": number, "carrier": carrier, "trackingNumber": nil,
			"shipmentStatus": shipStatus, "latestTrackingEvent": nil,
			"estimatedDeliveryDate": expected, "note": "Missing tracking number on this order.",
			"integration": "supabase",
		}}
	}

	var label, status, location *string
	var eventAt *time.Time
	_ = r.Pool.QueryRow(ctx, `
		select "eventLabel", status, location, "eventAt"
		from "ShipmentEvent"
		where "orderId" = $1
		order by "eventAt" desc
		limit 1`, id).Scan(&label, &status, &location, &eventAt)

	latest := any(nil)
	if status != nil {
		latest = map[string]any{"label": label, "status": status, "location": location, "eventAt": eventAt}
	}
	ship := shipStatus
	if status != nil {
		ship = *status
	}
	return toolResult{OK: true, Data: map[string]any{
		"orderNumber": number, "carrier": carrier, "trackingNumber": track,
		"shipmentStatus": ship, "latestTrackingEvent": latest,
		"estimatedDeliveryDate": expected, "integration": "supabase",
	}}
}

func (r *Runner) toolGetCustomer(ctx context.Context, st *runState, customerID string) toolResult {
	if customerID == "" || strings.EqualFold(customerID, "CURRENT") {
		if st.orderID != nil && *st.orderID != "" {
			var cid string
			if err := r.Pool.QueryRow(ctx, `select "customerId" from "Order" where id = $1`, *st.orderID).Scan(&cid); err == nil {
				customerID = cid
			}
		}
		if customerID == "" || strings.EqualFold(customerID, "CURRENT") {
			if st.orderNumber != "" {
				var cid string
				if err := r.Pool.QueryRow(ctx, `select "customerId" from "Order" where "orderNumber" = $1`, st.orderNumber).Scan(&cid); err == nil {
					customerID = cid
				}
			}
		}
	}
	if customerID == "" || strings.EqualFold(customerID, "CURRENT") {
		return toolResult{OK: false, Error: "customerId is required (use customer.id from get_order_details)"}
	}
	// Allow order numbers accidentally passed as customerId.
	if strings.HasPrefix(strings.ToUpper(customerID), "ORD-") {
		var cid string
		if err := r.Pool.QueryRow(ctx, `select "customerId" from "Order" where "orderNumber" = $1 limit 1`, customerID).Scan(&cid); err == nil {
			customerID = cid
		}
	}

	var id, name string
	var extID, notes *string
	err := r.Pool.QueryRow(ctx, `
		select id, name, "externalId", notes from "Customer"
		where id = $1 or "externalId" = $1 limit 1`, customerID).Scan(&id, &name, &extID, &notes)
	if err != nil {
		return toolResult{OK: false, Error: fmt.Sprintf("Customer not found: %s", customerID)}
	}

	rows, err := r.Pool.Query(ctx, `
		select "orderNumber", "orderStatus", "orderDate", "orderValue", "issueType"
		from "Order" where "customerId" = $1
		order by "orderDate" desc limit 5`, id)
	if err != nil {
		return toolResult{OK: false, Error: err.Error()}
	}
	defer rows.Close()
	orders := []map[string]any{}
	for rows.Next() {
		var on, os string
		var od *time.Time
		var ov *float64
		var it *string
		_ = rows.Scan(&on, &os, &od, &ov, &it)
		orders = append(orders, map[string]any{
			"orderNumber": on, "orderStatus": os, "orderDate": od, "orderValue": ov, "issueType": it,
		})
	}

	srows, _ := r.Pool.Query(ctx, `
		select channel, subject, summary, "createdAt"
		from "SupportInteraction"
		where "customerId" = $1
		order by "createdAt" desc limit 5`, id)
	interactions := []map[string]any{}
	if srows != nil {
		defer srows.Close()
		for srows.Next() {
			var ch, sub, sum string
			var created time.Time
			_ = srows.Scan(&ch, &sub, &sum, &created)
			interactions = append(interactions, map[string]any{
				"channel": ch, "subject": sub, "summary": sum, "createdAt": created,
			})
		}
	}

	return toolResult{OK: true, Data: map[string]any{
		"customerId": id, "externalId": extID, "name": name, "notes": notes,
		"recentOrders": orders, "previousSupportInteractions": interactions,
	}}
}

func (r *Runner) toolCreateTicket(ctx context.Context, args map[string]any) toolResult {
	order, err := r.resolveOrder(ctx, strArg(args, "orderId"))
	if err != nil {
		return toolResult{OK: false, Error: err.Error()}
	}
	priority := strArg(args, "priority")
	if priority == "" {
		priority = "medium"
	}
	id := newID()
	_, err = r.Pool.Exec(ctx, `
		insert into "SupportTicket"
			(id, "orderId", "customerId", category, description, priority, status, "createdBy", "createdAt", "updatedAt")
		values ($1,$2,$3,$4,$5,$6,'open','order_operations_agent',now(),now())`,
		id, order.ID, order.CustomerID, strArg(args, "issueCategory"), strArg(args, "description"), priority)
	if err != nil {
		return toolResult{OK: false, Error: err.Error()}
	}
	return toolResult{OK: true, Data: map[string]any{
		"ticketId": id, "status": "open", "category": strArg(args, "issueCategory"), "priority": priority,
	}}
}

func (r *Runner) toolDraftEmail(ctx context.Context, args map[string]any) toolResult {
	order, err := r.resolveOrder(ctx, strArg(args, "orderId"))
	if err != nil {
		return toolResult{OK: false, Error: err.Error()}
	}
	var name, email string
	_ = r.Pool.QueryRow(ctx, `select name, email from "Customer" where id = $1`, order.CustomerID).Scan(&name, &email)
	findings := strSlice(args, "verifiedFindings")
	closing := humanizeCustomerText(strArg(args, "intendedCommunication"))
	subject := fmt.Sprintf("Update on your order %s", order.OrderNumber)
	body := buildEmail(name, order.OrderNumber, findings)
	if closing != "" {
		body += "\n" + closing + "\n"
	}
	return toolResult{OK: true, Data: map[string]any{
		"to": email, "subject": subject, "body": humanizeCustomerText(body),
		"orderNumber": order.OrderNumber, "draftOnly": true,
		"note": "Draft only — not sent.",
	}}
}

func (r *Runner) toolSendEmail(ctx context.Context, st *runState, args map[string]any) toolResult {
	order, err := r.resolveOrder(ctx, strArg(args, "relatedOrderId"))
	if err != nil {
		return toolResult{OK: false, Error: err.Error()}
	}
	subject := humanizeCustomerText(strArg(args, "subject"))
	body := humanizeCustomerText(strArg(args, "message"))
	id := newID()
	_, err = r.Pool.Exec(ctx, `
		insert into "SimulatedEmail"
			(id, "taskId", "orderId", "toEmail", subject, body, status, provider, "createdAt")
		values ($1,$2,$3,$4,$5,$6,'simulated_sent','openai_via_go_worker',now())`,
		id, st.taskID, order.ID, strArg(args, "customerEmail"), "[SIMULATED] "+subject, body)
	if err != nil {
		return toolResult{OK: false, Error: err.Error()}
	}
	return toolResult{OK: true, Data: map[string]any{
		"emailId": id, "deliveryResult": "simulated_accepted",
		"provider": "openai_via_go_worker", "labeled": "SIMULATED — no real email was sent",
	}}
}

func (r *Runner) toolRequestApproval(ctx context.Context, st *runState, args map[string]any) toolResult {
	action := strArg(args, "proposedAction")
	if !isRestrictedAction(action) {
		return toolResult{OK: false, Error: "request_human_approval is only for restricted actions (refund/credit/cancel/address/compensation)."}
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%s", st.taskID, action, strArg(args, "relatedOrderId"))))
	key := hex.EncodeToString(sum[:])[:32]

	var existingID, existingStatus string
	err := r.Pool.QueryRow(ctx, `select id, status from "HumanApproval" where "idempotencyKey" = $1`, key).
		Scan(&existingID, &existingStatus)
	if err == nil {
		return toolResult{OK: true, Data: map[string]any{
			"approvalId": existingID, "status": existingStatus, "idempotent": true,
			"pauseExecution": existingStatus == "pending",
		}}
	}

	id := newID()
	_, err = r.Pool.Exec(ctx, `
		insert into "HumanApproval"
			(id, "taskId", "executionId", "proposedAction", reason, "evidenceJson", status, "idempotencyKey", "createdAt")
		values ($1,$2,$3,$4,$5,$6,'pending',$7,now())`,
		id, st.taskID, st.execID, action, strArg(args, "reason"),
		mustJSON(map[string]any{
			"relatedOrderId":     strArg(args, "relatedOrderId"),
			"supportingEvidence": strSlice(args, "supportingEvidence"),
			"restricted":         true,
		}), key)
	if err != nil {
		return toolResult{OK: false, Error: err.Error()}
	}
	_, _ = r.Pool.Exec(ctx, `
		update "AgentTask"
		set status = 'awaiting_approval', "requiresHumanApproval" = true, "selectedAction" = $2
		where id = $1`, st.taskID, action)
	notify.TaskUpdated(st.taskID, st.taskNumber, "awaiting_approval")
	return toolResult{OK: true, Data: map[string]any{
		"approvalId": id, "status": "pending", "pauseExecution": true,
		"message": "Execution paused until a human approves or rejects this action.",
	}}
}

func (r *Runner) toolEscalate(ctx context.Context, st *runState, args map[string]any) toolResult {
	taskID := strArg(args, "taskId")
	if taskID == "" || strings.EqualFold(taskID, "CURRENT") {
		taskID = st.taskID
	}
	payload := map[string]any{
		"escalationReason":    strArg(args, "escalationReason"),
		"supportingEvidence":  strSlice(args, "supportingEvidence"),
		"recommendedNextStep": strArg(args, "recommendedNextStep"),
	}
	_, err := r.Pool.Exec(ctx, `
		update "AgentTask"
		set status = 'escalated', "requiresHumanApproval" = true,
		    "actionResult" = $2, "reasoningSummary" = $3
		where id = $1`, taskID, mustJSON(payload), strArg(args, "escalationReason"))
	if err != nil {
		return toolResult{OK: false, Error: err.Error()}
	}
	notify.TaskUpdated(st.taskID, st.taskNumber, "escalated")
	return toolResult{OK: true, Data: map[string]any{
		"taskId": taskID, "status": "escalated", "recommendedNextStep": strArg(args, "recommendedNextStep"),
	}}
}

func (r *Runner) toolRecordOutcome(ctx context.Context, st *runState, args map[string]any) toolResult {
	taskID := strArg(args, "taskId")
	if taskID == "" || strings.EqualFold(taskID, "CURRENT") {
		taskID = st.taskID
	}
	status := strArg(args, "finalStatus")
	summary := strArg(args, "summary")
	payload := map[string]any{
		"finalStatus":  status,
		"actionsTaken": strSlice(args, "actionsTaken"),
		"evidence":     strSlice(args, "evidence"),
		"summary":      summary,
		"recordedAt":   time.Now().UTC().Format(time.RFC3339),
	}
	completed := "now()"
	q := `
		update "AgentTask"
		set status = $2, "investigationSummary" = $3, "actionResult" = $4, "finalResultJson" = $4,
		    "completedAt" = case when $2 = 'awaiting_approval' then null else now() end
		where id = $1`
	_, err := r.Pool.Exec(ctx, q, taskID, status, summary, mustJSON(payload))
	if err != nil {
		return toolResult{OK: false, Error: err.Error()}
	}
	_ = completed
	notify.TaskUpdated(st.taskID, st.taskNumber, status)
	return toolResult{OK: true, Data: map[string]any{"taskId": taskID, "recorded": true, "finalStatus": status, "summary": summary}}
}

type resolvedOrder struct {
	ID               string
	OrderNumber      string
	ProductionStatus string
	CustomerID       string
}

func (r *Runner) resolveOrder(ctx context.Context, orderID string) (resolvedOrder, error) {
	var o resolvedOrder
	if orderID == "" {
		return o, fmt.Errorf("orderId is required")
	}
	err := r.Pool.QueryRow(ctx, `
		select id, "orderNumber", "productionStatus", "customerId"
		from "Order" where "orderNumber" = $1 or id = $1 limit 1`, orderID).
		Scan(&o.ID, &o.OrderNumber, &o.ProductionStatus, &o.CustomerID)
	if err != nil {
		return o, fmt.Errorf("Order not found: %s", orderID)
	}
	return o, nil
}

func isRestrictedAction(action string) bool {
	n := strings.ToLower(strings.ReplaceAll(action, " ", "_"))
	keys := []string{
		"issue_refund", "issuerefund",
		"issue_credit", "issuecredit",
		"issue_discount", "issuediscount",
		"cancel_order", "cancelorder",
		"change_shipping_address", "changeshippingaddress",
		"promise_compensation", "promisecompensation",
	}
	for _, k := range keys {
		if strings.Contains(n, k) {
			return true
		}
	}
	return false
}

func strArg(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	default:
		b, _ := json.Marshal(t)
		return strings.Trim(string(b), `"`)
	}
}

func strSlice(m map[string]any, key string) []string {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch t := v.(type) {
	case []string:
		return t
	case []any:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}

var (
	isoTS   = regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?\b`)
	isoDate = regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}\b`)
	snake   = regexp.MustCompile(`\b[a-z]+(?:_[a-z0-9]+)+\b`)
)

func humanizeCustomerText(raw string) string {
	if raw == "" {
		return ""
	}
	text := strings.ReplaceAll(raw, "**", "")
	text = isoTS.ReplaceAllStringFunc(text, func(iso string) string {
		t, err := time.Parse(time.RFC3339Nano, iso)
		if err != nil {
			t, err = time.Parse(time.RFC3339, iso)
		}
		if err != nil {
			return iso
		}
		return t.Format("January 2, 2006")
	})
	text = isoDate.ReplaceAllStringFunc(text, func(ymd string) string {
		t, err := time.Parse("2006-01-02", ymd)
		if err != nil {
			return ymd
		}
		return t.Format("January 2, 2006")
	})
	replacements := map[string]string{
		"not_shipped": "has not shipped yet", "in_production": "is still in production",
		"material_shortage": "a material shortage", "production_delay": "a production delay",
		"missing_tracking": "tracking is not available yet", "in_transit": "is in transit",
	}
	text = snake.ReplaceAllStringFunc(text, func(m string) string {
		if v, ok := replacements[strings.ToLower(m)]; ok {
			return v
		}
		return strings.ReplaceAll(m, "_", " ")
	})
	return strings.TrimSpace(text)
}

func titleForTool(name string) string {
	m := map[string]string{
		"get_order_details":      "Retrieved order details",
		"get_production_status":  "Checked production status",
		"track_shipment":         "Checked shipment tracking",
		"get_customer_history":   "Reviewed customer history",
		"create_support_ticket":  "Created support ticket",
		"draft_customer_email":   "Drafted customer response",
		"send_customer_email":    "Sent simulated customer email",
		"request_human_approval": "Requested human approval",
		"escalate_task":          "Escalated task",
		"record_agent_outcome":   "Recorded agent outcome",
	}
	if v, ok := m[name]; ok {
		return v
	}
	return "Called " + name
}
