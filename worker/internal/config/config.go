package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Addr            string
	DatabaseURL     string
	OpenAIKey       string
	OpenAIModel     string
	PreferSimulated bool
	TimeoutSeconds  int
}

func Load() Config {
	db := firstNonEmpty(os.Getenv("DIRECT_URL"), os.Getenv("DATABASE_URL"))
	timeout := 90
	if v := os.Getenv("AGENT_TIMEOUT_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			timeout = n
		}
	}
	preferSim := strings.EqualFold(os.Getenv("AGENT_PROVIDER"), "simulated") ||
		os.Getenv("OPENAI_API_KEY") == ""

	return Config{
		Addr:            firstNonEmpty(os.Getenv("WORKER_ADDR"), ":8080"),
		DatabaseURL:     db,
		OpenAIKey:       os.Getenv("OPENAI_API_KEY"),
		OpenAIModel:     firstNonEmpty(os.Getenv("OPENAI_MODEL"), "gpt-5-mini"),
		PreferSimulated: preferSim,
		TimeoutSeconds:  timeout,
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
