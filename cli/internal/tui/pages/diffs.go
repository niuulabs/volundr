package pages

import (
	"fmt"
	"image/color"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	tui "github.com/niuulabs/volundr/cli/internal/tui"
)

// DiffFile represents a file in the diff tree.
type DiffFile struct {
	Path     string
	Status   string // "M" modified, "A" added, "D" deleted
	Diff     string
	Additions int
	Deletions int
}

// DiffsPage displays a file tree and diff viewer.
type DiffsPage struct {
	files     []DiffFile
	cursor    int
	scrollPos int
	width     int
	height    int
}

// NewDiffsPage creates a new diffs page with demo data.
func NewDiffsPage() DiffsPage {
	return DiffsPage{
		files: demoDiffFiles(),
	}
}

// Init initializes the diffs page.
func (d DiffsPage) Init() tea.Cmd {
	return nil
}

// Update handles messages for the diffs page.
func (d DiffsPage) Update(msg tea.Msg) (DiffsPage, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if d.cursor > 0 {
				d.cursor--
				d.scrollPos = 0
			}
		case "down", "j":
			if d.cursor < len(d.files)-1 {
				d.cursor++
				d.scrollPos = 0
			}
		case "J":
			d.scrollPos++
		case "K":
			if d.scrollPos > 0 {
				d.scrollPos--
			}
		}
	}
	return d, nil
}

// SetSize updates the page dimensions.
func (d *DiffsPage) SetSize(w, h int) {
	d.width = w
	d.height = h
}

// View renders the diffs page.
func (d DiffsPage) View() string {
	theme := tui.DefaultTheme

	titleStyle := lipgloss.NewStyle().
		Foreground(theme.TextPrimary).
		Bold(true).
		MarginBottom(1)

	// Split: file tree (left) and diff viewer (right)
	treeWidth := 35
	diffWidth := d.width - treeWidth - 8

	// File tree
	tree := d.renderFileTree(treeWidth, d.height-4)

	// Diff viewer
	diff := d.renderDiffView(diffWidth, d.height-4)

	content := lipgloss.JoinHorizontal(lipgloss.Top, tree, "  ", diff)

	// Stats summary
	totalAdd := 0
	totalDel := 0
	for _, f := range d.files {
		totalAdd += f.Additions
		totalDel += f.Deletions
	}

	stats := fmt.Sprintf("  %s  %s  %s files changed",
		lipgloss.NewStyle().Foreground(theme.AccentEmerald).Render(fmt.Sprintf("+%d", totalAdd)),
		lipgloss.NewStyle().Foreground(theme.AccentRed).Render(fmt.Sprintf("-%d", totalDel)),
		lipgloss.NewStyle().Foreground(theme.TextMuted).Render(fmt.Sprintf("%d", len(d.files))),
	)

	return lipgloss.NewStyle().
		Width(d.width).
		Height(d.height).
		Padding(1, 2).
		Render(lipgloss.JoinVertical(lipgloss.Left,
			titleStyle.Render("◧ Diffs"),
			stats,
			"",
			content,
		))
}

// renderFileTree renders the file tree sidebar.
func (d DiffsPage) renderFileTree(width, height int) string {
	theme := tui.DefaultTheme

	var items []string
	for i, f := range d.files {
		var statusColor color.Color
		switch f.Status {
		case "M":
			statusColor = theme.AccentAmber
		case "A":
			statusColor = theme.AccentEmerald
		case "D":
			statusColor = theme.AccentRed
		}

		statusStyle := lipgloss.NewStyle().Foreground(statusColor)
		pathStyle := lipgloss.NewStyle().Foreground(theme.TextSecondary)

		statsStr := lipgloss.NewStyle().Foreground(theme.TextMuted).
			Render(fmt.Sprintf("+%d -%d", f.Additions, f.Deletions))

		line := fmt.Sprintf(" %s %s %s",
			statusStyle.Render(f.Status),
			pathStyle.Render(truncatePath(f.Path, width-14)),
			statsStr,
		)

		if i == d.cursor {
			items = append(items, lipgloss.NewStyle().
				Background(theme.BgTertiary).
				Foreground(theme.AccentCyan).
				Width(width - 2).
				Render(line))
		} else {
			items = append(items, lipgloss.NewStyle().
				Width(width - 2).
				Render(line))
		}
	}

	content := strings.Join(items, "\n")

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.BorderSubtle).
		Width(width).
		Height(height).
		Render(content)
}

