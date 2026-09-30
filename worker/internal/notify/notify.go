package notify

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// Emit tells the Next.js app about task/step changes so SSE clients stay in sync.
// Safe no-op when NEXT_APP_URL / APP_URL is unset.
func Emit(event map[string]any) {
	base := strings.TrimRight(firstNonEmpty(os.Getenv("NEXT_APP_URL"), os.Getenv("APP_URL"), "http://127.0.0.1:3000"), "/")
	if base == "" {
		return
	}
	body, err := json.Marshal(event)
	if err != nil {
		return
	}
	go func() {
		client := &http.Client{Timeout: 3 * time.Second}
		req, err := http.NewRequest(http.MethodPost, base+"/api/worker/events", bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		res, err := client.Do(req)
		if err != nil {
			log.Printf("notify next failed: %v", err)
			return
		}
		_ = res.Body.Close()
		if res.StatusCode >= 300 {
			log.Printf("notify next http %d", res.StatusCode)
		}
	}()
}

func TaskUpdated(taskID, taskNumber, status string) {
	Emit(map[string]any{
		"type":       "task_updated",
		"taskId":     taskID,
		"taskNumber": taskNumber,
		"status":     status,
		"reason":     "go_worker_" + status,
	})
}

func StepAdded(taskID, executionID string, step map[string]any) {
	Emit(map[string]any{
		"type":        "step_added",
		"taskId":      taskID,
		"executionId": executionID,
		"step":        step,
	})
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
