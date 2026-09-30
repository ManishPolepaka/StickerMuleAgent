package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	APIKey string
	Model  string
	HTTP   *http.Client
}

type ToolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type Message struct {
	Role       string     `json:"role"`
	Content    string     `json:"content,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
}

type ToolCall struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type Usage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

type Response struct {
	Content      string
	ToolCalls    []ToolCall
	FinishReason string
	Usage        Usage
}

func New(apiKey, model string) *Client {
	return &Client{
		APIKey: apiKey,
		Model:  firstNonEmpty(model, "gpt-5-mini"),
		HTTP:   &http.Client{Timeout: 45 * time.Second},
	}
}

func (c *Client) Complete(ctx context.Context, messages []Message, tools []ToolDef) (*Response, error) {
	if strings.TrimSpace(c.APIKey) == "" {
		return nil, fmt.Errorf("OPENAI_API_KEY is not configured")
	}

	payload := map[string]any{
		"model":       c.Model,
		"messages":    toAPIMessages(messages),
		"tools":       toAPITools(tools),
		"tool_choice": "auto",
	}
	if supportsTemperature(c.Model) {
		payload["temperature"] = 0.2
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.openai.com/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("openai http %d: %s", res.StatusCode, truncate(string(raw), 500))
	}

	var parsed apiResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("openai decode: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("openai returned no choices")
	}

	choice := parsed.Choices[0]
	out := &Response{
		Content:      choice.Message.Content,
		FinishReason: choice.FinishReason,
		Usage: Usage{
			PromptTokens:     parsed.Usage.PromptTokens,
			CompletionTokens: parsed.Usage.CompletionTokens,
			TotalTokens:      parsed.Usage.TotalTokens,
		},
	}
	for _, tc := range choice.Message.ToolCalls {
		args := map[string]any{}
		_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
		out.ToolCalls = append(out.ToolCalls, ToolCall{
			ID:        tc.ID,
			Type:      "function",
			Name:      tc.Function.Name,
			Arguments: args,
		})
	}
	if len(out.ToolCalls) > 0 {
		out.FinishReason = "tool_calls"
	}
	return out, nil
}

type apiResponse struct {
	Choices []struct {
		FinishReason string `json:"finish_reason"`
		Message      struct {
			Content   string `json:"content"`
			ToolCalls []struct {
				ID       string `json:"id"`
				Type     string `json:"type"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func toAPIMessages(messages []Message) []map[string]any {
	out := make([]map[string]any, 0, len(messages))
	for _, m := range messages {
		item := map[string]any{"role": m.Role}
		switch m.Role {
		case "tool":
			item["tool_call_id"] = m.ToolCallID
			item["content"] = m.Content
		case "assistant":
			item["content"] = m.Content
			if len(m.ToolCalls) > 0 {
				calls := make([]map[string]any, 0, len(m.ToolCalls))
				for _, tc := range m.ToolCalls {
					args, _ := json.Marshal(tc.Arguments)
					calls = append(calls, map[string]any{
						"id":   tc.ID,
						"type": "function",
						"function": map[string]any{
							"name":      tc.Name,
							"arguments": string(args),
						},
					})
				}
				item["tool_calls"] = calls
			}
		default:
			item["content"] = m.Content
		}
		out = append(out, item)
	}
	return out
}

func toAPITools(tools []ToolDef) []map[string]any {
	out := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		out = append(out, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        t.Name,
				"description": t.Description,
				"parameters":  t.Parameters,
			},
		})
	}
	return out
}

func supportsTemperature(model string) bool {
	return !strings.HasPrefix(strings.ToLower(model), "gpt-5")
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