// renderDiffView renders the diff content for the selected file.
func (d DiffsPage) renderDiffView(width, height int) string {
	theme := tui.DefaultTheme

	if len(d.files) == 0 {
		return lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(theme.BorderSubtle).
			Width(width).
			Height(height).
			Render(lipgloss.NewStyle().Foreground(theme.TextMuted).Render("  No file selected"))
	}

	file := d.files[d.cursor]
	lines := strings.Split(file.Diff, "\n")

	// Apply scroll offset
	if d.scrollPos >= len(lines) {
		d.scrollPos = max(0, len(lines)-1)
	}

	visibleLines := height - 2
	start := d.scrollPos
	end := start + visibleLines
	if end > len(lines) {
		end = len(lines)
	}

	var coloredLines []string
	for _, line := range lines[start:end] {
		switch {
		case strings.HasPrefix(line, "+"):
			coloredLines = append(coloredLines,
				lipgloss.NewStyle().Foreground(theme.AccentEmerald).Render(line))
		case strings.HasPrefix(line, "-"):
			coloredLines = append(coloredLines,
				lipgloss.NewStyle().Foreground(theme.AccentRed).Render(line))
		case strings.HasPrefix(line, "@@"):
			coloredLines = append(coloredLines,
				lipgloss.NewStyle().Foreground(theme.AccentCyan).Render(line))
		default:
			coloredLines = append(coloredLines,
				lipgloss.NewStyle().Foreground(theme.TextSecondary).Render(line))
		}
	}

	content := strings.Join(coloredLines, "\n")

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.BorderSubtle).
		Width(width).
		Height(height).
		Padding(0, 1).
		Render(content)
}

// truncatePath shortens a file path to fit within the given width.
func truncatePath(path string, maxLen int) string {
	if len(path) <= maxLen {
		return path
	}
	return "..." + path[len(path)-maxLen+3:]
}

// demoDiffFiles returns demo diff data.
func demoDiffFiles() []DiffFile {
	return []DiffFile{
		{
			Path: "internal/api/ws.go", Status: "M", Additions: 47, Deletions: 3,
			Diff: `@@ -42,6 +42,12 @@ type WSClient struct {
     token   string
     conn    *websocket.Conn
     state   WSState
+    // Reconnection settings
+    maxRetries     int
+    retryBaseDelay time.Duration
+    retryMaxDelay  time.Duration
+    retryCurrent   int
+    pendingQueue   chan WSMessage
     mu      sync.Mutex

     OnMessage     func(WSMessage)
@@ -95,3 +101,44 @@ func (w *WSClient) Close() error {
     w.setState(WSDisconnected)
     return err
 }
+
+// reconnect attempts to re-establish the WebSocket connection
+// with exponential backoff and jitter.
+func (w *WSClient) reconnect(path string) {
+    w.setState(WSReconnecting)
+    delay := w.retryBaseDelay
+
+    for attempt := 0; attempt < w.maxRetries; attempt++ {
+        jitter := time.Duration(rand.Int63n(500)) * time.Millisecond
+        time.Sleep(delay + jitter)
+
+        if err := w.Connect(path); err == nil {
+            w.flushPendingQueue()
+            return
+        }
+
+        delay *= 2
+        if delay > w.retryMaxDelay {
+            delay = w.retryMaxDelay
+        }
+    }
+
+    w.setState(WSDisconnected)
+    if w.OnError != nil {
+        w.OnError(fmt.Errorf("max reconnection attempts reached"))
+    }
+}`,
		},
		{
			Path: "internal/api/ws_test.go", Status: "A", Additions: 82, Deletions: 0,
			Diff: `@@ -0,0 +1,82 @@
+package api_test
+
+import (
+    "testing"
+    "time"
+
+    "github.com/niuulabs/volundr/cli/internal/api"
+)
+
+func TestWSClientReconnection(t *testing.T) {
+    client := api.NewWSClient("ws://localhost:8000", "test-token")
+
+    stateChanges := make([]api.WSState, 0)
+    client.OnStateChange = func(s api.WSState) {
+        stateChanges = append(stateChanges, s)
+    }
+
+    // Verify initial state
+    if client.State() != api.WSDisconnected {
+        t.Errorf("expected disconnected, got %v", client.State())
+    }
+}
+
+func TestWSClientPendingQueue(t *testing.T) {
+    client := api.NewWSClient("ws://localhost:8000", "test-token")
+
+    // Messages sent while disconnected should be queued
+    err := client.SendText("hello")
+    if err == nil {
+        t.Error("expected error when sending while disconnected")
+    }
+}`,
		},
		{
			Path: "internal/tui/pages/chat.go", Status: "M", Additions: 12, Deletions: 5,
			Diff: `@@ -156,8 +156,15 @@ func (c ChatPage) renderInput() string {
     prompt := lipgloss.NewStyle().
         Foreground(theme.AccentCyan).
-        Render("> ")
+        Bold(true).
+        Render("▸ ")

-    return prompt + c.input
+    cursor := ""
+    if c.inputActive {
+        cursor = lipgloss.NewStyle().
+            Foreground(theme.AccentCyan).
+            Render("█")
+    }
+
+    return prompt + c.input + cursor`,
		},
		{
			Path: "internal/config/config.go", Status: "M", Additions: 8, Deletions: 2,
			Diff: `@@ -15,6 +15,12 @@ type Config struct {
     Server string ` + "`yaml:\"server\"`" + `
     Token  string ` + "`yaml:\"token\"`" + `
     Theme  string ` + "`yaml:\"theme\"`" + `
+    // WebSocket reconnection settings
+    WSMaxRetries     int           ` + "`yaml:\"ws_max_retries\"`" + `
+    WSRetryBaseDelay time.Duration ` + "`yaml:\"ws_retry_base_delay\"`" + `
+    WSRetryMaxDelay  time.Duration ` + "`yaml:\"ws_retry_max_delay\"`" + `
 }`,
		},
	}
}
