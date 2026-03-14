package api

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
)

// SSEEvent represents a Server-Sent Event.
type SSEEvent struct {
	ID    string
	Event string
	Data  string
}

// SSEClient connects to a Server-Sent Events endpoint.
type SSEClient struct {
	baseURL string
	token   string
	client  *http.Client
	cancel  chan struct{}
	mu      sync.Mutex

	// OnEvent is called for each received SSE event.
	OnEvent func(SSEEvent)
	// OnError is called when an error occurs.
	OnError func(error)
}

// NewSSEClient creates a new SSE client.
func NewSSEClient(baseURL, token string) *SSEClient {
	return &SSEClient{
		baseURL: baseURL,
		token:   token,
		client:  &http.Client{},
		cancel:  make(chan struct{}),
	}
}

// Connect starts listening for events on the given path.
func (s *SSEClient) Connect(path string) error {
	url := s.baseURL + path
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("creating SSE request: %w", err)
	}

	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("SSE connection failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		return fmt.Errorf("SSE server returned HTTP %d", resp.StatusCode)
	}

	go s.readLoop(resp)

	return nil
}

// Close stops the SSE connection.
func (s *SSEClient) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()

	select {
	case <-s.cancel:
		// Already closed
	default:
		close(s.cancel)
	}
}

// readLoop reads events from the SSE stream.
func (s *SSEClient) readLoop(resp *http.Response) {
	defer func() { _ = resp.Body.Close() }()

	scanner := bufio.NewScanner(resp.Body)
	var event SSEEvent

	for scanner.Scan() {
		select {
		case <-s.cancel:
			return
		default:
		}

		line := scanner.Text()

		// Empty line signals end of event
		if line == "" {
			if event.Data != "" {
				if s.OnEvent != nil {
					s.OnEvent(event)
				}
			}
			event = SSEEvent{}
			continue
		}

		// Parse SSE field.
		switch {
		case strings.HasPrefix(line, "data: "):
			data := strings.TrimPrefix(line, "data: ")
			if event.Data != "" {
				event.Data += "\n"
			}
			event.Data += data
		case strings.HasPrefix(line, "event: "):
			event.Event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "id: "):
			event.ID = strings.TrimPrefix(line, "id: ")
		}
	}

	if err := scanner.Err(); err != nil {
		if s.OnError != nil {
			s.OnError(err)
		}
	}
}
